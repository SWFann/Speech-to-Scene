/**
 * Asset candidate, provider snapshot, and rights schemas.
 *
 * These schemas define the structure of asset candidates returned by asset
 * providers, the provider's terms snapshot at retrieval time, and the
 * structured rights evidence.
 *
 * `AssetCandidate` is a discriminated union on `kind`:
 * - `asset`: a library result (Pexels/Pixabay/Unsplash/Openverse/fixture) with
 *   thumbnail, rights, dimensions, etc.
 * - `link`: a "search link card" for platforms without an API (Xiaohongshu,
 *   Douyin, Bilibili, YouTube) — just a platform name, keyword, and search URL.
 *
 * No asset-provider SDK, network call, or filesystem access lives in this
 * file. All URLs are HTTPS-only strings validated by HttpsUrlSchema.
 */

import { z } from "zod";
import {
IdSchema,
NonEmptyTrimmedStringSchema,
PositiveIntegerSchema,
UtcDateTimeSchema,
HttpsUrlSchema,
ImageUrlSchema,
} from "./schema-primitives.js";

// ---------------------------------------------------------------------------
// Provider snapshot
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of an asset provider's identity and terms at retrieval time.
 *
 * `policyRevision` is this project's internal mapping-rules version, not the
 * provider's official API version. It allows the project to detect when its
 * own rights-handling rules have changed.
 */
export const AssetProviderSnapshotSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyTrimmedStringSchema,
  homepageUrl: HttpsUrlSchema,
  termsUrl: HttpsUrlSchema,
  policyRevision: NonEmptyTrimmedStringSchema,
  termsCheckedAt: UtcDateTimeSchema,
});

export type AssetProviderSnapshot = z.infer<typeof AssetProviderSnapshotSchema>;

// ---------------------------------------------------------------------------
// Rights evidence
// ---------------------------------------------------------------------------

/**
 * Minimal structured evidence captured from the provider's terms at the time
 * of retrieval.
 *
 * `fields` stores the specific license terms as key/value pairs. Values are
 * limited to JSON-primitive types to prevent embedding large or complex
 * structures that would bloat the project file.
 */
const RightsEvidenceFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const RightsEvidenceSchema = z.strictObject({
  capturedAt: UtcDateTimeSchema,
  referenceUrl: HttpsUrlSchema,
  fields: z.record(z.string(), RightsEvidenceFieldValueSchema),
});

export type RightsEvidence = z.infer<typeof RightsEvidenceSchema>;

// ---------------------------------------------------------------------------
// Asset rights
// ---------------------------------------------------------------------------

/**
 * Structured asset rights with machine-readable status and supporting evidence.
 *
 * Cross-field rules (enforced via `.superRefine()`):
 * - `open_license` must have `licenseCode`, `licenseName`, and `licenseUrl`.
 * - `platform_license` must have `licenseUrl` (provider terms snapshot).
 * - `public_domain` must have license/rights evidence.
 * - `unknown` and `no_known_copyright` must NOT claim `commercialUse === "allowed"` or `derivatives === "allowed"`.
 * - `editorial_only` must NOT claim `commercialUse === "allowed"`.
 * - `attributionRequired === true` requires `attributionText`.
 */
export const AssetRightsSchema = z
  .strictObject({
    status: z.enum([
      "public_domain",
      "open_license",
      "platform_license",
      "editorial_only",
      "no_known_copyright",
      "unknown",
    ]),
    licenseCode: NonEmptyTrimmedStringSchema.optional(),
    licenseName: NonEmptyTrimmedStringSchema.optional(),
    licenseUrl: HttpsUrlSchema.optional(),
    attributionRequired: z.boolean(),
    attributionText: NonEmptyTrimmedStringSchema.optional(),
    commercialUse: z.enum(["allowed", "disallowed", "unclear"]),
    derivatives: z.enum(["allowed", "disallowed", "share_alike", "unclear"]),
    restrictions: z
      .array(NonEmptyTrimmedStringSchema)
      .max(20, "restrictions 最多 20 条")
      .optional(),
    rightsStatementUrl: HttpsUrlSchema.optional(),
    verifiedAt: UtcDateTimeSchema,
    evidence: RightsEvidenceSchema,
  })
  .superRefine((rights, ctx) => {
    // open_license requires identifying fields
    if (rights.status === "open_license") {
      if (!rights.licenseCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseCode"],
          message: "open_license 必须有 licenseCode",
        });
      }
      if (!rights.licenseName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseName"],
          message: "open_license 必须有 licenseName",
        });
      }
      if (!rights.licenseUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["licenseUrl"],
          message: "open_license 必须有 licenseUrl",
        });
      }
    }

    // platform_license requires terms URL
    if (rights.status === "platform_license" && !rights.licenseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["licenseUrl"],
        message: "platform_license 必须有 licenseUrl（Provider terms snapshot）",
      });
    }

    // public_domain requires evidence
    if (rights.status === "public_domain" && !rights.evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "public_domain 必须有 evidence",
      });
    }

    // unknown / no_known_copyright must not claim full commercial or derivative rights
    if (rights.status === "unknown" || rights.status === "no_known_copyright") {
      if (rights.commercialUse === "allowed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commercialUse"],
          message: `${rights.status} 不得声称 commercialUse 为 allowed`,
        });
      }
      if (rights.derivatives === "allowed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["derivatives"],
          message: `${rights.status} 不得声称 derivatives 为 allowed`,
        });
      }
    }

    // editorial_only must not claim commercial use allowed
    if (rights.status === "editorial_only" && rights.commercialUse === "allowed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["commercialUse"],
        message: "editorial_only 不得声称 commercialUse 为 allowed",
      });
    }

    // attributionRequired requires attributionText
    if (rights.attributionRequired && !rights.attributionText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attributionText"],
        message: "attributionRequired 为 true 时必须有 attributionText",
      });
    }
  });

