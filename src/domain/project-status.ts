/**
 * Project status derivation.
 *
 * Status is never persisted; it is derived from project data by a pure
 * function. This keeps the persisted schema minimal and allows status logic
 * to evolve without migration.
 *
 * Scene status priority:
 * 1. decision has localAsset → `local_attached`
 * 2. candidate_selected → `selected`
 * 3. skipped → `skipped`
 * 4. candidates non-empty → `candidates_ready`
 * 5. otherwise → `pending`
 */

import type { SpeechToSceneProject } from "./project-schema.js";
import type { ReviewDecision } from "./scene-schema.js";

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
 * Per-scene review status.
 */
export type SceneStatusValue =
  "pending" | "candidates_ready" | "selected" | "skipped" | "local_attached";

/**
 * Status of a single scene derived from its review decision.
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
  producingSceneCount: number;
  lastGenerationAt: string | null;
  scenes: SceneStatus[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives the review status of a single scene from its review decision
 * and search state.
 *
 * Scene status priority:
 * 1. review decision is local_asset_attached → `local_attached`
 * 2. review decision is candidate_selected with localAsset → `local_attached`
 * 3. review decision is candidate_selected → `selected`
 * 4. review decision is skipped → `skipped`
 * 5. scene has candidates (candidates.length > 0) → `candidates_ready`
 * 6. otherwise → `pending`
 */
function deriveSceneReviewStatus(review: ReviewDecision, hasCandidates: boolean): SceneStatusValue {
  switch (review.kind) {
    case "pending":
      if (hasCandidates) {
        return "candidates_ready";
      }
      return "pending";

    case "skipped":
      return "skipped";

    case "candidate_selected":
      if (review.localAsset) {
        return "local_attached";
      }
      return "selected";

    case "local_asset_attached":
      return "local_attached";

    default: {
      // Exhaustiveness check: satisfies the type checker
      const _exhaustive: never = review;
      return _exhaustive;
    }
  }
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
    status: deriveSceneReviewStatus(scene.review, scene.search.candidates.length > 0),
  }));

  const producingSceneCount = sceneStatuses.filter((s) => s.status !== "pending").length;

  return {
    status,
    sceneCount: scenes.length,
    producingSceneCount,
    lastGenerationAt: generation?.generatedAt ?? null,
    scenes: sceneStatuses,
  };
}
