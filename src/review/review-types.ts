/**
 * Review Server types and configuration.
 *
 * This module contains types specific to the local review server.
 * The server is a minimal local HTTP API for reviewing and editing
 * a Speech-to-Scene project.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { LocalAssetWriter } from "../application/ports/local-asset-writer.js";
import type { ReviewProjectView } from "../application/get-review-project.js";
import type { UpdateSceneDeps } from "../application/update-scene.js";
import type { UpdateSceneQueriesDeps } from "../application/update-scene-queries.js";
import type { SelectCandidateDeps } from "../application/select-candidate.js";
import type { SkipSceneDeps } from "../application/skip-scene.js";
import type { AttachLocalAssetDeps } from "../application/attach-local-asset.js";
import type { SearchProjectAssetsResult } from "../application/search-project-assets.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import type { SettingsView } from "../application/ports/settings-store.js";
import type { CreateProjectResult } from "../application/create-project.js";
import type { PlanProjectResult } from "../application/plan-script.js";

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
  /**
   * Absolute path to the static root directory for serving the React
   * Review Board build (default: `web/dist`).
   *
   * If not provided, static serving is disabled — only API endpoints
   * are available.
   *
   * M5-03
   */
  readonly staticRoot?: string;
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
  /** Project repository (used for loading/saving projects). */
  readonly repository: ProjectRepository;
  /** Local asset writer (used for writing uploaded files). M4-07 */
  readonly assetWriter: LocalAssetWriter;
  /** Application use case: getReviewProject(projectRoot, repository). */
  readonly getReviewProject: (
    projectRoot: string,
    repository: ProjectRepository,
  ) => Promise<ReviewProjectView>;
  /** Application use case: updateScene(input, deps). */
  readonly updateScene: (input: unknown, deps: UpdateSceneDeps) => Promise<SpeechToSceneProject>;
  /** Application use case: updateSceneQueries(input, deps). */
  readonly updateSceneQueries: (
    input: unknown,
    deps: UpdateSceneQueriesDeps,
  ) => Promise<SpeechToSceneProject>;
  /**
   * Application use case: searchSceneAssets(input).
   *
   * M4-05: Bound at the composition root with provider/cache factories.
   * The HTTP layer calls this with a validated input object and receives
   * the search result. Provider/cache creation is handled internally.
   */
  readonly searchSceneAssets: (input: unknown) => Promise<SearchProjectAssetsResult>;

  /** Application use case: selectCandidate(input, deps). M4-06 */
  readonly selectCandidate: (
    input: unknown,
    deps: SelectCandidateDeps,
  ) => Promise<SpeechToSceneProject>;

  /** Application use case: skipScene(input, deps). M4-06 */
  readonly skipScene: (input: unknown, deps: SkipSceneDeps) => Promise<SpeechToSceneProject>;

  /** Application use case: attachLocalAsset(input, deps). M4-07 */
  readonly attachLocalAsset: (
    input: unknown,
    deps: AttachLocalAssetDeps,
  ) => Promise<SpeechToSceneProject>;

  /** Application: load settings (desensitized view). Wired in E1. */
  readonly getSettings?: () => Promise<SettingsView>;
  /** Application: save settings (merged, returns desensitized view). Wired in E1. */
  readonly saveSettings?: (input: unknown) => Promise<SettingsView>;
  /** Application: create project from in-memory content bytes. Wired in E1. */
  readonly createProjectFromContent?: (input: unknown) => Promise<CreateProjectResult>;
  /** Application: plan project (slice script into scenes). Wired in E1. */
  readonly planProject?: (input: unknown) => Promise<PlanProjectResult>;
  /** Application: search all project assets (whole-project search). Wired in E1. */
  readonly searchProjectAssets?: (input: unknown) => Promise<SearchProjectAssetsResult>;
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
 *
 * For M4-04B, `path` may contain `:param` segments (e.g.,
 * `/api/scenes/:sceneId`). The `matchRoute` function extracts these
 * parameters and passes them to the handler via `RouteParams.pathParams`.
 */
export interface RouteDefinition {
  /** The URL path pattern. May contain `:param` segments. */
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
