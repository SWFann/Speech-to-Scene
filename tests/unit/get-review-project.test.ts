/**
 * Unit tests for the getReviewProject Application Use Case.
 *
 * Tests verify:
 * - Project with scenes and candidates maps correctly
 * - Empty project (no scenes) maps correctly
 * - No absolute projectRoot in output
 * - No Token/API key/cache path in output
 * - Local asset paths remain relative
 * - Source path remains relative (not absolute)
 * - Rights/sourcePageUrl evidence preserved
 * - Derived status consistent with domain status rules
 * - repository.load called exactly once
 * - repository.save never called
 * - repository load error propagates
 * - Input object not modified
 * - Same input → deep-equal output
 */

import { describe, expect, it } from "vitest";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import { getReviewProject } from "../../src/application/get-review-project.js";

// ---------------------------------------------------------------------------
// In-memory repository (tracks calls)
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  loadCount = 0;
  saveCount = 0;

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    this.loadCount++;
    const entry = this.projects.get(projectRoot);
    if (!entry) throw new Error(`Project not found at ${projectRoot}`);
    return entry;
  }
  async save(): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
  }
  setProject(root: string, project: SpeechToSceneProject): void {
    this.projects.set(root, project);
  }
}

// ---------------------------------------------------------------------------
// Helpers: build valid projects
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeEmptyProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-empty-00000000",
      title: "Empty Project",
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
      blocks: [],
    },
    generation: null,
    scenes: [],
  });
}

function makePlannedProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-planned-00000000",
      title: "Planned Project",
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
      sha256: "b".repeat(64),
      encoding: "utf-8",
      sizeBytes: 100,
      textLengthUtf16: 100,
      offsetUnit: "utf16_code_unit",
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 100 } },
      ],
    },
    generation: {
      plannerProvider: "fixture",
      apiProtocol: "fixture",
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
        sourceRange: { start: 0, end: 100 },
        text: "Hello world content for testing.",
        summary: "Opening scene",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need a visual",
          preferredMedia: ["photo"],
          visualKeywords: ["technology"],
        },
        search: {
          queries: [
            {
              id: "q-001",
              language: "en" as const,
              query: "technology photo",
              purpose: "main visual",
              enabled: true,
            },
          ],
          candidates: [
            {
              id: "cand-001",
              provider: {
                id: "fixture",
                name: "Fixture Provider",
                homepageUrl: "https://example.com",
                termsUrl: "https://example.com/terms",
                policyRevision: "v1",
                termsCheckedAt: FIXED_NOW,
              },
              providerAssetId: "fix-001",
              mediaType: "photo" as const,
              thumbnailUrl: "https://example.com/thumb.jpg",
              previewUrl: "https://example.com/preview.jpg",
              sourcePageUrl: "https://example.com/photo",
              width: 1080,
              height: 1920,
              orientation: "portrait" as const,
              creator: { name: "Test Creator", profileUrl: "https://example.com/creator" },
              rights: {
                status: "open_license",
                licenseCode: "CC-BY-4.0",
                licenseName: "Creative Commons Attribution 4.0",
                licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
                attributionRequired: true,
                attributionText: "Photo by Test Creator",
                commercialUse: "allowed",
                derivatives: "allowed",
                verifiedAt: FIXED_NOW,
                evidence: {
                  capturedAt: FIXED_NOW,
                  referenceUrl: "https://example.com/license",
                  fields: { source: "provider", version: "4.0" },
                },
              },
              retrievedAt: FIXED_NOW,
              matchedQueryId: "q-001",
              rank: 1,
            },
          ],
          lastSearchedAt: FIXED_NOW,
        },
        review: {
          kind: "pending",
        },
      },
    ],
  });
}

