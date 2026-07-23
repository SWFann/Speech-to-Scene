import fs, { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProjectFromContent,
  type CreateProjectFromContentInput,
} from "../../src/application/create-project-from-content.js";
import type { ProjectScaffolder } from "../../src/application/ports/project-scaffolder.js";
import { SystemClock, SystemIdGenerator } from "../../src/infrastructure/system-adapters.js";
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import { FileSystemProjectScaffolder } from "../../src/infrastructure/project-scaffolder.js";
import { ProjectAlreadyExistsError, ProjectWriteError } from "../../src/shared/errors.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function validInput(projectDirectory: string): CreateProjectFromContentInput {
  return {
    projectDirectory,
    content: new TextEncoder().encode("# 标题\n\n这是一段口播稿。"),
    originalFileName: "script.md",
    title: "",
    language: "zh-CN" as const,
    aspectRatio: "9:16" as const,
    style: "knowledge" as const,
    intendedUse: "commercial_capable" as const,
    willModify: true,
  };
}

describe("createProjectFromContent", () => {
  it("creates a project from text bytes without a file path", async () => {
    const dir = await makeTempDir("s2s-content-");
    const projectDir = path.join(dir, "myproj");
    const content = "# 标题\n\n这是一段口播稿。";

    const result = await createProjectFromContent(
      {
        projectDirectory: projectDir,
        content: new TextEncoder().encode(content),
        originalFileName: "script.md",
        title: "",
        language: "zh-CN",
        aspectRatio: "9:16",
        style: "knowledge",
        intendedUse: "commercial_capable",
        willModify: true,
      },
      new SystemClock(),
      new SystemIdGenerator(),
      new JsonProjectRepository(),
      new FileSystemProjectScaffolder(),
    );

    expect(result.status).toBe("created");
    expect(result.projectRoot).toBe(path.resolve(projectDir));
    const repo = new JsonProjectRepository();
    const loaded = await repo.load(result.projectRoot);
    expect(loaded.source.sha256).toBeTruthy();
  });

  it("rejects empty content", async () => {
    const dir = await makeTempDir("s2s-empty-");
    await expect(
      createProjectFromContent(
        {
          projectDirectory: path.join(dir, "p"),
          content: new TextEncoder().encode(""),
          originalFileName: "script.md",
          title: "",
          language: "zh-CN",
          aspectRatio: "9:16",
          style: "knowledge",
          intendedUse: "commercial_capable",
          willModify: true,
        },
        new SystemClock(),
        new SystemIdGenerator(),
        new JsonProjectRepository(),
        new FileSystemProjectScaffolder(),
      ),
    ).rejects.toThrow();
  });

  it("rejects a pre-existing non-project directory before writing and preserves its contents", async () => {
    const dir = await makeTempDir("s2s-existing-content-");
    const projectDir = path.join(dir, "occupied");
    const preservedFile = path.join(projectDir, "important.txt");
    await fs.mkdir(projectDir);
    await fs.writeFile(preservedFile, "do not delete");

    await expect(
      createProjectFromContent(
        validInput(projectDir),
        new SystemClock(),
        new SystemIdGenerator(),
        new JsonProjectRepository(),
        new FileSystemProjectScaffolder(),
      ),
    ).rejects.toThrow(ProjectAlreadyExistsError);

    await expect(fs.readFile(preservedFile, "utf-8")).resolves.toBe("do not delete");
    await expect(fs.readdir(projectDir)).resolves.toEqual(["important.txt"]);
  });

  it("creates the project root exclusively so a concurrent directory is never reused", async () => {
    const dir = await makeTempDir("s2s-exclusive-root-");
    const projectDir = path.join(dir, "occupied");
    const preservedFile = path.join(projectDir, "concurrent.txt");
    await fs.mkdir(projectDir);
    await fs.writeFile(preservedFile, "must survive");

    await expect(new FileSystemProjectScaffolder().createRoot(projectDir)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(fs.readFile(preservedFile, "utf-8")).resolves.toBe("must survive");
  });

  it("maps a concurrent root creation race to ProjectAlreadyExistsError", async () => {
    const dir = await makeTempDir("s2s-create-race-");
    const projectDir = path.join(dir, "race");
    const scaffolder: ProjectScaffolder = {
      ...new FileSystemProjectScaffolder(),
      createRoot: () =>
        Promise.reject(Object.assign(new Error("already exists"), { code: "EEXIST" })),
      createSubdirectories: () => Promise.resolve(),
      copySourceDocument: () => Promise.resolve("script.md"),
      writeSentinel: () => Promise.resolve(),
      removeSentinel: () => Promise.resolve(),
      checkSentinel: () => Promise.resolve(false),
      hasAnySentinel: () => Promise.resolve(false),
    };

    await expect(
      createProjectFromContent(
        validInput(projectDir),
        new SystemClock(),
        new SystemIdGenerator(),
        new JsonProjectRepository(),
        scaffolder,
      ),
    ).rejects.toThrow(ProjectAlreadyExistsError);
  });

  it("removes a root it created when the sentinel cannot be written", async () => {
    const dir = await makeTempDir("s2s-sentinel-failure-");
    const projectDir = path.join(dir, "project");
    const realScaffolder = new FileSystemProjectScaffolder();
    const scaffolder: ProjectScaffolder = {
      createRoot: (root) => realScaffolder.createRoot(root),
      createSubdirectories: (root) => realScaffolder.createSubdirectories(root),
      copySourceDocument: (root, bytes, fileName) =>
        realScaffolder.copySourceDocument(root, bytes, fileName),
      writeSentinel: () => Promise.reject(new Error("sentinel write failed")),
      removeSentinel: (root) => realScaffolder.removeSentinel(root),
      checkSentinel: () => Promise.resolve(false),
      hasAnySentinel: (root) => realScaffolder.hasAnySentinel(root),
    };

    await expect(
      createProjectFromContent(
        validInput(projectDir),
        new SystemClock(),
        new SystemIdGenerator(),
        new JsonProjectRepository(),
        scaffolder,
      ),
    ).rejects.toThrow(ProjectWriteError);

    await expect(fs.access(projectDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
