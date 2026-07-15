/**
 * Planner output schema.
 *
 * Defines the structure that the planner must produce and that the anchor
 * resolver and planProject use case consume.
 *
 * This is a separate schema from the persisted `SceneSchema` to:
 * - Avoid sending the full project schema to the model
 * - Allow planning-specific validation before conversion
 * - Keep planner output format stable across schema versions
 */

import { z } from "zod";
import { IdSchema, NonEmptyTrimmedStringSchema } from "../domain/schema-primitives.js";

// ---------------------------------------------------------------------------
// Types (also exported from script-planner.ts, re-exported here for convenience)
// ---------------------------------------------------------------------------

export type VisualDecision =
  | "speaker_only"
  | "stock_asset"
  | "title_card"
  | "structured_graphic"
  | "screen_capture"
  | "user_asset"
  | "none";
export type NarrativeRole =
  | "hook"
  | "question"
  | "claim"
  | "explanation"
  | "example"
  | "comparison"
  | "process"
  | "data"
  | "story"
  | "emotion"
  | "transition"
  | "conclusion"
  | "call_to_action";
export type PreferredMedia = "photo" | "video";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Visual decision enum.
 */
const VisualDecisionValues = [
  "speaker_only",
  "stock_asset",
  "title_card",
  "structured_graphic",
  "screen_capture",
  "user_asset",
  "none",
] as const;
export const VisualDecisionSchema = z.enum(VisualDecisionValues);
export type VisualDecisionZod = z.infer<typeof VisualDecisionSchema>;

/**
 * Narrative role enum.
 */
const NarrativeRoleValues = [
  "hook",
  "question",
  "claim",
  "explanation",
  "example",
  "comparison",
  "process",
  "data",
  "story",
  "emotion",
  "transition",
  "conclusion",
  "call_to_action",
] as const;
export const NarrativeRoleSchema = z.enum(NarrativeRoleValues);
export type NarrativeRoleZod = z.infer<typeof NarrativeRoleSchema>;

/**
 * Search query for a stock asset.
 */
export const SearchQuerySchema = z.strictObject({
  language: z.enum(["zh", "en"]),
  query: NonEmptyTrimmedStringSchema.max(200, "查询文本不能超过 200 字符"),
  purpose: NonEmptyTrimmedStringSchema,
  enabled: z.boolean(),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * Visual plan for a scene.
 */
export const VisualPlanSchema = z.strictObject({
  decision: VisualDecisionSchema,
  rationale: NonEmptyTrimmedStringSchema,
  preferredMedia: z.array(z.enum(["photo", "video"])).min(1, "至少需要一个 preferred media"),
  visualKeywords: z.array(NonEmptyTrimmedStringSchema).min(1, "至少需要一个 visual keyword"),
});

export type VisualPlan = z.infer<typeof VisualPlanSchema>;

/**
 * Source anchor for a scene (references source blocks).
 */
export const SourceAnchorSchema = z.strictObject({
  strategy: z.literal("source-blocks-v1"),
  sourceBlockIds: z
    .array(IdSchema)
    .min(1, "至少需要一个 sourceBlockId")
    .superRefine((ids, ctx) => {
      const unique = new Set(ids);
      if (unique.size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: "sourceBlockIds 内部必须唯一",
        });
      }
    }),
  startQuote: NonEmptyTrimmedStringSchema,
  endQuote: NonEmptyTrimmedStringSchema,
});

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

/**
 * A single planned scene.
 */
export const PlannedSceneSchema = z.strictObject({
  sourceAnchor: SourceAnchorSchema,
  summary: NonEmptyTrimmedStringSchema,
  narrativeRole: NarrativeRoleSchema,
  visualPlan: VisualPlanSchema,
  queries: z.array(SearchQuerySchema),
});

export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

/**
 * Top-level planner output.
 */
export const PlannerOutputSchema = z.strictObject({
  scenes: z.array(PlannedSceneSchema).min(1, "至少需要一个场景").max(100, "场景数量不能超过 100"),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

/**
 * Validates that a planner output has at least one enabled query for each
 * stock_asset scene.
 */
export function validateStockAssetQueries(output: PlannerOutput): void {
  for (const scene of output.scenes) {
    if (scene.visualPlan.decision === "stock_asset") {
      const hasEnabledQuery = scene.queries.some((q) => q.enabled);
      if (!hasEnabledQuery) {
        throw new Error(`Scene with stock_asset decision must have at least one enabled query`);
      }
    }
  }
}
