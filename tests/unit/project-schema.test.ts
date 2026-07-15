import { describe, expect, it } from "vitest";

import { SpeechToSceneProjectSchema, ProjectMetaSchema } from "../../src/domain/project-schema.js";

// ---------------------------------------------------------------------------
// ProjectMetaSchema
// ---------------------------------------------------------------------------

describe("ProjectMetaSchema", () => {
  const validMeta = {
    id: "my-project",
    title: "My Demo Project",
    createdAt: "2026-07-13T10:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
    language: "zh-CN" as const,
    aspectRatio: "9:16" as const,
    style: "knowledge" as const,
    assetUsePolicy: {
      intendedUse: "commercial_capable" as const,
      willModify: true,
    },
  };

  it("accepts valid project meta", () => {
    expect(ProjectMetaSchema.parse(validMeta)).toEqual(validMeta);
  });

  it("accepts title exactly 200 chars", () => {
    expect(() =>
      ProjectMetaSchema.parse({
        ...validMeta,
        title: "a".repeat(200),
      }),
    ).not.toThrow();
  });

  it("rejects title longer than 200 chars", () => {
    expect(() =>
      ProjectMetaSchema.parse({
        ...validMeta,
        title: "a".repeat(201),
      }),
    ).toThrow();
  });

  it("rejects invalid language", () => {
    expect(() =>
      ProjectMetaSchema.parse({
        ...validMeta,
        language: "ja-JP",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SpeechToSceneProjectSchema
// ---------------------------------------------------------------------------

describe("SpeechToSceneProjectSchema", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const baseProject = () => ({
    schemaVersion: "0.1" as const,
    project: {
      id: "my-project",
      title: "My Demo Project",
      createdAt: "2026-07-13T10:00:00Z",
      updatedAt: "2026-07-13T12:00:00Z",
      language: "zh-CN" as const,
      aspectRatio: "9:16" as const,
      style: "knowledge" as const,
      assetUsePolicy: {
        intendedUse: "commercial_capable" as const,
        willModify: true,
      },
    },
    source: {
      path: "script.md" as const,
      originalFileName: "script.md",
      sha256: "a".repeat(64),
      encoding: "utf-8" as const,
      sizeBytes: 1024,
      textLengthUtf16: 500,
      offsetUnit: "utf16_code_unit" as const,
      blocks: [],
    },
    generation: null,
    scenes: [],
  });

  it("accepts valid project with generation null and empty arrays", () => {
    expect(SpeechToSceneProjectSchema.parse(baseProject())).toBeDefined();
  });

  it("rejects generation null with non-empty blocks", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        source: {
          ...baseProject().source,
          blocks: [
            {
              id: "block-001",
              order: 1,
              kind: "paragraph" as const,
              sourceRange: { start: 0, end: 100 },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects generation null with non-empty scenes", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        scenes: [
          {
            id: "scene-001",
            order: 1,
            sourceAnchor: {
              strategy: "source-blocks-v1" as const,
              sourceBlockIds: [],
              startQuote: "Hello",
              endQuote: "World",
            },
            sourceRange: { start: 0, end: 100 },
            text: "Hello world",
            summary: "A greeting",
            narrativeRole: "hook" as const,
            visualPlan: {
              decision: "none" as const,
              rationale: "No visual needed",
              preferredMedia: ["photo"],
              visualKeywords: ["greeting"],
            },
            search: { queries: [], candidates: [] },
            review: { kind: "pending" as const },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects generation non-null with empty blocks", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        generation: {
          plannerProvider: "deepseek",
          promptVersion: "1.0.0",
          plannerOutputSchemaVersion: "1.0.0",
          sourceBlockVersion: "1.0.0",
          generatedAt: "2026-07-13T12:00:00Z",
        },
        source: {
          ...baseProject().source,
          blocks: [],
        },
        scenes: [],
      }),
    ).toThrow();
  });

  it("rejects wrong schemaVersion", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        schemaVersion: "0.2",
      }),
    ).toThrow();
  });

  it("rejects invalid source path", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        source: {
          ...baseProject().source,
          path: "script.pdf",
        },
      }),
    ).toThrow();
  });

  it("rejects updatedAt before createdAt", () => {
    expect(() =>
      SpeechToSceneProjectSchema.parse({
        ...baseProject(),
        project: {
          ...baseProject().project,
          updatedAt: "2026-07-13T08:00:00Z",
        },
      }),
    ).toThrow();
  });
});
