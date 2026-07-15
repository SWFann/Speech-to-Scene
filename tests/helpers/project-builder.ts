import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// ProjectBuilder
// ---------------------------------------------------------------------------

export interface ProjectBuilderOpts {
  id?: string;
  title?: string;
  language?: string;
  aspectRatio?: string;
  style?: string;
  textLengthUtf16?: number;
  blocks?: Array<{
    id: string;
    order: number;
    kind: string;
    sourceRange: { start: number; end: number };
  }>;
  scenes?: Array<{
    id: string;
    status: string;
    order: number;
    title: string;
    durationSec?: number;
    sourceAnchor: {
      strategy: string;
      sourceBlockIds: string[];
      startQuote: string;
      endQuote: string;
    };
    sourceRange: { start: number; end: number };
    text?: string;
    lines?: Array<{
      id: string;
      sceneId: string;
      order: number;
      text: string;
      syncRefs?: unknown[];
      assetRefs?: unknown[];
      background?: unknown;
    }>;
    assetCandidates?: unknown[];
    finalAssets?: unknown[];
  }>;
  generation?: {
    id: string;
    createdAt: string;
    style: string;
    scenes: unknown[];
    reviewBoard: { items: unknown[] };
  };
}

const DEFAULT_BLOCKS = [
  {
    id: "block-00000001",
    order: 1,
    kind: "paragraph",
    sourceRange: { start: 0, end: 25 },
  },
];

const DEFAULT_SCENES = [
  {
    id: "scene-00000001",
    status: "draft",
    order: 1,
    title: "Scene One",
    durationSec: 5,
    sourceAnchor: {
      strategy: "source-blocks-v1",
      sourceBlockIds: ["block-00000001"],
      startQuote: "Hello",
      endQuote: "here.",
    },
    sourceRange: { start: 0, end: 25 },
    text: "Hello world content here.",
    lines: [
      {
        id: "line-00000001",
        sceneId: "scene-00000001",
        order: 0,
        text: "Hello world content here.",
        syncRefs: [],
        assetRefs: [],
        background: null,
      },
    ],
    assetCandidates: [],
    finalAssets: [],
  },
];

export function buildProject(opts: ProjectBuilderOpts = {}): SpeechToSceneProject {
  const textLength = opts.textLengthUtf16 ?? 25;

  const project = {
    schemaVersion: "0.1" as const,
    project: {
      id: opts.id ?? "project-11111111-1111-1111-1111-111111111111",
      title: opts.title ?? "Test Project",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z",
      language: opts.language ?? "zh-CN",
      aspectRatio: opts.aspectRatio ?? "9:16",
      style: opts.style ?? "knowledge",
      assetUsePolicy: {
        intendedUse: "commercial_capable" as const,
        willModify: true,
      },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: "a".repeat(64),
      encoding: "utf-8",
      sizeBytes: 50,
      textLengthUtf16: textLength,
      offsetUnit: "utf16_code_unit" as const,
      blocks: opts.blocks ?? DEFAULT_BLOCKS,
    },
    generation: opts.generation ?? null,
    scenes: opts.scenes ?? DEFAULT_SCENES,
  };

  return SpeechToSceneProjectSchema.parse(project);
}
