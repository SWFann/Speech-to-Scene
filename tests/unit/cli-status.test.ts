import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createProgram } from "../../src/cli/index.js";
import { createCommandContext, type CommandContext } from "../../src/cli/command-context.js";
import {
  SpeechToSceneProjectSchema,
  type SpeechToSceneProject,
} from "../../src/domain/project-schema.js";
import { PROJECT_FILE_NAME } from "../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];
const SCRIPT = "Hello from status CLI.";
const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-cli-status-"));
  tempRoots.push(root);
  return root;
}

function makeCandidate(id = "candidate-001"): Record<string, unknown> {
  return {
    id,
    provider: {
      id: "pexels",
      name: "Pexels",
      homepageUrl: "https://www.pexels.com",
      termsUrl: "https://www.pexels.com/terms",
      policyRevision: "1.0.0",
      termsCheckedAt: FIXED_NOW,
    },
    providerAssetId: "photo-12345",
    mediaType: "photo" as const,
    thumbnailUrl: "https://images.pexels.com/photos/12345/thumb.jpg",
    sourcePageUrl: "https://www.pexels.com/photo/12345",
    width: 1080,
    height: 1920,
    orientation: "portrait" as const,
    creator: { name: "John Doe" },
    rights: {
      status: "unknown" as const,
      attributionRequired: false,
      commercialUse: "unclear" as const,
      derivatives: "unclear" as const,
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    },
    retrievedAt: FIXED_NOW,
    matchedQueryId: "query-001",
    rank: 1,
  };
}

function makeLocalAsset(sceneId = "scene-00000001"): Record<string, unknown> {
  return {
    relativePath: `assets/${sceneId}/test.png`,
    originalFileName: "test.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    sha256: "b".repeat(64),
    importedAt: FIXED_NOW,
    provenance: {
      kind: "selected_candidate" as const,
      candidateId: "candidate-001",
    },
  };
}

function makeBaseScene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "scene-00000001",
    order: 1,
    sourceAnchor: {
      strategy: "source-blocks-v1",
      sourceBlockIds: ["block-00000001"],
      startQuote: "Hello",
      endQuote: ".",
    },
    sourceRange: { start: 0, end: SCRIPT.length },
    text: SCRIPT,
    summary: "First scene summary",
    narrativeRole: "hook",
    visualPlan: {
      decision: "none",
      rationale: "No visual",
      preferredMedia: ["photo"],
      visualKeywords: ["greeting"],
    },
    search: { queries: [], candidates: [] },
    review: { kind: "pending" },
    ...overrides,
  };
}

