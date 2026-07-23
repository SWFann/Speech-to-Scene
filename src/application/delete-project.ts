/**
 * deleteProject use case.
 *
 * Deletes a named workspace project after verifying a confirmation string
 * matches the project directory name. This is a
 * destructive, irreversible operation — the two-step confirmation
 * (project name match) prevents accidental deletion.
 *
 * Phase 3: multi-project workspace support.
 *
 * Design rules:
 * 1. The target is resolved from `workspaceRoot` + validated `projectName`.
 * 2. The `confirm` string must exactly match `projectName`.
 * 2. Deletion is delegated to WorkspaceScanner.deleteProject (infrastructure).
 * 3. The `workspace/.s2s/` settings directory is never touched.
 * 4. The caller clears active state only when the deleted target was active.
 */

import type { WorkspaceScanner } from "./ports/workspace-scanner.js";
import { InvalidArgumentError, ProjectNotFoundError } from "../shared/errors.js";
import path from "node:path";
import { isValidProjectName } from "./project-name.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeleteProjectInput {
  /** Absolute path to the workspace containing all named projects. */
  readonly workspaceRoot: string;
  /** Direct child directory name of the project to delete. */
  readonly projectName: string;
  /** Confirmation string — must match the project directory basename. */
  readonly confirm: string;
}

export interface DeleteProjectResult {
  readonly ok: true;
  /** The project directory name that was deleted. */
  readonly deleted: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Delete a project directory after confirmation.
 *
 * @param input - Project root path + confirmation string.
 * @param scanner - Workspace scanner (provides deleteProject).
 * @returns Success result with the deleted directory name.
 * @throws InvalidArgumentError if the confirmation does not match.
 * @throws ProjectNotFoundError if the project root does not exist.
 */
export async function deleteProject(
  input: DeleteProjectInput,
  scanner: WorkspaceScanner,
): Promise<DeleteProjectResult> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const projectName = input.projectName?.trim() ?? "";
  if (!isValidProjectName(projectName)) {
    throw new InvalidArgumentError("Invalid project name", "项目名不能包含路径分隔符或以点开头");
  }
  const projectRoot = path.resolve(workspaceRoot, projectName);
  if (path.dirname(projectRoot) !== workspaceRoot) {
    throw new InvalidArgumentError("Project is outside workspace", "项目路径超出工作区");
  }

  const confirm = input.confirm?.trim() ?? "";

  if (confirm !== projectName) {
    throw new InvalidArgumentError(
      `Confirmation does not match project name: expected "${projectName}"`,
      `请输入项目名 "${projectName}" 以确认删除`,
    );
  }

  const entries = await scanner.scanProjectDirs(workspaceRoot);
  const target = entries.find((entry) => entry.name === projectName);
  if (!target?.hasProject) {
    throw new ProjectNotFoundError(projectRoot);
  }

  try {
    await scanner.deleteProject(projectRoot);
  } catch (error) {
    // If the directory doesn't exist, treat it as not found
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ProjectNotFoundError(projectRoot);
    }
    throw error;
  }

  return { ok: true, deleted: projectName };
}
