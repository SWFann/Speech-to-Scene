/**
 * GeneratedImageDownloader port.
 *
 * Downloads a generated image from a remote URL and saves it to the
 * project's assets directory. Returns a locally-served URL that the
 * frontend can use to display the image persistently (without URL expiry).
 *
 * The Application layer defines the contract; Infrastructure provides
 * the implementation (HTTP fetch + filesystem write).
 */

export interface GeneratedImageDownloader {
  /**
   * Downloads an image from the given URL and saves it to the project's
   * assets/generated/ directory.
   *
   * @param projectRoot - Absolute path to the project root.
   * @param imageUrl - The remote URL to download from.
   * @param candidateId - The candidate ID (used for the local filename).
   * @param port - The review server port (for constructing the local URL).
   * @returns A locally-served URL (e.g., http://127.0.0.1:3210/api/project-assets/generated/xxx.png).
   */
  download(
    projectRoot: string,
    imageUrl: string,
    candidateId: string,
    port: number,
  ): Promise<string>;
}
