/**
 * Static file serving for the Review Server.
 *
 * Serves the built React Review Board from a configurable static root
 * (default: `web/dist`). This allows `s2s review` to serve the UI directly
 * without requiring a separate Vite dev server.
 *
 * Security model:
 * - API routes (`/api/*`) are NEVER handled by static serving.
 * - Path traversal is blocked at three layers:
 *   1. Raw URL path must not contain `..`
 *   2. Decoded URL path must not contain `..` (catches `%2e%2e`)
 *   3. Resolved path must remain within the static root (defense-in-depth)
 * - NUL and control characters are rejected.
 * - Symlinks that escape the static root are rejected via `fs.realpath`.
 * - Static responses include security headers with a CSP appropriate for
 *   serving a React SPA (scripts, styles, and images from same origin).
 * - No wildcard CORS is added.
 * - The `Referrer-Policy: no-referrer` header prevents leaking `?token=`
 *   in the URL when the browser loads remote thumbnails.
 *
 * SPA fallback:
 * - Non-API GET paths that don't map to an existing file fall back to
 *   `index.html`, enabling client-side routing.
 * - Paths with a file extension that don't exist return 404 (not index.html).
 *
 * Missing build:
 * - If `web/dist/index.html` does not exist, `GET /` returns a friendly
 *   HTML error page telling the user to run `pnpm web:build`.
 * - API endpoints remain fully functional.
 * - The error page never leaks absolute paths.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { sendError } from "./json-response.js";
import { ERROR_NOT_FOUND, ERROR_INVALID_REQUEST } from "./http-errors.js";

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

/**
 * Maps file extensions to Content-Type header values.
 *
 * At minimum covers the types required by the Review Board build:
 * .html, .js, .css, .svg, .png, .jpg/.jpeg.
 * Unknown extensions default to `application/octet-stream`.
 */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const DEFAULT_MIME_TYPE = "application/octet-stream";

/**
 * Returns the Content-Type for a file based on its extension.
 */
export function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;
}

// ---------------------------------------------------------------------------
// Security headers for static responses
// ---------------------------------------------------------------------------

/**
 * CSP for static responses.
 *
 * Allows the React SPA to:
 * - Load scripts and styles from same origin (the bundled JS/CSS)
 * - Load images from same origin and remote HTTPS (Pexels thumbnails)
 * - Load data: URIs (used by some image placeholders)
 * - Make API calls to same origin
 *
 * Prevents:
 * - Inline scripts and styles (XSS mitigation)
 * - Framing (clickjacking mitigation)
 * - Loading from disallowed origins
 */
const STATIC_CSP =
  "default-src 'self'; " +
  "img-src 'self' https: data:; " +
  "style-src 'self'; " +
  "script-src 'self'; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'";

/**
 * Applies security headers appropriate for static file responses.
 *
 * These differ from the API security headers:
 * - CSP allows scripts, styles, and images (needed for the SPA)
 * - Content-Type is set per-file by the caller
 *
 * Shared with API headers:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Referrer-Policy: no-referrer (prevents leaking ?token= in URL)
 */
function applyStaticSecurityHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", STATIC_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Checks if a URL path is an API path.
 *
 * API paths start with `/api/` or are exactly `/api`.
 * These are NEVER handled by static serving.
 */
export function isApiPath(urlPath: string): boolean {
  return urlPath === "/api" || urlPath.startsWith("/api/");
}

/**
 * Safely decodes a URI component without throwing.
 *
 * Returns `null` if the input contains malformed percent-encoding.
 */
