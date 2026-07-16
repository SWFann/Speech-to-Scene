/**
 * Unit tests for the updateSceneQueries use case.
 *
 * Coverage:
 *  1.  Successfully replaces queries
 *  2.  Candidates are preserved
 *  3.  lastSearchedAt is preserved
 *  4.  Duplicate query ID is rejected
 *  5.  Empty query string is rejected
 *  6.  Empty purpose is rejected
 *  7.  Invalid language is rejected
 *  8.  stock_asset with no enabled query is rejected
 *  9.  Non-stock_asset can accept no enabled query
 *  10. Non-existent sceneId throws SceneNotFoundError
 *  11. Unknown fields in query are rejected
 *  12. Saved object passes SpeechToSceneProjectSchema
 *
 * Additional:
 *  - repository.save called exactly once
 *  - Other scenes not modified
 *  - repository.load error propagates unchanged
 *  - Empty queries array is valid for non-stock_asset scene
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  updateSceneQueries,
  type UpdateSceneQueriesDeps,
} from "../../src/application/update-scene-queries.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { SceneNotFoundError, ProjectConflictError } from "../../src/shared/errors.js";
import type { AssetCandidate } from "../../src/domain/asset-schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-07-15T12:00:00.000Z");

/**
 * A valid asset candidate for test fixtures.
 */
function makeTestCandidate(): AssetCandidate {
  return {
    id: "cand-001",
    provider: {
      id: "fixture",
      name: "Fixture",
      homepageUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      policyRevision: "1.0",
      termsCheckedAt: "2025-01-01T00:00:00.000Z",
    },
    providerAssetId: "asset-1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/thumb.jpg",
    sourcePageUrl: "https://example.com/page",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Test Creator" },
    rights: {
      status: "platform_license",
      licenseUrl: "https://www.pexels.com/license/",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: "2026-07-14T10:00:00.000Z",
      evidence: {
        capturedAt: "2026-07-14T10:00:00.000Z",
        referenceUrl: "https://www.pexels.com/license/",
        fields: { source: "pexels_api" },
      },
    },
    retrievedAt: "2026-07-14T10:00:00.000Z",
    matchedQueryId: "q-001",
    rank: 1,
  };
}

/**
 * Two-scene project fixture:
 *  - scene-001: stock_asset with one enabled query and one candidate
 *  - scene-002: speaker_only, no queries
 */
function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-queries-test",
      title: "Queries Test",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z",
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
      sizeBytes: 50,
      textLengthUtf16: 25,
      offsetUnit: "utf16_code_unit",
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 25 } },
      ],
    },
    generation: {
      plannerProvider: "fixture",
      promptVersion: "v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: "2026-07-13T10:00:00.000Z",
    },
    scenes: [
      {
        id: "scene-001",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Hello world content.",
        summary: "First scene",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need stock photo",
          preferredMedia: ["photo"],
          visualKeywords: ["tech"],
        },
        search: {
          queries: [
            {
              id: "q-001",
              language: "en",
              query: "tech photo",
              purpose: "main visual",
              enabled: true,
            },
          ],
          candidates: [makeTestCandidate()],
          lastSearchedAt: "2026-07-14T10:00:00.000Z",
        },
        review: { kind: "pending" },
      },
      {
        id: "scene-002",
        order: 2,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Hello world content.",
        summary: "Second scene",
        narrativeRole: "conclusion",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Speaker only",
          preferredMedia: ["video"],
          visualKeywords: ["speaker"],
        },
        search: {
          queries: [],
          candidates: [],
        },
        review: { kind: "pending" },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

class TestRepository implements ProjectRepository {
  private project: SpeechToSceneProject | null = null;
  loadCount = 0;
  saveCount = 0;
  savedProject: SpeechToSceneProject | null = null;
  loadShouldThrow: Error | null = null;

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return this.project !== null;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    this.loadCount++;
    if (this.loadShouldThrow) throw this.loadShouldThrow;
    if (!this.project) throw new Error(`Project not found at ${projectRoot}`);
    return JSON.parse(JSON.stringify(this.project)) as SpeechToSceneProject;
  }
  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
    this.savedProject = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
    void projectRoot;
  }
  setProject(project: SpeechToSceneProject): void {
    this.project = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
  }
}

