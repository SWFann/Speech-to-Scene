/**
 * Unsplash asset provider implementation.
 *
 * Maps Unsplash API responses to the AssetCandidate type. Unsplash photos are
 * licensed under the Unsplash License (free to use, no attribution required).
 *
 * No Unsplash types leak outside this package.
 */

import type {
  AssetProvider,
  AssetSearchInput,
  AssetSearchResult,
  AssetCandidate,
  AssetProviderSnapshot,
  ProviderCapabilities,
  ProviderWarning,
} from "../../application/ports/asset-provider.js";
import { AppError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSPLASH_PROVIDER_ID = "unsplash";
const UNSPLASH_POLICY_REVISION = "unsplash-policy-2026-07";
const UNSPLASH_TERMS_URL = "https://unsplash.com/license";
const UNSPLASH_BASE_URL = "https://api.unsplash.com";
const DEFAULT_TIMEOUT_MS = 15_000;

const UNSPLASH_SNAPSHOT: AssetProviderSnapshot = {
  id: UNSPLASH_PROVIDER_ID,
  name: "Unsplash",
  homepageUrl: "https://unsplash.com",
  termsUrl: UNSPLASH_TERMS_URL,
  policyRevision: UNSPLASH_POLICY_REVISION,
  termsCheckedAt: "2026-07-01T00:00:00.000Z",
};

const UNSPLASH_CAPABILITIES: ProviderCapabilities = {
  photos: true,
  videos: false,
  orientationFilter: true,
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

export class UnsplashApiError extends AppError {
  constructor(message: string, cause?: Error) {
    const params: {
      code: string;
      message: string;
      exitCode: number;
      userHint: string;
      cause?: Error;
      retryable?: boolean;
    } = {
      code: "unsplash_api_error",
      message,
      exitCode: 1,
      userHint: "检查 Unsplash API 配置和网络连接",
      retryable: true,
    };
    if (cause) {
      params.cause = cause;
    }
    super(params);
  }
}

// ---------------------------------------------------------------------------
// Response types (raw Unsplash API shapes)
// ---------------------------------------------------------------------------

interface UnsplashSearchResponse {
  readonly total: number;
  readonly total_pages: number;
  readonly results: ReadonlyArray<{
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly description: string | null;
    readonly alt_description: string | null;
    readonly urls: {
      readonly raw: string;
      readonly full: string;
      readonly regular: string;
      readonly small: string;
      readonly thumb: string;
    };
    readonly links: {
      readonly self: string;
      readonly html: string;
    };
    readonly user: {
      readonly id: string;
      readonly username: string;
      readonly name: string;
      readonly links: {
        readonly self: string;
        readonly html: string;
      };
    };
  }>;
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

class DefaultUnsplashHttpClient implements HttpGetClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async get<T>(url: string, options?: { signal?: AbortSignal }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      if (options?.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
      }
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Client-ID ${this.apiKey}`,
        },
      });
      if (!response.ok) {
        throw new UnsplashApiError(`Unsplash API returned ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof UnsplashApiError) {
        throw error;
      }
      throw new UnsplashApiError(
        error instanceof Error ? error.message : "Unsplash request failed",
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

export interface UnsplashAssetProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly httpClient?: HttpGetClient;
}

export class UnsplashAssetProvider implements AssetProvider {
  readonly providerId = UNSPLASH_PROVIDER_ID;
  readonly providerSnapshot = UNSPLASH_SNAPSHOT;
  readonly capabilities = UNSPLASH_CAPABILITIES;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly httpClient: HttpGetClient;

  constructor(options: UnsplashAssetProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? UNSPLASH_BASE_URL;
    this.httpClient = options.httpClient ?? new DefaultUnsplashHttpClient(this.apiKey);
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
      if (error instanceof UnsplashApiError) {
        warnings.push({
          code: "unsplash_photo_search_failed",
          message: error.message,
          queryId: input.queryId,
        });
      } else {
        warnings.push({
          code: "unsplash_photo_search_failed",
          message: error instanceof Error ? error.message : "unknown error",
          queryId: input.queryId,
        });
      }
    }

    return { candidates, warnings };
  }

  private async searchPhotos(input: AssetSearchInput): Promise<AssetCandidate[]> {
    const params = new URLSearchParams({
      query: input.query,
      per_page: String(Math.min(input.perPage, 30)),
      page: String(input.page),
    });

    if (input.orientation) {
      params.set("orientation", input.orientation);
    }

    const url = `${this.baseUrl}/search/photos?${params.toString()}`;
    const response = await this.httpClient.get<UnsplashSearchResponse>(url);

    return response.results.map((photo, index) => this.mapPhoto(photo, input, index + 1));
  }

  private mapPhoto(
    photo: UnsplashSearchResponse["results"][number],
    input: AssetSearchInput,
    rank: number,
  ): AssetCandidate {
    const width = photo.width;
    const height = photo.height;
    const orientation = this.inferOrientation(width, height);
    const now = new Date().toISOString();

    return {
      kind: "asset" as const,
      id: `${UNSPLASH_PROVIDER_ID}-photo-${photo.id}-${rank}`,
      provider: UNSPLASH_SNAPSHOT,
      providerAssetId: photo.id,
      mediaType: "photo",
      thumbnailUrl: photo.urls.thumb,
      previewUrl: photo.urls.regular,
      sourcePageUrl: photo.links.html,
      width,
      height,
      orientation,
      creator: {
        name: photo.user.name,
        profileUrl: photo.user.links.html,
      },
      rights: {
        status: "platform_license",
        licenseName: "Unsplash License",
        licenseUrl: UNSPLASH_TERMS_URL,
        attributionRequired: false,
        commercialUse: "allowed",
        derivatives: "allowed",
        restrictions: [
          "Do not sell photos from Unsplash without modification",
          "Do not compile photos from Unsplash to replicate a similar service",
        ],
        verifiedAt: now,
        evidence: {
          capturedAt: now,
          referenceUrl: UNSPLASH_TERMS_URL,
          fields: {
            policyRevision: UNSPLASH_POLICY_REVISION,
            source: "unsplash_api",
            photoId: photo.id,
          },
        },
      },
      retrievedAt: now,
      matchedQueryId: input.queryId,
      rank,
    };
  }

  private inferOrientation(width: number, height: number): "portrait" | "landscape" | "square" {
    const ratio = width / height;
    if (ratio > 1.1) return "landscape";
    if (ratio < 0.9) return "portrait";
    return "square";
  }
}
