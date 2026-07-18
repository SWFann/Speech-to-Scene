/**
 * Project status derivation.
 *
 * Status is never persisted; it is derived from project data by a pure
 * function. This keeps the persisted schema minimal and allows status logic
 * to evolve without migration.
 *
 * Scene status (Phase 1 material-discovery redesign):
 * 1. candidates non-empty (asset or link) → `candidates_ready`
 * 2. otherwise → `pending`
 *
 * The review state machine (selected/skipped/local_attached) has been
 * removed; search results are browse-only and no decision is persisted.
 */

import type { SpeechToSceneProject } from "./project-schema.js";

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

/**
 * Overall project lifecycle status.
 *
 * M1 supports only `created` and `planned`. The `producing` status will be
 * introduced in a future milestone when scene-level asset generation is
 * implemented.
 */
export type ProjectStatusValue = "created" | "planned";

/**
 * Per-scene search status.
 *
 * - `pending`: no search candidates yet.
 * - `candidates_ready`: the scene has been searched and has candidates.
 */
export type SceneStatusValue = "pending" | "candidates_ready";

/**
 * Status of a single scene derived from its search state.
 */
export type SceneStatus = {
  sceneId: string;
  sceneOrder: number;
  status: SceneStatusValue;
};

/**
 * Full project status derived from project data.
 */
export type ProjectStatus = {
  status: ProjectStatusValue;
  sceneCount: number;
  /** Scenes that have been searched (have candidates). */
  searchedSceneCount: number;
  lastGenerationAt: string | null;
  scenes: SceneStatus[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives the search status of a single scene from its candidate state.
 *
 * Scene status priority:
 * 1. scene has candidates (candidates.length > 0) → `candidates_ready`
 * 2. otherwise → `pending`
 */
function deriveSceneStatus(hasCandidates: boolean): SceneStatusValue {
  return hasCandidates ? "candidates_ready" : "pending";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives the full project status from a parsed SpeechToSceneProject.
 *
 * Status values:
 * - `created`: `generation === null` (project initialized, no generation yet).
 * - `planned`: `generation !== null` (a plan exists, regardless of scene progress).
 *
 * This function is pure and has no side effects. It is safe to call from
 * any layer.
 */
export function getProjectStatus(project: SpeechToSceneProject): ProjectStatus {
  const { generation, scenes } = project;

  // Determine project-level status
  const status: ProjectStatusValue = generation === null ? "created" : "planned";

  // Derive per-scene statuses
  const sceneStatuses: SceneStatus[] = scenes.map((scene) => ({
    sceneId: scene.id,
    sceneOrder: scene.order,
    status: deriveSceneStatus(scene.search.candidates.length > 0),
  }));

  const searchedSceneCount = sceneStatuses.filter((s) => s.status === "candidates_ready").length;

  return {
    status,
    sceneCount: scenes.length,
    searchedSceneCount,
    lastGenerationAt: generation?.generatedAt ?? null,
    scenes: sceneStatuses,
  };
}
