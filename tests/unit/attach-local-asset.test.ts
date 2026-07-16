/**
 * Application-level tests for the attachLocalAsset use case.
 *
 * Tests verify:
 *  1. user_owned local asset attach success
 *  2. candidate_selected + selected_candidate attach success, preserving selection
 *  3. selected_candidate candidateId mismatch → ProjectConflictError
 *  4. unknown scene → SceneNotFoundError
 *  5. unknown input fields rejected by Zod
 *  6. project.updatedAt updated
 *  7. search.candidates preserved
 *  8. full project schema validation passes
 *  9. note is persisted in review
 * 10. default provenance is user_owned when not provided
 */

import { describe, expect, it } from "vitest";
import { attachLocalAsset } from "../../src/application/attach-local-asset.js";
import type { AttachLocalAssetDeps } from "../../src/application/attach-local-asset.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { LocalAssetWriter } from "../../src/application/ports/local-asset-writer.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { SceneNotFoundError, ProjectConflictError } from "../../src/shared/errors.js";

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
  getProject(root: string): SpeechToSceneProject | undefined {
    return this.projects.get(root);
  }
}

// ---------------------------------------------------------------------------
// Mock LocalAssetWriter
// ---------------------------------------------------------------------------

class MockAssetWriter implements LocalAssetWriter {
  writtenFiles: Array<{ projectRoot: string; sceneId: string; fileName: string; data: Buffer }> =
    [];

  async writeAsset(
    projectRoot: string,
    sceneId: string,
    fileName: string,
    data: Buffer,
  ): Promise<{ relativePath: string }> {
    await Promise.resolve();
    this.writtenFiles.push({ projectRoot, sceneId, fileName, data });
    return { relativePath: `assets/${sceneId}/${fileName}` };
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";
const FIXED_DATE = new Date(FIXED_NOW);

/** Minimal valid PNG: 1x1 transparent pixel. */
const MINIMAL_PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
  0x00,
  0x00,
  0x00,
  0x01, // width: 1
  0x00,
  0x00,
  0x00,
  0x01, // height: 1
  0x08,
  0x06,
  0x00,
  0x00,
  0x00, // bit depth: 8, color type: 6 (RGBA)
  0x1f,
  0x15,
  0xc4,
  0x89, // CRC
  0x00,
  0x00,
  0x00,
  0x0a, // IDAT length
  0x49,
  0x44,
  0x41,
  0x54, // "IDAT"
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01, // compressed data
  0x0d,
  0x0a,
  0x2d,
  0xb4, // CRC
  0x00,
  0x00,
  0x00,
  0x00, // IEND length
  0x49,
  0x45,
  0x4e,
  0x44, // "IEND"
  0xae,
  0x42,
  0x60,
  0x82, // CRC
]);

function makeSafeCandidate(): unknown {
  return {
    id: "cand-safe",
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
    thumbnailUrl: "https://example.com/fixture/cand-safe/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-safe",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Fixture Creator", profileUrl: "https://example.com/fixture/creator/1" },
    rights: {
      status: "platform_license",
      licenseName: "Safe License",
      licenseUrl: "https://example.com/fixture/terms",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/fixture/terms",
        fields: { commercialUse: "allowed", derivatives: "allowed" },
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
      id: "proj-attach-test",
      title: "Attach Test",
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
    ],
  });
}

