/**
 * Scene and search schemas.
 *
 * These schemas define the structure of scenes within a project and the
 * search queries and asset candidates attached to each scene.
 *
 * The review state machine (selection/skip/local-asset) has been removed in
 * Phase 1's material-discovery redesign. Scenes now only carry LLM-suggested
 * metadata (summary, narrativeRole, visualPlan, queries) and on-demand search
 * results (asset + link candidates). There is no persisted review decision.
 *
 * No LLM, asset-provider SDK, network call, or filesystem access lives in
 * this file.
 */

import { z } from "zod";
import {
  IdSchema,
  NonEmptyTrimmedStringSchema,
  PositiveIntegerSchema,
  UtcDateTimeSchema,
} from "./schema-primitives.js";
import { AssetCandidateSchema } from "./asset-schema.js";

// ---------------------------------------------------------------------------
// Narrative and visual decision enums
// ---------------------------------------------------------------------------

/**
 * Narrative role of a scene in the overall story arc.
 */
export const NarrativeRoleSchema = z.enum([
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
]);
export type NarrativeRole = z.infer<typeof NarrativeRoleSchema>;

/**
 * High-level visual decision for a scene.
 *
 * `stock_asset` is retained as a value (the LLM still suggests it), but it no
 * longer gates search — any scene can be searched on demand.
 */
export const VisualDecisionSchema = z.enum([
  "speaker_only",
  "stock_asset",
  "title_card",
  "structured_graphic",
  "screen_capture",
  "user_asset",
  "none",
]);
export type VisualDecision = z.infer<typeof VisualDecisionSchema>;

// ---------------------------------------------------------------------------
// Source anchor
// ---------------------------------------------------------------------------

/**
 * Anchor that ties a scene to one or more source blocks.
 *
 * Rules:
 * - `sourceBlockIds` has at least one entry and internal unique IDs.
 * - Referenced block IDs must exist and be consecutive by block order.
 * - `startQuote` and `endQuote` are trimmed non-empty strings.
 * - M1 does not parse or validate quotes against raw text (M2 responsibility).
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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search query attached to a scene.
 */
export const SearchQuerySchema = z.strictObject({
  id: IdSchema,
  language: z.enum(["zh", "en"]),
  query: NonEmptyTrimmedStringSchema,
  purpose: NonEmptyTrimmedStringSchema,
  enabled: z.boolean(),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * Scene-level search state.
 *
 * `candidates` is a discriminated union (asset | link). `lastSearchedAt` is
 * present only when `candidates` is non-empty.
 */
export const SceneSearchSchema = z
  .strictObject({
    queries: z.array(SearchQuerySchema),
    candidates: z.array(AssetCandidateSchema),
    lastSearchedAt: UtcDateTimeSchema.optional(),
  })
  .superRefine((search, ctx) => {
    // lastSearchedAt must exist when candidates are present
    if (search.candidates.length > 0 && !search.lastSearchedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastSearchedAt"],
        message: "有 candidates 时必须有 lastSearchedAt",
      });
    }

    // Query IDs must be unique within this scene
    const queryIds = search.queries.map((q) => q.id);
    const uniqueQueryIds = new Set(queryIds);
    if (uniqueQueryIds.size !== queryIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queries"],
        message: "Scene 内 query ID 必须唯一",
      });
    }

    // Candidate IDs must be unique within this scene
    const candidateIds = search.candidates.map((c) => c.id);
    const uniqueCandidateIds = new Set(candidateIds);
    if (uniqueCandidateIds.size !== candidateIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "Scene 内 candidate ID 必须唯一",
      });
    }

    // Dedup keys must be unique within this scene, per kind:
    // - asset: [provider.id, mediaType, providerAssetId]
    // - link: [platform, searchUrl]
    const seenAssetKeys = new Set<string>();
    const seenLinkKeys = new Set<string>();
    for (const candidate of search.candidates) {
      if (candidate.kind === "asset") {
        const key = `${candidate.provider.id}\t${candidate.mediaType}\t${candidate.providerAssetId}`;
        if (seenAssetKeys.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["candidates"],
            message: "Scene 内 [provider.id, mediaType, providerAssetId] 必须唯一",
          });
        }
        seenAssetKeys.add(key);
      } else {
        const key = `${candidate.platform}\t${candidate.searchUrl}`;
        if (seenLinkKeys.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["candidates"],
            message: "Scene 内 [platform, searchUrl] 必须唯一",
          });
        }
        seenLinkKeys.add(key);
      }
    }

    // matchedQueryId must reference a query in this scene
    const validQueryIds = new Set(queryIds);
    for (const candidate of search.candidates) {
      if (!validQueryIds.has(candidate.matchedQueryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates", search.candidates.indexOf(candidate), "matchedQueryId"],
          message: "matchedQueryId 必须指向本 Scene 内的 query",
        });
      }
    }
  });

export type SceneSearch = z.infer<typeof SceneSearchSchema>;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * Scene within a project.
 *
 * Rules:
 * - `id` is unique within the project.
 * - `order` starts at 1 and is consecutive (no gaps).
 * - `sourceRange` uses `[start, end)` half-open interval in UTF-16 code units.
 * - `sourceAnchor.sourceBlockIds` references existing blocks in consecutive order.
 * - `sourceRange` falls within the coverage of the anchor's first and last blocks.
 * - `text` equals `source.rawText.slice(sourceRange.start, sourceRange.end)`.
 *
 * Note: `visualPlan.decision` no longer gates search. Any scene can be
 * searched on demand regardless of its decision value.
 */
export const SceneSchema = z.strictObject({
  id: IdSchema,
  order: PositiveIntegerSchema,
  sourceAnchor: SourceAnchorSchema,
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
  text: NonEmptyTrimmedStringSchema,
  summary: NonEmptyTrimmedStringSchema,
  narrativeRole: NarrativeRoleSchema,
  visualPlan: z.strictObject({
    decision: VisualDecisionSchema,
    rationale: NonEmptyTrimmedStringSchema,
    preferredMedia: z.array(z.enum(["photo", "video"])).min(1, "至少需要一个 preferred media"),
    visualKeywords: z.array(NonEmptyTrimmedStringSchema).min(1, "至少需要一个 visual keyword"),
  }),
  search: SceneSearchSchema,
});

export type Scene = z.infer<typeof SceneSchema>;
