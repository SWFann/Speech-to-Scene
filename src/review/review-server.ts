/**
 * Minimal local HTTP review server for Speech-to-Scene.
 *
 * Phase 3 security model:
 * - Loopback binding (127.0.0.1 only) — never exposed to the network
 * - Host Gate runs BEFORE route matching (pre-routing, prevents DNS rebinding)
 * - Route matching and 404/405 happen AFTER Host validation
 * - Origin validation runs only for matched mutating routes (post-routing, prevents CSRF)
 * - Session token removed — loopback + Host + Origin is sufficient
 * - All responses include security headers
 *
 * Phase 3 multi-project support:
 * - `workspaceRoot` is the parent directory of all projects
 * - `projectRoot` is the current active project (mutable at runtime)
 * - `POST /api/project/switch` updates the active project root
 * - `DELETE /api/project` deletes the active project and sets it to null
 *
 * Uses Node built-in `node:http`; no web framework.
 *
 * M5-03: Static file serving for the React Review Board.
 * - If `staticRoot` is provided in the config, non-API GET/HEAD paths are
 *   served from the static root (default: `web/dist`).
 * - API routes always take priority over static serving.
 * - `/api/*` paths that don't match any API route still get API 404/405.
 * - Non-API paths that don't match a file fall back to `index.html` (SPA).
 * - Path traversal is blocked at multiple layers.
 */

import http from "node:http";
import path from "node:path";

import type {
  ReviewServerConfig,
  ReviewServerHandle,
  ReviewServerDependencies,
} from "./review-types.js";
import { validateConfiguredBindHost } from "./security/host-validation.js";
import {
  createRoutes,
  matchRoute,
  getMatchedParams,
  matchPath,
  pathHasMalformedEncoding,
} from "./router.js";
import {
  applySecurityHeaders,
  applySecurityHeadersWithAllow,
} from "./security/response-headers.js";
import { sendError, sendInternalError } from "./json-response.js";
import {
  checkHostGate,
  runPostRoutingGate,
  type RequestSecurityConfig,
} from "./request-security.js";
import { ERROR_NOT_FOUND, ERROR_METHOD_NOT_ALLOWED, ERROR_INVALID_REQUEST } from "./http-errors.js";
import { isApiPath, serveStatic } from "./static-serving.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Server version identifier. */
export const SERVER_VERSION = "s2s-review-server/0.1";

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 300_000;
const HEADERS_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resolveWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function resolveProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

// ---------------------------------------------------------------------------
// Mutable project root reference
// ---------------------------------------------------------------------------

/**
 * A mutable container for the current active project root.
 *
 * Phase 3: the active project can change at runtime via
 * POST /api/project/switch. Routes read from this ref via a getter
 * function so they always see the current value.
 */
export interface ProjectRootRef {
  current: string | null;
}

// ---------------------------------------------------------------------------
// Request handler factory
// ---------------------------------------------------------------------------

/**
 * Creates the per-request handler for the HTTP server.
 *
 * Security execution order:
 * 1. Parse request (method, URL path)
 * 2. Apply base security headers
 * 3. Pre-routing Host Gate (validates Host on ALL requests)
 * 4. Route matching (path + method)
 * 5. If no route match: 404 (unknown path) or 405 (known path, wrong method)
 * 6. Post-routing gate: Origin (for mutating methods only)
 * 7. Execute route handler
 *
 * Phase 3: token gate removed. projectRoot is now a mutable ref.
 */
