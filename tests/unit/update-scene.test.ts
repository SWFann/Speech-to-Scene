/**
 * Unit tests for the updateScene use case.
 *
 * Coverage:
 *  1.  Successfully updates a single visualPlan field
 *  2.  Successfully merges multiple visualPlan fields
 *  3.  Successfully writes a review note
 *  4.  reviewNote null removes the note
 *  5.  Non-existent sceneId throws SceneNotFoundError
 *  6.  Unknown patch field is rejected
 *  7.  Non-whitelist fields (id, order, text, etc.) cannot be modified
 *  8.  stock_asset with no enabled query is rejected
 *  9.  repository.save is called exactly once
 *  10. Saved object passes SpeechToSceneProjectSchema
 *  11. Other scenes are not modified
 *  12. repository.load error propagates unchanged
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import { updateScene, type UpdateSceneDeps } from "../../src/application/update-scene.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { SceneNotFoundError, ProjectConflictError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-07-15T12:00:00.000Z");

/**
 * Two-scene project fixture:
 *  - scene-001: stock_asset with one enabled query
 *  - scene-002: speaker_only, no queries needed
 */
function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-update-scene-test",
      title: "Update Scene Test",
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
          candidates: [],
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
        review: { kind: "pending", note: "Existing note" },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// In-memory repository (tracks calls, deep-clones to prevent aliasing)
// ---------------------------------------------------------------------------

class TestRepository implements ProjectRepository {
  private project: SpeechToSceneProject | null = null;
  loadCount = 0;
  saveCount = 0;
  savedProject: SpeechToSceneProject | null = null;
  loadShouldThrow: Error | null = null;
  saveShouldThrow: Error | null = null;

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
    if (this.saveShouldThrow) throw this.saveShouldThrow;
    this.savedProject = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
    void projectRoot;
  }
  setProject(project: SpeechToSceneProject): void {
    this.project = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
  }
}

