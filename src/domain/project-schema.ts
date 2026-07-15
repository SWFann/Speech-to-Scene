/**
 * Top-level project schema and its constituent types.
 *
 * SpeechToSceneProject is the root persisted type. All other schemas in the
 * domain layer compose to form this structure.
 *
 * Rules:
 * - `generation === null` → `source.blocks` and `scenes` must be empty.
 * - `generation !== null` → `source.blocks` and `scenes` must be non-empty.
 * - `project.updatedAt >= project.createdAt`.
 * - Array order must match the `order` field of each element.
 */

import { z } from "zod";
import {
  IdSchema,
  NonEmptyTrimmedStringSchema,
  NonNegativeIntegerSchema,
  Sha256Schema,
  UtcDateTimeSchema,
} from "./schema-primitives.js";
import { SceneSchema } from "./scene-schema.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-exported for project-validation.ts
import type { Scene } from "./scene-schema.js";

// ---------------------------------------------------------------------------
// Source range (re-exported for convenience)
// ---------------------------------------------------------------------------

export type SourceRange = {
  start: number;
  end: number;
};

// ---------------------------------------------------------------------------
// GenerationMeta
// ---------------------------------------------------------------------------

export const GenerationMetaSchema = z.strictObject({
  plannerProvider: NonEmptyTrimmedStringSchema,
  apiProtocol: z.enum(["openai-compatible", "anthropic", "fixture"]).optional(),
  model: NonEmptyTrimmedStringSchema.optional(),
  promptVersion: NonEmptyTrimmedStringSchema,
  plannerOutputSchemaVersion: NonEmptyTrimmedStringSchema,
  sourceBlockVersion: NonEmptyTrimmedStringSchema,
  generatedAt: UtcDateTimeSchema,
});

export type GenerationMeta = z.infer<typeof GenerationMetaSchema>;

// ---------------------------------------------------------------------------
// SourceBlock
// ---------------------------------------------------------------------------

export const SourceBlockSchema = z.strictObject({
  id: IdSchema,
  order: z.number().int().positive(),
  kind: z.enum(["heading", "paragraph", "list_item", "blockquote", "code_block", "other"]),
  sourceRange: z
    .strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .superRefine((range, ctx) => {
      if (range.end <= range.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["end"],
          message: "end 必须大于 start",
        });
      }
    }),
});

export type SourceBlock = z.infer<typeof SourceBlockSchema>;

// ---------------------------------------------------------------------------
// SourceDocument
// ---------------------------------------------------------------------------

export const SourceDocumentSchema = z.strictObject({
  path: z.enum(["script.md", "script.txt"]),
  originalFileName: NonEmptyTrimmedStringSchema,
  sha256: Sha256Schema,
  encoding: z.literal("utf-8"),
  sizeBytes: NonNegativeIntegerSchema,
  textLengthUtf16: z.number().int().nonnegative(),
  offsetUnit: z.literal("utf16_code_unit"),
  blocks: z.array(SourceBlockSchema),
});

export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

// ---------------------------------------------------------------------------
// ProjectMeta
// ---------------------------------------------------------------------------

export const ProjectMetaSchema = z.strictObject({
  id: IdSchema,
  title: NonEmptyTrimmedStringSchema.superRefine((s, ctx) => {
    if (s.length > 200) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "title 最多 200 字符",
      });
    }
  }),
  createdAt: UtcDateTimeSchema,
  updatedAt: UtcDateTimeSchema,
  language: z.enum(["zh-CN", "en-US"]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  style: z.enum(["knowledge", "story", "commentary"]),
  assetUsePolicy: z.strictObject({
    intendedUse: z.enum(["commercial_capable", "noncommercial", "editorial"]),
    willModify: z.boolean(),
  }),
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

// ---------------------------------------------------------------------------
// SpeechToSceneProject
// ---------------------------------------------------------------------------

export const SpeechToSceneProjectSchema = z
  .strictObject({
    schemaVersion: z.literal("0.1"),
    project: ProjectMetaSchema,
    source: SourceDocumentSchema,
    generation: GenerationMetaSchema.nullable(),
    scenes: z.array(SceneSchema),
  })
  .superRefine((project, ctx) => {
    // Invariant: generation === null → blocks and scenes must be empty
    if (project.generation === null) {
      if (project.source.blocks.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source", "blocks"],
          message: "generation 为 null 时 source.blocks 必须为空",
        });
      }
      if (project.scenes.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes"],
          message: "generation 为 null 时 scenes 必须为空",
        });
      }
    }

    // Invariant: generation !== null → blocks and scenes must be non-empty
    if (project.generation !== null) {
      if (project.source.blocks.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source", "blocks"],
          message: "generation 非 null 时 source.blocks 必须非空",
        });
      }
      if (project.scenes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenes"],
          message: "generation 非 null 时 scenes 必须非空",
        });
      }
    }

    // Invariant: updatedAt >= createdAt
    const createdAt = new Date(project.project.createdAt).getTime();
    const updatedAt = new Date(project.project.updatedAt).getTime();
    if (isNaN(createdAt) || isNaN(updatedAt)) {
      // Invalid dates caught by UtcDateTimeSchema; skip here
      return;
    }
    if (updatedAt < createdAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["project", "updatedAt"],
        message: "updatedAt 必须大于等于 createdAt",
      });
    }
  });

export type SpeechToSceneProject = z.infer<typeof SpeechToSceneProjectSchema>;
