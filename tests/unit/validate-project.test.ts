/**
 * Unit tests for the validateProject use case.
 *
 * Phase 1 material-discovery redesign: the review state machine and local-asset
 * upload have been removed. Validation now checks:
 * 1. Source file exists and SHA-256 matches.
 * 2. Scene has candidates (warning if none).
 * 3. Asset-kind candidate metadata (creator, orientation).
 *
 * Tests for selected-candidate / local-asset validation have been removed
 * because those features no longer exist.
 */
import { afterEach, describe, expect, it } from "vitest";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateProject } from "../../src/application/validate-project.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import {
  SpeechToSceneProjectSchema,
  type SpeechToSceneProject,
} from "../../src/domain/project-schema.js";
import type { AssetCandidate } from "../../src/domain/asset-schema.js";
import { ProjectNotFoundError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  constructor(private readonly project: SpeechToSceneProject | null) {}

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return this.project !== null;
  }

  async create(): Promise<void> {
    await Promise.resolve();
  }

  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    if (this.project === null) {
      throw new ProjectNotFoundError(projectRoot);
    }
    return this.project;
  }

  async save(): Promise<void> {
    await Promise.resolve();
  }
}

const tempRoots: string[] = [];
const FIXED_NOW = "2026-07-13T10:00:00.000Z";

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-validate-"));
  tempRoots.push(root);
  return root;
}

function sha256(bytes: Uint8Array | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function makeCandidate(overrides: Partial<AssetCandidate> = {}): AssetCandidate {
  return {
    kind: "asset",
    id: "candidate-001",
    provider: {
      id: "fixture",
      name: "Fixture",
      homepageUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      policyRevision: "fixture-v1",
      termsCheckedAt: FIXED_NOW,
    },
    providerAssetId: "asset-001",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/thumb.jpg",
    sourcePageUrl: "https://example.com/source",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Fixture Creator" },
    rights: {
      status: "platform_license",
      licenseUrl: "https://example.com/terms",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/terms",
        fields: {},
      },
    },
    retrievedAt: FIXED_NOW,
    matchedQueryId: "query-001",
    rank: 1,
    ...overrides,
  } as AssetCandidate;
}

function makeProject(overrides: Partial<SpeechToSceneProject> = {}): SpeechToSceneProject {
  const script = "Hello world. This is a Speech-to-Scene validation fixture.";
  const base: SpeechToSceneProject = SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "project-validate",
      title: "Validate Project",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      language: "en-US",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: sha256(script),
      encoding: "utf-8",
      sizeBytes: Buffer.byteLength(script),
      textLengthUtf16: script.length,
      offsetUnit: "utf16_code_unit",
      blocks: [
        {
          id: "block-001",
          order: 1,
          kind: "paragraph",
          sourceRange: { start: 0, end: script.length },
        },
      ],
    },
    generation: {
      plannerProvider: "fixture",
      apiProtocol: "fixture",
      promptVersion: "v1",
      plannerOutputSchemaVersion: "v1",
      sourceBlockVersion: "v1",
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
          endQuote: "fixture.",
        },
        sourceRange: { start: 0, end: script.length },
        text: script,
        summary: "Validation fixture scene",
        narrativeRole: "hook",
        visualPlan: {
          decision: "none",
          rationale: "No visual needed",
          preferredMedia: ["photo"],
          visualKeywords: ["fixture"],
        },
        search: { queries: [], candidates: [] },
      },
    ],
  });

  return SpeechToSceneProjectSchema.parse({ ...base, ...overrides });
}

async function writeSource(
  projectRoot: string,
  project: SpeechToSceneProject,
  content?: string,
): Promise<void> {
  const bytes = content ?? "Hello world. This is a Speech-to-Scene validation fixture.";
  await fs.writeFile(path.join(projectRoot, project.source.path), bytes, "utf-8");
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------

describe("validateProject", () => {
  it("passes a complete project with matching source hash and candidates", async () => {
    const projectRoot = await makeTempRoot();
    const candidate = makeCandidate();
    const project = makeProject({
      scenes: [
        {
          ...makeProject().scenes[0]!,
          search: {
            queries: [
              {
                id: "query-001",
                language: "en",
                query: "city",
                purpose: "background",
                enabled: true,
              },
            ],
            candidates: [candidate],
            lastSearchedAt: FIXED_NOW,
          },
        },
      ],
    });
    await writeSource(projectRoot, project);

    const result = await validateProject(projectRoot, new InMemoryRepository(project));

    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("reports project_missing when the project cannot be loaded", async () => {
    const projectRoot = await makeTempRoot();

    const result = await validateProject(projectRoot, new InMemoryRepository(null));

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("project_missing");
  });

  it("reports missing source files", async () => {
    const projectRoot = await makeTempRoot();
    const project = makeProject();

    const result = await validateProject(projectRoot, new InMemoryRepository(project));

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("source_missing");
  });

  it("reports source hash mismatches", async () => {
    const projectRoot = await makeTempRoot();
    const project = makeProject();
    await writeSource(projectRoot, project, "changed source text");

    const result = await validateProject(projectRoot, new InMemoryRepository(project));

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("source_hash_mismatch");
  });

  it("warns when a scene has no candidates", async () => {
    const projectRoot = await makeTempRoot();
    const project = makeProject({
      scenes: [
        {
          ...makeProject().scenes[0]!,
          visualPlan: {
            decision: "stock_asset",
            rationale: "Needs visual support",
            preferredMedia: ["photo"],
            visualKeywords: ["city"],
          },
          search: {
            queries: [
              {
                id: "query-001",
                language: "en",
                query: "city",
                purpose: "background",
                enabled: true,
              },
            ],
            candidates: [],
          },
        },
      ],
    });
    await writeSource(projectRoot, project);

    const result = await validateProject(projectRoot, new InMemoryRepository(project));

    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain("scene_no_candidates");
  });

  it("warns when remote candidate attribution or orientation is suspicious", async () => {
    const projectRoot = await makeTempRoot();
    const candidate = makeCandidate({
      creator: { name: null },
      width: 1920,
      height: 1080,
      orientation: "landscape",
    });
    const project = makeProject({
      scenes: [
        {
          ...makeProject().scenes[0]!,
          search: {
            queries: [
              {
                id: "query-001",
                language: "en",
                query: "city",
                purpose: "background",
                enabled: true,
              },
            ],
            candidates: [candidate],
            lastSearchedAt: FIXED_NOW,
          },
        },
      ],
    });
    await writeSource(projectRoot, project);

    const result = await validateProject(projectRoot, new InMemoryRepository(project));

    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["candidate_missing_creator", "candidate_orientation_mismatch"]),
    );
  });
});
