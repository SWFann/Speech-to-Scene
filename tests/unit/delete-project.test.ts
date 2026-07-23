/**
 * Unit tests for the deleteProject use case.
 *
 * Phase 3: multi-project workspace support.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { deleteProject } from "../../src/application/delete-project.js";
import type { WorkspaceScanner } from "../../src/application/ports/workspace-scanner.js";
import { FileSystemWorkspaceScanner } from "../../src/infrastructure/workspace-scanner.js";
import { PROJECT_FILE_NAME } from "../../src/shared/constants.js";
import { InvalidArgumentError, ProjectNotFoundError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanner(deletedPaths: string[]): WorkspaceScanner {
  return {
    scanProjectDirs: () => Promise.resolve([{ name: "demo", hasProject: true }]),
    deleteProject: (projectRoot: string) => {
      deletedPaths.push(projectRoot);
      return Promise.resolve();
    },
  };
}

function makeFailingScanner(error: NodeJS.ErrnoException): WorkspaceScanner {
  return {
    scanProjectDirs: () => Promise.resolve([{ name: "demo", hasProject: true }]),
    deleteProject: () => Promise.reject(error),
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-delete-project-"));
  tempDirs.push(workspace);
  return workspace;
}

function validProjectJson(): string {
  return JSON.stringify({
    schemaVersion: "0.1",
    project: {
      id: "project-test",
      title: "Test project",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z",
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: {
        intendedUse: "commercial_capable",
        willModify: true,
      },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: "a".repeat(64),
      encoding: "utf-8",
      sizeBytes: 1,
      textLengthUtf16: 1,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deleteProject", () => {
  it("deletes a marked project with the real workspace scanner", async () => {
    const workspaceRoot = await makeWorkspace();
    const projectRoot = path.join(workspaceRoot, "demo");
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, PROJECT_FILE_NAME), validProjectJson());
    await fs.writeFile(path.join(projectRoot, "script.md"), "keep only until deletion");

    const result = await deleteProject(
      { workspaceRoot, projectName: "demo", confirm: "demo" },
      new FileSystemWorkspaceScanner(),
    );

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe("demo");
    await expect(fs.access(projectRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an ordinary workspace directory and preserves its files", async () => {
    const workspaceRoot = await makeWorkspace();
    const ordinaryRoot = path.join(workspaceRoot, "notes");
    const preservedFile = path.join(ordinaryRoot, "important.txt");
    await fs.mkdir(ordinaryRoot);
    await fs.writeFile(preservedFile, "must survive");

    await expect(
      deleteProject(
        { workspaceRoot, projectName: "notes", confirm: "notes" },
        new FileSystemWorkspaceScanner(),
      ),
    ).rejects.toThrow(ProjectNotFoundError);

    await expect(fs.readFile(preservedFile, "utf-8")).resolves.toBe("must survive");
  });

  it("throws InvalidArgumentError when confirmation does not match", async () => {
    const scanner = makeScanner([]);

    await expect(
      deleteProject(
        { workspaceRoot: "/test/workspace", projectName: "demo", confirm: "wrong" },
        scanner,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for empty confirmation", async () => {
    const scanner = makeScanner([]);

    await expect(
      deleteProject(
        { workspaceRoot: "/test/workspace", projectName: "demo", confirm: "" },
        scanner,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws ProjectNotFoundError when the named directory is missing", async () => {
    const workspaceRoot = await makeWorkspace();

    await expect(
      deleteProject(
        { workspaceRoot, projectName: "missing", confirm: "missing" },
        new FileSystemWorkspaceScanner(),
      ),
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it("rethrows non-ENOENT errors from scanner", async () => {
    const scanner = makeFailingScanner({
      name: "Error",
      message: "EACCES",
      code: "EACCES",
    });

    await expect(
      deleteProject(
        { workspaceRoot: "/test/workspace", projectName: "demo", confirm: "demo" },
        scanner,
      ),
    ).rejects.toThrow("EACCES");
  });

  it("trims whitespace from confirmation", async () => {
    const deleted: string[] = [];
    const scanner = makeScanner(deleted);

    const result = await deleteProject(
      { workspaceRoot: "/test/workspace", projectName: "demo", confirm: "  demo  " },
      scanner,
    );

    expect(result.ok).toBe(true);
  });

  it.each(["../outside", "nested/project", "/etc", ".s2s", ".", ".."])(
    "rejects unsafe project name %j without deleting",
    async (projectName) => {
      const deleted: string[] = [];

      await expect(
        deleteProject(
          { workspaceRoot: "/test/workspace", projectName, confirm: projectName },
          makeScanner(deleted),
        ),
      ).rejects.toThrow(InvalidArgumentError);

      expect(deleted).toEqual([]);
    },
  );

  it("keeps the resolved deletion target inside workspaceRoot", async () => {
    const deleted: string[] = [];

    await deleteProject(
      { workspaceRoot: "/test/workspace/../workspace", projectName: "demo", confirm: "demo" },
      makeScanner(deleted),
    );

    expect(deleted).toEqual(["/test/workspace/demo"]);
  });
});
