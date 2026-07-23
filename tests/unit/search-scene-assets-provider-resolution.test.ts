import { describe, expect, it, vi } from "vitest";

import { searchSceneAssets } from "../../src/application/search-scene-assets.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SearchProvider } from "../../src/application/search-project-assets.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";

function makeProject(): SpeechToSceneProject {
  const now = "2026-07-13T10:00:00.000Z";
  return {
    schemaVersion: "0.1",
    project: {
      id: "project-1",
      title: "Project",
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
      sizeBytes: 10,
      textLengthUtf16: 10,
      offsetUnit: "utf16_code_unit",
      blocks: [{ id: "block-1", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 10 } }],
    },
    generation: {
      plannerProvider: "fixture",
      promptVersion: "v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: now,
    },
    scenes: [
      {
        id: "scene-1",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-1"],
          startQuote: "start",
          endQuote: "end",
        },
        sourceRange: { start: 0, end: 10 },
        text: "scene text",
        summary: "scene",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "stock_asset",
          rationale: "visual",
          preferredMedia: ["photo"],
          visualKeywords: ["keyword"],
        },
        search: {
          queries: [
            { id: "query-1", language: "en", query: "query", purpose: "test", enabled: true },
          ],
          candidates: [],
        },
      },
    ],
  };
}

describe("searchSceneAssets provider resolution", () => {
  it("resolves omitted providers through an injectable resolver on every request", async () => {
    const project = makeProject();
    const repository: ProjectRepository = {
      exists: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
      load: vi.fn().mockResolvedValue(project),
      save: vi.fn(),
    };
    const providerNames = ["openverse", "pexels"];
    let requestIndex = 0;
    const resolveProviders = vi.fn(() =>
      Promise.resolve([providerNames[requestIndex++]!] as const),
    );
    const createdProviders: string[] = [];
    const createProvider = vi.fn((name: string): Promise<SearchProvider> => {
      createdProviders.push(name);
      return Promise.resolve({
        providerId: name,
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: true },
        search: vi.fn().mockResolvedValue({ candidates: [], warnings: [] }),
      });
    });
    const deps = {
      repository,
      resolveProviders,
      createProvider,
      createCache: () => ({
        read: vi.fn().mockResolvedValue({ hit: false }),
        write: vi.fn(),
        delete: vi.fn(),
      }),
      linkGenerator: { generateLinks: () => [] },
      now: () => new Date("2026-07-13T10:00:00.000Z"),
    };
    const input = {
      projectRoot: "/workspace/project",
      sceneId: "scene-1",
      maxAssetsPerQuery: 12,
      refresh: false,
    };

    await searchSceneAssets(input, deps);
    await searchSceneAssets(input, deps);

    expect(resolveProviders).toHaveBeenNthCalledWith(1, []);
    expect(resolveProviders).toHaveBeenNthCalledWith(2, []);
    expect(createdProviders).toEqual(["openverse", "pexels"]);
  });
});
