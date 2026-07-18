/**
 * Pixabay asset provider implementation.
 *
 * Maps Pixabay API responses to the AssetCandidate type. Pixabay offers
 * photos and videos under its own license (similar to Pexels). Only photos
 * are supported here (Pixabay's video API requires a separate endpoint and
 * key tier).
 *
 * No Pixabay types leak outside this package.
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

const PIXABAY_PROVIDER_ID = "pixabay";
const PIXABAY_POLICY_REVISION = "pixabay-policy-2026-07";
const PIXABAY_TERMS_URL = "https://pixabay.com/service/terms/";
const PIXABAY_BASE_URL = "https://pixabay.com/api/";
const DEFAULT_TIMEOUT_MS = 15_000;

const PIXABAY_SNAPSHOT: AssetProviderSnapshot = {
  id: PIXABAY_PROVIDER_ID,
  name: "Pixabay",
  homepageUrl: "https://pixabay.com",
  termsUrl: PIXABAY_TERMS_URL,
  policyRevision: PIXABAY_POLICY_REVISION,
  termsCheckedAt: "2026-07-01T00:00:00.000Z",
};

const PIXABAY_CAPABILITIES: ProviderCapabilities = {
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

export class PixabayApiError extends AppError {
  constructor(message: string, cause?: Error) {
    const params: {
      code: string;
      message: string;
      exitCode: number;
      userHint: string;
      cause?: Error;
      retryable?: boolean;
    } = {
      code: "pixabay_api_error",
      message,
      exitCode: 1,
      userHint: "检查 Pixabay API 配置和网络连接",
      retryable: true,
    };
    if (cause) {
      params.cause = cause;
    }
    super(params);
  }
}

// ---------------------------------------------------------------------------
// Response types (raw Pixabay API shapes)
// ---------------------------------------------------------------------------

interface PixabayPhotoResponse {
  readonly total: number;
  readonly totalHits: number;
  readonly hits: ReadonlyArray<{
    readonly id: number;
    readonly pageURL: string;
    readonly type: string;
    readonly tags: string;
    readonly previewURL: string;
    readonly previewWidth: number;
    readonly previewHeight: number;
    readonly webformatURL: string;
    readonly webformatWidth: number;
    readonly webformatHeight: number;
    readonly largeImageURL: string;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly imageSize: number;
    readonly views: number;
    readonly downloads: number;
    readonly likes: number;
    readonly comments: number;
    readonly user_id: number;
    readonly user: string;
    readonly userImageURL: string;
  }>;
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

class DefaultPixabayHttpClient implements HttpGetClient {
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
        throw new PixabayApiError(`Pixabay API returned ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof PixabayApiError) {
        throw error;
      }
      throw new PixabayApiError(
        error instanceof Error ? error.message : "Pixabay request failed",
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

export interface PixabayAssetProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly httpClient?: HttpGetClient;
}

export class PixabayAssetProvider implements AssetProvider {
  readonly providerId = PIXABAY_PROVIDER_ID;
  readonly providerSnapshot = PIXABAY_SNAPSHOT;
  readonly capabilities = PIXABAY_CAPABILITIES;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly httpClient: HttpGetClient;

  constructor(options: PixabayAssetProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? PIXABAY_BASE_URL;
    this.httpClient = options.httpClient ?? new DefaultPixabayHttpClient();
  }

  async search(input: AssetSearchInput): Promise<AssetSearchResult> {
    const candidates: AssetCandidate[] = [];
    const warnings: ProviderWarning[] = [];

    // Pixabay only supports photos in this adapter
    if (!input.mediaTypes.includes("photo")) {
      return { candidates, warnings };
    }

    try {
      const photoCandidates = await this.searchPhotos(input);
      candidates.push(...photoCandidates);
    } catch (error) {
      if (error instanceof PixabayApiError) {
        warnings.push({
          code: "pixabay_photo_search_failed",
          message: error.message,
          queryId: input.queryId,
        });
      } else {
        warnings.push({
          code: "pixabay_photo_search_failed",
          message: error instanceof Error ? error.message : "unknown error",
          queryId: input.queryId,
        });
      }
    }

    return { candidates, warnings };
  }

  private async searchPhotos(input: AssetSearchInput): Promise<AssetCandidate[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      q: input.query,
      per_page: String(Math.min(input.perPage, 200)),
      page: String(input.page),
      image_type: "photo",
      safesearch: "true",
    });

    if (input.orientation) {
      const orientation = this.mapOrientation(input.orientation);
      if (orientation) {
        params.set("orientation", orientation);
      }
    }

    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await this.httpClient.get<PixabayPhotoResponse>(url);

    return response.hits.map((hit, index) => this.mapPhoto(hit, input, index + 1));
  }

  private mapPhoto(
    hit: PixabayPhotoResponse["hits"][number],
    input: AssetSearchInput,
    rank: number,
  ): AssetCandidate {
    const width = hit.imageWidth;
    const height = hit.imageHeight;
    const orientation = this.inferOrientation(width, height);
    const now = new Date().toISOString();

    return {
      kind: "asset" as const,
      id: `${PIXABAY_PROVIDER_ID}-photo-${hit.id}-${rank}`,
      provider: PIXABAY_SNAPSHOT,
      providerAssetId: String(hit.id),
      mediaType: "photo",
      thumbnailUrl: this.ensureHttps(hit.previewURL),
      previewUrl: this.ensureHttps(hit.webformatURL),
      sourcePageUrl: this.ensureHttps(hit.pageURL),
      width,
      height,
      orientation,
      creator: {
        name: hit.user,
        ...(hit.userImageURL ? { profileUrl: this.ensureHttps(hit.userImageURL) } : {}),
      },
      rights: {
        status: "platform_license",
        licenseName: "Pixabay License",
        licenseUrl: PIXABAY_TERMS_URL,
        attributionRequired: false,
        commercialUse: "allowed",
        derivatives: "allowed",
        restrictions: [
          "Identifiable persons may not be depicted in a defamatory or sensitive manner",
          "Do not redistribute or sell the media as-is without modification",
        ],
        verifiedAt: now,
        evidence: {
          capturedAt: now,
          referenceUrl: PIXABAY_TERMS_URL,
          fields: {
            policyRevision: PIXABAY_POLICY_REVISION,
            source: "pixabay_api",
            photoId: hit.id,
          },
        },
      },
      retrievedAt: now,
      matchedQueryId: input.queryId,
      rank,
    };
  }

  private mapOrientation(orientation: string): string | undefined {
    switch (orientation) {
      case "portrait":
        return "vertical";
      case "landscape":
        return "horizontal";
      case "square":
        return undefined;
      default:
        return undefined;
    }
  }

  private inferOrientation(width: number, height: number): "portrait" | "landscape" | "square" {
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
