import { describe, it, expect, vi } from "vitest";
import {
  searchProjectAssets,
  type SearchProvider,
  type SearchProjectAssetsInput,
} from "../../src/application/search-project-assets.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import type { SearchCache } from "../../src/application/ports/search-cache.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMockCandidate(
  overrides: Partial<{
    id: string;
    providerAssetId: string;
    mediaType: string;
    thumbnailUrl: string;
    sourcePageUrl: string;
    width: number;
    height: number;
    orientation: "portrait" | "landscape" | "square";
    creator: { name: string; profileUrl: string };
    rights: object;
    retrievedAt: string;
    matchedQueryId: string;
    rank: number;
    previewUrl?: string;
    durationSeconds?: number;
  }> = {},
): object {
  return {
    id: "fixture-photo-1-1",
    provider: {
      id: "fixture",
      name: "Fixture",
      homepageUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      policyRevision: "1.0",
      termsCheckedAt: "2025-01-01T00:00:00.000Z",
    },
    providerAssetId: "1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/thumb.jpg",
    sourcePageUrl: "https://example.com/page",
    width: 1920,
    height: 1080,
    orientation: "landscape",
    creator: { name: "Test", profileUrl: "https://example.com/photo" },
    rights: {
      status: "platform_license",
      licenseName: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      restrictions: [],
      verifiedAt: new Date().toISOString(),
      evidence: {
        capturedAt: new Date().toISOString(),
        referenceUrl: "https://www.pexels.com/license/",
        fields: { policyRevision: "1.0", source: "pexels_api", photoId: 1 },
      },
    },
    retrievedAt: new Date().toISOString(),
    matchedQueryId: "q-1-1",
    rank: 1,
    ...overrides,
  };
}

function createMockProvider(): { provider: SearchProvider; searchMock: ReturnType<typeof vi.fn> } {
  const searchFn = vi
    .fn()
    .mockImplementation(
      (input: { readonly mediaTypes: readonly string[]; readonly queryId: string }) => {
        const candidates: object[] = [];
        if (input.mediaTypes.includes("photo")) {
          candidates.push(
            createMockCandidate({
              id: `fixture-photo-${input.queryId}-1`,
              matchedQueryId: input.queryId,
              rank: 1,
            }),
          );
        }
        if (input.mediaTypes.includes("video")) {
          candidates.push(
            createMockCandidate({
              id: `fixture-video-${input.queryId}-1`,
              providerAssetId: "2",
              mediaType: "video",
              thumbnailUrl: `https://example.com/fixture/${input.queryId}/video/1/thumb.jpg`,
              previewUrl: `https://example.com/fixture/${input.queryId}/video/1/preview.mp4`,
              durationSeconds: 30,
              matchedQueryId: input.queryId,
              rank: 1,
            }),
          );
        }
        return { candidates, warnings: [] };
      },
    );

  return {
    provider: {
      providerId: "fixture",
      providerPolicyRevision: "fixture-policy-0.1",
      capabilities: { photos: true, videos: true, orientationFilter: true },
      search: searchFn,
    },
    searchMock: searchFn,
  };
}

function createMockProject(sceneCount: number = 2): SpeechToSceneProject {
  const scenes = [];
  for (let i = 1; i <= sceneCount; i++) {
    scenes.push({
      id: `scene-${i}`,
      order: i,
      sourceAnchor: {
        strategy: "source-blocks-v1" as const,
        sourceBlockIds: [`block-${i}`],
        startQuote: `quote ${i}`,
        endQuote: `quote ${i}`,
      },
      sourceRange: { start: 0, end: 10 },
      text: `Scene text ${i}`,
      summary: `Scene summary ${i}`,
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
            id: `q-${i}-1`,
            language: "zh" as const,
            query: `test query ${i}`,
            purpose: "Search for test",
            enabled: true,
          },
        ],
        candidates: [],
        lastSearchedAt: undefined,
      },
      review: { kind: "pending" as const },
    });
  }

  return {
    schemaVersion: "0.1",
    project: {
      id: "test-project",
      title: "Test Project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      language: "zh-CN" as const,
      aspectRatio: "9:16" as const,
      style: "knowledge" as const,
      assetUsePolicy: { intendedUse: "commercial_capable" as const, willModify: true },
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
    scenes: scenes,
  };
}

function createMockRepository(project: SpeechToSceneProject): ProjectRepository {
  return {
    exists: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue(project),
    save: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(project),
  };
}

