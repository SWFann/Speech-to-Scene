/**
 * Infrastructure implementation of ProjectScaffolder.
 *
 * Handles the physical filesystem operations for project initialization:
 * - Exclusive directory creation (no-clobber)
 * - Subdirectory creation (assets, cache/search, logs)
 * - Source document copy
 * - Sentinel file for crash recovery
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import type { ProjectScaffolder } from "../application/ports/project-scaffolder.js";
import { PROJECT_FILE_NAME } from "../shared/constants.js";

/**
 * Infrastructure implementation of the ProjectScaffolder port.
 *
 * All paths are resolved and validated before I/O.
 */
export class FileSystemProjectScaffolder implements ProjectScaffolder {
  /**
   * Create the project root directory.
   *
   * Uses exclusive `mkdir` so a directory created after the application
   * pre-flight check is never reused during failure cleanup.
   */
  async createRoot(projectRoot: string): Promise<void> {
    const resolved = path.resolve(projectRoot);
    await fs.mkdir(resolved, { mode: 0o755 });
  }

  /**
   * Create required subdirectories inside the project root.
   */
  async createSubdirectories(projectRoot: string): Promise<void> {
    const resolved = path.resolve(projectRoot);
    await fs.mkdir(path.join(resolved, ".s2s"), { recursive: true });
    await fs.mkdir(path.join(resolved, "assets"), { recursive: true });
    await fs.mkdir(path.join(resolved, "cache", "search"), { recursive: true });
    await fs.mkdir(path.join(resolved, "logs"), { recursive: true });
  }

  /**
   * Copy the source document bytes into the project directory.
   *
   * Returns the destination file path (relative to project root).
   */
  async copySourceDocument(
    projectRoot: string,
    sourceBytes: Uint8Array,
    sourceFileName: string,
  ): Promise<string> {
    const resolved = path.resolve(projectRoot);
    const destName = this.getScriptDestinationName(sourceFileName);
    const destPath = path.join(resolved, destName);

    // Write with fsync for durability
    const handle = await fs.open(destPath, "wx");
    try {
      await handle.write(Buffer.from(sourceBytes));
      await handle.sync();
    } finally {
      await handle.close();
    }

    return destName;
  }

  /**
   * Derives the destination script filename from source file name.
   */
  private getScriptDestinationName(sourceFileName: string): string {
    const ext = sourceFileName.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "md" || ext === "markdown") {
      return "script.md";
    }
    if (ext === "txt") {
      return "script.txt";
    }
    return "script.txt";
  }

  /**
   * Write a sentinel file with the given token.
   *
   * The sentinel is a plain text file containing the token.
   * Uses exclusive creation (`wx`) to detect concurrent inits.
   */
  async writeSentinel(projectRoot: string, token: string): Promise<void> {
    const resolved = path.resolve(projectRoot);
    const sentinelPath = path.join(resolved, `.${PROJECT_FILE_NAME}.sentinel`);
    const handle = await fs.open(sentinelPath, "wx");
    try {
      await handle.write(Buffer.from(token, "utf-8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Remove the sentinel file after successful project creation.
   */
  async removeSentinel(projectRoot: string): Promise<void> {
    const resolved = path.resolve(projectRoot);
    const sentinelPath = path.join(resolved, `.${PROJECT_FILE_NAME}.sentinel`);
    try {
      await fs.unlink(sentinelPath);
    } catch (error) {
      // Ignore if sentinel doesn't exist
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Check whether the sentinel file exists and contains the expected token.
   */
  async checkSentinel(projectRoot: string, token: string): Promise<boolean> {
    const resolved = path.resolve(projectRoot);
    const sentinelPath = path.join(resolved, `.${PROJECT_FILE_NAME}.sentinel`);
    try {
      const content = await fs.readFile(sentinelPath, "utf-8");
      return content === token;
    } catch {
      return false;
    }
  }

  /**
   * Check whether ANY sentinel file exists in the project root, regardless of token.
   */
  async hasAnySentinel(projectRoot: string): Promise<boolean> {
    const resolved = path.resolve(projectRoot);
    const sentinelPath = path.join(resolved, `.${PROJECT_FILE_NAME}.sentinel`);
    try {
      await fs.access(sentinelPath);
      return true;
    } catch {
      return false;
    }
  }
}
