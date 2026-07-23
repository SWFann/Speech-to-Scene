/**
 * Openverse asset provider implementation.
 *
 * Maps Openverse API responses to the AssetCandidate type. Openverse aggregates
 * CC-licensed content from many sources. No API key is required (the field is
 * kept in Settings for future policy changes).
 *
 * No Openverse types leak outside this package.
 */

import type {
  AssetProvider,
  AssetSearchInput,
  AssetSearchResult,
  AssetCandidate,
  AssetRights,
  AssetProviderSnapshot,
  ProviderCapabilities,
  ProviderWarning,
} from "../../application/ports/asset-provider.js";
import { AppError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENVERSE_PROVIDER_ID = "openverse";
const OPENVERSE_POLICY_REVISION = "openverse-policy-2026-07-rights-v2";
const OPENVERSE_TERMS_URL = "https://creativecommons.org/about/cclicenses/";
const OPENVERSE_BASE_URL = "https://api.openverse.org/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const ALL_SUPPORTED_LICENSES = [
  "cc0",
  "pdm",
  "by",
  "by-sa",
  "by-nd",
  "by-nc",
  "by-nc-sa",
  "by-nc-nd",
] as const;

const OPENVERSE_SNAPSHOT: AssetProviderSnapshot = {
  id: OPENVERSE_PROVIDER_ID,
  name: "Openverse",
  homepageUrl: "https://openverse.org",
  termsUrl: OPENVERSE_TERMS_URL,
  policyRevision: OPENVERSE_POLICY_REVISION,
  termsCheckedAt: "2026-07-01T00:00:00.000Z",
};

const OPENVERSE_CAPABILITIES: ProviderCapabilities = {
  photos: true,
  videos: false,
  orientationFilter: false,
};

// ---------------------------------------------------------------------------
// HTTP client interface
// ---------------------------------------------------------------------------

export interface HttpGetClient {
  get<T>(url: string, options?: { signal?: AbortSignal }): Promise<T>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OpenverseApiError extends AppError {
  constructor(message: string, cause?: Error) {
    const params: {
      code: string;
      message: string;
      exitCode: number;
      userHint: string;
      cause?: Error;
      retryable?: boolean;
    } = {
      code: "openverse_api_error",
      message,
      exitCode: 1,
      userHint: "检查 Openverse API 配置和网络连接",
      retryable: true,
    };
    if (cause) {
      params.cause = cause;
    }
    super(params);
  }
}

// ---------------------------------------------------------------------------
// Response types (raw Openverse API shapes)
// ---------------------------------------------------------------------------

interface OpenverseSearchResponse {
  readonly result_count: number;
  readonly page_count: number;
  readonly results: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly url: string | null;
    readonly creator: string | null;
    readonly creator_url: string | null;
    readonly foreign_landing_url: string | null;
    readonly thumbnail: string | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly license: string;
    readonly license_version: string;
    readonly license_url: string | null;
    readonly attribution: string | null;
  }>;
}

