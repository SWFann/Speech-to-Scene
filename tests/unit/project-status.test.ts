/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
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
      review: { kind: "pending" },
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

// ---------------------------------------------------------------------------
// getProjectStatus
// ---------------------------------------------------------------------------

describe("getProjectStatus", () => {
  it("returns 'created' when generation is null", () => {
    const project = buildProject({ generation: null, scenes: [], blocks: [] });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("created");
    expect(status.sceneCount).toBe(0);
    expect(status.producingSceneCount).toBe(0);
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
          review: { kind: "pending" },
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("planned");
    expect(status.lastGenerationAt).toBe("2026-07-13T12:00:00Z");
  });

  it("returns 'producing' when at least one scene is selected", () => {
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
          review: {
            kind: "candidate_selected",
            selection: {
              selectedAt: "2026-07-13T12:00:00Z",
              candidate: {
                id: "candidate-001",
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
              },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.status).toBe("planned");
    expect(status.producingSceneCount).toBe(1);
  });

  it("correctly derives per-scene statuses", () => {
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
          review: { kind: "pending" },
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
          search: { queries: [], candidates: [] },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          review: { kind: "skipped", decidedAt: "2026-07-13T12:00:00Z" } as any,
        },
      ],
    });
    const status: ProjectStatus = getProjectStatus(project);
    expect(status.scenes).toHaveLength(2);
    expect(status.scenes[0]!.status).toBe("pending");
    expect(status.scenes[1]!.status).toBe("skipped");
    expect(status.producingSceneCount).toBe(1);
  });
});