function safeDecodeURIComponent(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Resolves a request URL path to a safe filesystem path within the static root.
 *
 * Security checks (all must pass):
 * 1. Raw URL must not contain `..` (catches literal traversal)
 * 2. Decoded URL must not contain `..` (catches `%2e%2e` encoded traversal)
 * 3. Decoded URL must not contain NUL or control characters
 * 4. Resolved path must be within the static root (defense-in-depth)
 *
 * @param staticRoot - Absolute path to the static root directory.
 * @param urlPath - The URL path from the request (e.g., `/assets/index.js`).
 * @returns The safe absolute file path, or `null` if the path is unsafe.
 */
export function resolveStaticPath(staticRoot: string, urlPath: string): string | null {
  // 1. Reject literal `..` in the raw URL
  if (urlPath.includes("..")) {
    return null;
  }

  // 2. Decode the URL path (catches %2e%2e → ..)
  const decoded = safeDecodeURIComponent(urlPath);
  if (decoded === null) {
    // Malformed percent-encoding
    return null;
  }

  // 3. Reject decoded `..` (catches encoded traversal)
  if (decoded.includes("..")) {
    return null;
  }

  // 4. Reject NUL and control characters
  // eslint-disable-next-line no-control-regex -- intentional security check
  if (/[\x00-\x1F\x7F]/.test(decoded)) {
    return null;
  }

  // 5. Build the relative path from the decoded URL
  const relativePath = decoded.replace(/^\//, "");

  // 6. Resolve to absolute path within the static root
  const resolved = path.resolve(staticRoot, relativePath);
  const normalizedRoot = path.resolve(staticRoot);

  // 7. Verify the resolved path is still within the static root
  // The path must either be the root itself or start with root + separator
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    return null;
  }

  return resolved;
}

/**
 * Checks whether a resolved file path is still within the static root
 * after following symlinks.
 *
 * This is a defense-in-depth check against symlink escapes. If the file
 * is a symlink that points outside the static root, it is rejected.
 *
 * @param resolvedPath - The resolved absolute file path.
 * @param staticRoot - The absolute static root path.
 * @returns `true` if the real path is within the static root, `false` otherwise.
 */
async function isWithinStaticRoot(resolvedPath: string, staticRoot: string): Promise<boolean> {
  const normalizedRoot = path.resolve(staticRoot);

  try {
    // fs.realpath resolves symlinks to their actual target
    const realPath = await fsp.realpath(resolvedPath);
    return realPath === normalizedRoot || realPath.startsWith(normalizedRoot + path.sep);
  } catch {
    // File doesn't exist or can't be resolved — not a symlink escape
    // The caller will handle the "file not found" case separately
    return true;
  }
}

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------

/**
 * Checks if a URL path should fall back to index.html (SPA routing).
 *
 * Returns `true` if:
 * - The path does NOT have a file extension, OR
 * - The path is exactly `/` or `/index.html`
 *
 * Returns `false` if:
 * - The path has a file extension (e.g., `/assets/missing.js`)
 *   — these should return 404, not the SPA
 */
function shouldSpaFallback(urlPath: string): boolean {
  // Root and index.html always get index.html
  if (urlPath === "/" || urlPath === "/index.html") {
    return true;
  }

  // If the path has a file extension, don't fall back to SPA
  const lastSegment = urlPath.split("/").pop() ?? "";
  if (lastSegment.includes(".")) {
    return false;
  }

  // No file extension — SPA fallback (client-side routing)
  return true;
}

// ---------------------------------------------------------------------------
// Missing build page
// ---------------------------------------------------------------------------

/**
 * HTML error page shown when the Review Board build is missing.
 *
 * Never includes absolute paths or sensitive information.
 * The message tells the user to run `pnpm web:build`.
 */
const MISSING_BUILD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Review Board build is missing</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #1d1f24; }
    h1 { font-size: 20px; color: #b42318; }
    p { color: #606874; line-height: 1.6; }
    code { background: #f0f0ec; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Review Board build is missing</h1>
  <p>The React Review Board has not been built yet. Run:</p>
  <p><code>pnpm web:build</code></p>
  <p>Then restart the review server. API endpoints are still available.</p>
</body>
</html>`;

/**
 * Serves the missing-build HTML error page.
 *
 * This is used when `web/dist/index.html` does not exist.
 * The response includes security headers and a 503 status code.
 */
function serveMissingBuildPage(res: ServerResponse): void {
  applyStaticSecurityHeaders(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 503;
  res.end(MISSING_BUILD_HTML);
}

// ---------------------------------------------------------------------------
// File serving
// ---------------------------------------------------------------------------

/**
 * Serves a file from the filesystem with appropriate headers.
 *
 * @param res - The HTTP response object.
 * @param filePath - The absolute path to the file to serve.
 * @param method - The HTTP method (GET or HEAD).
 * @param isHtml - Whether this is an HTML file (affects Cache-Control).
 */
async function serveFile(
  res: ServerResponse,
  filePath: string,
  method: string,
  isHtml: boolean,
): Promise<void> {
  try {
    const stat = await fsp.stat(filePath);

    if (!stat.isFile()) {
      // Not a regular file (could be a directory) — 404
      sendError(res, 404, ERROR_NOT_FOUND, "Not found");
      return;
    }

    const contentType = getContentType(filePath);

    // Apply security headers
    applyStaticSecurityHeaders(res);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);

    // Cache-Control: no-store for HTML (always get fresh SPA shell)
    // Cache-Control: long max-age for hashed assets (safe to cache)
    if (isHtml) {
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }

    res.statusCode = 200;

    if (method === "HEAD") {
      res.end();
    } else {
      // Stream the file for efficiency
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          sendError(res, 500, "internal_error", "Internal server error");
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      // File not found — 404
      sendError(res, 404, ERROR_NOT_FOUND, "Not found");
    } else if (err.code === "EACCES") {
      // Permission denied — 404 (don't reveal the reason)
      sendError(res, 404, ERROR_NOT_FOUND, "Not found");
    } else {
      // Other errors — 500
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "Internal server error");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main static serving entry point
// ---------------------------------------------------------------------------

/**
 * Result of attempting to handle a request as static.
 *
 * - `handled`: The request was handled (file served, SPA fallback, or error).
 * - `notHandled`: The request was not a static request (should fall through
 *   to the normal 404/405 logic).
 */
export type StaticServeResult = {
  readonly handled: boolean;
};

/**
 * Attempts to serve a static file for the given request.
 *
 * This is called by the review server AFTER API route matching fails,
 * and ONLY for non-API paths.
 *
 * Logic:
 * 1. If method is not GET or HEAD → return 404 (not handled as static)
 * 2. If the static root doesn't have index.html → serve missing-build page
 * 3. Resolve the URL path to a safe filesystem path
 * 4. If the path is unsafe (traversal) → 400
 * 5. If the file exists and is within the static root → serve it
 * 6. If the file doesn't exist:
 *    a. If the path has a file extension → 404 (missing asset)
 *    b. If the path doesn't have an extension → SPA fallback (serve index.html)
 *
 * @param req - The incoming HTTP request.
 * @param res - The HTTP response object.
 * @param staticRoot - Absolute path to the static root directory.
 * @param method - The HTTP method.
 * @param urlPath - The URL path (without query string).
 * @returns `{ handled: true }` if the request was handled, `{ handled: false }` otherwise.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticRoot: string,
  method: string,
  urlPath: string,
): Promise<StaticServeResult> {
  // Only handle GET and HEAD for static files
  if (method !== "GET" && method !== "HEAD") {
    // Non-GET/HEAD to a non-API path — 404 (don't enter API mutation logic)
    sendError(res, 404, ERROR_NOT_FOUND, "Not found");
    return { handled: true };
  }

  const indexPath = path.resolve(staticRoot, "index.html");

  // Check if the build exists
  let indexExists: boolean;
  try {
    await fsp.access(indexPath);
    indexExists = true;
  } catch {
    indexExists = false;
  }

  if (!indexExists) {
    // Missing build — serve friendly error page
    serveMissingBuildPage(res);
    return { handled: true };
  }

  // Resolve the URL path to a safe filesystem path
  const filePath = resolveStaticPath(staticRoot, urlPath);
  if (filePath === null) {
    // Path traversal attempt or malformed encoding — 400
    sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid path");
    return { handled: true };
  }

  // Check if the file exists
  let fileExists: boolean;
  try {
    const stat = await fsp.stat(filePath);
    fileExists = stat.isFile();
  } catch {
    fileExists = false;
  }

  if (fileExists) {
    // Verify the file is within the static root (symlink protection)
    const withinRoot = await isWithinStaticRoot(filePath, staticRoot);
    if (!withinRoot) {
      // Symlink escape — reject
      sendError(res, 400, ERROR_INVALID_REQUEST, "Invalid path");
      return { handled: true };
    }

    // Serve the file
    const isHtml = path.extname(filePath).toLowerCase() === ".html";
    await serveFile(res, filePath, method, isHtml);
    return { handled: true };
  }

  // File doesn't exist — check for SPA fallback
  if (shouldSpaFallback(urlPath)) {
    // SPA fallback — serve index.html
    await serveFile(res, indexPath, method, true);
    return { handled: true };
  }

  // Missing asset with a file extension — 404
  sendError(res, 404, ERROR_NOT_FOUND, "Not found");
  return { handled: true };
}
