/**
 * Application-level tests for the skipScene use case.
 *
 * Tests verify:
 *  1. Skip scene success
 *  2. Skip scene preserves candidates
 *  3. Skip scene writes decidedAt
 *  4. Skip scene writes note when provided
 *  5. Skip scene without note works
 *  6. Scene not found → SceneNotFoundError
 *  7. project.updatedAt updated
 *  8. repository.save called exactly once
 *  9. Unknown input fields rejected by Zod
 * 10. Skip overwrites previous review decision
 */

import { describe, expect, it } from "vitest";
import { skipScene } from "../../src/application/skip-scene.js";
import type { SkipSceneDeps } from "../../src/application/skip-scene.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { SceneNotFoundError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  saveCount = 0;

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return true;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) throw new Error(`Project not found at ${projectRoot}`);
    return JSON.parse(JSON.stringify(entry)) as SpeechToSceneProject;
  }
  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
    this.projects.set(projectRoot, JSON.parse(JSON.stringify(project)) as SpeechToSceneProject);
    void projectRoot;
  }
  setProject(root: string, project: SpeechToSceneProject): void {
    this.projects.set(root, JSON.parse(JSON.stringify(project)) as SpeechToSceneProject);
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-16T10:00:00.000Z";
const FIXED_DATE = new Date(FIXED_NOW);

function makeSafeCandidate(): unknown {
  return {
    id: "cand-001",
    provider: {
      id: "fixture",
      name: "Fixture Asset Provider",
      homepageUrl: "https://example.com/fixture",
      termsUrl: "https://example.com/fixture/terms",
      policyRevision: "fixture-policy-2026-07-14",
      termsCheckedAt: FIXED_NOW,
    },
    providerAssetId: "fixture-asset-1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/fixture/cand-001/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-001",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Fixture Creator", profileUrl: "https://example.com/fixture/creator/1" },
    rights: {
      status: "platform_license",
      licenseName: "Fixture License",
      licenseUrl: "https://example.com/fixture/terms",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/fixture/terms",
        fields: { commercialUse: "allowed" },
      },
    },
    retrievedAt: FIXED_NOW,
    matchedQueryId: "q-001",
    rank: 1,
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-skip-test",
      title: "Skip Test",
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
      generatedAt: FIXED_NOW,
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
        summary: "Test scene one",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need visual",
          preferredMedia: ["photo"],
          visualKeywords: ["tech"],
        },
        search: {
          queries: [
            { id: "q-001", language: "en", query: "tech photo", purpose: "main", enabled: true },
          ],
          candidates: [makeSafeCandidate()],
          lastSearchedAt: FIXED_NOW,
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
        text: "Second scene content.",
        summary: "Test scene two",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need visual",
          preferredMedia: ["photo"],
          visualKeywords: ["nature"],
        },
        search: {
          queries: [
            { id: "q-002", language: "en", query: "nature photo", purpose: "main", enabled: true },
          ],
          candidates: [],
          lastSearchedAt: FIXED_NOW,
        },
        review: { kind: "pending" },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skipScene use case", () => {
  function makeDeps(repo: InMemoryRepository): SkipSceneDeps {
    return { repository: repo, now: () => FIXED_DATE };
  }

  it("1. skip scene success", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("skipped");
  });

  it("2. skip scene preserves candidates", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    // candidates should still be present
    expect(scene.search.candidates).toHaveLength(1);
    expect(scene.search.candidates[0]!.id).toBe("cand-001");
  });

  it("3. skip scene writes decidedAt", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "skipped") {
      expect(scene.review.decidedAt).toBe(FIXED_NOW);
    } else {
      expect.fail("review.kind should be 'skipped'");
    }
  });

  it("4. skip scene writes note when provided", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene(
      { projectRoot: "/test", sceneId: "scene-001", note: "No external asset needed" },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "skipped") {
      expect(scene.review.note).toBe("No external asset needed");
    }
  });

  it("5. skip scene without note works", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "skipped") {
      expect(scene.review.note).toBeUndefined();
    }
  });

  it("6. scene not found → SceneNotFoundError", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      skipScene({ projectRoot: "/test", sceneId: "non-existent-scene" }, makeDeps(repo)),
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("7. project.updatedAt updated", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    expect(result.project.updatedAt).toBe(FIXED_NOW);
  });

  it("8. repository.save called exactly once", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    expect(repo.saveCount).toBe(1);
  });

  it("9. unknown input fields rejected by Zod", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      skipScene(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          extraField: "evil",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("10. skip overwrites previous candidate_selected decision", async () => {
    const repo = new InMemoryRepository();
    // Create a project where scene-001 already has a candidate_selected review
    const project = makeTestProject();
    const scene = project.scenes.find((s) => s.id === "scene-001")!;
    const candidate = scene.search.candidates[0]!;
    scene.review = {
      kind: "candidate_selected",
      selection: {
        selectedAt: "2026-07-15T10:00:00.000Z",
        candidate: JSON.parse(JSON.stringify(candidate)) as typeof candidate,
      },
    };
    // Re-validate to ensure the project is still valid
    const validProject = SpeechToSceneProjectSchema.parse(project);
    repo.setProject("/test", validProject);

    // Now skip the scene
    const result = await skipScene({ projectRoot: "/test", sceneId: "scene-001" }, makeDeps(repo));

    const resultScene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(resultScene.review.kind).toBe("skipped");
    // Candidates should still be preserved
    expect(resultScene.search.candidates).toHaveLength(1);
  });

  it("11. note with leading/trailing whitespace rejected", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      skipScene({ projectRoot: "/test", sceneId: "scene-001", note: "  spaced  " }, makeDeps(repo)),
    ).rejects.toThrow();
  });
});
