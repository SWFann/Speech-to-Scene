/**
 * LocalAssetWriter port.
 *
 * Defines the contract for writing uploaded asset files to the project's
 * `assets/<scene-id>/` directory. The Application layer uses this interface;
 * the Infrastructure layer provides the concrete filesystem implementation.
 *
 * Design constraints:
 * - The writer must only write under `assets/<scene-id>/` within projectRoot.
 * - The writer must generate the final filename — callers pass a suggested
 *   name, but the writer may override it for safety.
 * - The writer must reject symlinks and path traversal.
 * - The writer must verify realpath containment after writing.
 * - The writer returns a project-relative POSIX path (e.g.,
 *   `assets/scene-001/abc123.png`).
 */

export interface LocalAssetWriter {
  /**
   * Writes a file buffer to the project's assets directory.
   *
   * @param projectRoot - Absolute path to the project root.
   * @param sceneId - The scene ID (used for the subdirectory name).
   * @param fileName - Server-generated safe filename (e.g., `abc123.png`).
   * @param data - The file content as a Buffer.
   * @returns The project-relative POSIX path of the written file.
   * @throws If the path is unsafe, the directory cannot be created, or the
   *   file cannot be written.
   */
  writeAsset(
    projectRoot: string,
    sceneId: string,
    fileName: string,
    data: Buffer,
  ): Promise<{ relativePath: string }>;
}
