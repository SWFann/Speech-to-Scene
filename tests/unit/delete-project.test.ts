/**
 * Unit tests for the deleteProject use case.
 *
 * Phase 3: multi-project workspace support.
 */

import { describe, expect, it } from "vitest";

import { deleteProject } from "../../src/application/delete-project.js";
import type { WorkspaceScanner } from "../../src/application/ports/workspace-scanner.js";
import { InvalidArgumentError, ProjectNotFoundError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanner(deletedPaths: string[]): WorkspaceScanner {
  return {
    scanProjectDirs: () => Promise.resolve([]),
    deleteProject: (projectRoot: string) => {
      deletedPaths.push(projectRoot);
      return Promise.resolve();
    },
  };
}

function makeFailingScanner(error: NodeJS.ErrnoException): WorkspaceScanner {
  return {
    scanProjectDirs: () => Promise.resolve([]),
    deleteProject: () => Promise.reject(error),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deleteProject", () => {
  it("deletes project when confirmation matches directory name", async () => {
    const deleted: string[] = [];
    const scanner = makeScanner(deleted);

    const result = await deleteProject(
      { projectRoot: "/test/workspace/demo", confirm: "demo" },
      scanner,
    );

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe("demo");
    expect(deleted).toEqual(["/test/workspace/demo"]);
  });

  it("throws InvalidArgumentError when confirmation does not match", async () => {
    const scanner = makeScanner([]);

    await expect(
      deleteProject(
        { projectRoot: "/test/workspace/demo", confirm: "wrong" },
        scanner,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for empty confirmation", async () => {
    const scanner = makeScanner([]);

    await expect(
      deleteProject(
        { projectRoot: "/test/workspace/demo", confirm: "" },
        scanner,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws ProjectNotFoundError when directory does not exist (ENOENT)", async () => {
    const scanner = makeFailingScanner({
      name: "Error",
      message: "ENOENT",
      code: "ENOENT",
    });

    await expect(
      deleteProject(
        { projectRoot: "/test/workspace/missing", confirm: "missing" },
        scanner,
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
        { projectRoot: "/test/workspace/demo", confirm: "demo" },
        scanner,
      ),
    ).rejects.toThrow("EACCES");
  });

  it("trims whitespace from confirmation", async () => {
    const deleted: string[] = [];
    const scanner = makeScanner(deleted);

    const result = await deleteProject(
      { projectRoot: "/test/workspace/demo", confirm: "  demo  " },
      scanner,
    );

    expect(result.ok).toBe(true);
  });
});