/** Creates a project where scene-001 already has a candidate_selected review. */
function makeProjectWithSelection(): SpeechToSceneProject {
  const project = makeTestProject();
  const scene = project.scenes[0]!;
  const candidate = scene.search.candidates[0]!;
  scene.review = {
    kind: "candidate_selected",
    selection: {
      selectedAt: FIXED_NOW,
      candidate: JSON.parse(JSON.stringify(candidate)) as typeof candidate,
    },
  };
  return SpeechToSceneProjectSchema.parse(project);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attachLocalAsset use case", () => {
  function makeDeps(repo: InMemoryRepository, writer?: MockAssetWriter): AttachLocalAssetDeps {
    return {
      repository: repo,
      assetWriter: writer ?? new MockAssetWriter(),
      now: () => FIXED_DATE,
    };
  }

  it("1. user_owned local asset attach success", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const writer = new MockAssetWriter();

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "my-photo.png",
        mimeType: "image/png",
        extension: ".png",
        provenance: { kind: "user_owned" },
      },
      makeDeps(repo, writer),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("local_asset_attached");
    if (scene.review.kind === "local_asset_attached") {
      expect(scene.review.localAsset.mimeType).toBe("image/png");
      expect(scene.review.localAsset.originalFileName).toBe("my-photo.png");
      expect(scene.review.localAsset.sizeBytes).toBe(MINIMAL_PNG.length);
      expect(scene.review.localAsset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(scene.review.localAsset.importedAt).toBe(FIXED_NOW);
      expect(scene.review.localAsset.provenance.kind).toBe("user_owned");
      expect(scene.review.localAsset.relativePath).toMatch(/^assets\/scene-001\//);
    }
    expect(writer.writtenFiles).toHaveLength(1);
    expect(writer.writtenFiles[0]!.sceneId).toBe("scene-001");
  });

  it("2. candidate_selected + selected_candidate attach success, preserving selection", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeProjectWithSelection());
    const writer = new MockAssetWriter();

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "downloaded.png",
        mimeType: "image/png",
        extension: ".png",
        provenance: { kind: "selected_candidate", candidateId: "cand-safe" },
      },
      makeDeps(repo, writer),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("candidate_selected");
    if (scene.review.kind === "candidate_selected") {
      // Selection is preserved
      expect(scene.review.selection.candidate.id).toBe("cand-safe");
      // Local asset is attached
      expect(scene.review.localAsset).toBeDefined();
      expect(scene.review.localAsset!.provenance.kind).toBe("selected_candidate");
      if (scene.review.localAsset!.provenance.kind === "selected_candidate") {
        expect(scene.review.localAsset!.provenance.candidateId).toBe("cand-safe");
      }
    }
  });

  it("3. selected_candidate candidateId mismatch → ProjectConflictError", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeProjectWithSelection());
    const writer = new MockAssetWriter();

    await expect(
      attachLocalAsset(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          fileBuffer: MINIMAL_PNG,
          originalFileName: "photo.png",
          mimeType: "image/png",
          extension: ".png",
          provenance: { kind: "selected_candidate", candidateId: "wrong-candidate" },
        },
        makeDeps(repo, writer),
      ),
    ).rejects.toThrow(ProjectConflictError);
  });

  it("3b. candidateId mismatch does not call assetWriter.writeAsset (no orphan file)", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeProjectWithSelection());
    const writer = new MockAssetWriter();

    await expect(
      attachLocalAsset(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          fileBuffer: MINIMAL_PNG,
          originalFileName: "photo.png",
          mimeType: "image/png",
          extension: ".png",
          provenance: { kind: "selected_candidate", candidateId: "wrong-candidate" },
        },
        makeDeps(repo, writer),
      ),
    ).rejects.toThrow(ProjectConflictError);

    // No file should have been written
    expect(writer.writtenFiles).toHaveLength(0);
    // No save should have been called
    expect(repo.saveCount).toBe(0);
  });

  it("4. unknown scene → SceneNotFoundError", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      attachLocalAsset(
        {
          projectRoot: "/test",
          sceneId: "non-existent",
          fileBuffer: MINIMAL_PNG,
          originalFileName: "photo.png",
          mimeType: "image/png",
          extension: ".png",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("5. unknown input fields rejected by Zod", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      attachLocalAsset(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          fileBuffer: MINIMAL_PNG,
          originalFileName: "photo.png",
          mimeType: "image/png",
          extension: ".png",
          extraField: "bad",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("6. project.updatedAt updated", async () => {
    const repo = new InMemoryRepository();
    const project = makeTestProject();
    repo.setProject("/test", project);

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
      },
      makeDeps(repo),
    );

    expect(result.project.updatedAt).toBe(FIXED_NOW);
  });

  it("7. search.candidates preserved", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.search.candidates).toHaveLength(1);
    expect(scene.search.candidates[0]!.id).toBe("cand-safe");
  });

  it("8. full project schema validation passes", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
      },
      makeDeps(repo),
    );

    // The use case already validates, but double-check here
    const reparsed = SpeechToSceneProjectSchema.safeParse(result);
    expect(reparsed.success).toBe(true);
  });

  it("9. note is persisted in review", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
        note: "My custom note",
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "local_asset_attached") {
      expect(scene.review.note).toBe("My custom note");
    }
  });

  it("10. default provenance is user_owned when not provided", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "local_asset_attached") {
      expect(scene.review.localAsset.provenance.kind).toBe("user_owned");
    }
  });

  it("11. repository.save is called exactly once", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "photo.png",
        mimeType: "image/png",
        extension: ".png",
      },
      makeDeps(repo),
    );

    expect(repo.saveCount).toBe(1);
  });

  it("12. external provenance with rights is accepted", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await attachLocalAsset(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        fileBuffer: MINIMAL_PNG,
        originalFileName: "external.png",
        mimeType: "image/png",
        extension: ".png",
        provenance: {
          kind: "external",
          sourcePageUrl: "https://example.com/source",
          rights: {
            status: "open_license",
            licenseCode: "CC-BY-4.0",
            licenseName: "Creative Commons Attribution 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
            attributionRequired: true,
            attributionText: "Photo by Example",
            commercialUse: "allowed",
            derivatives: "allowed",
            verifiedAt: FIXED_NOW,
            evidence: {
              capturedAt: FIXED_NOW,
              referenceUrl: "https://creativecommons.org/licenses/by/4.0/",
              fields: { commercialUse: "allowed", derivatives: "allowed" },
            },
          },
          note: "Downloaded from example.com",
        },
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "local_asset_attached") {
      expect(scene.review.localAsset.provenance.kind).toBe("external");
      if (scene.review.localAsset.provenance.kind === "external") {
        expect(scene.review.localAsset.provenance.rights.status).toBe("open_license");
      }
    }
  });
});
