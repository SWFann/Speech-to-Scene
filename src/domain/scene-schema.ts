/**
 * Scene, search, and review decision schemas.
 *
 * These schemas define the structure of scenes within a project, the search
 * queries and asset candidates attached to each scene, and the user's review
 * decision (discriminated union).
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
  HttpsUrlSchema,
} from "./schema-primitives.js";
import { AssetCandidateSchema, AssetRightsSchema } from "./asset-schema.js";

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
 * `lastSearchedAt` is present only when `candidates` is non-empty.
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

    // [provider.id, mediaType, providerAssetId] must be unique within this scene
    const seenKeys = new Set<string>();
    for (const candidate of search.candidates) {
      const key = `${candidate.provider.id}\t${candidate.mediaType}\t${candidate.providerAssetId}`;
      if (seenKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates"],
          message: "Scene 内 [provider.id, mediaType, providerAssetId] 必须唯一",
        });
      }
      seenKeys.add(key);
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

    // stock_asset check deferred to SceneSchema (requires visualPlan context)
  });

export type SceneSearch = z.infer<typeof SceneSearchSchema>;

// ---------------------------------------------------------------------------
// Review decision (discriminated union)
// ---------------------------------------------------------------------------

/**
 * Audit snapshot of a selected candidate at the time of selection.
 *
 * The snapshot contains the full, immutable candidate data so that subsequent
 * changes to the candidates list do not invalidate the selection.
 */
export const SelectedCandidateSnapshotSchema = z.strictObject({
  selectedAt: UtcDateTimeSchema,
  candidate: AssetCandidateSchema,
  rightsAcknowledgement: z
    .strictObject({
      acknowledgedAt: UtcDateTimeSchema,
      warningCodes: z.array(NonEmptyTrimmedStringSchema),
    })
    .optional(),
});

export type SelectedCandidateSnapshot = z.infer<typeof SelectedCandidateSnapshotSchema>;

/**
 * Provenance of a local asset.
 *
 * Discriminated by `kind`:
 * - `selected_candidate`: asset was downloaded from a selected candidate.
 * - `user_owned`: asset was provided by the user.
 * - `external`: asset was imported from an external source with rights.
 */
const LocalAssetProvenanceSelectedSchema = z.strictObject({
  kind: z.literal("selected_candidate"),
  candidateId: IdSchema,
});

const LocalAssetProvenanceUserOwnedSchema = z.strictObject({
  kind: z.literal("user_owned"),
  note: NonEmptyTrimmedStringSchema.optional(),
});

const LocalAssetProvenanceExternalSchema = z.strictObject({
  kind: z.literal("external"),
  sourcePageUrl: HttpsUrlSchema.optional(),
  rights: AssetRightsSchema,
  note: NonEmptyTrimmedStringSchema.optional(),
});

/**
 * Local asset record.
 *
 * Rules:
 * - `relativePath` must be under `assets/<scene-id>/`.
 * - `mimeType` starts with `image/` or `video/`.
 * - `sizeBytes` is a positive integer.
 * - `sha256` is a valid SHA-256 hash.
 * - `importedAt` is a valid UTC datetime.
 */
export const LocalAssetSchema = z
  .strictObject({
    relativePath: z
      .string()
      .refine(
        (p) => /^assets\/[a-z0-9][a-z0-9._-]+\/.+$/.test(p),
        "relativePath 必须位于 assets/<scene-id>/ 下",
      ),
    originalFileName: NonEmptyTrimmedStringSchema,
    mimeType: z
      .string()
      .refine(
        (t) => t.startsWith("image/") || t.startsWith("video/"),
        "mimeType 必须以 image/ 或 video/ 开头",
      ),
    sizeBytes: PositiveIntegerSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "必须是 64 位小写十六进制 (SHA-256)"),
    importedAt: UtcDateTimeSchema,
    provenance: z.discriminatedUnion("kind", [
      LocalAssetProvenanceSelectedSchema,
      LocalAssetProvenanceUserOwnedSchema,
      LocalAssetProvenanceExternalSchema,
    ]),
  })
  .superRefine((asset) => {
    // selected_candidate provenance must have matching candidateId in selection
    // This cross-field check is deferred to project-validation.ts where the
    // full scene context is available.
    if (asset.provenance.kind === "selected_candidate") {
      // Basic structural check: candidateId must be a valid Id format
      // (IdSchema validation already applied via the provenance schema)
    }
  });

export type LocalAsset = z.infer<typeof LocalAssetSchema>;

/**
 * User's review decision for a scene.
 *
 * Discriminated by `kind`:
 * - `pending`: not yet reviewed.
 * - `skipped`: user chose to skip this scene.
 * - `candidate_selected`: user selected a candidate; may have local asset.
 * - `local_asset_attached`: user attached a local asset directly.
 */
export const ReviewDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pending"),
    note: NonEmptyTrimmedStringSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("skipped"),
    decidedAt: UtcDateTimeSchema,
    note: NonEmptyTrimmedStringSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("candidate_selected"),
    selection: SelectedCandidateSnapshotSchema,
    localAsset: LocalAssetSchema.optional(),
    note: NonEmptyTrimmedStringSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("local_asset_attached"),
    localAsset: LocalAssetSchema,
    note: NonEmptyTrimmedStringSchema.optional(),
  }),
]);

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

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
 */
export const SceneSchema = z
  .strictObject({
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
    review: ReviewDecisionSchema,
  })
  .superRefine((scene, ctx) => {
    // stock_asset scenes must have at least one enabled query
    if (scene.visualPlan.decision === "stock_asset") {
      const hasEnabledQuery = scene.search.queries.some((q) => q.enabled);
      if (!hasEnabledQuery) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["search", "queries"],
          message: "stock_asset scene 至少需要一个 enabled query",
        });
      }
    }
  });

export type Scene = z.infer<typeof SceneSchema>;