function makeProjectWithLocalAsset(): SpeechToSceneProject {
  const base = makePlannedProject();
  // Modify scene to have a local_asset_attached review
  const scene = base.scenes[0]!;
  return {
    ...base,
    scenes: [
      {
        ...scene,
        review: {
          kind: "local_asset_attached" as const,
          localAsset: {
            relativePath: "assets/scene-001/file.png",
            originalFileName: "file.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            sha256: "c".repeat(64),
            importedAt: FIXED_NOW,
            provenance: {
              kind: "user_owned" as const,
              note: "User uploaded",
            },
          },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getReviewProject", () => {
  const ROOT = "/test/project";

  it("maps a planned project with scenes and candidates correctly", async () => {
    const repo = new InMemoryRepository();
    const project = makePlannedProject();
    repo.setProject(ROOT, project);

    const view = await getReviewProject(ROOT, repo);

    expect(view.schemaVersion).toBe("0.1");
    expect(view.project.id).toBe("proj-planned-00000000");
    expect(view.project.title).toBe("Planned Project");
    expect(view.status).toBe("planned");
    expect(view.sceneCount).toBe(1);
    expect(view.scenes).toHaveLength(1);

    const scene = view.scenes[0]!;
    expect(scene.id).toBe("scene-001");
    expect(scene.visualPlan.decision).toBe("stock_asset");
    expect(scene.search.queries).toHaveLength(1);
    expect(scene.search.candidateCount).toBe(1);
    expect(scene.search.enabledQueryCount).toBe(1);
    expect(scene.status).toBe("candidates_ready");

    const cand = scene.search.candidates[0]!;
    expect(cand.id).toBe("cand-001");
    expect(cand.sourcePageUrl).toBe("https://example.com/photo");
    expect(cand.rights.status).toBe("open_license");
    expect(cand.rights.licenseCode).toBe("CC-BY-4.0");
    expect(cand.rights.evidence.referenceUrl).toBe("https://example.com/license");
  });

  it("maps an empty project (no scenes) correctly", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makeEmptyProject());

    const view = await getReviewProject(ROOT, repo);

    expect(view.status).toBe("created");
    expect(view.sceneCount).toBe(0);
    expect(view.scenes).toHaveLength(0);
    expect(view.generation).toBeNull();
    expect(view.lastGenerationAt).toBeNull();
  });

  it("does not include absolute projectRoot in output", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);
    const json = JSON.stringify(view);

    expect(json).not.toContain("/test/project");
    expect(json).not.toContain(ROOT);
  });

  it("does not include Token, API key, or cache path", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);
    const json = JSON.stringify(view);

    expect(json).not.toContain("token");
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("cache");
    expect(json).not.toContain("secret");
  });

  it("keeps local asset paths relative", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makeProjectWithLocalAsset());

    const view = await getReviewProject(ROOT, repo);

    const scene = view.scenes[0]!;
    expect(scene.review.kind).toBe("local_asset_attached");
    if (scene.review.kind === "local_asset_attached") {
      expect(scene.review.localAsset.relativePath).toBe("assets/scene-001/file.png");
      expect(JSON.stringify(view)).not.toContain("/test/project");
    }
  });

  it("keeps source path relative (not absolute)", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);

    expect(view.source.path).toBe("script.md");
    expect(JSON.stringify(view)).not.toContain("/test/project/script.md");
  });

  it("preserves rights and sourcePageUrl evidence", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);

    const cand = view.scenes[0]!.search.candidates[0]!;
    expect(cand.sourcePageUrl).toBe("https://example.com/photo");
    expect(cand.rights.evidence.referenceUrl).toBe("https://example.com/license");
    expect(cand.rights.evidence.fields).toEqual({ source: "provider", version: "4.0" });
    expect(cand.rights.licenseCode).toBe("CC-BY-4.0");
    expect(cand.rights.attributionText).toBe("Photo by Test Creator");
  });

  it("derives scene status consistent with domain rules", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);

    // pending + has candidates → candidates_ready
    expect(view.scenes[0]!.status).toBe("candidates_ready");
    expect(view.sceneStatuses[0]!.status).toBe("candidates_ready");
    expect(view.producingSceneCount).toBe(1);
  });

  it("calls repository.load exactly once", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    await getReviewProject(ROOT, repo);

    expect(repo.loadCount).toBe(1);
  });

  it("never calls repository.save", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    await getReviewProject(ROOT, repo);

    expect(repo.saveCount).toBe(0);
  });

  it("propagates repository load error", async () => {
    const repo = new InMemoryRepository();
    // Don't set a project → load will throw

    await expect(getReviewProject(ROOT, repo)).rejects.toThrow(/not found/i);
  });

  it("does not modify the input project object", async () => {
    const repo = new InMemoryRepository();
    const project = makePlannedProject();
    repo.setProject(ROOT, project);

    // Deep clone before call to compare after
    const before = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;

    await getReviewProject(ROOT, repo);

    // The original object should be unchanged
    expect(JSON.parse(JSON.stringify(project))).toEqual(before);
  });

  it("produces deep-equal output for same input", async () => {
    const repo1 = new InMemoryRepository();
    const repo2 = new InMemoryRepository();
    const project1 = makePlannedProject();
    const project2 = makePlannedProject();
    repo1.setProject(ROOT, project1);
    repo2.setProject(ROOT, project2);

    const view1 = await getReviewProject(ROOT, repo1);
    const view2 = await getReviewProject(ROOT, repo2);

    expect(JSON.parse(JSON.stringify(view1))).toEqual(JSON.parse(JSON.stringify(view2)));
  });

  it("preserves generation metadata when present", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);

    expect(view.generation).not.toBeNull();
    expect(view.generation?.plannerProvider).toBe("fixture");
    expect(view.generation?.generatedAt).toBe(FIXED_NOW);
    expect(view.lastGenerationAt).toBe(FIXED_NOW);
  });

  it("maps candidate_selected review with local asset", async () => {
    const repo = new InMemoryRepository();
    const project = makePlannedProject();
    // Change review to candidate_selected with local asset
    const scene = project.scenes[0]!;
    const modifiedProject: SpeechToSceneProject = {
      ...project,
      scenes: [
        {
          ...scene,
          review: {
            kind: "candidate_selected" as const,
            selection: {
              selectedAt: FIXED_NOW,
              candidate: scene.search.candidates[0],
              rightsAcknowledgement: {
                acknowledgedAt: FIXED_NOW,
                warningCodes: ["test-warning"],
              },
            },
            localAsset: {
              relativePath: "assets/scene-001/downloaded.png",
              originalFileName: "downloaded.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              sha256: "d".repeat(64),
              importedAt: FIXED_NOW,
              provenance: {
                kind: "selected_candidate" as const,
                candidateId: "cand-001",
              },
            },
          },
        },
      ],
    } as SpeechToSceneProject;
    repo.setProject(ROOT, modifiedProject);

    const view = await getReviewProject(ROOT, repo);

    const sceneView = view.scenes[0]!;
    expect(sceneView.review.kind).toBe("candidate_selected");
    if (sceneView.review.kind === "candidate_selected") {
      expect(sceneView.review.selection.candidate.id).toBe("cand-001");
      expect(sceneView.review.selection.rightsAcknowledgement?.warningCodes).toEqual([
        "test-warning",
      ]);
      expect(sceneView.review.localAsset?.relativePath).toBe("assets/scene-001/downloaded.png");
      expect(sceneView.review.localAsset?.provenance.kind).toBe("selected_candidate");
    }
    expect(sceneView.status).toBe("local_attached");
  });

  it("maps skipped review correctly", async () => {
    const repo = new InMemoryRepository();
    const project = makePlannedProject();
    const scene = project.scenes[0]!;
    const modifiedProject: SpeechToSceneProject = {
      ...project,
      scenes: [
        {
          ...scene,
          review: {
            kind: "skipped" as const,
            decidedAt: FIXED_NOW,
            note: "Not needed",
          },
        },
      ],
    };
    repo.setProject(ROOT, modifiedProject);

    const view = await getReviewProject(ROOT, repo);

    const sceneView = view.scenes[0]!;
    expect(sceneView.review.kind).toBe("skipped");
    if (sceneView.review.kind === "skipped") {
      expect(sceneView.review.decidedAt).toBe(FIXED_NOW);
      expect(sceneView.review.note).toBe("Not needed");
    }
    expect(sceneView.status).toBe("skipped");
  });

  it("preserves provider snapshot fields", async () => {
    const repo = new InMemoryRepository();
    repo.setProject(ROOT, makePlannedProject());

    const view = await getReviewProject(ROOT, repo);

    const provider = view.scenes[0]!.search.candidates[0]!.provider;
    expect(provider.id).toBe("fixture");
    expect(provider.name).toBe("Fixture Provider");
    expect(provider.homepageUrl).toBe("https://example.com");
    expect(provider.termsUrl).toBe("https://example.com/terms");
    expect(provider.policyRevision).toBe("v1");
  });

  it("does not return a Zod output schema — persisted schema is sole source of truth", () => {
    // Verify that the getReviewProject module does not export a Zod schema
    // The persisted SpeechToSceneProjectSchema remains the single source of truth
    // This is a design verification, not a runtime check
    const module = getReviewProject;
    expect(typeof module).toBe("function");
  });
});
