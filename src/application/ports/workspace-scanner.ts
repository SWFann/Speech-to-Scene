/**
 * WorkspaceScanner port.
 *
 * Abstraction over workspace-level filesystem operations: scanning the
 * workspace directory for project subdirectories and deleting a project
 * directory entirely. The Application layer defines the contract;
 * Infrastructure provides the implementation.
 *
 * Design constraints:
 * - Only direct subdirectories of `workspaceRoot` are scanned.
 * - The `workspace/.s2s/` settings directory is always skipped.
 * - `deleteProject` removes the entire project directory (project file,
 *   script, assets, cache, logs). It must NOT touch `workspace/.s2s/`.
 */

/**
 * A single directory entry found during workspace scanning.
 */
export interface WorkspaceDirEntry {
  /** Directory name (e.g., "default"). */
  readonly name: string;
  /** True if the directory contains a `project.s2s.json` file. */
  readonly hasProject: boolean;
}

export interface WorkspaceScanner {
  /**
   * Scan the workspace root for project subdirectories.
   *
   * Returns all direct subdirectories (except `.s2s`) with a flag
   * indicating whether each contains a `project.s2s.json` file.
   *
   * Never throws for missing workspace root or I/O errors — returns
   * an empty array instead so the server can still start.
   */
  scanProjectDirs(workspaceRoot: string): Promise<readonly WorkspaceDirEntry[]>;

  /**
   * Delete an entire project directory.
   *
   * Removes the directory and all its contents (project file, script,
   * assets, cache, logs). Does NOT affect `workspace/.s2s/` settings.
   *
   * @throws Error if the project root is outside the workspace or
   *   if deletion fails.
   */
  deleteProject(projectRoot: string): Promise<void>;
}