export type AssetRights = z.infer<typeof AssetRightsSchema>;

// ---------------------------------------------------------------------------
// Link platform
// ---------------------------------------------------------------------------

/**
 * Platforms supported for "search link card" candidates.
 *
 * These platforms do not expose a public search API usable from the app, so
 * we only generate a search URL for the user to open manually.
 *
 * Categories:
 * - video_platform: 小红书, 抖音, B站, 快手, 西瓜视频, YouTube
 * - stock_site: 包图网, 千图网, 摄图网, 觅知网, 站酷, 花瓣网
 * - social_media: 微博, 知乎
 */
export const LinkPlatformSchema = z.enum([
  // Video platforms
  "xiaohongshu",
  "douyin",
  "bilibili",
  "kuaishou",
  "xigua",
  "youtube",
  // Stock material sites
  "baotu",
  "588ku",
  "699pic",
  "mizhi",
  "zcool",
  "huaban",
  // Social media
  "weibo",
  "zhihu",
]);
export type LinkPlatform = z.infer<typeof LinkPlatformSchema>;

/**
 * Category of a candidate, used for UI grouping/filtering.
 *
 * - `stock_library`: API-backed stock photo/video libraries (Pexels, Pixabay, etc.)
 * - `video_platform`: Video-centric social platforms (小红书, 抖音, B站, etc.)
 * - `stock_site`: Chinese stock material websites (包图网, 千图网, etc.)
 * - `social_media`: General social media (微博, 知乎)
 * - `ai_generated`: AI-generated images (StepFun, etc.)
 */
export const CandidateCategorySchema = z.enum([
  "stock_library",
  "video_platform",
  "stock_site",
  "social_media",
  "ai_generated",
]);
export type CandidateCategory = z.infer<typeof CandidateCategorySchema>;

/**
 * Maps a link platform to its category.
 */
export function platformToCategory(platform: LinkPlatform): CandidateCategory {
  switch (platform) {
    case "xiaohongshu":
    case "douyin":
    case "bilibili":
    case "kuaishou":
    case "xigua":
    case "youtube":
      return "video_platform";
    case "baotu":
    case "588ku":
    case "699pic":
    case "mizhi":
    case "zcool":
    case "huaban":
      return "stock_site";
    case "weibo":
    case "zhihu":
      return "social_media";
  }
}

// ---------------------------------------------------------------------------
// Asset candidate (discriminated union)
// ---------------------------------------------------------------------------

/**
 * Validates that orientation is consistent with width and height.
 */
function validateOrientation(width: number, height: number, orientation: string): boolean {
  if (width === height) return orientation === "square";
  if (width > height) return orientation === "landscape";
  return orientation === "portrait";
}

/**
 * Base schema for an `asset`-kind candidate (a library result).
 *
 * This is the existing candidate structure returned by asset providers
 * (Pexels/Pixabay/Unsplash/Openverse/fixture).
 *
 * Cross-field rules (enforced on the union via `.superRefine()`):
 * - `orientation` must be consistent with `width` and `height`.
 * - `photo` must not have `durationSeconds`; `video` must have positive `durationSeconds`.
 * - `creator.name` must be `null` when unknown, never a placeholder like `"Unknown"`.
 */
