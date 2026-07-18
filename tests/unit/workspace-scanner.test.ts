/**
 * Unit tests for FileSystemWorkspaceScanner.
 *
 * Phase 3: multi-project workspace support.
 *
 * Uses real temp directories to verify filesystem scanning and deletion.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import { FileSystemWorkspaceScanner } from "../../src/infrastructure/workspace-scanner.js";
import { PROJECT_FILE_NAME } from "../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  tempDirs.length = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-scanner-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileSystemWorkspaceScanner", () => {
  const scanner = new FileSystemWorkspaceScanner();

  describe("scanProjectDirs", () => {
    it("finds directories containing project.s2s.json", async () => {
      const workspace = await makeTempDir();
      await fs.mkdir(path.join(workspace, "project-a"));
      await writeFile(path.join(workspace, "project-a"), PROJECT_FILE_NAME, "{}");
      await fs.mkdir(path.join(workspace, "project-b"));
      await writeFile(path.join(workspace, "project-b"), PROJECT_FILE_NAME, "{}");
      await fs.mkdir(path.join(workspace, "empty-dir"));

      const entries = await scanner.scanProjectDirs(workspace);

      expect(entries).toHaveLength(3);
      const a = entries.find((e) => e.name === "project-a");
      const b = entries.find((e) => e.name === "project-b");
      const empty = entries.find((e) => e.name === "empty-dir");
      expect(a?.hasProject).toBe(true);
      expect(b?.hasProject).toBe(true);
      expect(empty?.hasProject).toBe(false);
    });

    it("skips the .s2s settings directory", async () => {
      const workspace = await makeTempDir();
      await fs.mkdir(path.join(workspace, ".s2s"));
      await fs.mkdir(path.join(workspace, "real-project"));
      await writeFile(path.join(workspace, "real-project"), PROJECT_FILE_NAME, "{}");

      const entries = await scanner.scanProjectDirs(workspace);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("real-project");
    });

    it("returns empty array for non-existent workspace", async () => {
      const entries = await scanner.scanProjectDirs("/nonexistent/path/xyz");

      expect(entries).toEqual([]);
    });

    it("ignores regular files in workspace root", async () => {
      const workspace = await makeTempDir();
      await writeFile(workspace, "readme.txt", "hello");
      await fs.mkdir(path.join(workspace, "project"));
      await writeFile(path.join(workspace, "project"), PROJECT_FILE_NAME, "{}");

      const entries = await scanner.scanProjectDirs(workspace);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("project");
    });
  });

  describe("deleteProject", () => {
    it("removes the project directory entirely", async () => {
      const workspace = await makeTempDir();
      const projectDir = path.join(workspace, "to-delete");
      await fs.mkdir(projectDir);
      await writeFile(projectDir, PROJECT_FILE_NAME, "{}");
      await fs.mkdir(path.join(projectDir, "cache"));

      await scanner.deleteProject(projectDir);

      const exists = await fs
        .access(projectDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("does not affect sibling directories", async () => {
      const workspace = await makeTempDir();
      const projectDir = path.join(workspace, "to-delete");
      const siblingDir = path.join(workspace, "sibling");
      await fs.mkdir(projectDir);
      await fs.mkdir(siblingDir);
      await writeFile(siblingDir, PROJECT_FILE_NAME, "{}");

      await scanner.deleteProject(projectDir);

      const siblingExists = await fs
        .access(siblingDir)
        .then(() => true)
        .catch(() => false);
      expect(siblingExists).toBe(true);
    });

    it("rejects path traversal in project root", async () => {
      await expect(
        scanner.deleteProject("/test/../../etc/passwd"),
      ).rejects.toThrow("path traversal");
    });
  });
});
