/**
 * Unit tests for the switchProject use case.
 *
 * Phase 3: multi-project workspace support.
 */

import { describe, expect, it } from "vitest";

import { switchProject } from "../../src/application/switch-project.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { InvalidArgumentError, ProjectNotFoundError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepository(existingRoots: Set<string>): ProjectRepository {
  return {
    exists: (root) => Promise.resolve(existingRoots.has(root)),
    create: () => Promise.resolve(),
    load: () => Promise.resolve({} as SpeechToSceneProject),
    save: () => Promise.resolve(),
  };
}

const WORKSPACE = "/test/workspace";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("switchProject", () => {
  it("resolves project root for a valid project name", async () => {
    const repo = makeRepository(new Set([`${WORKSPACE}/demo2`]));

    const result = await switchProject({ workspaceRoot: WORKSPACE, project: "demo2" }, repo);

    expect(result.projectRoot).toBe(`${WORKSPACE}/demo2`);
    expect(result.project).toBe("demo2");
  });

  it("throws ProjectNotFoundError for non-existent project", async () => {
    const repo = makeRepository(new Set());

    await expect(
      switchProject({ workspaceRoot: WORKSPACE, project: "nonexistent" }, repo),
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it("throws InvalidArgumentError for empty project name", async () => {
    const repo = makeRepository(new Set());

    await expect(switchProject({ workspaceRoot: WORKSPACE, project: "" }, repo)).rejects.toThrow(
      InvalidArgumentError,
    );
  });

  it("throws InvalidArgumentError for path traversal attempts", async () => {
    const repo = makeRepository(new Set());

    await expect(
      switchProject({ workspaceRoot: WORKSPACE, project: "../etc/passwd" }, repo),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for hidden dot-directories", async () => {
    const repo = makeRepository(new Set());

    await expect(
      switchProject({ workspaceRoot: WORKSPACE, project: ".s2s" }, repo),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for names with backslash", async () => {
    const repo = makeRepository(new Set());

    await expect(
      switchProject({ workspaceRoot: WORKSPACE, project: "evil\\path" }, repo),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError for dot segment", async () => {
    const repo = makeRepository(new Set());

    await expect(switchProject({ workspaceRoot: WORKSPACE, project: "." }, repo)).rejects.toThrow(
      InvalidArgumentError,
    );
  });

  it("trims whitespace from project name", async () => {
    const repo = makeRepository(new Set([`${WORKSPACE}/demo`]));

    const result = await switchProject({ workspaceRoot: WORKSPACE, project: "  demo  " }, repo);

    expect(result.project).toBe("demo");
  });

  it("strips trailing slashes from workspaceRoot", async () => {
    const repo = makeRepository(new Set([`${WORKSPACE}/demo`]));

    const result = await switchProject({ workspaceRoot: `${WORKSPACE}/`, project: "demo" }, repo);

    expect(result.projectRoot).toBe(`${WORKSPACE}/demo`);
  });
});
