/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
/**
 * Unit tests for the domain-level getProjectStatus function.
 *
 * Phase 1 material-discovery redesign: the review state machine has been
 * removed. Scene status now reflects search progress only:
 * - `pending`: no candidates.
 * - `candidates_ready`: the scene has been searched and has candidates.
 * Project status is `created` (no generation) or `planned` (generation exists).
 */
import { describe, expect, it } from "vitest";

import { getProjectStatus, type ProjectStatus } from "../../src/domain/project-status.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProject(opts?: { generation?: any; scenes?: any[]; blocks?: any[] }): any {
  const defaultBlocks = [
    { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 500 } },
  ];

  const defaultScenes = [
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
  ];

  const generation = opts?.generation ?? null;
  const scenes = opts?.scenes ?? defaultScenes;
  const blocks = opts?.blocks ?? defaultBlocks;

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
      textLengthUtf16: 500,
      offsetUnit: "utf16_code_unit",
      blocks,
    },
    generation,
    scenes,
  });
}

/** A minimal asset-kind candidate for search status tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCandidate(id = "candidate-001"): any {
  return {
    kind: "asset",
    id,
    provider: {
      id: "pexels",
      name: "Pexels",
      homepageUrl: "https://www.pexels.com",
      termsUrl: "https://www.pexels.com/terms",
      policyRevision: "1.0.0",
      termsCheckedAt: "2026-07-13T10:00:00Z",
    },
    providerAssetId: "photo-12345",
    mediaType: "photo",
    thumbnailUrl: "https://images.pexels.com/photos/12345/thumb.jpg",
    sourcePageUrl: "https://www.pexels.com/photo/12345",
    width: 1920,
    height: 1080,
    orientation: "landscape",
    creator: { name: "John Doe" },
    rights: {
      status: "unknown",
      attributionRequired: false,
      commercialUse: "unclear",
      derivatives: "unclear",
      verifiedAt: "2026-07-13T10:00:00Z",
      evidence: {
        capturedAt: "2026-07-13T10:00:00Z",
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    },
    retrievedAt: "2026-07-13T10:00:00Z",
    matchedQueryId: "query-001",
    rank: 1,
  };
}

// ---------------------------------------------------------------------------
// getProjectStatus
// ---------------------------------------------------------------------------

describe("getProjectStatus", () => {
  it("returns 'created' when generation is null", () => {
    const project = buildProject({ generation: null, scenes: [], blocks: [] });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("created");
    expect(status.sceneCount).toBe(0);
    expect(status.searchedSceneCount).toBe(0);
    expect(status.lastGenerationAt).toBeNull();
  });

  it("returns 'planned' when generation exists but all scenes are pending", () => {
    const project = buildProject({
      generation: {
        plannerProvider: "deepseek",
        promptVersion: "1.0.0",
        plannerOutputSchemaVersion: "1.0.0",
        sourceBlockVersion: "1.0.0",
        generatedAt: "2026-07-13T12:00:00Z",
      },
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
            visualKeywords: ["keyword"],
          },
          search: { queries: [], candidates: [] },
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("planned");
    expect(status.lastGenerationAt).toBe("2026-07-13T12:00:00Z");
    expect(status.searchedSceneCount).toBe(0);
  });

  it("counts searched scenes when at least one scene has candidates", () => {
    const candidate = makeCandidate();
    const project = buildProject({
      generation: {
        plannerProvider: "deepseek",
        promptVersion: "1.0.0",
        plannerOutputSchemaVersion: "1.0.0",
        sourceBlockVersion: "1.0.0",
        generatedAt: "2026-07-13T12:00:00Z",
      },
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
            visualKeywords: ["keyword"],
          },
          search: {
            queries: [
              { id: "query-001", language: "en", query: "greeting", purpose: "visual", enabled: true },
            ],
            candidates: [candidate],
            lastSearchedAt: "2026-07-13T12:00:00Z",
          },
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("planned");
    expect(status.searchedSceneCount).toBe(1);
  });

  it("correctly derives per-scene statuses", () => {
    const candidate = makeCandidate();
    const project = buildProject({
      generation: {
        plannerProvider: "deepseek",
        promptVersion: "1.0.0",
        plannerOutputSchemaVersion: "1.0.0",
        sourceBlockVersion: "1.0.0",
        generatedAt: "2026-07-13T12:00:00Z",
      },
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
            visualKeywords: ["keyword"],
          },
          search: { queries: [], candidates: [] },
        },
        {
          id: "scene-002",
          order: 2,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-001"],
            startQuote: "Hello",
            endQuote: "World",
          },
          sourceRange: { start: 100, end: 200 },
          text: "World end",
          summary: "Farewell",
          narrativeRole: "conclusion",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["keyword"],
          },
          search: {
            queries: [
              { id: "query-001", language: "en", query: "farewell", purpose: "visual", enabled: true },
            ],
            candidates: [candidate],
            lastSearchedAt: "2026-07-13T12:00:00Z",
          },
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.scenes).toHaveLength(2);
    expect(status.scenes[0]!.status).toBe("pending");
    expect(status.scenes[1]!.status).toBe("candidates_ready");
    expect(status.searchedSceneCount).toBe(1);
  });
});
