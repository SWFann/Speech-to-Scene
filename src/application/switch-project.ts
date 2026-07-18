/**
 * switchProject use case.
 *
 * Validates a project name and resolves its absolute directory path within
 * the workspace. The server uses this result to update its active project
 * root, so all subsequent `/api/project*` and `/api/scenes*` operations
 * act on the newly selected project.
 *
 * Phase 3: multi-project workspace support.
 *
 * Design rules:
 * 1. The project name must be a simple directory name (no path separators,
 *    no traversal, no hidden-dot prefix).
 * 2. The resolved project root is `workspaceRoot/projectName`.
 * 3. The project directory must exist and contain `project.s2s.json`.
 * 4. Never accepts arbitrary absolute paths from the caller.
 */

import type { ProjectRepository } from "./ports/project-repository.js";
import { ProjectNotFoundError, InvalidArgumentError } from "../shared/errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwitchProjectInput {
  /** Absolute path to the workspace root directory. */
  readonly workspaceRoot: string;
  /** Directory name of the project to switch to (e.g., "demo2"). */
  readonly project: string;
}

export interface SwitchProjectResult {
  /** Resolved absolute path to the new active project root. */
  readonly projectRoot: string;
  /** The project directory name (echoed back from input). */
  readonly project: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a project directory name.
 *
 * Rejects:
 * - Empty or whitespace-only
 * - Path separators (`/` or `\`)
 * - Traversal segments (`..` or `.`)
 * - Hidden-dot prefix (`.s2s`, `.git`, etc.)
 * - Windows device names (handled by path safety utilities elsewhere)
 *
 * @returns true if the name is safe.
 */
function isValidProjectName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (name.startsWith(".")) return false;
  // Reject NUL bytes and control characters
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a project name and resolve its directory path.
 *
 * @param input - Workspace root + project name.
 * @param repository - Project repository for existence checking.
 * @returns The resolved project root path.
 * @throws InvalidArgumentError if the project name is invalid.
 * @throws ProjectNotFoundError if the project directory or project file
 *   does not exist.
 */
export async function switchProject(
  input: SwitchProjectInput,
  repository: ProjectRepository,
): Promise<SwitchProjectResult> {
  const projectName = input.project?.trim() ?? "";

  if (!isValidProjectName(projectName)) {
    throw new InvalidArgumentError(
      `Invalid project name: ${projectName}`,
      "项目名不能包含路径分隔符或以点开头",
    );
  }

  const workspaceRoot = input.workspaceRoot.replace(/\/+$/, "");
  const projectRoot = `${workspaceRoot}/${projectName}`;

  // Verify the project exists (contains project.s2s.json)
  const exists = await repository.exists(projectRoot);
  if (!exists) {
    throw new ProjectNotFoundError(projectRoot);
  }

  return { projectRoot, project: projectName };
}