function makeDeps(repo: TestRepository): UpdateSceneQueriesDeps {
  return { repository: repo, now: () => FIXED_NOW };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateSceneQueries", () => {
  it("1. successfully replaces queries", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [
          {
            id: "q-001",
            language: "en",
            query: "new tech photo",
            purpose: "updated visual",
            enabled: true,
          },
          {
            id: "q-002",
            language: "zh",
            query: "科技照片",
            purpose: "secondary",
            enabled: false,
          },
        ],
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.search.queries).toHaveLength(2);
    expect(scene.search.queries[0]!.query).toBe("new tech photo");
    expect(scene.search.queries[1]!.language).toBe("zh");
    expect(repo.saveCount).toBe(1);
  });

  it("2. candidates are preserved", async () => {
    const repo = new TestRepository();
    const original = makeTestProject();
    repo.setProject(original);

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        // Same query ID so candidate's matchedQueryId stays valid
        queries: [
          {
            id: "q-001",
            language: "en",
            query: "updated query",
            purpose: "updated purpose",
            enabled: true,
          },
        ],
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.search.candidates).toHaveLength(1);
    expect(scene.search.candidates[0]!.id).toBe("cand-001");
    expect(scene.search.candidates[0]!.matchedQueryId).toBe("q-001");
  });

  it("3. lastSearchedAt is preserved", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [
          {
            id: "q-001",
            language: "en",
            query: "updated query",
            purpose: "updated purpose",
            enabled: true,
          },
        ],
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.search.lastSearchedAt).toBe("2026-07-14T10:00:00.000Z");
  });

  it("4. duplicate query ID is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [
            { id: "q-dup", language: "en", query: "first", purpose: "p1", enabled: true },
            { id: "q-dup", language: "zh", query: "second", purpose: "p2", enabled: false },
          ],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("5. empty query string is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "en", query: "", purpose: "p1", enabled: true }],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("6. empty purpose is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [
            { id: "q-001", language: "en", query: "valid query", purpose: "", enabled: true },
          ],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("7. invalid language is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "fr", query: "valid", purpose: "p1", enabled: true }],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("8. stock_asset with no enabled query is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: false }],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(ProjectConflictError);

    expect(repo.saveCount).toBe(0);
  });

  it("9. non-stock_asset can accept no enabled query", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    // scene-002 is speaker_only — can have disabled queries
    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-002",
        queries: [
          { id: "q-201", language: "zh", query: "备用查询", purpose: "备用", enabled: false },
        ],
      },
      makeDeps(repo),
    );

    const scene = result.scenes[1]!;
    expect(scene.search.queries).toHaveLength(1);
    expect(scene.search.queries[0]!.enabled).toBe(false);
    expect(repo.saveCount).toBe(1);
  });

  it("10. non-existent sceneId throws SceneNotFoundError", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "non-existent",
          queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(SceneNotFoundError);

    expect(repo.saveCount).toBe(0);
  });

  it("11. unknown fields in query are rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [
            {
              id: "q-001",
              language: "en",
              query: "valid",
              purpose: "p1",
              enabled: true,
              extraField: "bad",
            },
          ],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("12. saved object passes SpeechToSceneProjectSchema", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [
          {
            id: "q-001",
            language: "zh",
            query: "科技照片更新",
            purpose: "主视觉",
            enabled: true,
          },
        ],
      },
      makeDeps(repo),
    );

    expect(repo.savedProject).not.toBeNull();
    // Should not throw — the saved project is valid
    const parsed = SpeechToSceneProjectSchema.parse(repo.savedProject);
    expect(parsed.scenes[0]!.search.queries[0]!.query).toBe("科技照片更新");
  });

  // --- Additional tests ---

  it("repository.save is called exactly once", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
      },
      makeDeps(repo),
    );

    expect(repo.saveCount).toBe(1);
  });

  it("other scenes are not modified", async () => {
    const repo = new TestRepository();
    const original = makeTestProject();
    repo.setProject(original);

    await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [
          { id: "q-001", language: "zh", query: "新查询", purpose: "新目的", enabled: true },
        ],
      },
      makeDeps(repo),
    );

    const saved = repo.savedProject!;
    const otherScene = saved.scenes[1]!;
    const originalOther = original.scenes[1]!;

    expect(otherScene.id).toBe(originalOther.id);
    expect(otherScene.search.queries).toEqual(originalOther.search.queries);
    expect(otherScene.search.candidates).toEqual(originalOther.search.candidates);
    expect(otherScene.visualPlan).toEqual(originalOther.visualPlan);
    expect(otherScene.review).toEqual(originalOther.review);
  });

  it("repository.load error propagates unchanged", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());
    const loadError = new Error("Disk read failure");
    repo.loadShouldThrow = loadError;

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
        },
        makeDeps(repo),
      ),
    ).rejects.toBe(loadError);

    expect(repo.saveCount).toBe(0);
  });

  it("empty queries array is valid for non-stock_asset scene", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-002",
        queries: [],
      },
      makeDeps(repo),
    );

    expect(result.scenes[1]!.search.queries).toHaveLength(0);
    expect(repo.saveCount).toBe(1);
  });

  it("replacing queries removes old query IDs (full replacement, not append)", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-002",
        queries: [
          { id: "q-new-1", language: "zh", query: "查询一", purpose: "目的一", enabled: true },
          {
            id: "q-new-2",
            language: "en",
            query: "query two",
            purpose: "purpose two",
            enabled: false,
          },
        ],
      },
      makeDeps(repo),
    );

    const scene = result.scenes[1]!;
    expect(scene.search.queries).toHaveLength(2);
    expect(scene.search.queries[0]!.id).toBe("q-new-1");
    expect(scene.search.queries[1]!.id).toBe("q-new-2");
  });

  it("rejects unknown top-level input field", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
          extraField: "bad",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects empty sceneId", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "",
          queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects non-boolean enabled", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [
            { id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: "true" },
          ],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects query with leading whitespace", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [
            { id: "q-001", language: "en", query: "  padded", purpose: "p1", enabled: true },
          ],
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("updates project.updatedAt", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateSceneQueries(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        queries: [{ id: "q-001", language: "en", query: "valid", purpose: "p1", enabled: true }],
      },
      makeDeps(repo),
    );

    expect(result.project.updatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("ZodError is instance of z.ZodError for input validation failures", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    let caught: unknown = null;
    try {
      await updateSceneQueries(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          queries: [{ id: "q-001", language: "invalid", query: "q", purpose: "p", enabled: true }],
        },
        makeDeps(repo),
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    expect(z.ZodError[Symbol.hasInstance](caught)).toBe(true);
  });
});