export const AssetCandidateAssetSchema = z.strictObject({
  kind: z.literal("asset"),
  id: IdSchema,
  provider: AssetProviderSnapshotSchema,
  providerAssetId: NonEmptyTrimmedStringSchema,
  mediaType: z.enum(["photo", "video"]),
  thumbnailUrl: HttpsUrlSchema,
  previewUrl: HttpsUrlSchema.optional(),
  sourcePageUrl: HttpsUrlSchema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  durationSeconds: z.number().positive().finite().optional(),
  orientation: z.enum(["portrait", "landscape", "square"]),
  creator: z.strictObject({
    name: z.union([z.string(), z.null()]),
    profileUrl: HttpsUrlSchema.optional(),
  }),
  rights: AssetRightsSchema,
  retrievedAt: UtcDateTimeSchema,
  matchedQueryId: IdSchema,
  rank: PositiveIntegerSchema,
  category: CandidateCategorySchema.optional(),
});

export type AssetCandidateAsset = z.infer<typeof AssetCandidateAssetSchema>;

/**
 * Schema for a `link`-kind candidate (a "search link card").
 *
 * Represents a platform (Xiaohongshu/Douyin/Bilibili/YouTube) search URL
 * generated from a scene's query/keywords. No image is attached — the user
 * opens the URL to browse results manually.
 */
export const AssetCandidateLinkSchema = z.strictObject({
  kind: z.literal("link"),
  id: IdSchema,
  platform: LinkPlatformSchema,
  searchUrl: HttpsUrlSchema,
  keyword: NonEmptyTrimmedStringSchema,
  retrievedAt: UtcDateTimeSchema,
  matchedQueryId: IdSchema,
  rank: PositiveIntegerSchema,
  category: CandidateCategorySchema.optional(),
});

export type AssetCandidateLink = z.infer<typeof AssetCandidateLinkSchema>;

/**
 * Schema for a `generated`-kind candidate (an AI-generated image).
 *
 * Represents an image generated by an AI model (e.g., StepFun text-to-image).
 * The `imageUrl` is typically a temporary URL provided by the generation
 * API. No rights/license metadata is attached — generated images have no
 * third-party copyright concerns, but the user is responsible for any
 * content-policy considerations.
 */
export const AssetCandidateGeneratedSchema = z.strictObject({
  kind: z.literal("generated"),
  id: IdSchema,
  provider: AssetProviderSnapshotSchema,
  prompt: NonEmptyTrimmedStringSchema,
  imageUrl: ImageUrlSchema,
  thumbnailUrl: ImageUrlSchema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  orientation: z.enum(["portrait", "landscape", "square"]),
  model: NonEmptyTrimmedStringSchema,
  generatedAt: UtcDateTimeSchema,
  matchedQueryId: IdSchema,
  rank: PositiveIntegerSchema,
  category: CandidateCategorySchema.optional(),
});

export type AssetCandidateGenerated = z.infer<typeof AssetCandidateGeneratedSchema>;

/**
 * Asset candidate returned by a search result.
 *
 * Discriminated union on `kind`:
 * - `asset`: a library result with thumbnail/rights/dimensions.
 * - `link`: a platform search-link card (no image).
 * - `generated`: an AI-generated image (text-to-image model output).
 *
 * Asset-kind cross-field rules (enforced via `.superRefine()`):
 * - `orientation` must be consistent with `width` and `height`.
 * - `photo` must not have `durationSeconds`; `video` must have positive `durationSeconds`.
 * - `creator.name` must be `null` when unknown, never a placeholder like `"Unknown"`.
 *
 * Generated-kind cross-field rules:
 * - `orientation` must be consistent with `width` and `height`.
 */
export const AssetCandidateSchema = z
  .discriminatedUnion("kind", [
    AssetCandidateAssetSchema,
    AssetCandidateLinkSchema,
    AssetCandidateGeneratedSchema,
  ])
  .superRefine((candidate, ctx) => {
    if (candidate.kind === "link") {
      return;
    }

    // Orientation must match dimensions (applies to both asset and generated)
    const width = candidate.width;
    const height = candidate.height;
    const orientation = candidate.orientation;
    if (!validateOrientation(width, height, orientation)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orientation"],
        message: "orientation 与 width/height 不一致",
      });
    }

    if (candidate.kind === "asset") {
      // Photo must not have duration; video must have positive duration
      if (candidate.mediaType === "photo" && candidate.durationSeconds !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationSeconds"],
          message: "photo 不允许 durationSeconds",
        });
      }
      if (
        candidate.mediaType === "video" &&
        (!candidate.durationSeconds || candidate.durationSeconds <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationSeconds"],
          message: "video 必须有正 durationSeconds",
        });
      }
    }
  });

export type AssetCandidate = z.infer<typeof AssetCandidateSchema>;
