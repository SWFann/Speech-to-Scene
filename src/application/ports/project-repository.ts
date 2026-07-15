/**
 * ProjectRepository port.
 *
 * Defines the contract for persisting and loading Speech-to-Scene projects.
 * Implementations must enforce atomicity, path safety, and schema validation.
 *
 * Design constraints:
 * - The fixed filename is PROJECT_FILE_NAME; callers must not inject arbitrary paths.
 * - `create` is no-clobber: it must refuse if a project already exists.
 * - `save` only works on existing projects; it does not implicitly create.
 * - Both `create` and `save` re-parse after any write I/O.
 * - Repository never modifies `updatedAt`; the caller sets it.
 * - Repository never auto-migrates, repairs, downgrades, or strips unknown fields.
 */

import type { SpeechToSceneProject } from "../../domain/project-schema.js";

export interface ProjectRepository {
  /**
   * Check whether a project already exists at the given root.
   * Only checks for the fixed project file, not directory contents.
   */
  exists(projectRoot: string): Promise<boolean>;

  /**
   * Create a new project.
   *
   * Preconditions:
   * - `projectRoot` does not already contain a project file.
   * - `projectRoot` parent exists and is a directory.
   *
   * The project is written atomically. On failure, no partial state is left.
   */
  create(projectRoot: string, project: SpeechToSceneProject): Promise<void>;

  /**
   * Load an existing project.
   *
   * Throws ProjectNotFoundError if the project file does not exist.
   * Performs full validation including schema parse and relation checks.
   */
  load(projectRoot: string): Promise<SpeechToSceneProject>;

  /**
   * Save (overwrite) an existing project.
   *
   * Preconditions:
   * - A project already exists at `projectRoot`.
   * - `project.id` matches the existing project's id.
   * - The project passes full validation.
   *
   * Uses atomic rename; the old file is replaced only after the new one
   * is fully written and validated.
   */
  save(projectRoot: string, project: SpeechToSceneProject): Promise<void>;
}
