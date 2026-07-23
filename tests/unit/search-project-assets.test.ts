/**
 * Unit tests for the searchProjectAssets use case.
 *
 * Phase 1 material-discovery redesign:
 * - API changed from positional args to (input, deps) with a deps object.
 * - Input uses `providers` (array) instead of `provider` (singular).
 * - Any scene with enabled queries is searched (no stock_asset gating).
 * - Link candidates (kind: "link") are appended after asset candidates.
 *
 * These tests use a stub linkGenerator (returns empty array) to focus on
 * asset-candidate behavior. Link generation is tested in api-scene-search.
 */
import { describe, it, expect, vi } from "vitest";
import {
  searchProjectAssets,
  type SearchProvider,
  type SearchProjectAssetsInput,
  type SearchProjectAssetsDeps,
} from "../../src/application/search-project-assets.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import type { SearchCache } from "../../src/application/ports/search-cache.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { AssetCandidateLink } from "../../src/domain/asset-schema.js";
import type { AssetCandidate as PortAssetCandidate } from "../../src/application/ports/asset-provider.js";
import { ProjectNotPlannedError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMockCandidate(overrides: Partial<PortAssetCandidate> = {}): PortAssetCandidate {
  return {
    kind: "asset",
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
  } as unknown as SpeechToSceneProject;
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

/** Stub link generator that returns no link candidates. */
const stubLinkGenerator: SearchProjectAssetsDeps["linkGenerator"] = {
  generateLinks: (): AssetCandidateLink[] => [],
};

/** Builds deps from individual mocks. */
function makeDeps(
  repository: ProjectRepository,
  provider: SearchProvider,
  cache: SearchCache,
  nowFn: () => Date,
  linkGenerator?: SearchProjectAssetsDeps["linkGenerator"],
): SearchProjectAssetsDeps {
  return {
    repository,
    createProvider: vi.fn().mockResolvedValue(provider),
    createCache: vi.fn().mockReturnValue(cache),
    linkGenerator: linkGenerator ?? stubLinkGenerator,
    now: nowFn,
  };
}

function makeInput(overrides: Partial<SearchProjectAssetsInput> = {}): SearchProjectAssetsInput {
  return {
    projectRoot: "/tmp/test-project",
    providers: ["fixture"],
    maxAssetsPerQuery: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchProjectAssets", (): void => {
  describe("success scenarios", (): void => {
    it("searches all scenes with enabled queries and returns results", async (): Promise<void> => {
      const project = createMockProject(2);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const result = await searchProjectAssets(
        makeInput(),
        makeDeps(repository, provider, cache, nowFn),
      );

      expect(result.projectId).toBe("test-project");
      expect(result.status).toBe("searched");
      expect(result.sceneCount).toBe(2);
      expect(result.totalCandidates).toBeGreaterThan(0);
    });

    it("skips scenes with no enabled queries", async (): Promise<void> => {
      const project = createMockProject(2);
      // Scene 0 has no enabled queries → should be skipped
      project.scenes[0]!.search.queries = [];
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

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

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

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

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

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

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

      expect(project.scenes[0]!.search.lastSearchedAt).toBeTruthy();
    });

    it("does not set lastSearchedAt when no candidates", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider, searchMock } = createMockProvider();
      searchMock.mockResolvedValue({ candidates: [], warnings: [] });
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

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
                    kind: "asset",
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

      const result = await searchProjectAssets(
        makeInput(),
        makeDeps(repository, provider, cache, nowFn),
      );

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

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

      const candidates = project.scenes[0]!.search.candidates as Array<{
        kind: string;
        provider: { id: string };
        mediaType: string;
        providerAssetId: string;
      }>;
      // Only check asset-kind candidates for dedup (link candidates have no provider)
      const assetCandidates = candidates.filter((c) => c.kind === "asset");
      const keys = assetCandidates.map(
        (c) => `${c.provider.id}\t${c.mediaType}\t${c.providerAssetId}`,
      );
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("ranks by orientation, rights, preview, resolution, and provider rank", async () => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const cache = createMockCache();
      const allowedRights = createMockCandidate().rights;
      const unclearRights = {
        ...allowedRights,
        commercialUse: "unclear" as const,
        derivatives: "unclear" as const,
      };
      const candidates = [
        createMockCandidate({
          id: "wrong-orientation",
          providerAssetId: "wrong-orientation",
          orientation: "landscape",
          width: 4000,
          height: 2000,
          rank: 1,
        }),
        createMockCandidate({
          id: "unclear-rights",
          providerAssetId: "unclear-rights",
          orientation: "portrait",
          width: 1080,
          height: 1920,
          rights: unclearRights,
          rank: 1,
        }),
        createMockCandidate({
          id: "best-quality",
          providerAssetId: "best-quality",
          mediaType: "video",
          orientation: "portrait",
          width: 2160,
          height: 3840,
          previewUrl: "https://example.com/preview.mp4",
          durationSeconds: 12,
          rank: 2,
        }),
        createMockCandidate({
          id: "lower-resolution",
          providerAssetId: "lower-resolution",
          mediaType: "video",
          orientation: "portrait",
          width: 1080,
          height: 1920,
          previewUrl: "https://example.com/preview-low.mp4",
          durationSeconds: 12,
          rank: 1,
        }),
      ];
      const provider: SearchProvider = {
        providerId: "pexels",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: true, orientationFilter: true },
        search: vi.fn().mockResolvedValue({ candidates, warnings: [] }),
      };

      await searchProjectAssets(
        makeInput({ providers: ["pexels"], maxAssetsPerQuery: 20 }),
        makeDeps(repository, provider, cache, () => new Date()),
      );

      const ids = project.scenes[0]!.search.candidates.filter(
        (candidate) => candidate.kind === "asset",
      ).map((candidate) => candidate.id);
      expect(ids).toEqual(["best-quality", "lower-resolution", "wrong-orientation"]);
    });

    it("filters commercial rights that are disallowed or unclear", async () => {
      const project = createMockProject(1);
      project.project.assetUsePolicy = {
        intendedUse: "commercial_capable",
        willModify: false,
      };
      const allowedRights = createMockCandidate().rights;
      const candidates = [
        createMockCandidate({ id: "commercial-allowed", providerAssetId: "allowed" }),
        createMockCandidate({
          id: "commercial-disallowed",
          providerAssetId: "disallowed",
          rights: { ...allowedRights, commercialUse: "disallowed" },
        }),
        createMockCandidate({
          id: "commercial-unclear",
          providerAssetId: "unclear",
          rights: { ...allowedRights, commercialUse: "unclear" },
        }),
      ];
      const provider: SearchProvider = {
        providerId: "openverse",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: false },
        search: vi.fn().mockResolvedValue({ candidates, warnings: [] }),
      };

      await searchProjectAssets(
        makeInput({ providers: ["openverse"] }),
        makeDeps(createMockRepository(project), provider, createMockCache(), () => new Date()),
      );

      expect(project.scenes[0]!.search.candidates.map((candidate) => candidate.id)).toEqual([
        "commercial-allowed",
      ]);
    });

    it("filters disallowed and unclear derivatives when the project will modify assets", async () => {
      const project = createMockProject(1);
      project.project.assetUsePolicy = {
        intendedUse: "noncommercial",
        willModify: true,
      };
      const allowedRights = createMockCandidate().rights;
      const candidates = [
        createMockCandidate({ id: "derivatives-allowed", providerAssetId: "allowed" }),
        createMockCandidate({
          id: "derivatives-disallowed",
          providerAssetId: "disallowed",
          rights: { ...allowedRights, derivatives: "disallowed" },
        }),
        createMockCandidate({
          id: "derivatives-unclear",
          providerAssetId: "unclear",
          rights: { ...allowedRights, derivatives: "unclear" },
        }),
      ];
      const provider: SearchProvider = {
        providerId: "openverse",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: false },
        search: vi.fn().mockResolvedValue({ candidates, warnings: [] }),
      };

      await searchProjectAssets(
        makeInput({ providers: ["openverse"] }),
        makeDeps(createMockRepository(project), provider, createMockCache(), () => new Date()),
      );

      expect(project.scenes[0]!.search.candidates.map((candidate) => candidate.id)).toEqual([
        "derivatives-allowed",
      ]);
    });

    it("keeps editorial-only assets for an editorial project", async () => {
      const project = createMockProject(1);
      project.project.assetUsePolicy = {
        intendedUse: "editorial",
        willModify: false,
      };
      const editorial = createMockCandidate({
        id: "editorial-only",
        providerAssetId: "editorial-only",
        rights: {
          ...createMockCandidate().rights,
          status: "editorial_only",
          commercialUse: "disallowed",
          derivatives: "unclear",
        },
      });
      const provider: SearchProvider = {
        providerId: "openverse",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: false },
        search: vi.fn().mockResolvedValue({ candidates: [editorial], warnings: [] }),
      };

      await searchProjectAssets(
        makeInput({ providers: ["openverse"] }),
        makeDeps(createMockRepository(project), provider, createMockCache(), () => new Date()),
      );

      expect(project.scenes[0]!.search.candidates.map((candidate) => candidate.id)).toEqual([
        "editorial-only",
      ]);
    });

    it("keeps share-alike assets after assets with unrestricted derivatives", async () => {
      const project = createMockProject(1);
      project.project.assetUsePolicy = {
        intendedUse: "commercial_capable",
        willModify: true,
      };
      const allowedRights = createMockCandidate().rights;
      const candidates = [
        createMockCandidate({
          id: "share-alike",
          providerAssetId: "share-alike",
          orientation: "portrait",
          width: 1080,
          height: 1920,
          rights: { ...allowedRights, derivatives: "share_alike" },
          rank: 1,
        }),
        createMockCandidate({
          id: "derivatives-allowed",
          providerAssetId: "derivatives-allowed",
          orientation: "portrait",
          width: 1080,
          height: 1920,
          rank: 2,
        }),
      ];
      const provider: SearchProvider = {
        providerId: "openverse",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: false },
        search: vi.fn().mockResolvedValue({ candidates, warnings: [] }),
      };

      await searchProjectAssets(
        makeInput({ providers: ["openverse"] }),
        makeDeps(createMockRepository(project), provider, createMockCache(), () => new Date()),
      );

      expect(project.scenes[0]!.search.candidates.map((candidate) => candidate.id)).toEqual([
        "derivatives-allowed",
        "share-alike",
      ]);
    });

    it("caps assets at 12 and keeps multiple providers in the first results", async () => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const cache = createMockCache();
      const providerFor = (providerId: string): SearchProvider => ({
        providerId,
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: true },
        search: vi.fn().mockResolvedValue({
          candidates: Array.from({ length: 10 }, (_, index) =>
            createMockCandidate({
              id: `${providerId}-${index + 1}`,
              providerAssetId: `${index + 1}`,
              provider: {
                id: providerId,
                name: providerId,
                homepageUrl: `https://${providerId}.example.com`,
                termsUrl: `https://${providerId}.example.com/terms`,
                policyRevision: "1",
                termsCheckedAt: "2025-01-01T00:00:00.000Z",
              },
              orientation: "portrait",
              width: 1080,
              height: 1920,
              rank: index + 1,
            }),
          ),
          warnings: [],
        }),
      });
      const providers = new Map([
        ["pexels", providerFor("pexels")],
        ["openverse", providerFor("openverse")],
      ]);
      const deps: SearchProjectAssetsDeps = {
        repository,
        createProvider: (name) => Promise.resolve(providers.get(name)!),
        createCache: () => cache,
        linkGenerator: stubLinkGenerator,
        now: () => new Date(),
      };

      await searchProjectAssets(
        makeInput({ providers: ["pexels", "openverse"], maxAssetsPerQuery: 20 }),
        deps,
      );

      const assets = project.scenes[0]!.search.candidates.filter(
        (candidate) => candidate.kind === "asset",
      );
      expect(assets).toHaveLength(12);
      expect(new Set(assets.slice(0, 4).map((candidate) => candidate.provider.id))).toEqual(
        new Set(["pexels", "openverse"]),
      );
    });

    it("continues with other providers when one provider reports an operational failure", async () => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const cache = createMockCache();
      const failing: SearchProvider = {
        providerId: "pexels",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: true, orientationFilter: true },
        search: vi
          .fn()
          .mockRejectedValue(new ProjectNotPlannedError("Pexels temporarily unavailable")),
      };
      const working: SearchProvider = {
        providerId: "openverse",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: true },
        search: vi.fn().mockResolvedValue({
          candidates: [
            createMockCandidate({
              id: "openverse-result",
              providerAssetId: "openverse-result",
              provider: {
                id: "openverse",
                name: "Openverse",
                homepageUrl: "https://openverse.org",
                termsUrl: "https://openverse.org/terms",
                policyRevision: "1",
                termsCheckedAt: "2025-01-01T00:00:00.000Z",
              },
            }),
          ],
          warnings: [],
        }),
      };
      const providers = new Map([
        ["pexels", failing],
        ["openverse", working],
      ]);

      const result = await searchProjectAssets(makeInput({ providers: [...providers.keys()] }), {
        repository,
        createProvider: (name) => Promise.resolve(providers.get(name)!),
        createCache: () => cache,
        linkGenerator: stubLinkGenerator,
        now: () => new Date(),
      });

      expect(project.scenes[0]!.search.candidates[0]?.id).toBe("openverse-result");
      expect(result.warnings).toContainEqual({
        code: "provider_search_failed",
        message: "pexels 素材搜索暂时不可用",
        queryId: "q-1-1",
      });
    });

    it("returns links and warnings when all real providers fail without creating Fixture", async () => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const cache = createMockCache();
      const createProvider = vi.fn((name: string): Promise<SearchProvider> =>
        Promise.resolve({
          providerId: name,
          providerPolicyRevision: "1",
          capabilities: { photos: true, videos: false, orientationFilter: true },
          search: vi.fn().mockRejectedValue(new ProjectNotPlannedError(`${name} unavailable`)),
        }),
      );
      const linkGenerator: SearchProjectAssetsDeps["linkGenerator"] = {
        generateLinks: ({ matchedQueryId, retrievedAt }) => [
          {
            kind: "link",
            id: "manual-search",
            platform: "bilibili",
            searchUrl: "https://search.bilibili.com/all?keyword=test",
            keyword: "test",
            retrievedAt,
            matchedQueryId,
            rank: 1,
            category: "video_platform",
          },
        ],
      };

      const result = await searchProjectAssets(makeInput({ providers: ["pexels", "openverse"] }), {
        repository,
        createProvider,
        createCache: () => cache,
        linkGenerator,
        now: () => new Date(),
      });

      expect(createProvider.mock.calls.map(([name]) => name)).toEqual(["pexels", "openverse"]);
      expect(project.scenes[0]!.search.candidates.map((candidate) => candidate.kind)).toEqual([
        "link",
      ]);
      expect(result.warnings).toHaveLength(2);
    });

    it("starts provider requests for a scene concurrently", async () => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const cache = createMockCache();
      let releaseFirst: (() => void) | undefined;
      const firstSearch = vi.fn(
        () =>
          new Promise<{ candidates: []; warnings: [] }>((resolve) => {
            releaseFirst = () => resolve({ candidates: [], warnings: [] });
          }),
      );
      const secondSearch = vi.fn().mockResolvedValue({ candidates: [], warnings: [] });
      const providers = new Map<string, SearchProvider>([
        [
          "pexels",
          {
            providerId: "pexels",
            providerPolicyRevision: "1",
            capabilities: { photos: true, videos: false, orientationFilter: true },
            search: firstSearch,
          },
        ],
        [
          "openverse",
          {
            providerId: "openverse",
            providerPolicyRevision: "1",
            capabilities: { photos: true, videos: false, orientationFilter: true },
            search: secondSearch,
          },
        ],
      ]);

      const pending = searchProjectAssets(makeInput({ providers: [...providers.keys()] }), {
        repository,
        createProvider: (name) => Promise.resolve(providers.get(name)!),
        createCache: () => cache,
        linkGenerator: stubLinkGenerator,
        now: () => new Date(),
      });

      await vi.waitFor(() => expect(secondSearch).toHaveBeenCalledTimes(1));
      releaseFirst?.();
      await pending;
    });

    it("does not hide programming errors from providers", async () => {
      const project = createMockProject(1);
      const provider: SearchProvider = {
        providerId: "pexels",
        providerPolicyRevision: "1",
        capabilities: { photos: true, videos: false, orientationFilter: true },
        search: vi.fn().mockRejectedValue(new TypeError("broken provider mapping")),
      };

      await expect(
        searchProjectAssets(
          makeInput({ providers: ["pexels"] }),
          makeDeps(createMockRepository(project), provider, createMockCache(), () => new Date()),
        ),
      ).rejects.toThrow("broken provider mapping");
    });

    it("throws error when project has no generation", async (): Promise<void> => {
      const project = createMockProject(1);
      project.generation = null;
      project.scenes = [];
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      await expect(
        searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn)),
      ).rejects.toThrow();
    });
  });

  describe("category interleaving", (): void => {
    it("tags asset candidates with category=stock_library", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      await searchProjectAssets(makeInput(), makeDeps(repository, provider, cache, nowFn));

      const candidates = project.scenes[0]!.search.candidates as Array<{
        kind: string;
        category?: string;
      }>;
      const assetCandidates = candidates.filter((c) => c.kind === "asset");
      for (const c of assetCandidates) {
        expect(c.category).toBe("stock_library");
      }
    });

    it("keeps ranked assets before link candidates", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      // Use real link generator so we get link candidates
      const { DefaultLinkSuggestionGenerator } =
        await import("../../src/infrastructure/link-suggestion-generator.js");
      const realLinkGen = new DefaultLinkSuggestionGenerator();
      const deps = makeDeps(repository, provider, cache, nowFn, realLinkGen);

      const result = await searchProjectAssets(makeInput(), deps);

      const candidates = project.scenes[0]!.search.candidates as Array<{
        kind: string;
        category?: string;
      }>;

      // Should have both asset and link candidates
      const assetCount = candidates.filter((c) => c.kind === "asset").length;
      const linkCount = candidates.filter((c) => c.kind === "link").length;
      expect(assetCount).toBeGreaterThan(0);
      expect(linkCount).toBeGreaterThan(0);
      expect(result.totalCandidates).toBe(assetCount);

      const lastAssetIndex = Math.max(...candidates.map((c, i) => (c.kind === "asset" ? i : -1)));
      const firstLinkIndex = candidates.findIndex((c) => c.kind === "link");
      expect(firstLinkIndex).toBeGreaterThan(lastAssetIndex);
    });

    it("assigns sequential ranks after interleaving", async (): Promise<void> => {
      const project = createMockProject(1);
      const repository = createMockRepository(project);
      const { provider } = createMockProvider();
      const cache = createMockCache();
      const nowFn = (): Date => new Date();

      const { DefaultLinkSuggestionGenerator } =
        await import("../../src/infrastructure/link-suggestion-generator.js");
      const realLinkGen = new DefaultLinkSuggestionGenerator();
      const deps = makeDeps(repository, provider, cache, nowFn, realLinkGen);

      await searchProjectAssets(makeInput(), deps);

      const candidates = project.scenes[0]!.search.candidates as Array<{ rank: number }>;
      const ranks = candidates.map((c) => c.rank);
      for (let i = 0; i < ranks.length; i++) {
        expect(ranks[i]).toBe(i + 1);
      }
    });
  });
});
