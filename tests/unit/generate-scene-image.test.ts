/**
 * Unit tests for the generateSceneImage use case and buildGenerationPrompt.
 *
 * Phase 2: AI image generation.
 *
 * Coverage:
 *  1.  buildGenerationPrompt: combines summary + first 3 keywords
 *  2.  buildGenerationPrompt: works with fewer than 3 keywords
 *  3.  buildGenerationPrompt: works with no keywords
 *  4.  Successfully appends generated candidate to empty candidates
 *  5.  Rank increments correctly with existing candidates
 *  6.  Updates lastSearchedAt
 *  7.  Updates project.updatedAt
 *  8.  repository.save is called exactly once
 *  9.  Saved object passes SpeechToSceneProjectSchema
 * 10.  Other scenes are not modified
 * 11.  Unknown sceneId throws SceneNotFoundError
 * 12.  Unplanned project throws ProjectNotPlannedError
 * 13.  Invalid input (empty prompt) throws ZodError
 * 14.  matchedQueryId uses first enabled query
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  generateSceneImage,
  buildGenerationPrompt,
  type GenerateSceneImageDeps,
} from "../../src/application/generate-scene-image.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type {
  ImageGenerator,
  ImageGenerateResult,
} from "../../src/application/ports/image-generator.js";
import type { GeneratedImageDownloader } from "../../src/application/ports/generated-image-downloader.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { SceneNotFoundError, ProjectNotPlannedError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-07-18T12:00:00.000Z");
const FIXED_ID = "gen-candidate-001";

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-gen-image-test",
      title: "Generate Image Test",
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
        summary: "A city skyline at sunset",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need stock photo",
          preferredMedia: ["photo"],
          visualKeywords: ["city", "sunset", "skyline", "urban"],
        },
        search: {
          queries: [
            {
              id: "q-001",
              language: "en",
              query: "city skyline",
              purpose: "main visual",
              enabled: true,
            },
            {
              id: "q-002",
              language: "zh",
              query: "城市日落",
              purpose: "alternate",
              enabled: false,
            },
          ],
          candidates: [],
        },
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
        summary: "A person working at a desk",
        narrativeRole: "conclusion",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Speaker only",
          preferredMedia: ["video"],
          visualKeywords: ["person", "desk"],
        },
        search: {
          queries: [],
          candidates: [],
        },
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

  constructor(project: SpeechToSceneProject) {
    this.project = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
  }

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return this.project !== null;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    this.loadCount++;
    if (!this.project) throw new Error("Project not found");
    return JSON.parse(JSON.stringify(this.project)) as SpeechToSceneProject;
  }
  async save(_projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
    this.savedProject = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
    this.project = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
  }
}

// ---------------------------------------------------------------------------
// Fake image generator
// ---------------------------------------------------------------------------

class FakeImageGenerator implements ImageGenerator {
  readonly providerId = "fake-image";
  readonly providerSnapshot = {
    id: "fake-image",
    name: "Fake Image Generator",
    homepageUrl: "https://example.com/fake",
    termsUrl: "https://example.com/fake/terms",
    policyRevision: "fake-policy-v1",
    termsCheckedAt: "2026-07-18T00:00:00.000Z",
  };
  generateWasCalled = false;
  lastInput: { prompt: string; aspectRatio: string; model?: string } | null = null;

  async generate(input: {
    prompt: string;
    aspectRatio: "9:16" | "16:9" | "1:1";
    model?: string;
  }): Promise<ImageGenerateResult> {
    await Promise.resolve();
    this.generateWasCalled = true;
    this.lastInput = input;
    const dims =
      input.aspectRatio === "9:16"
        ? { width: 1024, height: 1792 }
        : input.aspectRatio === "16:9"
          ? { width: 1792, height: 1024 }
          : { width: 1024, height: 1024 };
    return {
      imageUrl: "https://example.com/fake-generated.png",
      thumbnailUrl: "https://example.com/fake-generated.png",
      width: dims.width,
      height: dims.height,
      model: input.model ?? "fake-model-v1",
      providerSnapshot: this.providerSnapshot,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGenerationPrompt", () => {
  it("1. builds a production-ready portrait prompt from scene context", () => {
    const project = makeTestProject();
    const scene = project.scenes[0]!;
    const prompt = buildGenerationPrompt(scene);
    expect(prompt).toContain("A city skyline at sunset");
    expect(prompt).toContain("city, sunset, skyline");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("No text");
    expect(prompt.length).toBeLessThanOrEqual(512);
  });

  it("2. works with fewer than 3 keywords", () => {
    const project = makeTestProject();
    const scene = project.scenes[1]!; // has 2 keywords
    const prompt = buildGenerationPrompt(scene);
    expect(prompt).toContain("person, desk");
  });

  it("3. works with no keywords", () => {
    const project = makeTestProject();
    const scene = project.scenes[1]!;
    const modified = {
      ...scene,
      visualPlan: { ...scene.visualPlan, visualKeywords: [] },
    };
    const prompt = buildGenerationPrompt(modified);
    expect(prompt).toContain("A person working at a desk");
    expect(prompt).not.toContain("undefined");
  });

  it("limits generated prompts to the StepFun prompt boundary", () => {
    const scene = makeTestProject().scenes[0]!;
    const verbose = {
      ...scene,
      summary: "A".repeat(800),
      visualPlan: { ...scene.visualPlan, visualKeywords: ["B".repeat(300)] },
    };
    expect(buildGenerationPrompt(verbose)).toHaveLength(512);
  });
});

describe("generateSceneImage", () => {
  function makeDeps(project: SpeechToSceneProject): {
    deps: GenerateSceneImageDeps;
    repo: TestRepository;
    generator: FakeImageGenerator;
  } {
    const repo = new TestRepository(project);
    const generator = new FakeImageGenerator();
    const imageDownloader: GeneratedImageDownloader = {
      download: (_projectRoot: string, imageUrl: string) => Promise.resolve(imageUrl),
    };
    const deps: GenerateSceneImageDeps = {
      repository: repo,
      imageGenerator: generator,
      imageDownloader,
      serverPort: 3210,
      generateId: () => FIXED_ID,
      now: () => FIXED_NOW,
    };
    return { deps, repo, generator };
  }

  it("4. appends generated candidate to empty candidates", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.search.candidates).toHaveLength(1);
    expect(scene.search.candidates[0]!.kind).toBe("generated");
  });

  it("5. rank increments correctly with existing candidates", async () => {
    const project = makeTestProject();
    // Add an existing candidate with rank 5
    const scene = project.scenes[0]!;
    scene.search.candidates.push({
      kind: "asset",
      id: "existing-001",
      provider: {
        id: "pexels",
        name: "Pexels",
        homepageUrl: "https://www.pexels.com",
        termsUrl: "https://www.pexels.com/terms",
        policyRevision: "1.0.0",
        termsCheckedAt: "2026-07-13T10:00:00Z",
      },
      providerAssetId: "photo-123",
      mediaType: "photo",
      thumbnailUrl: "https://images.pexels.com/photos/123/thumb.jpg",
      sourcePageUrl: "https://www.pexels.com/photo/123",
      width: 1920,
      height: 1080,
      orientation: "landscape",
      creator: { name: "John" },
      rights: {
        status: "unknown",
        attributionRequired: false,
        commercialUse: "unclear",
        derivatives: "unclear",
        verifiedAt: "2026-07-13T10:00:00Z",
        evidence: {
          capturedAt: "2026-07-13T10:00:00Z",
          referenceUrl: "https://example.com",
          fields: {},
        },
      },
      retrievedAt: "2026-07-13T10:00:00Z",
      matchedQueryId: "q-001",
      rank: 5,
    });

    const { deps } = makeDeps(project);
    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const updatedScene = result.scenes.find((s) => s.id === "scene-001")!;
    const genCandidate = updatedScene.search.candidates.find((c) => c.kind === "generated")!;
    expect(genCandidate.rank).toBe(6);
  });

  it("6. updates lastSearchedAt", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    expect(scene.search.lastSearchedAt).toBe(FIXED_NOW.toISOString());
  });

  it("7. updates project.updatedAt", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    expect(result.project.updatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("8. repository.save is called exactly once", async () => {
    const project = makeTestProject();
    const { deps, repo } = makeDeps(project);

    await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    expect(repo.saveCount).toBe(1);
  });

  it("9. saved object passes SpeechToSceneProjectSchema", async () => {
    const project = makeTestProject();
    const { deps, repo } = makeDeps(project);

    await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    expect(repo.savedProject).not.toBeNull();
    expect(() => SpeechToSceneProjectSchema.parse(repo.savedProject)).not.toThrow();
  });

  it("10. other scenes are not modified", async () => {
    const project = makeTestProject();
    const originalScene2 = JSON.parse(
      JSON.stringify(project.scenes[1]),
    ) as SpeechToSceneProject["scenes"][number];
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const scene2 = result.scenes.find((s) => s.id === "scene-002")!;
    expect(scene2).toEqual(originalScene2);
  });

  it("11. unknown sceneId throws SceneNotFoundError", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    await expect(
      generateSceneImage(
        {
          projectRoot: "/proj",
          sceneId: "nonexistent-scene",
          prompt: "A beautiful city",
          aspectRatio: "9:16",
        },
        deps,
      ),
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("12. unplanned project throws ProjectNotPlannedError", async () => {
    const project = makeTestProject();
    // Remove generation to simulate unplanned project
    const unplanned = {
      ...project,
      generation: null,
      scenes: [],
    } as unknown as SpeechToSceneProject;
    const { deps } = makeDeps(unplanned);

    await expect(
      generateSceneImage(
        {
          projectRoot: "/proj",
          sceneId: "scene-001",
          prompt: "A beautiful city",
          aspectRatio: "9:16",
        },
        deps,
      ),
    ).rejects.toThrow(ProjectNotPlannedError);
  });

  it("13. invalid input (empty prompt) throws ZodError", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    await expect(
      generateSceneImage(
        {
          projectRoot: "/proj",
          sceneId: "scene-001",
          prompt: "   ",
          aspectRatio: "9:16",
        },
        deps,
      ),
    ).rejects.toThrow(z.ZodError);
  });

  it("14. matchedQueryId uses first enabled query", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    const genCandidate = scene.search.candidates.find((c) => c.kind === "generated")!;
    if (genCandidate.kind !== "generated") throw new Error("Expected generated candidate");
    // q-001 is the first enabled query
    expect(genCandidate.matchedQueryId).toBe("q-001");
  });

  it("15. generated candidate has correct orientation for 9:16", async () => {
    const project = makeTestProject();
    const { deps } = makeDeps(project);

    const result = await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "9:16",
      },
      deps,
    );

    const scene = result.scenes.find((s) => s.id === "scene-001")!;
    const genCandidate = scene.search.candidates.find((c) => c.kind === "generated")!;
    if (genCandidate.kind !== "generated") throw new Error("Expected generated candidate");
    expect(genCandidate.orientation).toBe("portrait");
    expect(genCandidate.width).toBe(1024);
    expect(genCandidate.height).toBe(1792);
  });

  it("16. imageGenerator.generate is called with correct input", async () => {
    const project = makeTestProject();
    const { deps, generator } = makeDeps(project);

    await generateSceneImage(
      {
        projectRoot: "/proj",
        sceneId: "scene-001",
        prompt: "A beautiful city",
        aspectRatio: "16:9",
      },
      deps,
    );

    expect(generator.generateWasCalled).toBe(true);
    expect(generator.lastInput).toEqual({
      prompt: "A beautiful city",
      aspectRatio: "16:9",
    });
  });
});
