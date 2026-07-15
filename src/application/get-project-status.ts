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
import { getProjectStatus } from "../domain/project-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  status: "created" | "planned" | "producing";
  source: {
    path: string;
    textLengthUtf16: number;
  };
  scenes: {
    total: number;
    byStatus: Record<string, number>;
  };
  updatedAt: string;
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
    updatedAt: project.project.updatedAt,
  };
}
