/**
 * getProjectStatus use case.
 *
 * Pure read-only operation:
 * 1. Load the project from the repository.
 * 2. Derive the project status using the pure domain function.
 * 3. Return a structured view suitable for CLI output or JSON serialization.
 *
 * This use case does not modify any state.
 */

import type { ProjectRepository } from "../application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../domain/project-schema.js";
import { getProjectStatus } from "../domain/project-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Review progress summary for a project.
 *
 * Counts are derived from scene review decisions:
 * - `pending`: review.kind === "pending"
 * - `skipped`: review.kind === "skipped"
 * - `candidateSelected`: review.kind === "candidate_selected" (with or without localAsset)
 * - `localAssetAttached`: review.kind === "local_asset_attached"
 * - `withLocalAsset`: localAssetAttached + candidate_selected with localAsset present
 * - `completionRatio`: (totalScenes - pending) / totalScenes, or 0 when totalScenes is 0
 */
export interface ReviewSummary {
  totalScenes: number;
  pending: number;
  skipped: number;
  candidateSelected: number;
  localAssetAttached: number;
  withLocalAsset: number;
  completionRatio: number;
}

/**
 * Human-readable view of a project's status.
 *
 * This is the shape returned by the use case and serialized by the CLI.
 */
export interface ProjectStatusView {
  schemaVersion: "0.1";
  project: {
    id: string;
    title: string;
    language: string;
    aspectRatio: string;
    style: string;
  };
  status: "created" | "planned";
  source: {
    path: string;
    textLengthUtf16: number;
  };
  scenes: {
    total: number;
    byStatus: Record<string, number>;
  };
  review: ReviewSummary;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the review progress summary from a project's scenes.
 *
 * This is a pure function — no side effects, no I/O.
 */
function computeReviewSummary(scenes: SpeechToSceneProject["scenes"]): ReviewSummary {
  const totalScenes = scenes.length;
  let pending = 0;
  let skipped = 0;
  let candidateSelected = 0;
  let localAssetAttached = 0;
  let withLocalAsset = 0;

  for (const scene of scenes) {
    switch (scene.review.kind) {
      case "pending":
        pending++;
        break;
      case "skipped":
        skipped++;
        break;
      case "candidate_selected":
        candidateSelected++;
        if (scene.review.localAsset !== undefined) {
          withLocalAsset++;
        }
        break;
      case "local_asset_attached":
        localAssetAttached++;
        withLocalAsset++;
        break;
    }
  }

  const completionRatio = totalScenes === 0 ? 0 : (totalScenes - pending) / totalScenes;

  return {
    totalScenes,
    pending,
    skipped,
    candidateSelected,
    localAssetAttached,
    withLocalAsset,
    completionRatio,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gets the status of an existing project.
 *
 * @param projectRoot - Absolute or relative path to the project directory.
 * @param repository - Project repository implementation.
 * @returns Structured status view.
 */
export async function getProjectStatusUseCase(
  projectRoot: string,
  repository: ProjectRepository,
): Promise<ProjectStatusView> {
  // Load the project (validates schema, relations, version)
  const project = await repository.load(projectRoot);

  // Derive status using the pure domain function
  const status = getProjectStatus(project);

  // Build byStatus map
  const byStatus: Record<string, number> = {};
  for (const scene of status.scenes) {
    byStatus[scene.status] = (byStatus[scene.status] ?? 0) + 1;
  }

  return {
    schemaVersion: "0.1",
    project: {
      id: project.project.id,
      title: project.project.title,
      language: project.project.language,
      aspectRatio: project.project.aspectRatio,
      style: project.project.style,
    },
    status: status.status,
    source: {
      path: project.source.path,
      textLengthUtf16: project.source.textLengthUtf16,
    },
    scenes: {
      total: status.sceneCount,
      byStatus,
    },
    review: computeReviewSummary(project.scenes),
    updatedAt: project.project.updatedAt,
  };
}
