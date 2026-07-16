/**
 * Minimal local HTTP review server for Speech-to-Scene.
 *
 * Security flow (M4-02F1+):
 * - Host Gate runs BEFORE route matching (pre-routing)
 * - Route matching and 404/405 happen AFTER Host validation
 * - Origin/Token validation runs only for matched mutating routes (post-routing)
 * - All responses include security headers
 * - Session token is validated at startup (not just on requests)
 *
 * M4-03B: GET /api/project requires session token (GET is not mutating,
 * but the project endpoint is token-gated to prevent unauthenticated access
 * to project data).
 *
 * Uses Node built-in `node:http`; no web framework.
 *
 * Security notes:
 * - Binds to loopback (127.0.0.1) by default.
 * - Rejects non-loopback host at startup.
 * - All responses include security headers.
 * - No arbitrary filesystem paths are accepted from clients.
 * - Session token is generated at startup and returned to the CLI caller.
 * - Token is NOT exposed in GET /api/health or error responses.
 * - projectRoot is fixed at startup; clients cannot change it via query/body/header.
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
import { validateConfiguredToken, generateSessionToken } from "./security/session-token.js";
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
import { validateSessionToken } from "./security/session-token.js";
import { isApiPath, serveStatic } from "./static-serving.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Server version identifier. */
export const SERVER_VERSION = "s2s-review-server/0.1";

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resolveProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

// ---------------------------------------------------------------------------
// Token-gated routes (M4-03B)
// ---------------------------------------------------------------------------

/**
 * Routes that require a valid session token even for GET methods.
 * These expose project data that must not be accessible without authentication.
 */
const TOKEN_GATED_PATHS = new Set(["/api/project"]);

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
 * 6. Token gate for token-gated GET routes
 * 7. Post-routing gate: Origin + Token (for mutating methods only)
 * 8. Execute route handler
 */
function createRequestHandler(
  config: ReviewServerConfig,
  boundPortRef: { current: number },
  deps?: ReviewServerDependencies,
): http.RequestListener {
  const routes = createRoutes({
    projectRoot: config.projectRoot,
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
      boundToken: config.token,
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

    // 4. Token gate for token-gated GET routes (before post-routing Origin/Token gate)
    if (TOKEN_GATED_PATHS.has(urlPath) && method === "GET") {
      const tokenResult = validateSessionToken(req, config.token);
      if (!tokenResult.valid) {
        const statusCode = tokenResult.reason === "session_required" ? 401 : 403;
        const errorCode = tokenResult.reason ?? "session_rejected";
        sendError(
          res,
          statusCode,
          errorCode,
          statusCode === 401 ? "Session token is required" : "Session token is invalid",
          statusCode === 401 ? "Provide X-S2S-Session header" : undefined,
        );
        return;
      }
    }

    // 5. Post-routing gate: method (defense-in-depth) + Origin/Token (mutating)
    const postRoutingResult = runPostRoutingGate(req, method, route.methods, securityConfig);
    if (!postRoutingResult.passed) {
      postRoutingResult.rejection!.apply(res);
      return;
    }

    // 6. Execute route handler
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
 * The project root is resolved to an absolute path at startup. The server
 * binds only to loopback addresses.
 *
 * Token handling:
 * - If `token` is provided, it is validated via `validateConfiguredToken`
 *   BEFORE the server binds to any port. Invalid tokens prevent startup.
 * - If `token` is not provided, a random UUID token is generated.
 * - Token validation errors never include the token itself.
 *
 * Dependencies (M4-03B):
 * - `deps` contains the ProjectRepository and getReviewProject use case.
 * - If deps is omitted, only GET /api/health is available (backward compat).
 *
 * @param config - Server configuration. `token` is optional; a random token
 *   is generated if not provided. `version` defaults to `SERVER_VERSION`.
 * @param deps - Optional dependencies for M4-03B routes.
 * @returns A handle containing the bound port, session token, and close method.
 * @throws Error if the token fails validation or the host is not loopback.
 */
export async function startReviewServer(
  config: Omit<ReviewServerConfig, "token" | "version"> & {
    token?: string;
    version?: string;
  },
  deps?: ReviewServerDependencies,
): Promise<ReviewServerHandle> {
  // Validate host before binding
  validateConfiguredBindHost(config.host);

  // Resolve project root to absolute, normalized path
  const projectRoot = resolveProjectRoot(config.projectRoot);

  // Token: validate if provided, generate if not
  const token = config.token ?? generateSessionToken();
  if (config.token !== undefined) {
    validateConfiguredToken(token);
  }

  const fullConfig: ReviewServerConfig = {
    projectRoot,
    host: config.host,
    port: config.port,
    token,
    version: config.version ?? SERVER_VERSION,
    ...(config.staticRoot !== undefined ? { staticRoot: config.staticRoot } : {}),
  };

  const boundPortRef = { current: config.port };
  const server = http.createServer(createRequestHandler(fullConfig, boundPortRef, deps));

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
        token,
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
