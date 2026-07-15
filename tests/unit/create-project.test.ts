import { describe, expect, it, beforeEach, afterEach } from "vitest";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  InvalidArgumentError,
  SourceDocumentError,
  ProjectAlreadyExistsError,
  ProjectWriteError,
} from "../../src/shared/errors.js";
import { createProject } from "../../src/application/create-project.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import type { Clock } from "../../src/application/ports/clock.js";
import type { IdGenerator } from "../../src/application/ports/id-generator.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { ProjectScaffolder } from "../../src/application/ports/project-scaffolder.js";
import { FixedClock } from "../../tests/helpers/fixed-clock.js";
import { FixedIdGenerator } from "../../tests/helpers/fixed-id-generator.js";

// ---------------------------------------------------------------------------
// In-memory doubles (mocked repository and scaffolder)
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
    if (this.projects.has(projectRoot)) {
      throw new Error(`Project already exists at ${projectRoot}`);
    }
    this.projects.set(projectRoot, { root: projectRoot, project });
  }

  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) {
      throw new Error(`Project not found at ${projectRoot}`);
    }
    return entry.project;
  }

  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) {
      throw new Error(`Project not found at ${projectRoot}`);
    }
    this.projects.set(projectRoot, { ...entry, project });
  }
}

interface InMemoryScaffolderState {
  root: string | null;
  subdirsCreated: boolean;
  copiedSource: { name: string; bytes: Uint8Array } | null;
  sentinel: string | null;
}

class InMemoryScaffolder implements ProjectScaffolder {
  private state: InMemoryScaffolderState = {
    root: null,
    subdirsCreated: false,
    copiedSource: null,
    sentinel: null,
  };

  reset(): void {
    this.state = { root: null, subdirsCreated: false, copiedSource: null, sentinel: null };
  }

  getState(): Readonly<InMemoryScaffolderState> {
    return { ...this.state };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async createRoot(projectRoot: string): Promise<void> {
    this.state.root = projectRoot;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async createSubdirectories(): Promise<void> {
    this.state.subdirsCreated = true;
  }

  async copySourceDocument(
    _projectRoot: string,
    sourceBytes: Uint8Array,
    sourceFileName: string,
  ): Promise<string> {
    await Promise.resolve();
    this.state.copiedSource = { name: sourceFileName, bytes: sourceBytes };
    return sourceFileName;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async writeSentinel(_projectRoot: string, token: string): Promise<void> {
    this.state.sentinel = token;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async removeSentinel(): Promise<void> {
    this.state.sentinel = null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async checkSentinel(_projectRoot: string, token: string): Promise<boolean> {
    return this.state.sentinel === token;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async hasAnySentinel(): Promise<boolean> {
    return this.state.sentinel !== null;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SCRIPT = "# 深度学习简介\n\n深度学习是机器学习的一个分支。\n";

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe("createProject", () => {
  let tempDir: string;
  let scriptPath: string;
  let projectDir: string;
  let clock: Clock;
  let idGenerator: IdGenerator;
  let repository: InMemoryRepository;
  let scaffolder: InMemoryScaffolder;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-test-"));
    scriptPath = path.join(tempDir, "script.md");
    await fs.writeFile(scriptPath, VALID_SCRIPT, "utf-8");
    projectDir = path.join(tempDir, "my-project");

    clock = new FixedClock();
    idGenerator = new FixedIdGenerator();
    repository = new InMemoryRepository();
    scaffolder = new InMemoryScaffolder();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  function makeInput(overrides?: {
    projectDirectory?: string;
    scriptPath?: string;
    title?: string;
  }): {
    projectDirectory: string;
    scriptPath: string;
    title: string;
    language: "zh-CN";
    aspectRatio: "9:16";
    style: "knowledge";
    intendedUse: "commercial_capable";
    willModify: boolean;
  } {
    return {
      projectDirectory: overrides?.projectDirectory ?? projectDir,
      scriptPath: overrides?.scriptPath ?? scriptPath,
      title: overrides?.title ?? "My Test Project",
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      intendedUse: "commercial_capable",
      willModify: true,
    };
  }

  // --- Valid input ---

  it("returns a created result with correct fields", async () => {
    const result = await createProject(makeInput(), clock, idGenerator, repository, scaffolder);

    expect(result.status).toBe("created");
    expect(result.projectId).toBeDefined();
    expect(result.title).toBe("My Test Project");
    expect(result.projectRoot).toBe(projectDir);
    expect(result.scriptPath).toBe(path.join(projectDir, "script.md"));
    expect(result.createdAt).toBe("2026-07-13T10:00:00.000Z");
  });

  it("copies source bytes to the scaffolder", async () => {
    await createProject(makeInput(), clock, idGenerator, repository, scaffolder);

    const state = scaffolder.getState();
    expect(state.copiedSource).not.toBeNull();
    expect(state.copiedSource!.name).toBe("script.md");
    expect(state.copiedSource!.bytes.length).toBeGreaterThan(0);
  });

  it("creates project in repository", async () => {
    await createProject(makeInput(), clock, idGenerator, repository, scaffolder);

    expect(await repository.exists(projectDir)).toBe(true);
  });

  // --- Sentinel ---

  it("writes and then removes sentinel", async () => {
    await createProject(makeInput(), clock, idGenerator, repository, scaffolder);

    const state = scaffolder.getState();
    expect(state.sentinel).toBeNull();
  });

  // --- Input validation ---

  it("throws InvalidArgumentError when project directory is empty", async () => {
    await expect(
      createProject(
        makeInput({ projectDirectory: "" }),
        clock,
        idGenerator,
        repository,
        scaffolder,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws InvalidArgumentError when script path is empty", async () => {
    await expect(
      createProject(makeInput({ scriptPath: "" }), clock, idGenerator, repository, scaffolder),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("throws SourceDocumentError when script file does not exist", async () => {
    await expect(
      createProject(
        makeInput({ scriptPath: "/nonexistent/path/script.md" }),
        clock,
        idGenerator,
        repository,
        scaffolder,
      ),
    ).rejects.toThrow(SourceDocumentError);
  });

  // --- Duplicate detection ---

  it("throws ProjectAlreadyExistsError when project directory already exists", async () => {
    await repository.create(projectDir, {
      schemaVersion: "0.1",
      project: {
        id: "existing",
        title: "Existing",
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
        sizeBytes: 0,
        textLengthUtf16: 0,
        offsetUnit: "utf16_code_unit",
        blocks: [],
      },
      generation: null,
      scenes: [],
    });

    await expect(
      createProject(makeInput(), clock, idGenerator, repository, scaffolder),
    ).rejects.toThrow(ProjectAlreadyExistsError);
  });

  // --- Cleanup on failure ---

  it("wraps failure in ProjectWriteError and calls cleanup", async () => {
    const failingRepository: ProjectRepository = {
      exists: async () => {
        await Promise.resolve();
        return false;
      },
      create: async () => {
        await Promise.resolve();
        throw new Error("Simulated repository failure");
      },
      load: async () => {
        await Promise.resolve();
        return { schemaVersion: "0.1" } as unknown as SpeechToSceneProject;
      },
      save: async () => {
        await Promise.resolve();
      },
    };

    await expect(
      createProject(makeInput(), clock, idGenerator, failingRepository, scaffolder),
    ).rejects.toThrow(ProjectWriteError);

    const state = scaffolder.getState();
    expect(state.sentinel).not.toBeNull();
    expect(state.root).toBe(projectDir);
  });
});
