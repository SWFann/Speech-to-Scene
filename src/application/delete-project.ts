/**
 * deleteProject use case.
 *
 * Deletes the current active project directory entirely after verifying a
 * confirmation string matches the project directory name. This is a
 * destructive, irreversible operation — the two-step confirmation
 * (project name match) prevents accidental deletion.
 *
 * Phase 3: multi-project workspace support.
 *
 * Design rules:
 * 1. The `confirm` string must exactly match the project directory name
 *    (basename of `projectRoot`).
 * 2. Deletion is delegated to WorkspaceScanner.deleteProject (infrastructure).
 * 3. The `workspace/.s2s/` settings directory is never touched.
 * 4. After deletion, the caller (server) sets the active project to null.
 */

import type { WorkspaceScanner } from "./ports/workspace-scanner.js";
import { InvalidArgumentError, ProjectNotFoundError } from "../shared/errors.js";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeleteProjectInput {
  /** Absolute path to the project root to delete. */
  readonly projectRoot: string;
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
  const projectRoot = path.resolve(input.projectRoot);
  const projectDirName = projectRoot.split("/").pop() ?? "";

  if (!projectDirName) {
    throw new InvalidArgumentError(
      "Cannot determine project directory name",
      "项目根路径无效",
    );
  }

  const confirm = input.confirm?.trim() ?? "";

  if (confirm !== projectDirName) {
    throw new InvalidArgumentError(
      `Confirmation does not match project name: expected "${projectDirName}"`,
      `请输入项目名 "${projectDirName}" 以确认删除`,
    );
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

  return { ok: true, deleted: projectDirName };
}
