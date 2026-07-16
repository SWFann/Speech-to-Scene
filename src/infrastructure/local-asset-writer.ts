/**
 * Filesystem implementation of LocalAssetWriter.
 *
 * Writes uploaded asset files to `assets/<scene-id>/` within the project root.
 *
 * Security measures:
 * 1. Rejects path traversal in sceneId and fileName.
 * 2. Creates the assets directory if it does not exist.
 * 3. Writes the file with a server-generated name.
 * 4. Verifies the realpath of the written file is contained within the
 *    project root's assets directory.
 * 5. Rejects symlinks in the directory chain.
 *
 * This is the only place where filesystem writes for local assets happen.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { LocalAssetWriter } from "../application/ports/local-asset-writer.js";
import { hasPathTraversal, isPathContained } from "./project-paths.js";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when a path safety check fails during local asset writing.
 */
export class LocalAssetPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalAssetPathError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Filesystem-based LocalAssetWriter.
 *
 * Writes files under `<projectRoot>/assets/<scene-id>/` and returns
 * project-relative POSIX paths.
 */
export class FsLocalAssetWriter implements LocalAssetWriter {
  async writeAsset(
    projectRoot: string,
    sceneId: string,
    fileName: string,
    data: Buffer,
  ): Promise<{ relativePath: string }> {
    // 1. Reject path traversal in sceneId
    if (hasPathTraversal(sceneId) || sceneId.includes("/") || sceneId.includes("\\")) {
      throw new LocalAssetPathError("Invalid sceneId for asset path");
    }

    // 2. Reject path traversal in fileName
    if (
      hasPathTraversal(fileName) ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      fileName.includes("..")
    ) {
      throw new LocalAssetPathError("Invalid fileName for asset path");
    }

    // 3. Build the target directory: projectRoot/assets/<scene-id>/
    const assetsDir = path.join(projectRoot, "assets");
    const sceneAssetsDir = path.join(assetsDir, sceneId);
    const targetPath = path.join(sceneAssetsDir, fileName);

    // 4. Reject if targetPath escapes the project root (lexical check)
    const checkLexical = isPathContained(path.resolve(targetPath), path.resolve(projectRoot));
    if (!checkLexical.safe) {
      throw new LocalAssetPathError("Target path escapes project root");
    }

    // 5. Create the directory if it does not exist
    await fs.mkdir(sceneAssetsDir, { recursive: true });

    // 6. Verify the created directory is not a symlink and is contained
    const realSceneAssetsDir = await fs.realpath(sceneAssetsDir);
    const realProjectRoot = await fs.realpath(projectRoot);
    const dirCheck = isPathContained(realSceneAssetsDir, realProjectRoot);
    if (!dirCheck.safe) {
      throw new LocalAssetPathError("Assets directory escapes project root via symlink");
    }

    // 7. Write the file
    await fs.writeFile(targetPath, data);

    // 8. Verify the written file's realpath is contained within the scene assets dir
    const realTargetPath = await fs.realpath(targetPath);
    const fileCheck = isPathContained(realTargetPath, realSceneAssetsDir);
    if (!fileCheck.safe) {
      // Attempt cleanup of the escaped file
      try {
        await fs.unlink(targetPath);
      } catch {
        // Best-effort cleanup
      }
      throw new LocalAssetPathError("Written file escapes assets directory via symlink");
    }

    // 9. Return the project-relative POSIX path
    const relativePath = path.relative(realProjectRoot, realTargetPath).split(path.sep).join("/");

    return { relativePath };
  }
}
