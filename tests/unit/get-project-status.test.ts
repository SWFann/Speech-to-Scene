import { describe, expect, it, beforeEach } from "vitest";

import { getProjectStatusUseCase } from "../../src/application/get-project-status.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";

// ---------------------------------------------------------------------------
// In-memory repository (loads parsed projects)
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, { project: SpeechToSceneProject }>();

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }

  async create(): Promise<void> {
    await Promise.resolve();
  }

  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) {
      throw new Error(`Project not found at ${projectRoot}`);
    }
    return entry.project;
  }

  async save(): Promise<void> {
    await Promise.resolve();
  }

  setProject(projectRoot: string, project: SpeechToSceneProject): void {
    this.projects.set(projectRoot, { project });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}): SpeechToSceneProject {
  const generation = overrides.generation ?? null;
  const blocks =
    generation === null
      ? []
      : [
          {
            id: "block-00000001",
            order: 1,
            kind: "paragraph",
            sourceRange: { start: 0, end: 250 },
          },
        ];
  const scenes =
    generation === null ? [] : ((overrides.scenes as SpeechToSceneProject["scenes"]) ?? []);

  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "project-11111111-1111-1111-1111-111111111111",
      title: "Test Project",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
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
      sizeBytes: 500,
      textLengthUtf16: 250,
      offsetUnit: "utf16_code_unit",
      blocks,
    },
    generation,
    scenes,
    ...overrides,
  });
}

