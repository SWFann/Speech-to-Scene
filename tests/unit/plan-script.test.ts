/**
 * planProject use case tests.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ProjectAlreadyPlannedError,
  ProjectNotFoundError,
  SourceDocumentError,
  PlannerValidationError,
} from "../../src/shared/errors.js";
import { planProject } from "../../src/application/plan-script.js";
import { FixtureScriptPlanner } from "../../src/planner/fixture-script-planner.js";
import type {
  ScriptPlanner,
  PlannerRawResult,
} from "../../src/application/ports/script-planner.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import type { Clock } from "../../src/application/ports/clock.js";
import type { IdGenerator } from "../../src/application/ports/id-generator.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import { FixedClock } from "../../tests/helpers/fixed-clock.js";
import { FixedIdGenerator } from "../../tests/helpers/fixed-id-generator.js";
import { computeSha256, decodeSourceText } from "../../src/infrastructure/source-document.js";

// ---------------------------------------------------------------------------
// In-memory doubles
// ---------------------------------------------------------------------------

interface InMemoryProject {
  root: string;
  project: SpeechToSceneProject;
}

class InMemoryRepository implements ProjectRepository {
  private projects: Map<string, InMemoryProject> = new Map();

  // eslint-disable-next-line @typescript-eslint/require-await
  async exists(projectRoot: string): Promise<boolean> {
    return this.projects.has(projectRoot);
  }

  async create(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.projects.set(projectRoot, { root: projectRoot, project });
  }

  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) {
      throw new Error("Project not found");
    }
    return entry.project;
  }

  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) {
      throw new Error("Project not found");
    }
    this.projects.set(projectRoot, { ...entry, project });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SCRIPT = "# 深度学习简介\n\n深度学习是机器学习的一个分支。\n";

async function createProject(
  repo: InMemoryRepository,
  projectRoot: string,
  sourceBytes: Uint8Array,
  overrides?: Partial<SpeechToSceneProject>,
): Promise<SpeechToSceneProject> {
  const now = new FixedClock().now().toISOString();
  const sha256 = computeSha256(sourceBytes);
  const text = decodeSourceText(sourceBytes);

  const project: SpeechToSceneProject = {
    schemaVersion: "0.1",
    project: {
      id: "project-test-001",
      title: "Test Project",
      createdAt: now,
      updatedAt: now,
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
      sha256,
      encoding: "utf-8",
      sizeBytes: sourceBytes.length,
      textLengthUtf16: text.length,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
    ...overrides,
  };
  await repo.create(projectRoot, project);
  return project;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("planProject", () => {
  let tempDir: string;
  let scriptPath: string;
  let projectDir: string;
  let clock: Clock;
  let idGenerator: IdGenerator;
  let repository: InMemoryRepository;
  let planner: FixtureScriptPlanner;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-plan-test-"));
    scriptPath = path.join(tempDir, "script.md");
    await fs.writeFile(scriptPath, VALID_SCRIPT, "utf-8");
    projectDir = path.join(tempDir, "my-project");

    clock = new FixedClock();
    idGenerator = new FixedIdGenerator();
    repository = new InMemoryRepository();
    planner = new FixtureScriptPlanner();

    // Create the project
    await fs.mkdir(projectDir, { recursive: true });
    const sourceBytes = new TextEncoder().encode(VALID_SCRIPT);
    const project = await createProject(repository, projectDir, sourceBytes);
    // Copy source file
    await fs.writeFile(path.join(projectDir, project.source.path), sourceBytes);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("plans an unplanned project", async () => {
    const result = await planProject(
      {
        projectRoot: projectDir,
        provider: "fixture",
        force: false,
        maxScenes: 20,
        dryRun: false,
      },
      repository,
      planner,
      clock,
      idGenerator,
    );

    expect(result.projectId).toBe("project-test-001");
    expect(result.status).toBe("planned");
    expect(result.sceneCount).toBeGreaterThan(0);
    expect(result.provider).toBe("fixture");
  });

  it("throws for non-existent project", async () => {
    await expect(
      planProject(
        {
          projectRoot: "/nonexistent/path",
          provider: "fixture",
          force: false,
          maxScenes: 20,
          dryRun: false,
        },
        repository,
        planner,
        clock,
        idGenerator,
      ),
    ).rejects.toThrow(ProjectNotFoundError);
  });

  it("throws for already planned project without --force", async () => {
    // Create a planned project
    const sourceBytes = new TextEncoder().encode(VALID_SCRIPT);
    const baseProject = await createProject(repository, projectDir, sourceBytes);
    const plannedProject: SpeechToSceneProject = {
      ...baseProject,
      generation: {
        plannerProvider: "fixture",
        promptVersion: "1.0.0",
        plannerOutputSchemaVersion: "1.0.0",
        sourceBlockVersion: "1.0.0",
        generatedAt: new FixedClock().now().toISOString(),
      },
      source: {
        ...baseProject.source,
        blocks: [
          { id: "block-0001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 10 } },
        ],
      },
      scenes: [
        {
          id: "scene-001",
          order: 1,
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-0001"],
            startQuote: "Hello",
            endQuote: "world",
          },
          sourceRange: { start: 0, end: 10 },
          text: "Hello world",
          summary: "Test",
          narrativeRole: "explanation",
          visualPlan: {
            decision: "speaker_only",
            rationale: "Test",
            preferredMedia: ["photo"],
            visualKeywords: ["test"],
          },
          search: { queries: [], candidates: [] },
          review: { kind: "pending" },
        },
      ],
    };
    await repository.save(projectDir, plannedProject);

    await expect(
      planProject(
        {
          projectRoot: projectDir,
          provider: "fixture",
          force: false,
          maxScenes: 20,
          dryRun: false,
        },
        repository,
        planner,
        clock,
        idGenerator,
      ),
    ).rejects.toThrow(ProjectAlreadyPlannedError);
  });

  it("supports --dry-run", async () => {
    const result = await planProject(
      {
        projectRoot: projectDir,
        provider: "fixture",
        force: false,
        maxScenes: 20,
        dryRun: true,
      },
      repository,
      planner,
      clock,
      idGenerator,
    );

    expect(result.status).toBe("planned");
    // Project should not have been saved (still has null generation)
    const savedProject = await repository.load(projectDir);
    expect(savedProject.generation).toBeNull();
  });

  it("throws on source hash mismatch", async () => {
    // Write wrong content to source file
    await fs.writeFile(path.join(projectDir, "script.md"), "Wrong content");

    await expect(
      planProject(
        {
          projectRoot: projectDir,
          provider: "fixture",
          force: false,
          maxScenes: 20,
          dryRun: false,
        },
        repository,
        planner,
        clock,
        idGenerator,
      ),
    ).rejects.toThrow(SourceDocumentError);
  });

  it("rejects planner output exceeding maxScenes", async () => {
    // Create a planner that returns more scenes than maxScenes
    const overflowingPlanner: ScriptPlanner = {
      providerId: "overflow",
      capabilities: {
        jsonMode: true,
        strictJsonSchema: false,
        toolCalling: false,
        usageMetrics: false,
      },
      plan: async (): Promise<PlannerRawResult> => {
        await Promise.resolve();
        const scenes = Array.from({ length: 5 }, (_, i) => ({
          sourceAnchor: {
            strategy: "source-blocks-v1" as const,
            sourceBlockIds: ["block-0001"],
            startQuote: "深度学习",
            endQuote: "分支",
          },
          summary: `Scene ${i + 1}`,
          narrativeRole: "explanation" as const,
          visualPlan: {
            decision: "speaker_only" as const,
            rationale: "Test",
            preferredMedia: ["photo"] as const,
            visualKeywords: ["test"],
          },
          queries: [],
        }));
        return { output: { scenes }, apiProtocol: "fixture" };
      },
    };

    await expect(
      planProject(
        {
          projectRoot: projectDir,
          provider: "fixture",
          force: false,
          maxScenes: 3,
          dryRun: false,
        },
        repository,
        overflowingPlanner,
        clock,
        idGenerator,
      ),
    ).rejects.toThrow(PlannerValidationError);
  });

  it("updates project.updatedAt after planning", async () => {
    const sourceBytes = new TextEncoder().encode(VALID_SCRIPT);
    const project = await createProject(repository, projectDir, sourceBytes);
    const originalUpdatedAt = project.project.updatedAt;

    // Use a custom clock that returns a later time
    const laterTime = new Date("2026-07-14T12:00:00.000Z");
    const futureClock: Clock = {
      now: () => {
        const d = new Date(laterTime);
        d.setMilliseconds(d.getMilliseconds() + 1);
        return d;
      },
    };

    await planProject(
      {
        projectRoot: projectDir,
        provider: "fixture",
        force: false,
        maxScenes: 20,
        dryRun: false,
      },
      repository,
      planner,
      futureClock,
      idGenerator,
    );

    const savedProject = await repository.load(projectDir);
    expect(savedProject.project.updatedAt).not.toBe(originalUpdatedAt);
    expect(savedProject.project.updatedAt > originalUpdatedAt).toBe(true);
  });
});
