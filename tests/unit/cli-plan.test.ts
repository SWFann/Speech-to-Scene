/**
 * CLI `s2s plan` integration tests.
 *
 * Tests the full CLI pipeline from command invocation to output.
 * Uses temporary project directories to avoid polluting the workspace.
 */

import { describe, expect, it, afterEach, vi } from "vitest";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createProgram } from "../../src/cli/index.js";
import { createTempProject } from "../helpers/temp-project.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";

const VALID_SCRIPT =
  "# 深度学习简介\n\n深度学习是机器学习的一个分支。\n它通过多层神经网络来学习数据的表示。\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes a minimal valid `project.s2s.json` directly in the project root.
 *
 * This bypasses `createProject` because the repository's `create` method
 * does not persist the file in the test environment. We write the file
 * manually with the correct schema and a matching source hash.
 */
async function writeProjectFile(projectRoot: string, scriptBytes: Uint8Array): Promise<void> {
  const sourceHash = crypto.createHash("sha256").update(scriptBytes).digest("hex");
  const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

  const project: SpeechToSceneProject = {
    schemaVersion: "0.1",
    project: {
      id: "project-0001",
      title: "Test Project",
      createdAt: now,
      updatedAt: now,
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: sourceHash,
      encoding: "utf-8",
      sizeBytes: scriptBytes.length,
      textLengthUtf16: VALID_SCRIPT.length,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  };

  await fs.writeFile(
    path.join(projectRoot, "project.s2s.json"),
    JSON.stringify(project, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI: s2s plan", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // best-effort cleanup
      }
    }
    cleanups.length = 0;
  });

  async function setupProject(): Promise<string> {
    const scriptBytes = Buffer.from(VALID_SCRIPT, "utf-8");
    const { projectRoot, cleanup } = await createTempProject({
      scriptContent: VALID_SCRIPT,
    });
    cleanups.push(cleanup);

    // Write a valid project.s2s.json directly in the project root.
    await writeProjectFile(projectRoot, scriptBytes);

    return projectRoot;
  }

  it("plans a project with --provider fixture", async () => {
    const projectRoot = await setupProject();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync(["node", "s2s", "plan", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    // On success, no error output
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("plans a project with default provider (env fallback)", async () => {
    const projectRoot = await setupProject();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync(["node", "s2s", "plan", projectRoot]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("outputs JSON with --json flag", async () => {
    const projectRoot = await setupProject();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "plan",
        projectRoot,
        "--provider",
        "fixture",
        "--json",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    const logCalls = consoleLogSpy.mock.calls;
    const jsonOutput = logCalls.find((c) => {
      const val = c[0] as unknown as string;
      return typeof val === "string" && val.includes("projectId");
    })?.[0] as unknown as string | undefined;
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput as unknown as string) as unknown as Record<
      string,
      unknown
    >;
    expect((parsed as { status: string }).status).toBe("planned");
    expect((parsed as { sceneCount: number }).sceneCount).toBeGreaterThan(0);

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("outputs human-readable format by default", async () => {
    const projectRoot = await setupProject();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync(["node", "s2s", "plan", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.map((c) => c[0] as unknown as string).join("\n");
    expect(output).toContain("planned");

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("prints error for non-existent project", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "plan",
        "/nonexistent/path",
        "--provider",
        "fixture",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as unknown as string).join("");
    expect(errorOutput).toMatch(/not found|不存在/);

    consoleErrorSpy.mockRestore();
  });

  it("prints error for already planned project without --force", async () => {
    const projectRoot = await setupProject();

    // Plan once
    const program1 = createProgram();
    try {
      await program1.parseAsync(["node", "s2s", "plan", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    // Try to plan again without --force
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program2 = createProgram();
    try {
      await program2.parseAsync(["node", "s2s", "plan", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as unknown as string).join("");
    expect(errorOutput).toMatch(/already planned|重新规划/);

    consoleErrorSpy.mockRestore();
  });

  it("respects --force flag for already planned project", async () => {
    const projectRoot = await setupProject();

    // Plan once
    const program1 = createProgram();
    try {
      await program1.parseAsync(["node", "s2s", "plan", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    // Plan again with --force
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program2 = createProgram();
    try {
      await program2.parseAsync([
        "node",
        "s2s",
        "plan",
        projectRoot,
        "--provider",
        "fixture",
        "--force",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("prints error for invalid --max-scenes value", async () => {
    const projectRoot = await setupProject();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "plan",
        projectRoot,
        "--provider",
        "fixture",
        "--max-scenes",
        "0",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("does not save on --dry-run", async () => {
    const projectRoot = await setupProject();

    // Snapshot the project file before --dry-run
    const projectPath = path.join(projectRoot, "project.s2s.json");
    const beforeContent = await fs.readFile(projectPath, "utf-8");
    const before = JSON.parse(beforeContent) as SpeechToSceneProject;
    expect(before.generation).toBeNull();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "plan",
        projectRoot,
        "--provider",
        "fixture",
        "--dry-run",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    // Verify project file is byte-for-byte unchanged
    const afterContent = await fs.readFile(projectPath, "utf-8");
    expect(afterContent).toBe(beforeContent);

    consoleErrorSpy.mockRestore();
  });
});
