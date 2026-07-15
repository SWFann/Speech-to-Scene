/**
 * Asset source catalog entry and license policy schemas.
 *
 * These schemas define the metadata for registered asset providers and the
 * machine-readable license policies that govern their use.
 *
 * M1 only freezes the contracts; the actual catalog population is deferred
 * to M6. No YAML parsing, no network access, no third-party SDK.
 */

import { z } from "zod";
import { IdSchema, NonEmptyTrimmedStringSchema, UtcDateTimeSchema } from "./schema-primitives.js";

// ---------------------------------------------------------------------------
// License policy
// ---------------------------------------------------------------------------

/**
 * Allow policy: the asset is cleared for the stated use case.
 */
const LicensePolicyAllowSchema = z.strictObject({
  kind: z.literal("allow"),
  message: NonEmptyTrimmedStringSchema,
});

/**
 * Warn policy: the asset is usable but carries a warning.
 */
const LicensePolicyWarnSchema = z.strictObject({
  kind: z.literal("warn"),
  message: NonEmptyTrimmedStringSchema,
});

/**
 * Reject policy: the asset must not be used.
 */
const LicensePolicyRejectSchema = z.strictObject({
  kind: z.literal("reject"),
  message: NonEmptyTrimmedStringSchema,
});

/**
 * Machine-readable license policy.
 *
 * Discriminated by `kind`. Each variant carries an actionable `message`
 * that can be surfaced to the user or used by filtering logic.
 */
export const LicensePolicySchema = z.discriminatedUnion("kind", [
  LicensePolicyAllowSchema,
  LicensePolicyWarnSchema,
  LicensePolicyRejectSchema,
]);

export type LicensePolicy = z.infer<typeof LicensePolicySchema>;

// ---------------------------------------------------------------------------
// Asset source catalog entry
// ---------------------------------------------------------------------------

/**
 * Supported media types for asset sources.
 */
export const MediaTypeSchema = z.enum(["image", "video", "audio", "illustration", "3d"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/**
 * Supported access methods for asset sources.
 */
export const AccessMethodSchema = z.enum(["api", "manual", "iiif", "bulk"]);
export type AccessMethod = z.infer<typeof AccessMethodSchema>;

/**
 * License model for asset sources.
 */
export const LicenseModelSchema = z.enum(["single", "per_item", "mixed"]);
export type LicenseModel = z.infer<typeof LicenseModelSchema>;

/**
 * Entry in the asset source catalog.
 *
 * Each entry describes a provider's capabilities, access requirements,
 * and licensing terms at a high level.
 */
export const AssetSourceCatalogEntrySchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyTrimmedStringSchema,
  homepage: z
    .string()
    .url("必须是有效 URL")
    .refine((url) => url.startsWith("https://"), "必须使用 HTTPS 协议"),
  mediaTypes: z.array(MediaTypeSchema).min(1, "至少需要一个 media type"),
  access: z.array(AccessMethodSchema).min(1, "至少需要一个 access method"),
  apiDocs: z
    .string()
    .url("必须是有效 URL")
    .refine((url) => url.startsWith("https://"), "必须使用 HTTPS 协议")
    .optional(),
  apiKeyRequired: z.boolean(),
  licenseModel: LicenseModelSchema,
  commercialFilter: z.boolean(),
  derivativeFilter: z.boolean(),
  attributionMetadata: z.boolean(),
  autoDownloadPolicy: z.enum(["forbidden", "review_required", "allowed_by_terms"]),
  termsUrl: z
    .string()
    .url("必须是有效 URL")
    .refine((url) => url.startsWith("https://"), "必须使用 HTTPS 协议"),
  lastVerifiedAt: UtcDateTimeSchema,
  riskNotes: z.array(NonEmptyTrimmedStringSchema),
});

export type AssetSourceCatalogEntry = z.infer<typeof AssetSourceCatalogEntrySchema>;
