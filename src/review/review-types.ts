/**
 * Review Server types and configuration.
 *
 * This module contains types specific to the local review server.
 * The server is a minimal local HTTP API for reviewing and editing
 * a Speech-to-Scene project.
 *
 * Phase 3: session token removed (loopback + Host + Origin is sufficient).
 * `workspaceRoot` added for multi-project support.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { ReviewProjectView } from "../application/get-review-project.js";
import type { UpdateSceneDeps } from "../application/update-scene.js";
import type { UpdateSceneQueriesDeps } from "../application/update-scene-queries.js";
import type { SearchProjectAssetsResult } from "../application/search-project-assets.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import type { SettingsView } from "../application/ports/settings-store.js";
import type { CreateProjectResult } from "../application/create-project.js";
import type { PlanProjectResult } from "../application/plan-script.js";
import type { ListProjectsResult } from "../application/list-projects.js";
import type { SwitchProjectResult } from "../application/switch-project.js";
import type { DeleteProjectResult } from "../application/delete-project.js";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the review server.
 *
 * Phase 3: `workspaceRoot` added for multi-project support. `projectRoot`
 * is the current active project (mutable at runtime via /api/project/switch).
 * Session token removed — loopback + Host + Origin is sufficient.
 */
export interface ReviewServerConfig {
  /** Absolute path to the workspace root directory (parent of all projects). */
  readonly workspaceRoot: string;
  /** Absolute path to the current active project root directory. */
  readonly projectRoot: string;
  /** Host to bind to. Must be a loopback address. */
  readonly host: string;
  /** Port to listen on. */
  readonly port: number;
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
 *
 * Phase 3: added listProjects, switchProject, deleteProject for multi-project
 * workspace support.
 */
export interface ReviewServerDependencies {
  /** Project repository (used for loading/saving projects). */
  readonly repository: ProjectRepository;
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
   * Bound at the composition root with provider/cache factories and the link
   * suggestion generator. The HTTP layer calls this with a validated input
   * object and receives the search result. Provider/cache creation is handled
   * internally.
   */
  readonly searchSceneAssets: (input: unknown) => Promise<SearchProjectAssetsResult>;

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
  /** Application: generate AI image for a scene. Wired in Phase 2. */
  readonly generateSceneImage?: (input: unknown) => Promise<SpeechToSceneProject>;

  /** Phase 3: list all projects in the workspace. */
  readonly listProjects?: (workspaceRoot: string) => Promise<ListProjectsResult>;
  /** Phase 3: switch to a different project. */
  readonly switchProject?: (input: unknown) => Promise<SwitchProjectResult>;
  /** Phase 3: delete the current active project. */
  readonly deleteProject?: (input: unknown) => Promise<DeleteProjectResult>;
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
  projects?: readonly unknown[];
  activeProject?: string | null;
  error?: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Returned by `startReviewServer`. Provides lifecycle control.
 *
 * Phase 3: session token field removed.
 */
export interface ReviewServerHandle {
  /** The bound port number. */
  readonly port: number;
  /** Gracefully shuts down the server. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Health response shape
// ---------------------------------------------------------------------------

/**
 * Response body for GET /api/health.
 *
 * Phase 3: token reference removed (no session token mechanism).
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