function createMockCache(): SearchCache {
  return {
    read: vi.fn().mockResolvedValue({ hit: false }),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchProjectAssets", (): void => {
  describe("success scenarios", (): void => {
    it("searches all stock_asset scenes and returns results", async (): Promise<void> => {
      const project = createMockProject(2);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      const result = await searchProjectAssets(input, repository, provider, cache, nowFn);

      expect(result.projectId).toBe("test-project");
      expect(result.status).toBe("searched");
      expect(result.sceneCount).toBe(2);
      expect(result.totalCandidates).toBeGreaterThan(0);
    });

    it("skips non-stock_asset scenes", async (): Promise<void> => {
      const project = createMockProject(2);
      project.scenes[0]!.visualPlan.decision = "speaker_only";
      project.scenes[0]!.search.queries = [];
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      expect(project.scenes[0]!.search.candidates).toEqual([]);
      expect(project.scenes[1]!.search.candidates.length).toBeGreaterThan(0);
    });

    it("skips disabled queries", async (): Promise<void> => {
      const project = createMockProject(1);
      project.scenes[0]!.search.queries = [
        { id: "q-1-1", language: "zh", query: "enabled query", purpose: "test", enabled: true },
        { id: "q-1-2", language: "en", query: "disabled query", purpose: "test", enabled: false },
      ];
      const repository = createMockRepository(project);
      const { provider, searchMock } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      const calls = searchMock.mock.calls as Array<
        [
          {
            readonly queryId: string;
            readonly mediaTypes: readonly string[];
          },
        ]
      >;
      expect(calls.length).toBe(1);
      expect(calls[0]![0].queryId).toBe("q-1-1");
    });

    it("preserves query language", async (): Promise<void> => {
      const project = createMockProject(1);
      project.scenes[0]!.search.queries = [
        { id: "q-1-1", language: "en", query: "english query", purpose: "test", enabled: true },
      ];
      const repository = createMockRepository(project);
      const { provider, searchMock } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      const calls = searchMock.mock.calls as Array<
        [
          {
            readonly queryId: string;
            readonly query: string;
            readonly language: string;
            readonly mediaTypes: readonly string[];
          },
        ]
      >;
      expect(calls.length).toBe(1);
      const firstCall = calls[0]!;
      expect(firstCall[0].language).toBe("en");
    });

    it("sets lastSearchedAt when candidates exist", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      expect(project.scenes[0]!.search.lastSearchedAt).toBeTruthy();
    });

    it("does not set lastSearchedAt when no candidates", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider, searchMock } = createMockProvider();
      searchMock.mockResolvedValue({ candidates: [], warnings: [] });
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      expect(project.scenes[0]!.search.lastSearchedAt).toBeUndefined();
    });

    it("tracks cache hits and misses", async (): Promise<void> => {
      const project = createMockProject(2);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();

      let callCount = 0;
      const cache: SearchCache = {
        read: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount % 2 === 1) {
            return Promise.resolve({
              hit: true,
              entry: {
                schemaVersion: "0.1",
                providerId: "fixture",
                providerPolicyRevision: "fixture-policy-0.1",
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 86400000).toISOString(),
                request: {
                  queryId: "q-1-1",
                  query: "test query 1",
                  language: "zh",
                  mediaTypes: ["photo", "video"],
                  orientation: "portrait",
                  perPage: 10,
                  page: 1,
                  sceneId: "scene-1",
                },
                response: [
                  {
                    id: "fixture-photo-q-1-1-1",
                    rank: 1,
                    provider: {
                      id: "fixture",
                      name: "Fixture",
                      homepageUrl: "https://example.com",
                      termsUrl: "https://example.com/terms",
                      policyRevision: "1.0",
                      termsCheckedAt: "2025-01-01T00:00:00.000Z",
                    },
                    providerAssetId: "1",
                    mediaType: "photo",
                    thumbnailUrl: "https://example.com/thumb.jpg",
                    sourcePageUrl: "https://example.com/page",
                    width: 1920,
                    height: 1080,
                    creator: { name: "Test", profileUrl: "https://example.com/photo" },
                    rights: {
                      status: "platform_license",
                      licenseName: "Pexels License",
                      licenseUrl: "https://www.pexels.com/license/",
                      attributionRequired: false,
                      commercialUse: "allowed",
                      derivatives: "allowed",
                      restrictions: [],
                      verifiedAt: new Date().toISOString(),
                      evidence: {
                        capturedAt: new Date().toISOString(),
                        referenceUrl: "https://www.pexels.com/license/",
                        fields: { policyRevision: "1.0", source: "pexels_api", photoId: 1 },
                      },
                    },
                    retrievedAt: new Date().toISOString(),
                    matchedQueryId: "q-1-1",
                  },
                ],
                warnings: [],
              },
            });
          }
          return Promise.resolve({ hit: false });
        }),
        write: vi.fn(),
        delete: vi.fn(),
      };

      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      const result = await searchProjectAssets(input, repository, provider, cache, nowFn);

      expect(result.cacheHits).toBeGreaterThanOrEqual(1);
      expect(result.cacheMisses).toBeGreaterThanOrEqual(1);
    });

    it("deduplicates candidates by provider+mediaType+assetId", async (): Promise<void> => {
      const project = createMockProject(1);
      project.scenes[0]!.search.queries = [
        { id: "q-1-1", language: "zh", query: "same", purpose: "test", enabled: true },
        { id: "q-1-2", language: "zh", query: "same", purpose: "test", enabled: true },
      ];
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await searchProjectAssets(input, repository, provider, cache, nowFn);

      const candidates = project.scenes[0]!.search.candidates as Array<{
        provider: { id: string };
        mediaType: string;
        providerAssetId: string;
      }>;
      const keys = candidates.map((c) => `${c.provider.id}\t${c.mediaType}\t${c.providerAssetId}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("throws error when project has no generation", async (): Promise<void> => {
      const project = createMockProject(1);
      project.generation = null;
      project.scenes = [];
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const input: SearchProjectAssetsInput = {
        projectRoot: "/tmp/test-project",
        provider: "fixture",
        maxAssetsPerQuery: 10,
      };

      await expect(
        searchProjectAssets(input, repository, provider, cache, nowFn),
      ).rejects.toThrow();
    });
  });
});
