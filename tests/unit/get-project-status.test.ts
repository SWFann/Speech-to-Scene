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
      generation: {
        plannerProvider: "test-provider",
        promptVersion: "v1",
        plannerOutputSchemaVersion: "0.1",
        sourceBlockVersion: "0.1",
        generatedAt: "2026-07-13T10:00:00.000Z",
      },
      scenes: [
        {
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
        },
        {
          id: "scene-00000002",
          order: 2,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-00000001"],
            startQuote: "World",
            endQuote: ".",
          },
          sourceRange: { start: 26, end: 50 },
          text: "World content here for testing.",
          summary: "Second scene summary",
          narrativeRole: "explanation",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["greeting"],
          },
          search: { queries: [], candidates: [] },
          review: { kind: "skipped", decidedAt: "2026-07-13T10:00:00.000Z" },
        },
        {
          id: "scene-00000003",
          order: 3,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-00000001"],
            startQuote: "!",
            endQuote: ".",
          },
          sourceRange: { start: 51, end: 52 },
          text: "!",
          summary: "Third scene summary",
          narrativeRole: "call_to_action",
          visualPlan: {
            decision: "none",
            rationale: "No visual",
            preferredMedia: ["photo"],
            visualKeywords: ["greeting"],
          },
          search: { queries: [], candidates: [] },
          review: { kind: "pending" },
        },
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
});
