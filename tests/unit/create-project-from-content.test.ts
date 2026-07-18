import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createProjectFromContent } from "../../src/application/create-project-from-content.js";
import { SystemClock, SystemIdGenerator } from "../../src/infrastructure/system-adapters.js";
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import { FileSystemProjectScaffolder } from "../../src/infrastructure/project-scaffolder.js";

describe("createProjectFromContent", () => {
  it("creates a project from text bytes without a file path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "s2s-content-"));
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
    const dir = await mkdtemp(path.join(tmpdir(), "s2s-empty-"));
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
});
