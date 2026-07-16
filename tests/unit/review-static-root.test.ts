import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, afterEach } from "vitest";

import { resolveReviewStaticRoot } from "../../src/cli/review-static-root.js";

const tempDirs: string[] = [];

async function makeFakeRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-root-"));
  tempDirs.push(repo);
  await fs.mkdir(path.join(repo, "web", "dist"), { recursive: true });
  await fs.mkdir(path.join(repo, "dist", "cli", "commands"), { recursive: true });
  await fs.mkdir(path.join(repo, "src", "cli", "commands"), { recursive: true });
  await fs.writeFile(path.join(repo, "package.json"), '{"name":"speech-to-scene"}\n', "utf-8");
  await fs.writeFile(path.join(repo, "web", "dist", "index.html"), "<div></div>\n", "utf-8");
  await fs.writeFile(path.join(repo, "dist", "cli", "commands", "review-command.js"), "", "utf-8");
  await fs.writeFile(path.join(repo, "src", "cli", "commands", "review-command.ts"), "", "utf-8");
  return repo;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("resolveReviewStaticRoot", () => {
  it("finds web/dist from a dist command module location, independent of cwd", async () => {
    const repo = await makeFakeRepo();
    const moduleUrl = pathToFileURL(
      path.join(repo, "dist", "cli", "commands", "review-command.js"),
    ).href;

    const staticRoot = resolveReviewStaticRoot({
      cwd: path.join(os.tmpdir(), "not-the-repo"),
      moduleUrl,
    });

    expect(staticRoot).toBe(path.join(repo, "web", "dist"));
  });

  it("finds web/dist from a source command module location", async () => {
    const repo = await makeFakeRepo();
    const moduleUrl = pathToFileURL(
      path.join(repo, "src", "cli", "commands", "review-command.ts"),
    ).href;

    const staticRoot = resolveReviewStaticRoot({ moduleUrl });

    expect(staticRoot).toBe(path.join(repo, "web", "dist"));
  });

  it("uses explicit environment override first", async () => {
    const repo = await makeFakeRepo();
    const override = path.join(os.tmpdir(), "custom-static-root");
    const moduleUrl = pathToFileURL(
      path.join(repo, "dist", "cli", "commands", "review-command.js"),
    ).href;

    const staticRoot = resolveReviewStaticRoot({
      cwd: repo,
      moduleUrl,
      envStaticRoot: override,
    });

    expect(staticRoot).toBe(path.resolve(override));
  });

  it("falls back to cwd/web/dist when no repository root is discoverable", () => {
    const cwd = path.join(os.tmpdir(), "fallback-cwd");

    const staticRoot = resolveReviewStaticRoot({
      cwd,
      moduleUrl: "file:///tmp/no-repo/dist/cli/index.js",
    });

    expect(staticRoot).toBe(path.join(cwd, "web", "dist"));
  });
});