function makeDeps(repo: TestRepository): UpdateSceneDeps {
  return { repository: repo, now: () => FIXED_NOW };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateScene", () => {
  it("1. successfully updates a single visualPlan field", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          visualPlan: { rationale: "Updated rationale" },
        },
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.visualPlan.rationale).toBe("Updated rationale");
    // Other visualPlan fields unchanged
    expect(scene.visualPlan.decision).toBe("stock_asset");
    expect(scene.visualPlan.preferredMedia).toEqual(["photo"]);
    expect(scene.visualPlan.visualKeywords).toEqual(["tech"]);
  });

  it("2. successfully merges multiple visualPlan fields", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          visualPlan: {
            decision: "title_card",
            preferredMedia: ["photo", "video"],
            visualKeywords: ["graphic", "title"],
          },
        },
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.visualPlan.decision).toBe("title_card");
    expect(scene.visualPlan.preferredMedia).toEqual(["photo", "video"]);
    expect(scene.visualPlan.visualKeywords).toEqual(["graphic", "title"]);
    // rationale not in patch → preserved
    expect(scene.visualPlan.rationale).toBe("Need stock photo");
  });

  it("3. successfully writes a review note", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          reviewNote: "This is a review note",
        },
      },
      makeDeps(repo),
    );

    const scene = result.scenes[0]!;
    expect(scene.review).toMatchObject({ kind: "pending", note: "This is a review note" });
  });

  it("4. reviewNote null removes the note", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    // scene-002 has a note "Existing note"
    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-002",
        patch: {
          reviewNote: null,
        },
      },
      makeDeps(repo),
    );

    const scene = result.scenes[1]!;
    expect(scene.review.kind).toBe("pending");
    expect(scene.review).not.toHaveProperty("note");
  });

  it("5. non-existent sceneId throws SceneNotFoundError", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "non-existent",
          patch: {
            visualPlan: { rationale: "test" },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(SceneNotFoundError);

    // save should not have been called
    expect(repo.saveCount).toBe(0);
  });

  it("6. unknown patch field is rejected", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { rationale: "test" },
            unknownField: "bad",
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("7. non-whitelist fields (id, order, text, sourceRange) cannot be modified via patch", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    // Attempt to pass non-whitelist fields at the top level — strictObject rejects them
    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { rationale: "test" },
            text: "hacked text", // not in ScenePatchSchema
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    // Also: visualPlan patch rejects unknown visualPlan fields
    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { decision: "speaker_only", id: "hacked-id" },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();

    expect(repo.saveCount).toBe(0);
  });

  it("8. stock_asset with no enabled query is rejected", async () => {
    const repo = new TestRepository();
    const project = makeTestProject();
    // Remove the enabled query from scene-001
    project.scenes[0]!.search.queries = [];
    project.scenes[0]!.search.lastSearchedAt = undefined;
    repo.setProject(project);

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { rationale: "still stock_asset" },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow(ProjectConflictError);

    expect(repo.saveCount).toBe(0);
  });

  it("9. repository.save is called exactly once", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          visualPlan: { rationale: "updated" },
        },
      },
      makeDeps(repo),
    );

    expect(repo.saveCount).toBe(1);
  });

  it("10. saved object passes SpeechToSceneProjectSchema", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          visualPlan: { decision: "title_card", rationale: "changed" },
          reviewNote: "a note",
        },
      },
      makeDeps(repo),
    );

    expect(repo.savedProject).not.toBeNull();
    // Should not throw — the saved project is valid
    const parsed = SpeechToSceneProjectSchema.parse(repo.savedProject);
    expect(parsed.scenes[0]!.visualPlan.decision).toBe("title_card");
  });

  it("11. other scenes are not modified", async () => {
    const repo = new TestRepository();
    const original = makeTestProject();
    repo.setProject(original);

    await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: {
          visualPlan: { rationale: "new rationale" },
          reviewNote: "new note",
        },
      },
      makeDeps(repo),
    );

    const saved = repo.savedProject!;
    const otherScene = saved.scenes[1]!;
    const originalOther = original.scenes[1]!;

    expect(otherScene.id).toBe(originalOther.id);
    expect(otherScene.order).toBe(originalOther.order);
    expect(otherScene.text).toBe(originalOther.text);
    expect(otherScene.summary).toBe(originalOther.summary);
    expect(otherScene.narrativeRole).toBe(originalOther.narrativeRole);
    expect(otherScene.visualPlan).toEqual(originalOther.visualPlan);
    expect(otherScene.search).toEqual(originalOther.search);
    expect(otherScene.review).toEqual(originalOther.review);
    expect(otherScene.sourceAnchor).toEqual(originalOther.sourceAnchor);
    expect(otherScene.sourceRange).toEqual(originalOther.sourceRange);
  });

  it("12. repository.load error propagates unchanged", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());
    const loadError = new Error("Disk I/O failure");
    repo.loadShouldThrow = loadError;

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { rationale: "test" },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toBe(loadError);

    expect(repo.saveCount).toBe(0);
  });

  // --- Additional edge-case tests ---

  it("rejects empty sceneId", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "",
          patch: { visualPlan: { rationale: "test" } },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects unknown top-level input field", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: { visualPlan: { rationale: "test" } },
          extraField: "bad",
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects invalid visualPlan decision value", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { decision: "invalid_decision" },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects invalid preferredMedia value", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { preferredMedia: ["audio"] },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects empty preferredMedia array", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { preferredMedia: [] },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects empty visualKeywords array", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {
            visualPlan: { visualKeywords: [] },
          },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects patch with no visualPlan and no reviewNote", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: {},
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("updates project.updatedAt", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: { visualPlan: { rationale: "updated" } },
      },
      makeDeps(repo),
    );

    expect(result.project.updatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("preserves scene order after update", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-002",
        patch: { visualPlan: { rationale: "updated scene 2" } },
      },
      makeDeps(repo),
    );

    expect(result.scenes[0]!.id).toBe("scene-001");
    expect(result.scenes[1]!.id).toBe("scene-002");
    expect(result.scenes[0]!.order).toBe(1);
    expect(result.scenes[1]!.order).toBe(2);
  });

  it("can update visualPlan.decision away from stock_asset without enabled queries", async () => {
    const repo = new TestRepository();
    const project = makeTestProject();
    // scene-001 is stock_asset with enabled query → change to speaker_only
    repo.setProject(project);

    const result = await updateScene(
      {
        projectRoot: "/test/project",
        sceneId: "scene-001",
        patch: { visualPlan: { decision: "speaker_only" } },
      },
      makeDeps(repo),
    );

    expect(result.scenes[0]!.visualPlan.decision).toBe("speaker_only");
    expect(repo.saveCount).toBe(1);
  });

  it("rejects note exceeding 2000 characters", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: { reviewNote: "x".repeat(2001) },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects note with leading/trailing whitespace", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: { reviewNote: "  padded note  " },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("rejects non-string input (number as projectRoot)", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    await expect(
      updateScene(
        {
          projectRoot: 12345,
          sceneId: "scene-001",
          patch: { visualPlan: { rationale: "test" } },
        },
        makeDeps(repo),
      ),
    ).rejects.toThrow();
  });

  it("ZodError is instance of z.ZodError for input validation failures", async () => {
    const repo = new TestRepository();
    repo.setProject(makeTestProject());

    let caught: unknown = null;
    try {
      await updateScene(
        {
          projectRoot: "/test/project",
          sceneId: "scene-001",
          patch: { visualPlan: { decision: "bad_value" } },
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
