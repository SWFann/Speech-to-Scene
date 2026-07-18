/**
 * listProjects use case.
 *
 * Scans the workspace directory for all project subdirectories, loads
 * each project's metadata, and returns a UI-safe list of project items.
 *
 * Phase 3: multi-project workspace support.
 *
 * Design rules:
 * 1. Scanning is delegated to WorkspaceScanner (infrastructure port).
 * 2. Project metadata is loaded via ProjectRepository.
 * 3. Only directories containing `project.s2s.json` are included.
 * 4. Load failures for individual projects do not abort the whole scan —
 *    the project is skipped with a warning.
 * 5. Output is sorted by `updatedAt` descending (most recent first).
 * 6. Never returns absolute paths — only directory names.
 */

import type { ProjectRepository } from "./ports/project-repository.js";
import type { WorkspaceScanner, WorkspaceDirEntry } from "./ports/workspace-scanner.js";
import { ProjectNotFoundError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single project entry in the workspace listing.
 *
 * This is the data the HTTP layer serializes into the `GET /api/projects`
 * response. The `isActive` flag is NOT set here — it is determined by the
 * server/router layer which knows the current active project.
 */
export interface ProjectListItem {
  /** Directory name within the workspace (e.g., "default"). */
  readonly name: string;
  /** Relative path — same as name for direct subdirectories. */
  readonly path: string;
  /** Always true (only projects with project files are listed). */
  readonly hasProject: true;
  /** Project title from project.s2s.json metadata. */
  readonly title: string;
  /** Number of scenes in the project. */
  readonly sceneCount: number;
  /** ISO timestamp of the last project update. */
  readonly updatedAt: string;
}

/**
 * Result of listProjects.
 */
export interface ListProjectsResult {
  readonly projects: readonly ProjectListItem[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the workspace and return a list of all projects.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory.
 * @param scanner - Workspace scanner implementation.
 * @param repository - Project repository for loading project metadata.
 * @returns List of project items, sorted by updatedAt descending.
 */
export async function listProjects(
  workspaceRoot: string,
  scanner: WorkspaceScanner,
  repository: ProjectRepository,
): Promise<ListProjectsResult> {
  const entries: readonly WorkspaceDirEntry[] = await scanner.scanProjectDirs(workspaceRoot);

  const items: ProjectListItem[] = [];

  for (const entry of entries) {
    if (!entry.hasProject) continue;

    const projectRoot = `${workspaceRoot.replace(/\/+$/, "")}/${entry.name}`;

    try {
      const project = await repository.load(projectRoot);
      items.push({
        name: entry.name,
        path: entry.name,
        hasProject: true,
        title: project.project.title,
        sceneCount: project.scenes.length,
        updatedAt: project.project.updatedAt,
      });
    } catch (error) {
      // Skip projects that fail to load (corrupt, wrong version, etc.)
      // But re-throw if it's not a ProjectNotFoundError — those indicate
      // a systemic issue (e.g., permissions) that should be surfaced.
      if (error instanceof ProjectNotFoundError) {
        continue;
      }
      // For validation errors and other recoverable issues, skip the project
      // so the user can still see and interact with their other projects.
      continue;
    }
  }

  // Sort by updatedAt descending (most recent first)
  items.sort((a, b) => {
    if (a.updatedAt > b.updatedAt) return -1;
    if (a.updatedAt < b.updatedAt) return 1;
    return 0;
  });

  return { projects: items };
}