function makeProject(overrides: Record<string, unknown> = {}): SpeechToSceneProject {
  const project = SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "project-cli-status",
      title: "CLI Status Project",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      language: "zh-CN",
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

async function writeLocalAsset(projectRoot: string, sceneId: string): Promise<void> {
  const assetDir = path.join(projectRoot, "assets", sceneId);
  await fs.mkdir(assetDir, { recursive: true });
  await fs.writeFile(path.join(assetDir, "test.png"), Buffer.alloc(1024, 0x89));
}

async function runCli(
  args: string[],
  ctx: CommandContext = createCommandContext(),
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
    await createProgram(ctx).parseAsync(["node", "s2s", ...args]);
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
// CLI: s2s status
// ---------------------------------------------------------------------------

describe("CLI: s2s status", () => {
  it("is registered on the root command", () => {
    const commandNames = createProgram().commands.map((command) => command.name());

    expect(commandNames).toContain("status");
  });

  it("human output contains review, localAsset, and Validate summary", async () => {
    const projectRoot = await makeTempRoot();
    const candidate = makeCandidate();
    const localAsset = makeLocalAsset("scene-00000002");

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
            id: "block-00000001",
            order: 1,
            kind: "paragraph",
            sourceRange: { start: 0, end: SCRIPT.length },
          },
        ],
      },
      scenes: [
        makeBaseScene({
          id: "scene-00000001",
          order: 1,
          sourceRange: { start: 0, end: 11 },
          text: "Hello from",
          summary: "Scene 1",
          review: { kind: "pending" },
        }),
        makeBaseScene({
          id: "scene-00000002",
          order: 2,
          sourceRange: { start: 11, end: 22 },
          text: "status CLI.",
          summary: "Scene 2",
          search: {
            queries: [
              {
                id: "query-001",
                language: "en",
                query: "test",
                purpose: "visual",
                enabled: true,
              },
            ],
            candidates: [candidate],
            lastSearchedAt: FIXED_NOW,
          },
          review: {
            kind: "candidate_selected",
            selection: {
              selectedAt: FIXED_NOW,
              candidate,
            },
            localAsset,
          },
        }),
      ],
    });
    await writeProject(projectRoot, project);
    await writeSource(projectRoot);
    await writeLocalAsset(projectRoot, "scene-00000002");

    const result = await runCli(["status", projectRoot]);
    const output = result.stdout.join("\n");

    // Review summary: 1/2 processed (1 pending, 1 candidate_selected)
    expect(output).toContain("审阅：1/2 已处理");
    // withLocalAsset: 1 (candidate_selected with localAsset)
    expect(output).toContain("本地素材：1");
    // Validate line
    expect(output).toMatch(/Validate：\d+ errors?, \d+ warnings?/);
  });

  it("JSON output contains review and validation fields", async () => {
    const projectRoot = await makeTempRoot();
    await writeProject(projectRoot);
    await writeSource(projectRoot);

    const result = await runCli(["status", projectRoot, "--json"]);
    const body = JSON.parse(result.stdout.join("\n")) as {
      review: {
        totalScenes: number;
        pending: number;
        completionRatio: number;
      };
      validation: {
        ok: boolean;
        errorCount: number;
        warningCount: number;
        issues: unknown[];
      };
    };

    expect(body.review).toBeDefined();
    expect(body.review.totalScenes).toBe(0);
    expect(body.review.pending).toBe(0);
    expect(body.review.completionRatio).toBe(0);
    expect(body.validation).toBeDefined();
    expect(body.validation.ok).toBe(true);
    expect(body.validation.errorCount).toBe(0);
    expect(body.validation.warningCount).toBe(0);
    expect(body.validation.issues).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("outputs validation issues but keeps exit 0 when source is missing", async () => {
    const projectRoot = await makeTempRoot();
    // Write project but NOT the source file
    await writeProject(projectRoot);

    const result = await runCli(["status", projectRoot, "--json"]);
    const body = JSON.parse(result.stdout.join("\n")) as {
      validation: {
        ok: boolean;
        errorCount: number;
        issues: Array<{ code: string; severity: string }>;
      };
    };

    // Source missing is an error
    expect(body.validation.ok).toBe(false);
    expect(body.validation.errorCount).toBeGreaterThan(0);
    expect(body.validation.issues.map((i) => i.code)).toContain("source_missing");
    // Status still exits 0 — it's a read-only command
    expect(result.exitCode).toBe(0);
  });

  it("human output shows validation issues when source is missing", async () => {
    const projectRoot = await makeTempRoot();
    await writeProject(projectRoot);
    // No source file written

    const result = await runCli(["status", projectRoot]);
    const output = result.stdout.join("\n");

    expect(output).toContain("Validate：1 errors, 0 warnings");
    expect(output).toContain("问题：");
    expect(output).toContain("[error] source_missing: 文稿路径不存在");
    expect(result.exitCode).toBe(0);
  });

  it("handles non-existent project as error path", async () => {
    const projectRoot = await makeTempRoot();
    // Empty directory — no project.s2s.json

    const result = await runCli(["status", projectRoot]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("shows at most 5 validation issues in human output", async () => {
    const projectRoot = await makeTempRoot();

    // Create a project with 4 stock_asset scenes, all pending.
    // Each scene generates 2 warnings (scene_pending + stock_asset_no_candidates),
    // for a total of 8 warnings — more than the 5-issue display limit.
    // Non-overlapping sourceRanges are required by relation validation.
    const ranges = [
      { start: 0, end: 5, text: "Hello" },
      { start: 6, end: 10, text: "from" },
      { start: 11, end: 17, text: "status" },
      { start: 18, end: 22, text: "CLI." },
    ];
    const scenes = ranges.map((r, i) =>
      makeBaseScene({
        id: `scene-${String(i + 1).padStart(8, "0")}`,
        order: i + 1,
        sourceRange: { start: r.start, end: r.end },
        text: r.text,
        summary: `Scene ${i + 1}`,
        visualPlan: {
          decision: "stock_asset",
          rationale: "Needs visual",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        search: {
          queries: [
            {
              id: "query-001",
              language: "en",
              query: "test",
              purpose: "visual",
              enabled: true,
            },
          ],
          candidates: [],
        },
        review: { kind: "pending" },
      }),
    );

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
            id: "block-00000001",
            order: 1,
            kind: "paragraph",
            sourceRange: { start: 0, end: SCRIPT.length },
          },
        ],
      },
      scenes,
    });
    await writeProject(projectRoot, project);
    await writeSource(projectRoot);

    const result = await runCli(["status", projectRoot]);
    const output = result.stdout.join("\n");

    // Count the number of issue lines (start with "  - [")
    const issueLines = output.split("\n").filter((line) => line.startsWith("  - ["));

    // Should show at most 5 issues (8 total - 5 shown = 3 remaining)
    expect(issueLines.length).toBe(5);
    // Should have a "remaining" message
    expect(output).toContain("还有");
    expect(output).toContain("条问题未显示");
  });

  it("maps unexpected validateProject failures to a safe validation_unavailable issue", async () => {
    const projectRoot = await makeTempRoot();
    await writeProject(projectRoot);
    await writeSource(projectRoot);

    const ctx: CommandContext = {
      ...createCommandContext(),
      validateProject: async () => {
        await Promise.resolve();
        throw new Error("secret /absolute/path stack");
      },
    };

    const result = await runCli(["status", projectRoot, "--json"], ctx);
    const output = result.stdout.join("\n");
    const body = JSON.parse(output) as {
      validation: {
        ok: boolean;
        errorCount: number;
        warningCount: number;
        issues: Array<{ severity: string; code: string; message: string; hint?: string }>;
      };
    };

    expect(result.exitCode).toBe(0);
    expect(body.validation.ok).toBe(false);
    expect(body.validation.errorCount).toBe(1);
    expect(body.validation.warningCount).toBe(0);
    expect(body.validation.issues).toEqual([
      {
        severity: "error",
        code: "validation_unavailable",
        message: "项目验证未能完成",
        hint: "请重新运行 s2s validate 获取详细错误",
      },
    ]);
    expect(output).not.toContain("secret");
    expect(output).not.toContain("/absolute/path");
    expect(output).not.toContain("stack");
  });
});
