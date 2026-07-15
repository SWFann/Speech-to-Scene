/**
 * Integration tests for `s2s search` command.
 */

import { describe, expect, it, afterEach, vi } from "vitest";

import fs from "node:fs/promises";
import path from "node:path";

import { createProgram } from "../../src/cli/index.js";
import { createTempProject } from "../helpers/temp-project.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a test program with exitOverride to prevent process.exit().
 */
function createTestProgram(): ReturnType<typeof createProgram> {
  const program = createProgram();
  // Override exit behavior for testing - Commander help/errors become throws
  program.exitOverride((exitCode) => {
    throw new Error(`Command failed with exit code ${exitCode}`);
  });
  return program;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes a minimal valid `project.s2s.json` directly in the project root.
 */
async function writeProjectFile(projectRoot: string): Promise<void> {
  const now = new Date().toISOString();
  const project: SpeechToSceneProject = {
    schemaVersion: "0.1",
    project: {
      id: "test-project",
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
      sha256: "a".repeat(64),
      encoding: "utf-8",
      sizeBytes: 100,
      textLengthUtf16: 100,
      offsetUnit: "utf16_code_unit",
      blocks: [{ id: "block-1", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } }],
    },
    generation: {
      plannerProvider: "fixture",
      apiProtocol: "fixture",
      promptVersion: "plan-script-v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: new Date().toISOString(),
    },
    scenes: [
      {
        id: "scene-1",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1" as const,
          sourceBlockIds: ["block-1"],
          startQuote: "quote",
          endQuote: "quote",
        },
        sourceRange: { start: 0, end: 10 },
        text: "Scene text",
        summary: "Scene summary",
        narrativeRole: "explanation" as const,
        visualPlan: {
          decision: "stock_asset" as const,
          rationale: "Need visual asset",
          preferredMedia: ["photo", "video"] as ["photo", "video"],
          visualKeywords: ["test"],
        },
        search: {
          queries: [
            {
              id: "q-1",
              language: "zh" as const,
              query: "test query 1",
              purpose: "Search for test",
              enabled: true,
            },
          ],
          candidates: [],
          lastSearchedAt: undefined,
        },
        review: { kind: "pending" as const },
      },
    ],
  };

  await fs.writeFile(
    path.join(projectRoot, "project.s2s.json"),
    JSON.stringify(project, null, 2) + "\n",
    "utf-8",
  );
}

describe("CLI: s2s search", () => {
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
    const { projectRoot, cleanup } = await createTempProject({
      scriptContent: "# Test script\n\nThis is a test script for searching assets.\n",
    });
    cleanups.push(cleanup);

    // Write project file
    await writeProjectFile(projectRoot);

    return projectRoot;
  }

  it("registers search subcommand", () => {
    const program = createTestProgram();
    const searchCmd = program.commands.find((c) => c.name() === "search");
    expect(searchCmd).toBeDefined();
  });

  it("validates provider name", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync(["node", "s2s", "search", projectRoot, "--provider", "invalid"]);
    } catch {
      // parseAsync may throw on error paths
    }

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as unknown as string).join("");
    expect(errorOutput).toContain("Unknown provider");

    consoleErrorSpy.mockRestore();
  });

  it("rejects negative --limit", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "search",
        projectRoot,
        "--provider",
        "fixture",
        "--limit",
        "-1",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as unknown as string).join("");
    expect(errorOutput).toContain("limit");

    consoleErrorSpy.mockRestore();
  });

  it("requires project directory argument", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    // Suppress Commander's missing-argument error that goes to stderr
    process.stderr.write = () => true;

    const program = createTestProgram();
    let error: Error | undefined;
    try {
      await program.parseAsync(["node", "s2s", "search"]);
    } catch (e) {
      error = e instanceof Error ? e : undefined;
    } finally {
      consoleErrorSpy.mockRestore();
      process.stderr.write = originalStderrWrite;
    }

    // Either console.error was called OR an error was thrown
    expect(consoleErrorSpy.mock.calls.length > 0 || error !== undefined).toBe(true);
  });

  it("searches assets with valid options", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync(["node", "s2s", "search", projectRoot, "--provider", "fixture"]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("accepts --scene option", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "search",
        projectRoot,
        "--provider",
        "fixture",
        "--scene",
        "scene-1",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("accepts --refresh flag", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "search",
        projectRoot,
        "--provider",
        "fixture",
        "--refresh",
      ]);
    } catch {
      // parseAsync may throw on error paths
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("accepts --dry-run flag", async () => {
    const projectRoot = await setupProject();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = createTestProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "search",
        projectRoot,
        "--provider",
        "fixture",
        "--dry-run",
      ]);
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

    const program = createTestProgram();
    try {
      await program.parseAsync([
        "node",
        "s2s",
        "search",
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

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