interface OpenverseLicenseMapping {
  readonly status: AssetRights["status"];
  readonly attributionRequired: boolean;
  readonly commercialUse: AssetRights["commercialUse"];
  readonly derivatives: AssetRights["derivatives"];
  readonly restrictions: string[];
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

class DefaultOpenverseHttpClient implements HttpGetClient {
  async get<T>(url: string, options?: { signal?: AbortSignal }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      if (options?.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new OpenverseApiError(`Openverse API returned ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof OpenverseApiError) {
        throw error;
      }
      throw new OpenverseApiError(
        error instanceof Error ? error.message : "Openverse request failed",
        error instanceof Error ? error : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface OpenverseAssetProviderOptions {
  readonly baseUrl?: string;
  readonly httpClient?: HttpGetClient;
}

export class OpenverseAssetProvider implements AssetProvider {
  readonly providerId = OPENVERSE_PROVIDER_ID;
  readonly providerSnapshot = OPENVERSE_SNAPSHOT;
  readonly capabilities = OPENVERSE_CAPABILITIES;

  private readonly baseUrl: string;
  private readonly httpClient: HttpGetClient;

  constructor(options: OpenverseAssetProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? OPENVERSE_BASE_URL;
    this.httpClient = options.httpClient ?? new DefaultOpenverseHttpClient();
  }

  async search(input: AssetSearchInput): Promise<AssetSearchResult> {
    const candidates: AssetCandidate[] = [];
    const warnings: ProviderWarning[] = [];

    if (!input.mediaTypes.includes("photo")) {
      return { candidates, warnings };
    }

    try {
      const photoCandidates = await this.searchPhotos(input);
      candidates.push(...photoCandidates);
    } catch (error) {
      if (error instanceof OpenverseApiError) {
        warnings.push({
          code: "openverse_photo_search_failed",
          message: error.message,
          queryId: input.queryId,
        });
      } else {
        warnings.push({
          code: "openverse_photo_search_failed",
          message: error instanceof Error ? error.message : "unknown error",
          queryId: input.queryId,
        });
      }
    }

    return { candidates, warnings };
  }

  private async searchPhotos(input: AssetSearchInput): Promise<AssetCandidate[]> {
    const policyFilter = this.mapPolicyToApiFilter(input.projectPolicy);
    const params = new URLSearchParams({
      q: input.query,
      page_size: String(Math.min(input.perPage, 20)),
      page: String(input.page),
      license_type: policyFilter.licenseType,
      license: policyFilter.licenses.join(","),
      mature: "false",
    });

    const url = `${this.baseUrl}/images/?${params.toString()}`;
    const response = await this.httpClient.get<OpenverseSearchResponse>(url);

    const now = new Date().toISOString();

    return response.results
      .filter(
        (result) =>
          result.thumbnail !== null &&
          result.url !== null &&
          result.width !== null &&
          result.height !== null &&
          result.width > 1 &&
          result.height > 1,
      )
      .flatMap((result, index) => {
        const candidate = this.mapPhoto(result, input, index + 1, now);
        return candidate ? [candidate] : [];
      });
  }

  private mapPhoto(
    result: OpenverseSearchResponse["results"][number],
    input: AssetSearchInput,
    rank: number,
    now: string,
  ): AssetCandidate | null {
    const width = result.width!;
    const height = result.height!;
    const orientation = this.inferOrientation(width, height);
    const sourcePageUrl = this.ensureHttps(result.foreign_landing_url ?? result.url!);
    const licenseUrl = result.license_url ?? undefined;
    const attribution = result.attribution ?? result.creator ?? undefined;
    const licenseCode = result.license.trim().toLowerCase();
    const license = this.mapLicense(licenseCode);

    if (
      (license.attributionRequired && !attribution) ||
      (license.status === "open_license" && !licenseUrl)
    ) {
      return null;
    }

    return {
      kind: "asset" as const,
      id: `${OPENVERSE_PROVIDER_ID}-photo-${result.id}-${rank}`,
      provider: OPENVERSE_SNAPSHOT,
      providerAssetId: result.id,
      mediaType: "photo",
      thumbnailUrl: this.ensureHttps(result.thumbnail!),
      sourcePageUrl,
      width: width > 0 ? width : 1,
      height: height > 0 ? height : 1,
      orientation,
      creator: {
        name: result.creator,
        ...(result.creator_url !== null ? { profileUrl: result.creator_url } : {}),
      },
      rights: {
        status: license.status,
        licenseCode,
        licenseName: this.formatLicenseName(licenseCode, result.license_version),
        ...(licenseUrl ? { licenseUrl } : {}),
        attributionRequired: license.attributionRequired,
        ...(attribution ? { attributionText: attribution } : {}),
        commercialUse: license.commercialUse,
        derivatives: license.derivatives,
        restrictions: license.restrictions,
        verifiedAt: now,
        evidence: {
          capturedAt: now,
          referenceUrl: licenseUrl ?? sourcePageUrl,
          fields: {
            policyRevision: OPENVERSE_POLICY_REVISION,
            source: "openverse_api",
            photoId: result.id,
            license: licenseCode,
            licenseVersion: result.license_version,
          },
        },
      },
      retrievedAt: now,
      matchedQueryId: input.queryId,
      rank,
    };
  }

  private mapPolicyToApiFilter(policy: AssetSearchInput["projectPolicy"]): {
    readonly licenseType: string;
    readonly licenses: readonly string[];
  } {
    if (policy.intendedUse === "commercial_capable") {
      return policy.willModify
        ? {
            licenseType: "commercial,modification",
            licenses: ["cc0", "pdm", "by", "by-sa"],
          }
        : {
            licenseType: "commercial",
            licenses: ["cc0", "pdm", "by", "by-sa", "by-nd"],
          };
    }

    if (policy.willModify) {
      return {
        licenseType: "modification",
        licenses: ["cc0", "pdm", "by", "by-sa", "by-nc", "by-nc-sa"],
      };
    }

    return {
      licenseType: "all",
      licenses: ALL_SUPPORTED_LICENSES,
    };
  }

  private mapLicense(licenseCode: string): OpenverseLicenseMapping {
    switch (licenseCode) {
      case "cc0":
      case "pdm":
        return {
          status: "public_domain",
          attributionRequired: false,
          commercialUse: "allowed",
          derivatives: "allowed",
          restrictions: [],
        };
      case "by":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "allowed",
          derivatives: "allowed",
          restrictions: [],
        };
      case "by-sa":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "allowed",
          derivatives: "share_alike",
          restrictions: ["share_alike"],
        };
      case "by-nc":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "disallowed",
          derivatives: "allowed",
          restrictions: ["noncommercial_only"],
        };
      case "by-nc-sa":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "disallowed",
          derivatives: "share_alike",
          restrictions: ["noncommercial_only", "share_alike"],
        };
      case "by-nd":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "allowed",
          derivatives: "disallowed",
          restrictions: ["no_derivatives"],
        };
      case "by-nc-nd":
        return {
          status: "open_license",
          attributionRequired: true,
          commercialUse: "disallowed",
          derivatives: "disallowed",
          restrictions: ["noncommercial_only", "no_derivatives"],
        };
      default:
        return {
          status: "unknown",
          attributionRequired: true,
          commercialUse: "unclear",
          derivatives: "unclear",
          restrictions: ["verify_license"],
        };
    }
  }

  private formatLicenseName(licenseCode: string, version: string): string {
    const names: Readonly<Record<string, string>> = {
      cc0: "CC0",
      pdm: "Public Domain Mark",
      by: "CC BY",
      "by-sa": "CC BY-SA",
      "by-nc": "CC BY-NC",
      "by-nc-sa": "CC BY-NC-SA",
      "by-nd": "CC BY-ND",
      "by-nc-nd": "CC BY-NC-ND",
    };
    return `${names[licenseCode] ?? licenseCode} ${version}`.trim();
  }

  private inferOrientation(width: number, height: number): "portrait" | "landscape" | "square" {
    if (width === 0 || height === 0) return "square";
    const ratio = width / height;
    if (ratio > 1.1) return "landscape";
    if (ratio < 0.9) return "portrait";
    return "square";
  }

  private ensureHttps(url: string): string {
    if (url.startsWith("https://")) return url;
    if (url.startsWith("http://")) return url.replace("http://", "https://");
    return url;
  }
}
