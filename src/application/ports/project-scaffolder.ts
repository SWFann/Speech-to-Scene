/**
 * ProjectScaffolder port.
 *
 * Abstraction over directory creation and source document copying.
 * The Application layer defines the contract; Infrastructure provides the
 * implementation.
 *
 * The scaffolder is responsible for:
 * - Creating the project root directory (exclusive, no-clobber)
 * - Creating subdirectories (assets, cache/search, logs)
 * - Copying the source document into the project
 * - Creating a sentinel file for crash recovery
 * - Removing the sentinel on success
 */

export interface ProjectScaffolder {
  /**
   * Create the project root directory exclusively.
   *
   * Uses `mkdir` with no recursive flag to ensure the parent exists and
   * to atomically claim the directory. Throws if the directory already exists.
   */
  createRoot(projectRoot: string): Promise<void>;

  /**
   * Create required subdirectories inside the project root.
   */
  createSubdirectories(projectRoot: string): Promise<void>;

  /**
   * Copy the source document bytes into the project directory.
   *
   * The destination filename is derived from the source file extension:
   * - `.md` / `.markdown` → `script.md`
   * - `.txt` → `script.txt`
   *
   * The same bytes that were pre-validated must be written; do not re-read
   * the source.
   */
  copySourceDocument(
    projectRoot: string,
    sourceBytes: Uint8Array,
    sourceFileName: string,
  ): Promise<string>;

  /**
   * Write a sentinel file to detect crash recovery.
   *
   * The sentinel contains a unique token that can be verified on cleanup.
   * Uses exclusive creation (wx flag).
   */
  writeSentinel(projectRoot: string, token: string): Promise<void>;

  /**
   * Remove the sentinel file after successful project creation.
   */
  removeSentinel(projectRoot: string): Promise<void>;

  /**
   * Check whether the sentinel file exists and matches the expected token.
   *
   * Used for crash recovery detection: if a sentinel exists without a
   * project file, the previous init crashed and the directory is incomplete.
   */
  checkSentinel(projectRoot: string, token: string): Promise<boolean>;

  /**
   * Check whether ANY sentinel file exists in the project root, regardless of token.
   *
   * Used before creating a new project to detect crash residue from a
   * previous init that used a different token.
   */
  hasAnySentinel(projectRoot: string): Promise<boolean>;
}
