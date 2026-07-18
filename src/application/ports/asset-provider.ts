/**
 * AssetProvider port.
 *
 * Abstraction over asset search providers (Pexels, fixture, etc.).
 * The Application layer defines the contract; Infrastructure provides implementations.
 *
 * The provider is responsible for:
 * - Receiving search queries with project context
 * - Returning normalized AssetCandidate[] with rights metadata
 * - Reporting non-fatal warnings
 *
 * The Application layer never calls a specific provider SDK or API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Project asset use policy.
 */
export interface AssetUsePolicy {
  readonly intendedUse: "commercial_capable" | "noncommercial" | "editorial";
  readonly willModify: boolean;
}

/**
 * Input for a single asset search query.
 */
export interface AssetSearchInput {
  readonly queryId: string;
  readonly query: string;
  readonly language: "zh" | "en";
  readonly mediaTypes: ReadonlyArray<"photo" | "video">;
  readonly orientation?: "portrait" | "landscape" | "square";
  readonly perPage: number;
  readonly page: number;
  readonly projectPolicy: AssetUsePolicy;
  readonly sceneId: string;
}

/**
 * Rights filtering result for a candidate.
 */
export interface RightsFilterResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Asset candidate returned by a provider (asset-kind only).
 *
 * Providers only ever return `kind: "asset"` candidates. Link-kind candidates
 * ("search link cards" for platforms without an API) are generated separately
 * by a `LinkSuggestionGenerator`, not by asset providers.
 *
 * Every candidate must satisfy the domain `AssetCandidateAssetSchema` after
 * mapping.
 */
export interface AssetCandidate {
  readonly kind: "asset";
  readonly id: string;
  readonly provider: AssetProviderSnapshot;
  readonly providerAssetId: string;
  readonly mediaType: "photo" | "video";
  readonly thumbnailUrl: string;
  readonly previewUrl?: string;
  readonly sourcePageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds?: number;
  readonly orientation: "portrait" | "landscape" | "square";
  readonly creator: {
    readonly name: string | null;
    readonly profileUrl?: string;
  };
  readonly rights: AssetRights;
  readonly retrievedAt: string;
  readonly matchedQueryId: string;
  readonly rank: number;
}

/**
 * Asset rights snapshot.
 */
export interface AssetRights {
  readonly status:
    | "public_domain"
    | "open_license"
    | "platform_license"
    | "editorial_only"
    | "no_known_copyright"
    | "unknown";
  readonly licenseCode?: string;
  readonly licenseName?: string;
  readonly licenseUrl?: string;
  readonly attributionRequired: boolean;
  readonly attributionText?: string;
  readonly commercialUse: "allowed" | "disallowed" | "unclear";
  readonly derivatives: "allowed" | "disallowed" | "share_alike" | "unclear";
  readonly restrictions: string[] | undefined;
  readonly rightsStatementUrl?: string;
  readonly verifiedAt: string;
  readonly evidence: RightsEvidence;
}

/**
 * Rights evidence snapshot.
 */
export interface RightsEvidence {
  readonly capturedAt: string;
  readonly referenceUrl: string;
  readonly fields: Record<string, string | number | boolean | null>;
}

/**
 * Provider snapshot at retrieval time.
 */
export interface AssetProviderSnapshot {
  readonly id: string;
  readonly name: string;
  readonly homepageUrl: string;
  readonly termsUrl: string;
  readonly policyRevision: string;
  readonly termsCheckedAt: string;
}

/**
 * Non-fatal warning from a provider.
 */
export interface ProviderWarning {
  readonly code: string;
  readonly message: string;
  readonly queryId?: string;
}

/**
 * Result of a provider search.
 */
export interface AssetSearchResult {
  readonly candidates: ReadonlyArray<AssetCandidate>;
  readonly warnings: ReadonlyArray<ProviderWarning>;
  readonly requestId?: string;
}

/**
 * Provider capabilities.
 */
export interface ProviderCapabilities {
  readonly photos: boolean;
  readonly videos: boolean;
  readonly orientationFilter: boolean;
}

/**
 * AssetProvider interface.
 *
 * Implementations must:
 * - Never return API keys or raw provider responses
 * - Map all external data through typed guards before returning
 * - Return candidates that satisfy the domain AssetCandidateSchema
 * - Never make real network calls in tests
 */
export interface AssetProvider {
  /** Stable provider identifier (e.g., "fixture", "pexels"). */
  readonly providerId: string;

  /** Provider snapshot at retrieval time. */
  readonly providerSnapshot: AssetProviderSnapshot;

  /** Provider capabilities. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Search for asset candidates.
   *
   * @param input - Search parameters
   * @returns Normalized candidates and warnings
   */
  search(input: AssetSearchInput): Promise<AssetSearchResult>;
}
