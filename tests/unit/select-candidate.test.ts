/**
 * Application-level tests for the selectCandidate use case.
 *
 * Tests verify:
 *  1. Select existing candidate success
 *  2. Selection persists selectedAt
 *  3. Selection saves complete candidate snapshot and rights metadata
 *  4. Selection does not allow selecting another scene's candidate
 *  5. Selection candidate not found returns stable error (ProjectConflictError)
 *  6. Restricted rights without acknowledgement rejected
 *  7. Rights acknowledgement = true succeeds for restricted rights
 *  8. Safe rights (no restrictions, allowed) can be selected without acknowledgement
 *  9. Unknown status rights require acknowledgement
 * 10. Scene not found → SceneNotFoundError
 * 11. Unknown input fields rejected by Zod
 * 12. search.candidates preserved after selection
 * 13. project.updatedAt updated
 * 14. rightsAcknowledgement persists warningCodes
 */

import { describe, expect, it } from "vitest";
import { selectCandidate, collectRightsWarnings } from "../../src/application/select-candidate.js";
import type { SelectCandidateDeps } from "../../src/application/select-candidate.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
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
// Test data
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-16T10:00:00.000Z";
const FIXED_DATE = new Date(FIXED_NOW);

/** A candidate with safe rights (platform_license, no restrictions, all allowed). */
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

/** A candidate with restrictions present (requires acknowledgement). */
function makeRestrictedCandidate(): unknown {
  const c = makeSafeCandidate() as Record<string, unknown>;
  return {
    ...c,
    id: "cand-restricted",
    providerAssetId: "fixture-asset-2",
    thumbnailUrl: "https://example.com/fixture/cand-restricted/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-restricted",
    rights: {
      ...(c.rights as Record<string, unknown>),
      restrictions: ["Do not redistribute as standalone"],
    },
    rank: 2,
  };
}

