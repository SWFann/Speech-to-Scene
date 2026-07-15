/**
 * Router for the Review Server.
 *
 * Defines all API routes and handles path matching.
 * M4-02: GET /api/health (no token required)
 * M4-03B: GET /api/project (session token required)
 *
 * Response utilities (applySecurityHeaders, sendError, sendSuccess, etc.)
 * are NOT defined here — they live in security/response-headers.ts and
 * json-response.ts. This file only defines routes and path matching.
 */

import type { RouteDefinition } from "./review-types.js";
import type { ReviewServerDependencies } from "./review-types.js";
import { sendSuccess, sendError, sendInternalError } from "./json-response.js";
import type { ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

/**
 * Creates the route table for the server.
 *
 * @param config - The resolved server configuration.
 * @param getBoundPort - A function that returns the current bound port.
 *   This is needed because the port may be 0 at creation time (OS-assigned).
 * @param deps - Injected dependencies (repository, application use cases).
 */
export function createRoutes(config: {
  readonly projectRoot: string;
  readonly host: string;
  readonly getBoundPort: () => number;
  readonly version: string;
  readonly deps?: ReviewServerDependencies;
}): RouteDefinition[] {
  const routes: RouteDefinition[] = [
    {
      path: "/api/health",
      methods: ["GET"],
      handler: (_req, res) => {
        sendSuccess(res, 200, {
          projectRoot: config.projectRoot,
          host: config.host,
          port: config.getBoundPort(),
          version: config.version,
        });
      },
    },
  ];

  // M4-03B: GET /api/project (requires session token)
  if (config.deps) {
    const { repository, getReviewProject } = config.deps;
    routes.push({
      path: "/api/project",
      methods: ["GET"],
      handler: async (_req, res) => {
        try {
          const project = await getReviewProject(config.projectRoot, repository);
          sendSuccess(res, 200, { project });
        } catch (error) {
          // Map errors to safe HTTP responses — never leak internal details
          mapProjectLoadError(error, res);
        }
      },
    });
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Maps project loading errors to safe HTTP responses.
 *
 * Never includes the original exception message, stack trace, or absolute paths.
 */
function mapProjectLoadError(error: unknown, res: ServerResponse): void {
  const err = error as { code?: string };
  const code = err?.code ?? "";

  // ProjectNotFoundError → 404
  if (code === "project_not_found") {
    sendError(res, 404, "not_found", "Project not found", "Ensure the project was created");
    return;
  }

  // ProjectValidationError → 409
  if (
    code === "project_validation_error" ||
    code === "unsupported_schema_version" ||
    code === "project_file_too_large" ||
    code === "source_document_error"
  ) {
    sendError(res, 409, "conflict", "Project data is invalid", undefined);
    return;
  }

  // Unknown I/O or other errors → 500
  // Never include the original error message
  sendInternalError(res);
}

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

/**
 * Finds a matching route for the request method and path.
 */
export function matchRoute(
  routes: RouteDefinition[],
  method: string,
  urlPath: string,
): RouteDefinition | undefined {
  return routes.find((r) => r.path === urlPath && r.methods.includes(method));
}

/**
 * Parses path parameters from a route path.
 *
 * For M4-02+, only exact-match routes are used, so this returns an empty object.
 * Future milestones can add :param extraction here.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future M4-03+ route param extraction
export function parseRouteParams(_routePath: string, _requestPath: string): Record<string, string> {
  return {};
}
