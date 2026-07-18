/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it } from "vitest";

import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import {
  validateProjectRelations,
  validateSceneRelations,
} from "../../src/domain/project-validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildValidProject(overrides?: any): any {
  const blocks = overrides?.blocks ?? [
    { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } },
    { id: "block-002", order: 2, kind: "paragraph", sourceRange: { start: 100, end: 200 } },
    { id: "block-003", order: 3, kind: "paragraph", sourceRange: { start: 200, end: 300 } },
  ];

  const scenes = overrides?.scenes ?? [
    {
      id: "scene-001",
      order: 1,
      sourceAnchor: {
        strategy: "source-blocks-v1",
        sourceBlockIds: ["block-001", "block-002"],
        startQuote: "Hello",
        endQuote: "World",
      },
      sourceRange: { start: 0, end: 200 },
      text: "Hello world, this is the scene text that spans two blocks.",
      summary: "A greeting scene",
      narrativeRole: "hook",
      visualPlan: {
        decision: "stock_asset",
        rationale: "Need a greeting image",
        preferredMedia: ["photo"],
        visualKeywords: ["greeting"],
      },
      search: {
        queries: [
          {
            id: "query-001",
            language: "zh",
            query: "greeting",
            purpose: "Find greeting images",
            enabled: true,
          },
        ],
        candidates: [],
      },
    },
  ];

  const textLength = overrides?.textLengthUtf16 ?? 300;

  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "my-project",
      title: "My Demo Project",
      createdAt: "2026-07-13T10:00:00Z",
      updatedAt: "2026-07-13T12:00:00Z",
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
      sizeBytes: 1024,
      textLengthUtf16: textLength,
      offsetUnit: "utf16_code_unit",
      blocks,
    },
    generation: {
      plannerProvider: "deepseek",
      promptVersion: "1.0.0",
      plannerOutputSchemaVersion: "1.0.0",
      sourceBlockVersion: "1.0.0",
      generatedAt: "2026-07-13T12:00:00Z",
    },
    scenes,
  });
}

// ---------------------------------------------------------------------------
// validateProjectRelations
// ---------------------------------------------------------------------------

describe("validateProjectRelations", () => {
  it("returns no issues for valid project", () => {
    const project = buildValidProject();
    const issues = validateProjectRelations(project);
    expect(issues).toHaveLength(0);
  });

  it("detects non-consecutive block order", () => {
    const project = buildValidProject({
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } },
        { id: "block-002", order: 3, kind: "paragraph", sourceRange: { start: 100, end: 200 } }, // skips 2
      ],
    });
    const issues = validateProjectRelations(project);
    expect(issues.some((i) => i.code === "non_consecutive_order")).toBe(true);
  });

  it("detects overlapping block ranges", () => {
    const project = buildValidProject({
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 150 } },
        { id: "block-002", order: 2, kind: "paragraph", sourceRange: { start: 100, end: 200 } },
      ],
    });
    const issues = validateProjectRelations(project);
    expect(issues.some((i) => i.code === "range_overlap")).toBe(true);
  });

  it("detects block range exceeding text boundary", () => {
    const project = buildValidProject({
      textLengthUtf16: 50,
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } },
      ],
    });
    const issues = validateProjectRelations(project);
    expect(issues.some((i) => i.code === "range_out_of_bounds")).toBe(true);
  });

  it("detects non-consecutive scene order", () => {
    const project = buildValidProject({
      scenes: [
        {
          id: "scene-001",
          order: 1,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-001"],
            startQuote: "Hello",
            endQuote: "World",
          },
          sourceRange: { start: 0, end: 100 },
          text: "Hello world",
          summary: "Greeting",
          narrativeRole: "hook",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["greeting"],
          },
          search: { queries: [], candidates: [] },
        },
        {
          id: "scene-002",
          order: 3, // skips 2
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-002"],
            startQuote: "World",
            endQuote: "End",
          },
          sourceRange: { start: 100, end: 200 },
          text: "World end",
          summary: "Farewell",
          narrativeRole: "conclusion",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["farewell"],
          },
          search: { queries: [], candidates: [] },
        },
      ],
    });
    const issues = validateProjectRelations(project);
    expect(issues.some((i) => i.code === "non_consecutive_order")).toBe(true);
  });

  it("detects anchor referencing nonexistent block", () => {
    const project = buildValidProject({
      scenes: [
        {
          id: "scene-001",
          order: 1,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-nonexistent"],
            startQuote: "Hello",
            endQuote: "World",
          },
          sourceRange: { start: 0, end: 100 },
          text: "Hello world",
          summary: "Greeting",
          narrativeRole: "hook",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["greeting"],
          },
          search: { queries: [], candidates: [] },
        },
      ],
    });
    const issues = validateProjectRelations(project);
    expect(issues.some((i) => i.code === "anchor_block_not_found")).toBe(true);
  });

  it("accepts stock_asset scene without enabled query (gating removed)", () => {
    // stock_asset check is enforced by SceneSchema.superRefine at parse time.
    // Here we verify that a scene parsed with the check passing produces no issues.
    const project = buildValidProject({
      scenes: [
        {
          id: "scene-001",
          order: 1,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-001"],
            startQuote: "Hello",
            endQuote: "World",
          },
          sourceRange: { start: 0, end: 100 },
          text: "Hello world",
          summary: "Greeting",
          narrativeRole: "hook",
          visualPlan: {
            decision: "stock_asset",
            rationale: "Need a stock photo",
            preferredMedia: ["photo"],
            visualKeywords: ["greeting"],
          },
          search: {
            queries: [
              {
                id: "query-001",
                language: "zh",
                query: "greeting",
                purpose: "Find greeting images",
                enabled: true,
              },
            ],
            candidates: [],
          },
        },
      ],
    });
    const issues = validateProjectRelations(project);
    // Phase 1 redesign: stock_asset gating removed, so no issues expected.
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateSceneRelations
// ---------------------------------------------------------------------------

describe("validateSceneRelations", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingBlocks: any[] = [
    { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } },
    { id: "block-002", order: 2, kind: "paragraph", sourceRange: { start: 100, end: 200 } },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseScene = (): any => ({
    id: "scene-001",
    order: 1,
    sourceAnchor: {
      strategy: "source-blocks-v1",
      sourceBlockIds: ["block-001"],
      startQuote: "Hello",
      endQuote: "World",
    },
    sourceRange: { start: 0, end: 100 },
    text: "Hello world",
    summary: "Greeting",
    narrativeRole: "hook",
    visualPlan: {
      decision: "none",
      rationale: "No visual",
      preferredMedia: ["photo"],
      visualKeywords: ["greeting"],
    },
    search: {
      queries: [],
      candidates: [],
    },
  });

  it("returns no issues for valid scene", () => {
    const issues = validateSceneRelations(baseScene(), existingBlocks);
    expect(issues).toHaveLength(0);
  });

  it("detects anchor referencing nonexistent block", () => {
    const scene = {
      ...baseScene(),
      sourceAnchor: {
        strategy: "source-blocks-v1",
        sourceBlockIds: ["block-nonexistent"],
        startQuote: "Hello",
        endQuote: "World",
      },
    };
    const issues = validateSceneRelations(scene, existingBlocks);
    expect(issues.some((i) => i.code === "anchor_block_not_found")).toBe(true);
  });
});