/** A candidate with unknown rights status (requires acknowledgement). */
function makeUnknownRightsCandidate(): unknown {
  const c = makeSafeCandidate() as Record<string, unknown>;
  return {
    ...c,
    id: "cand-unknown",
    providerAssetId: "fixture-asset-3",
    thumbnailUrl: "https://example.com/fixture/cand-unknown/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-unknown",
    rights: {
      status: "unknown",
      attributionRequired: false,
      commercialUse: "unclear",
      derivatives: "unclear",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/fixture/terms",
        fields: { status: "unknown" },
      },
    },
    rank: 3,
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-select-test",
      title: "Select Test",
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
          candidates: [
            makeSafeCandidate(),
            makeRestrictedCandidate(),
            makeUnknownRightsCandidate(),
          ],
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

describe("selectCandidate use case", () => {
  function makeDeps(repo: InMemoryRepository): SelectCandidateDeps {
    return { repository: repo, now: () => FIXED_DATE };
  }

  it("1. select existing safe candidate success", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("candidate_selected");
    if (scene.review.kind === "candidate_selected") {
      expect(scene.review.selection.candidate.id).toBe("cand-safe");
    }
  });

  it("2. selection persists selectedAt", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "candidate_selected") {
      expect(scene.review.selection.selectedAt).toBe(FIXED_NOW);
    }
  });

  it("3. selection saves complete candidate snapshot and rights metadata", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-restricted",
        rightsAcknowledged: true,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("candidate_selected");
    if (scene.review.kind === "candidate_selected") {
      const snapshot = scene.review.selection;
      // Full candidate snapshot
      expect(snapshot.candidate.id).toBe("cand-restricted");
      expect(snapshot.candidate.provider.id).toBe("fixture");
      expect(snapshot.candidate.rights.status).toBe("platform_license");
      expect(snapshot.candidate.rights.restrictions).toEqual(["Do not redistribute as standalone"]);
      // Rights acknowledgement persisted
      expect(snapshot.rightsAcknowledgement).toBeDefined();
      expect(snapshot.rightsAcknowledgement!.acknowledgedAt).toBe(FIXED_NOW);
      expect(snapshot.rightsAcknowledgement!.warningCodes).toContain("restrictions_present");
    }
  });

  it("4. selection does not allow selecting another scene's candidate", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    // cand-safe exists in scene-001, not scene-002
    await expect(
      selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "scene-002",
          candidateId: "cand-safe",
          rightsAcknowledged: false,
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(ProjectConflictError);
  });

  it("5. selection candidate not found returns stable error (ProjectConflictError)", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    try {
      await selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          candidateId: "non-existent-candidate",
          rightsAcknowledged: false,
        },
        makeDeps(repo),
      );
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectConflictError);
      expect((error as ProjectConflictError).code).toBe("project_conflict");
    }
  });

  it("6. restricted rights without acknowledgement rejected", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          candidateId: "cand-restricted",
          rightsAcknowledged: false,
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(ProjectConflictError);
  });

  it("7. rightsAcknowledged = true succeeds for restricted rights", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-restricted",
        rightsAcknowledged: true,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.review.kind).toBe("candidate_selected");
  });

  it("8. safe rights (no restrictions, allowed) can be selected without acknowledgement", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    // No rightsAcknowledgement should be present for safe rights
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "candidate_selected") {
      expect(scene.review.selection.rightsAcknowledgement).toBeUndefined();
    }
  });

  it("9. unknown status rights require acknowledgement", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    // Without acknowledgement → rejected
    await expect(
      selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          candidateId: "cand-unknown",
          rightsAcknowledged: false,
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(ProjectConflictError);

    // With acknowledgement → succeeds
    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-unknown",
        rightsAcknowledged: true,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "candidate_selected") {
      expect(scene.review.selection.rightsAcknowledgement).toBeDefined();
      expect(scene.review.selection.rightsAcknowledgement!.warningCodes).toContain(
        "rights_unknown",
      );
      expect(scene.review.selection.rightsAcknowledgement!.warningCodes).toContain(
        "commercial_use_unclear",
      );
      expect(scene.review.selection.rightsAcknowledgement!.warningCodes).toContain(
        "derivatives_unclear",
      );
    }
  });

  it("10. scene not found → SceneNotFoundError", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "non-existent-scene",
          candidateId: "cand-safe",
          rightsAcknowledged: false,
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("11. unknown input fields rejected by Zod", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await expect(
      selectCandidate(
        {
          projectRoot: "/test",
          sceneId: "scene-001",
          candidateId: "cand-safe",
          rightsAcknowledged: false,
          extraField: "evil",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("12. search.candidates preserved after selection", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    // All three candidates should still be present
    expect(scene.search.candidates).toHaveLength(3);
  });

  it("13. project.updatedAt updated", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    expect(result.project.updatedAt).toBe(FIXED_NOW);
  });

  it("14. repository.save called exactly once", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    expect(repo.saveCount).toBe(1);
  });

  it("15. selection snapshot is a deep copy (not a reference)", async () => {
    const repo = new InMemoryRepository();
    repo.setProject("/test", makeTestProject());

    const result = await selectCandidate(
      {
        projectRoot: "/test",
        sceneId: "scene-001",
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      },
      makeDeps(repo),
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    if (scene.review.kind === "candidate_selected") {
      // The snapshot candidate should have the same values but be a different object
      const snapshotCandidate = scene.review.selection.candidate;
      const listCandidate = scene.search.candidates.find((c) => c.id === "cand-safe")!;
      expect(snapshotCandidate).toEqual(listCandidate);
      expect(snapshotCandidate).not.toBe(listCandidate);
      // Modifying one should not affect the other
      expect(snapshotCandidate.rights).not.toBe(listCandidate.rights);
    }
  });
});

// ---------------------------------------------------------------------------
// collectRightsWarnings unit tests
// ---------------------------------------------------------------------------

describe("collectRightsWarnings", () => {
  it("returns empty array for safe rights", () => {
    const warnings = collectRightsWarnings({
      status: "platform_license",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    });
    expect(warnings).toEqual([]);
  });

  it("returns restrictions_present when restrictions exist", () => {
    const warnings = collectRightsWarnings({
      status: "platform_license",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      restrictions: ["No redistribution"],
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    });
    expect(warnings).toContain("restrictions_present");
  });

  it("returns rights_unknown for unknown status", () => {
    const warnings = collectRightsWarnings({
      status: "unknown",
      attributionRequired: false,
      commercialUse: "unclear",
      derivatives: "unclear",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    });
    expect(warnings).toContain("rights_unknown");
    expect(warnings).toContain("commercial_use_unclear");
    expect(warnings).toContain("derivatives_unclear");
  });

  it("returns derivatives_share_alike for share-alike derivatives", () => {
    const warnings = collectRightsWarnings({
      status: "open_license",
      licenseCode: "cc-by-sa-4.0",
      licenseName: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      attributionRequired: true,
      attributionText: "Author Name",
      commercialUse: "allowed",
      derivatives: "share_alike",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    });
    expect(warnings).toContain("derivatives_share_alike");
  });
});