/** A minimal candidate object for candidate_selected review tests. */
function makeCandidate(): Record<string, unknown> {
  return {
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

function makeLocalAsset(): Record<string, unknown> {
  return {
    relativePath: "assets/scene-00000001/test.png",
    originalFileName: "test.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    sha256: "b".repeat(64),
    importedAt: "2026-07-13T11:00:00.000Z",
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
    sourceRange: { start: 0, end: 25 },
    text: "Hello world content here.",
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

function makeGeneration(): Record<string, unknown> {
  return {
    plannerProvider: "test-provider",
    promptVersion: "v1",
    plannerOutputSchemaVersion: "0.1",
    sourceBlockVersion: "0.1",
    generatedAt: "2026-07-13T10:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// getProjectStatusUseCase
// ---------------------------------------------------------------------------

describe("getProjectStatusUseCase", () => {
  let repository: InMemoryRepository;

  beforeEach(() => {
    repository = new InMemoryRepository();
  });

  // --- Project with no scenes ---

  it("returns status 'created' when there are no scenes", async () => {
    const project = makeProject({ scenes: [] });
    repository.setProject("/tmp/test-project", project);

    const view = await getProjectStatusUseCase("/tmp/test-project", repository);

    expect(view.status).toBe("created");
    expect(view.scenes.total).toBe(0);
    expect(view.scenes.byStatus).toEqual({});
  });

  // --- Project with scenes ---

  it("returns correct scene count and byStatus breakdown", async () => {
    const project = makeProject({
      generation: makeGeneration(),
      scenes: [
        makeBaseScene({ id: "scene-00000001", order: 1, review: { kind: "pending" } }),
        makeBaseScene({
          id: "scene-00000002",
          order: 2,
          review: { kind: "skipped", decidedAt: "2026-07-13T10:00:00.000Z" },
        }),
        makeBaseScene({ id: "scene-00000003", order: 3, review: { kind: "pending" } }),
      ],
    });
    repository.setProject("/tmp/test-project", project);

    const view = await getProjectStatusUseCase("/tmp/test-project", repository);

    expect(view.scenes.total).toBe(3);
    expect(view.scenes.byStatus).toEqual({ pending: 2, skipped: 1 });
  });

  // --- Source fields ---

  it("returns source metadata", async () => {
    const project = makeProject({ scenes: [] });
    repository.setProject("/tmp/test-project", project);

    const view = await getProjectStatusUseCase("/tmp/test-project", repository);

    expect(view.source.path).toBe("script.md");
    expect(view.source.textLengthUtf16).toBe(250);
  });

  // --- Project fields ---

  it("returns project metadata", async () => {
    const project = makeProject({ scenes: [] });
    repository.setProject("/tmp/test-project", project);

    const view = await getProjectStatusUseCase("/tmp/test-project", repository);

    expect(view.project.id).toBe("project-11111111-1111-1111-1111-111111111111");
    expect(view.project.title).toBe("Test Project");
    expect(view.project.language).toBe("zh-CN");
    expect(view.project.aspectRatio).toBe("9:16");
    expect(view.project.style).toBe("knowledge");
  });

  // --- updatedAt ---

  it("returns updatedAt from project", async () => {
    const project = makeProject({ scenes: [] });
    repository.setProject("/tmp/test-project", project);

    const view = await getProjectStatusUseCase("/tmp/test-project", repository);

    expect(view.updatedAt).toBe("2026-07-13T12:00:00.000Z");
  });

  // --- Error handling ---

  it("throws when project does not exist", async () => {
    await expect(getProjectStatusUseCase("/nonexistent", repository)).rejects.toThrow();
  });

  // --- Review statistics ---

  describe("review statistics", () => {
    it("returns zero counts for 0 scenes", async () => {
      const project = makeProject({ scenes: [] });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review).toEqual({
        totalScenes: 0,
        pending: 0,
        skipped: 0,
        candidateSelected: 0,
        localAssetAttached: 0,
        withLocalAsset: 0,
        completionRatio: 0,
      });
    });

    it("counts pending scenes", async () => {
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          makeBaseScene({ id: "scene-00000001", order: 1, review: { kind: "pending" } }),
          makeBaseScene({ id: "scene-00000002", order: 2, review: { kind: "pending" } }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.totalScenes).toBe(2);
      expect(view.review.pending).toBe(2);
      expect(view.review.completionRatio).toBe(0);
    });

    it("counts skipped scenes", async () => {
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          makeBaseScene({ id: "scene-00000001", order: 1, review: { kind: "pending" } }),
          makeBaseScene({
            id: "scene-00000002",
            order: 2,
            review: { kind: "skipped", decidedAt: "2026-07-13T10:00:00.000Z" },
          }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.skipped).toBe(1);
      expect(view.review.pending).toBe(1);
      expect(view.review.completionRatio).toBe(0.5);
    });

    it("counts candidate_selected without localAsset", async () => {
      const candidate = makeCandidate();
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          makeBaseScene({
            id: "scene-00000001",
            order: 1,
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
              lastSearchedAt: "2026-07-13T10:00:00.000Z",
            },
            review: {
              kind: "candidate_selected",
              selection: {
                selectedAt: "2026-07-13T11:00:00.000Z",
                candidate,
              },
            },
          }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.candidateSelected).toBe(1);
      expect(view.review.localAssetAttached).toBe(0);
      expect(view.review.withLocalAsset).toBe(0);
      expect(view.review.pending).toBe(0);
      expect(view.review.completionRatio).toBe(1);
    });

    it("counts candidate_selected with localAsset", async () => {
      const candidate = makeCandidate();
      const localAsset = makeLocalAsset();
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          makeBaseScene({
            id: "scene-00000001",
            order: 1,
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
              lastSearchedAt: "2026-07-13T10:00:00.000Z",
            },
            review: {
              kind: "candidate_selected",
              selection: {
                selectedAt: "2026-07-13T11:00:00.000Z",
                candidate,
              },
              localAsset,
            },
          }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.candidateSelected).toBe(1);
      expect(view.review.localAssetAttached).toBe(0);
      expect(view.review.withLocalAsset).toBe(1);
      expect(view.review.completionRatio).toBe(1);
    });

    it("counts local_asset_attached scenes", async () => {
      const localAsset = makeLocalAsset();
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          makeBaseScene({
            id: "scene-00000001",
            order: 1,
            review: {
              kind: "local_asset_attached",
              localAsset,
            },
          }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.localAssetAttached).toBe(1);
      expect(view.review.candidateSelected).toBe(0);
      expect(view.review.withLocalAsset).toBe(1);
      expect(view.review.completionRatio).toBe(1);
    });

    it("computes completionRatio for mixed scenes", async () => {
      const candidate = makeCandidate();
      const localAsset = makeLocalAsset();
      const project = makeProject({
        generation: makeGeneration(),
        scenes: [
          // pending
          makeBaseScene({ id: "scene-00000001", order: 1, review: { kind: "pending" } }),
          // skipped
          makeBaseScene({
            id: "scene-00000002",
            order: 2,
            review: { kind: "skipped", decidedAt: "2026-07-13T10:00:00.000Z" },
          }),
          // candidate_selected without localAsset
          makeBaseScene({
            id: "scene-00000003",
            order: 3,
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
              lastSearchedAt: "2026-07-13T10:00:00.000Z",
            },
            review: {
              kind: "candidate_selected",
              selection: {
                selectedAt: "2026-07-13T11:00:00.000Z",
                candidate,
              },
            },
          }),
          // candidate_selected with localAsset
          makeBaseScene({
            id: "scene-00000004",
            order: 4,
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
              lastSearchedAt: "2026-07-13T10:00:00.000Z",
            },
            review: {
              kind: "candidate_selected",
              selection: {
                selectedAt: "2026-07-13T11:00:00.000Z",
                candidate,
              },
              localAsset,
            },
          }),
          // local_asset_attached
          makeBaseScene({
            id: "scene-00000005",
            order: 5,
            review: {
              kind: "local_asset_attached",
              localAsset,
            },
          }),
        ],
      });
      repository.setProject("/tmp/test-project", project);

      const view = await getProjectStatusUseCase("/tmp/test-project", repository);

      expect(view.review.totalScenes).toBe(5);
      expect(view.review.pending).toBe(1);
      expect(view.review.skipped).toBe(1);
      expect(view.review.candidateSelected).toBe(2);
      expect(view.review.localAssetAttached).toBe(1);
      expect(view.review.withLocalAsset).toBe(2); // 1 candidate_selected+localAsset + 1 local_asset_attached
      expect(view.review.completionRatio).toBe(4 / 5); // (5 - 1) / 5
    });
  });
});
