import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createProgram } from "../../src/cli/index.js";
import {
  SpeechToSceneProjectSchema,
  type SpeechToSceneProject,
} from "../../src/domain/project-schema.js";
import { PROJECT_FILE_NAME } from "../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];
const SCRIPT = "Hello from validate CLI.";
const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-cli-validate-"));
  tempRoots.push(root);
  return root;
}

function makeProject(overrides: Partial<SpeechToSceneProject> = {}): SpeechToSceneProject {
  const project = SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "project-cli-validate",
      title: "CLI Validate Project",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      language: "en-US",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: sha256(SCRIPT),
      encoding: "utf-8",
      sizeBytes: Buffer.byteLength(SCRIPT),
      textLengthUtf16: SCRIPT.length,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  });

  return SpeechToSceneProjectSchema.parse({ ...project, ...overrides });
}

async function writeProject(projectRoot: string, project = makeProject()): Promise<void> {
  await fs.writeFile(
    path.join(projectRoot, PROJECT_FILE_NAME),
    JSON.stringify(project, null, 2) + "\n",
  );
}

async function writeSource(projectRoot: string): Promise<void> {
  await fs.writeFile(path.join(projectRoot, "script.md"), SCRIPT, "utf-8");
}

async function runCli(
  args: string[],
): Promise<{ stdout: string[]; stderr: string[]; exitCode: unknown }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stringifyMessage = (message: unknown): string =>
    typeof message === "string" ? message : JSON.stringify(message);
  const logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    stdout.push(message === undefined ? "" : stringifyMessage(message));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
    stderr.push(message === undefined ? "" : stringifyMessage(message));
  });
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await createProgram().parseAsync(["node", "s2s", ...args]);
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    process.exitCode = previousExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// CLI validate
// ---------------------------------------------------------------------------

describe("CLI: s2s validate", () => {
  it("is registered on the root command", () => {
    const commandNames = createProgram().commands.map((command) => command.name());

    expect(commandNames).toContain("validate");
  });

  it("prints JSON and exits 0 for a valid project", async () => {
    const projectRoot = await makeTempRoot();
    await writeProject(projectRoot);
    await writeSource(projectRoot);

    const result = await runCli(["validate", projectRoot, "--json"]);
    const body = JSON.parse(result.stdout.join("\n")) as { ok: boolean; errorCount: number };

    expect(body.ok).toBe(true);
    expect(body.errorCount).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
  });

  it("sets exit code 1 when validation has errors", async () => {
    const projectRoot = await makeTempRoot();
    await writeProject(projectRoot);

    const result = await runCli(["validate", projectRoot, "--json"]);
    const body = JSON.parse(result.stdout.join("\n")) as {
      ok: boolean;
      issues: Array<{ code: string }>;
    };

    expect(body.ok).toBe(false);
    expect(body.issues.map((issue) => issue.code)).toContain("source_missing");
    expect(result.exitCode).toBe(1);
  });

  it("keeps exit code 0 when only warnings are present", async () => {
    const projectRoot = await makeTempRoot();
    const project = makeProject({
      generation: {
        plannerProvider: "fixture",
        apiProtocol: "fixture",
        promptVersion: "v1",
        plannerOutputSchemaVersion: "v1",
        sourceBlockVersion: "v1",
        generatedAt: FIXED_NOW,
      },
      source: {
        ...makeProject().source,
        blocks: [
          {
            id: "block-001",
            order: 1,
            kind: "paragraph",
            sourceRange: { start: 0, end: SCRIPT.length },
          },
        ],
      },
      scenes: [
        {
          id: "scene-001",
          order: 1,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-001"],
            startQuote: "Hello",
            endQuote: ".",
          },
          sourceRange: { start: 0, end: SCRIPT.length },
          text: SCRIPT,
          summary: "Pending fixture scene",
          narrativeRole: "hook",
          visualPlan: {
            decision: "stock_asset",
            rationale: "Needs supporting visual",
            preferredMedia: ["photo"],
            visualKeywords: ["fixture"],
          },
          search: {
            queries: [
              {
                id: "query-001",
                language: "en",
                query: "fixture",
                purpose: "visual",
                enabled: true,
              },
            ],
            candidates: [],
          },
        },
      ],
    });
    await writeProject(projectRoot, project);
    await writeSource(projectRoot);

    const result = await runCli(["validate", projectRoot]);

    expect(result.stdout.join("\n")).toContain("验证通过：未发现错误");
    expect(result.stdout.join("\n")).toContain("scene_no_candidates");
    expect(result.exitCode).toBe(0);
  });

  it("reports missing projects as validation errors", async () => {
    const projectRoot = await makeTempRoot();

    const result = await runCli(["validate", projectRoot, "--json"]);
    const body = JSON.parse(result.stdout.join("\n")) as {
      ok: boolean;
      issues: Array<{ code: string }>;
    };

    expect(body.ok).toBe(false);
    expect(body.issues.map((issue) => issue.code)).toContain("project_missing");
    expect(result.exitCode).toBe(1);
  });
});
