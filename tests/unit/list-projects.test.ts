/**
 * Unit tests for the listProjects use case.
 *
 * Phase 3: multi-project workspace support.
 */

import { describe, expect, it } from "vitest";

import { listProjects } from "../../src/application/list-projects.js";
import type {
  WorkspaceScanner,
  WorkspaceDirEntry,
} from "../../src/application/ports/workspace-scanner.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeProject(title: string, updatedAt: string, sceneCount = 1): SpeechToSceneProject {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    id: `scene-${String(i + 1).padStart(3, "0")}`,
    order: i + 1,
    sourceAnchor: {
      strategy: "source-blocks-v1" as const,
      sourceBlockIds: [`block-${String(i + 1).padStart(3, "0")}`],
      startQuote: "Hello",
      endQuote: "world",
    },
    sourceRange: { start: 0, end: 25 },
    text: "Hello world content.",
    summary: "Test scene",
    narrativeRole: "hook" as const,
    visualPlan: {
      decision: "stock_asset" as const,
      rationale: "Need visual",
      preferredMedia: ["photo"],
      visualKeywords: ["tech"],
    },
    search: {
      queries: [
        { id: "q-001", language: "en", query: "tech photo", purpose: "main", enabled: true },
      ],
      candidates: [],
      lastSearchedAt: FIXED_NOW,
    },
  }));

  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-list-test",
      title,
      createdAt: FIXED_NOW,
      updatedAt,
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
    scenes,
  });
}

function makeScanner(entries: readonly WorkspaceDirEntry[]): WorkspaceScanner {
  return {
    scanProjectDirs: () => Promise.resolve(entries),
    deleteProject: () => Promise.resolve(),
  };
}

function makeRepository(projects: Record<string, SpeechToSceneProject>): ProjectRepository {
  return {
    exists: (root) => Promise.resolve(projects[root] !== undefined),
    create: () => Promise.resolve(),
    load: (root) => {
      const p = projects[root];
      if (!p) {
        const err = new Error("not found") as Error & { code: string };
        err.code = "project_not_found";
        return Promise.reject(err);
      }
      return Promise.resolve(p);
    },
    save: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const WORKSPACE = "/test/workspace";

describe("listProjects", () => {
  it("returns projects sorted by updatedAt descending", async () => {
    const entries: WorkspaceDirEntry[] = [
      { name: "older", hasProject: true },
      { name: "newer", hasProject: true },
    ];
    const repo = makeRepository({
      [`${WORKSPACE}/older`]: makeProject("Older", "2026-07-14T00:00:00Z"),
      [`${WORKSPACE}/newer`]: makeProject("Newer", "2026-07-18T00:00:00Z"),
    });

    const result = await listProjects(WORKSPACE, makeScanner(entries), repo);

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]!.name).toBe("newer");
    expect(result.projects[1]!.name).toBe("older");
  });

  it("includes title, sceneCount, and updatedAt from project data", async () => {
    const entries: WorkspaceDirEntry[] = [{ name: "demo", hasProject: true }];
    const repo = makeRepository({
      [`${WORKSPACE}/demo`]: makeProject("Demo Title", "2026-07-15T12:00:00Z", 3),
    });

    const result = await listProjects(WORKSPACE, makeScanner(entries), repo);

    expect(result.projects).toHaveLength(1);
    const item = result.projects[0]!;
    expect(item.title).toBe("Demo Title");
    expect(item.sceneCount).toBe(3);
    expect(item.updatedAt).toBe("2026-07-15T12:00:00Z");
    expect(item.hasProject).toBe(true);
  });

  it("skips entries where hasProject is false", async () => {
    const entries: WorkspaceDirEntry[] = [
      { name: "real-project", hasProject: true },
      { name: "empty-dir", hasProject: false },
    ];
    const repo = makeRepository({
      [`${WORKSPACE}/real-project`]: makeProject("Real", FIXED_NOW),
    });

    const result = await listProjects(WORKSPACE, makeScanner(entries), repo);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]!.name).toBe("real-project");
  });

  it("skips projects that fail to load (corrupt, wrong version, etc.)", async () => {
    const entries: WorkspaceDirEntry[] = [
      { name: "good", hasProject: true },
      { name: "broken", hasProject: true },
    ];
    const repo = makeRepository({
      [`${WORKSPACE}/good`]: makeProject("Good", FIXED_NOW),
    });

    const result = await listProjects(WORKSPACE, makeScanner(entries), repo);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]!.name).toBe("good");
  });

  it("returns empty list when workspace has no projects", async () => {
    const entries: WorkspaceDirEntry[] = [{ name: "empty-dir", hasProject: false }];
    const repo = makeRepository({});

    const result = await listProjects(WORKSPACE, makeScanner(entries), repo);

    expect(result.projects).toHaveLength(0);
  });

  it("returns empty list when scanner returns empty", async () => {
    const repo = makeRepository({});

    const result = await listProjects(WORKSPACE, makeScanner([]), repo);

    expect(result.projects).toHaveLength(0);
  });
});
