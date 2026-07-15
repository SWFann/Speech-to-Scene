/**
 * Review Server types and configuration.
 *
 * This module contains types specific to the local review server.
 * The server is a minimal local HTTP API for reviewing and editing
 * a Speech-to-Scene project.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { ReviewProjectView } from "../application/get-review-project.js";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the review server.
 */
export interface ReviewServerConfig {
  /** Absolute path to the project root directory. */
  readonly projectRoot: string;
  /** Host to bind to. Must be a loopback address. */
  readonly host: string;
  /** Port to listen on. */
  readonly port: number;
  /** Session token for mutating requests. */
  readonly token: string;
  /** Server version identifier. */
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Server dependencies (M4-03B)
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the Review Server from the CLI composition root.
 *
 * The HTTP layer never instantiates JsonProjectRepository or any other
 * infrastructure provider directly. All application use cases are injected
 * as functions.
 */
export interface ReviewServerDependencies {
  /** Project repository (used for loading projects). */
  readonly repository: ProjectRepository;
  /** Application use case: getReviewProject(projectRoot, repository). */
  readonly getReviewProject: (
    projectRoot: string,
    repository: ProjectRepository,
  ) => Promise<ReviewProjectView>;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Minimal JSON response body shape for API endpoints.
 */
export interface JsonResponse {
  ok?: boolean;
  projectRoot?: string;
  host?: string;
  port?: number;
  version?: string;
  project?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Returned by `startReviewServer`. Provides lifecycle control and session info.
 */
export interface ReviewServerHandle {
  /** The bound port number. */
  readonly port: number;
  /** The session token (auto-generated or user-provided). */
  readonly token: string;
  /** Gracefully shuts down the server. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Health response shape
// ---------------------------------------------------------------------------

/**
 * Response body for GET /api/health.
 *
 * NOTE: The session token is intentionally NOT included in the health response.
 * Tokens are provided to CLI users at startup and used via X-S2S-Session header
 * for mutating requests (M4-02+).
 */
export interface HealthResponse {
  ok: true;
  projectRoot: string;
  host: string;
  port: number;
  version: string;
}

// ---------------------------------------------------------------------------
// Route definitions (M4-02)
// ---------------------------------------------------------------------------

/**
 * Definition of a single API route.
 */
export interface RouteDefinition {
  /** The URL path pattern (exact match for M4-02). */
  readonly path: string;
  /** Allowed HTTP methods for this route. */
  readonly methods: readonly string[];
  /** Request handler function. */
  readonly handler: RouteHandler;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
) => void | Promise<void>;

/**
 * Extracted route parameters.
 */
export interface RouteParams {
  /** Path parameters extracted from the URL (e.g., sceneId from /api/scenes/:sceneId). */
  readonly pathParams: Record<string, string>;
}