function createRequestHandler(
  config: ReviewServerConfig,
  projectRootRef: ProjectRootRef,
  boundPortRef: { current: number },
  deps?: ReviewServerDependencies,
): http.RequestListener {
  const routes = createRoutes({
    workspaceRoot: config.workspaceRoot,
    projectRootRef,
    host: config.host,
    getBoundPort: () => boundPortRef.current,
    version: config.version,
    ...(deps !== undefined ? { deps } : {}),
  });

  return (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const urlPath = url.split("?")[0] ?? "/";

    // Build security config dynamically to read the actual bound port
    const securityConfig: RequestSecurityConfig = {
      boundHost: config.host,
      boundPort: boundPortRef.current,
    };

    // 1. Apply base security headers to every response
    applySecurityHeaders(res);

    // 2. Pre-routing: Host Gate (runs on ALL requests, even unknown paths)
    const hostResult = checkHostGate(req, securityConfig);
    if (!hostResult.passed) {
      hostResult.rejection!.apply(res);
      return;
    }

    // 3. Route matching (path + method)
    const route = matchRoute(routes, method, urlPath);

    if (route === undefined) {
      // Check if path exists but method is wrong → 405
      // Use matchPath to detect path-only matches (works for param routes too)
      const matchingPath = routes.find((r) => {
        const params: Record<string, string> = {};
        return matchPath(r.path, urlPath, params);
      });
      if (matchingPath) {
        applySecurityHeadersWithAllow(res, [...matchingPath.methods]);
        sendError(
          res,
          405,
          ERROR_METHOD_NOT_ALLOWED,
          `Method ${method} is not allowed for ${urlPath}`,
        );
        return;
      }

      // M5-03: Static file serving for non-API paths.
      //
      // If staticRoot is configured and the path is NOT an API path,
      // attempt to serve a static file (React Review Board). This includes:
      // - GET / → index.html
      // - GET /assets/* → bundled JS/CSS
      // - GET /review → SPA fallback to index.html
      // - Path traversal attempts → 400
      // - Missing build → friendly error page
      //
      // API paths (/api/*) are NEVER handled by static serving — they
      // always get API 404/405/400 responses.
      if (config.staticRoot !== undefined && !isApiPath(urlPath)) {
        serveStatic(req, res, config.staticRoot, method, urlPath).catch(() => {
          if (!res.headersSent) {
            sendInternalError(res);
          } else {
            res.destroy();
          }
        });
        return;
      }

      // Check for malformed percent-encoding before falling through to 404.
      // A malformed path segment (e.g. /api/scenes/%E0%A4%A) must return
      // 400 invalid_request, not 404 or 500.
      if (pathHasMalformedEncoding(urlPath)) {
        sendError(res, 400, ERROR_INVALID_REQUEST, "Malformed URL encoding");
        return;
      }

      // Unknown path → 404
      sendError(res, 404, ERROR_NOT_FOUND, "Not found");
      return;
    }

    // 4. Post-routing gate: method (defense-in-depth) + Origin (mutating)
    const postRoutingResult = runPostRoutingGate(req, method, route.methods, securityConfig);
    if (!postRoutingResult.passed) {
      postRoutingResult.rejection!.apply(res);
      return;
    }

    // 5. Execute route handler
    try {
      const params = { pathParams: getMatchedParams(route) };
      const result = route.handler(req, res, params);

      // Handle async handlers — destroy response safely if headers already sent
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          if (!res.headersSent) {
            sendInternalError(res);
          } else {
            res.destroy();
          }
        });
      }
    } catch {
      if (!res.headersSent) {
        sendInternalError(res);
      } else {
        res.destroy();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

/**
 * Starts the review server.
 *
 * The workspace root and project root are resolved to absolute paths at
 * startup. The server binds only to loopback addresses.
 *
 * Phase 3:
 * - Session token removed. Security relies on loopback + Host + Origin.
 * - `workspaceRoot` is required for multi-project support.
 * - `projectRoot` may be null (no active project → shows project list).
 *
 * Dependencies:
 * - `deps` contains the ProjectRepository and use cases.
 * - If deps is omitted, only GET /api/health is available (backward compat).
 *
 * @param config - Server configuration. `version` defaults to `SERVER_VERSION`.
 * @param deps - Optional dependencies for API routes.
 * @returns A handle containing the bound port and close method.
 * @throws Error if the host is not loopback.
 */
export async function startReviewServer(
  config: Omit<ReviewServerConfig, "workspaceRoot" | "version"> & {
    workspaceRoot?: string;
    version?: string;
  },
  deps?: ReviewServerDependencies,
): Promise<ReviewServerHandle> {
  // Validate host before binding
  validateConfiguredBindHost(config.host);

  // Resolve workspace root (defaults to parent of projectRoot)
  const workspaceRoot = resolveWorkspaceRoot(
    config.workspaceRoot ?? path.dirname(path.resolve(config.projectRoot)),
  );

  // Resolve project root to absolute, normalized path
  const initialProjectRoot = resolveProjectRoot(config.projectRoot);

  const fullConfig: ReviewServerConfig = {
    workspaceRoot,
    projectRoot: initialProjectRoot,
    host: config.host,
    port: config.port,
    version: config.version ?? SERVER_VERSION,
    ...(config.staticRoot !== undefined ? { staticRoot: config.staticRoot } : {}),
  };

  // Phase 3: mutable project root ref for runtime switching
  const projectRootRef: ProjectRootRef = { current: initialProjectRoot };

  const boundPortRef = { current: config.port };
  const server = http.createServer(
    createRequestHandler(fullConfig, projectRootRef, boundPortRef, deps),
  );

  // Configure timeouts
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.timeout = REQUEST_TIMEOUT_MS;

  // Bind to the requested port (0 means OS-assigned port)
  return new Promise<ReviewServerHandle>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };

    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        boundPortRef.current = address.port;
      }

      resolve({
        port: boundPortRef.current,
        close: (): Promise<void> =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    };

    server.on("error", onError);
    server.on("listening", onListening);
    server.listen(config.port, config.host);
  });
}