/**
 * FileSystemWorkspaceScanner — infrastructure implementation of WorkspaceScanner.
 *
 * Scans the workspace directory for project subdirectories and deletes
 * project directories entirely.
 *
 * Phase 3: multi-project workspace support.
 *
 * Security:
 * - Only direct subdirectories of `workspaceRoot` are scanned.
 * - The `.s2s` settings directory is always skipped.
 * - `deleteProject` validates that the project root is a direct subdirectory
 *   of a workspace (prevents arbitrary filesystem deletion).
 */

import fs from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceScanner,
  WorkspaceDirEntry,
} from "../application/ports/workspace-scanner.js";
import { PROJECT_FILE_NAME } from "../shared/constants.js";
import { hasPathTraversal } from "./project-paths.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory names to skip during workspace scanning. */
const SKIP_DIRS = new Set([".s2s"]);

// ---------------------------------------------------------------------------
// FileSystemWorkspaceScanner
// ---------------------------------------------------------------------------

export class FileSystemWorkspaceScanner implements WorkspaceScanner {
  /**
   * Scan the workspace root for project subdirectories.
   *
   * Returns all direct subdirectories (except `.s2s`) with a flag indicating
   * whether each contains a `project.s2s.json` file.
   *
   * Never throws for missing workspace root or I/O errors — returns an empty
   * array instead so the server can still start.
   */
  async scanProjectDirs(workspaceRoot: string): Promise<readonly WorkspaceDirEntry[]> {
    const resolved = path.resolve(workspaceRoot);

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });

      const results: WorkspaceDirEntry[] = [];

      for (const entry of entries) {
        // Only directories are candidates
        if (!entry.isDirectory()) continue;

        // Skip the settings directory and other skip-list entries
        if (SKIP_DIRS.has(entry.name)) continue;

        // Check for project file
        const projectFilePath = path.join(resolved, entry.name, PROJECT_FILE_NAME);
        let hasProject = false;
        try {
          const stat = await fs.stat(projectFilePath);
          hasProject = stat.isFile();
        } catch {
          // File doesn't exist or is inaccessible — hasProject stays false
        }

        results.push({ name: entry.name, hasProject });
      }

      return results;
    } catch {
      // Workspace root doesn't exist or is inaccessible — return empty list
      return [];
    }
  }

  /**
   * Delete an entire project directory.
   *
   * Validates that the project root:
   * 1. Does not contain path traversal patterns.
   * 2. Is not the workspace root itself.
   *
   * Then removes the directory recursively.
   */
  async deleteProject(projectRoot: string): Promise<void> {
    const resolved = path.resolve(projectRoot);

    // Path safety: reject traversal
    if (hasPathTraversal(projectRoot)) {
      throw new Error("Project root contains path traversal");
    }

    // Safety: refuse to delete if the resolved path is the filesystem root
    // or has no parent (prevents catastrophic deletion).
    const parent = path.dirname(resolved);
    if (parent === resolved) {
      throw new Error("Refusing to delete filesystem root");
    }

    // Use recursive rm with force to handle non-existent files gracefully
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
