/**
 * SearchCache port.
 *
 * Abstraction over asset search result caching.
 * The Application layer defines the contract; Infrastructure provides implementations.
 *
 * This file defines the canonical types and cache key policy. The infrastructure
 * implementation must not leak into the Application layer.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal asset search input for cache key computation.
 */
export interface CacheSearchInput {
  readonly queryId: string;
  readonly query: string;
  readonly language: "zh" | "en";
  readonly mediaTypes: ReadonlyArray<"photo" | "video">;
  readonly orientation: "portrait" | "landscape" | "square" | undefined;
  readonly perPage: number;
  readonly page: number;
  readonly sceneId: string;
}

/**
 * Provider warning.
 */
export interface CacheProviderWarning {
  readonly code: string;
  readonly message: string;
  readonly queryId?: string;
}

/**
 * Cache entry stored on disk or in memory.
 *
 * `response` stores the full normalized candidate objects, not just id/rank.
 * The Application layer validates cached candidates with AssetCandidateSchema
 * before using them.
 */
export interface SearchCacheEntry {
  readonly schemaVersion: "0.1";
  readonly providerId: string;
  readonly providerPolicyRevision: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly request: CacheSearchInput;
  readonly response: ReadonlyArray<Record<string, unknown>>;
  readonly warnings: ReadonlyArray<CacheProviderWarning>;
}

/**
 * Cache read result.
 */
export interface CacheReadResult {
  readonly hit: boolean;
  readonly entry?: SearchCacheEntry;
}

/**
 * SearchCache interface.
 */
export interface SearchCache {
  read(key: string): Promise<CacheReadResult>;
  write(key: string, entry: SearchCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FileSearchCacheOptions {
  readonly cacheDir: string;
  readonly ttlMs?: number;
}

// ---------------------------------------------------------------------------
// Cache Key Policy
// ---------------------------------------------------------------------------

/**
 * Computes SHA-256 hex digest of a string.
 */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Computes a deterministic cache key from the search input.
 */
export function computeCacheKey(input: CacheSearchInput): string {
  const canonical = JSON.stringify({
    qId: input.queryId,
    q: input.query,
    lang: input.language,
    mt: input.mediaTypes,
    orient: input.orientation,
    perPage: input.perPage,
    page: input.page,
    sceneId: input.sceneId,
  });
  return sha256Hex(canonical);
}

/**
 * Computes cache key including provider id and policy revision for
 * provider-specific caching.
 */
export function computeProviderCacheKey(
  input: CacheSearchInput,
  providerId: string,
  providerPolicyRevision: string,
): string {
  const baseKey = computeCacheKey(input);
  const combined = `${baseKey}:${providerId}:${providerPolicyRevision}`;
  return sha256Hex(combined);
}
