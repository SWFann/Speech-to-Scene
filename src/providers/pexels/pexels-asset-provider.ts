/**
 * Pexels asset provider implementation.
 *
 * Maps Pexels API responses to the AssetCandidate type defined in the
 * Application layer port. No Pexels types leak outside this package.
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
import type { HttpGetClient } from "./pexels-client.js";
import { AppError } from "../../shared/errors.js";
import { PexelsClient } from "./pexels-client.js";
import type { PexelsClientOptions } from "./pexels-client.js";
import { PEXELS_POLICY_REVISION, PEXELS_TERMS_URL } from "./pexels-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PEXELS_PROVIDER_ID = "pexels";

const PEXELS_SNAPSHOT: AssetProviderSnapshot = {
  id: PEXELS_PROVIDER_ID,
  name: "Pexels",
  homepageUrl: "https://www.pexels.com",
  termsUrl: PEXELS_TERMS_URL,
  policyRevision: PEXELS_POLICY_REVISION,
  termsCheckedAt: "2025-06-01T00:00:00.000Z",
};

const PEXELS_CAPABILITIES: ProviderCapabilities = {
  photos: true,
  videos: true,
  orientationFilter: true,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PexelsApiError extends AppError {
  constructor(message: string, cause?: Error) {
    const params: {
      code: string;
      message: string;
      exitCode: number;
      userHint: string;
      cause?: Error;
      retryable?: boolean;
    } = {
      code: "pexels_api_error",
      message,
      exitCode: 1,
      userHint: "检查 Pexels API 配置和网络连接",
      retryable: true,
    };
    if (cause) {
      params.cause = cause;
    }
    super(params);
  }
}

export class PexelsAuthError extends AppError {
  constructor(message: string) {
    super({
      code: "pexels_auth_error",
      message,
      exitCode: 2,
      userHint: "检查 PEXELS_API_KEY 环境变量",
    });
  }
}

export class PexelsRateLimitError extends AppError {
  constructor(message: string) {
    super({
      code: "pexels_rate_limit",
      message,
      exitCode: 4,
      userHint: "Pexels API 请求频率超限，请稍后重试",
      retryable: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface PexelsAssetProviderOptions {
  readonly apiKey: string;
  readonly photosBaseUrl?: string;
  readonly videosBaseUrl?: string;
  readonly httpClient?: HttpGetClient;
}

export class PexelsAssetProvider implements AssetProvider {
  readonly providerId = PEXELS_PROVIDER_ID;
  readonly providerSnapshot = PEXELS_SNAPSHOT;
  readonly capabilities = PEXELS_CAPABILITIES;

  private readonly client: PexelsClient;

  constructor(options: PexelsAssetProviderOptions) {
    const clientOptions: PexelsClientOptions = {
      apiKey: options.apiKey,
      photosBaseUrl: options.photosBaseUrl,
      videosBaseUrl: options.videosBaseUrl,
      httpClient: options.httpClient,
    };
    this.client = new PexelsClient(clientOptions);
  }

  /**
   * Search for asset candidates.
   */
  async search(input: AssetSearchInput): Promise<AssetSearchResult> {
    const candidates: AssetCandidate[] = [];
    const warnings: ProviderWarning[] = [];
    const orientation = input.orientation ? this.mapOrientation(input.orientation) : undefined;

    // Search for photos if requested
    if (input.mediaTypes.includes("photo")) {
      try {
        const photoCandidates = await this.searchPhotos(input, orientation);
        candidates.push(...photoCandidates);
      } catch (error) {
        if (error instanceof PexelsAuthError) {
          throw error;
        }
        if (error instanceof PexelsRateLimitError) {
          throw error;
        }
        warnings.push({
          code: "photo_search_failed",
          message: `Photo search failed: ${error instanceof Error ? error.message : "unknown"}`,
          queryId: input.queryId,
        });
      }
    }

    // Search for videos if requested
    if (input.mediaTypes.includes("video")) {
      try {
        const videoCandidates = await this.searchVideos(input, orientation);
        candidates.push(...videoCandidates);
      } catch (error) {
        if (error instanceof PexelsAuthError) {
          throw error;
        }
        if (error instanceof PexelsRateLimitError) {
          throw error;
        }
        warnings.push({
          code: "video_search_failed",
          message: `Video search failed: ${error instanceof Error ? error.message : "unknown"}`,
          queryId: input.queryId,
        });
      }
    }

    return {
      candidates,
      warnings,
    };
  }

  /**
   * Search for photos and map to AssetCandidates.
   */
  private async searchPhotos(
    input: AssetSearchInput,
    orientation?: string,
  ): Promise<AssetCandidate[]> {
    const response = await this.client.searchPhotos(
      input.query,
      input.perPage,
      input.page,
      orientation,
    );
    return response.photos.map((photo, index) => this.mapPhoto(photo, input, index + 1));
  }

  /**
   * Search for videos and map to AssetCandidates.
   */
  private async searchVideos(
    input: AssetSearchInput,
    orientation?: string,
  ): Promise<AssetCandidate[]> {
    const response = await this.client.searchVideos(
      input.query,
      input.perPage,
      input.page,
      orientation,
    );
    return response.videos.map((video, index) => this.mapVideo(video, input, index + 1));
  }

  /**
   * Maps a Pexels photo to an AssetCandidate.
   */
  private mapPhoto(
    photo: {
      id: number;
      width: number;
      height: number;
      url: string;
      photographer: string;
      photographer_url: string;
      src: { portrait: string; landscape: string; medium: string };
      alt: string;
    },
    input: AssetSearchInput,
    rank: number,
  ): AssetCandidate {
    const photoOrientation = this.inferOrientation(photo.width, photo.height);
    const thumbnailUrl = photoOrientation === "portrait" ? photo.src.portrait : photo.src.landscape;

    // Validate URLs are HTTPS
    const sourcePageUrl = photo.url.startsWith("https://")
      ? photo.url
      : `https://www.pexels.com/photo/${photo.id}/`;

    return {
      id: `${PEXELS_PROVIDER_ID}-photo-${photo.id}-${rank}`,
      provider: PEXELS_SNAPSHOT,
      providerAssetId: String(photo.id),
      mediaType: "photo",
      thumbnailUrl,
      sourcePageUrl,
      width: photo.width,
      height: photo.height,
      orientation: photoOrientation,
      creator: {
        name: photo.photographer,
        profileUrl: photo.photographer_url,
      },
      rights: {
        status: "platform_license",
        licenseName: "Pexels License",
        licenseUrl: PEXELS_TERMS_URL,
        attributionRequired: false,
        commercialUse: "allowed",
        derivatives: "allowed",
        restrictions: [
          "Identifiable persons may not be depicted in a defamatory or sensitive manner",
          "Do not redistribute or sell the photos/videos as-is without modification",
        ],
        verifiedAt: new Date().toISOString(),
        evidence: {
          capturedAt: new Date().toISOString(),
          referenceUrl: PEXELS_TERMS_URL,
          fields: {
            policyRevision: PEXELS_POLICY_REVISION,
            source: "pexels_api",
            photoId: photo.id,
          },
        },
      },
      retrievedAt: new Date().toISOString(),
      matchedQueryId: input.queryId,
      rank,
    };
  }

  /**
   * Maps a Pexels video to an AssetCandidate.
   */
  private mapVideo(
    video: {
      id: number;
      width: number;
      height: number;
      duration: number;
      image: string;
      url: string;
      user: { name: string; url: string };
      video_files: ReadonlyArray<{ link: string }>;
    },
    input: AssetSearchInput,
    rank: number,
  ): AssetCandidate {
    const videoOrientation = this.inferOrientation(video.width, video.height);

    // Use video.image as thumbnailUrl (it's the preview image)
    const thumbnailUrl = video.image.startsWith("https://") ? video.image : "";

    // Use first video file as previewUrl
    const previewUrl = video.video_files[0]?.link ?? "";

    // Validate URLs
    const sourcePageUrl = video.url.startsWith("https://")
      ? video.url
      : `https://www.pexels.com/video/${video.id}/`;

    return {
      id: `${PEXELS_PROVIDER_ID}-video-${video.id}-${rank}`,
      provider: PEXELS_SNAPSHOT,
      providerAssetId: String(video.id),
      mediaType: "video",
      thumbnailUrl,
      ...(previewUrl ? { previewUrl } : {}),
      sourcePageUrl,
      width: video.width,
      height: video.height,
      durationSeconds: video.duration,
      orientation: videoOrientation,
      creator: {
        name: video.user.name,
        profileUrl: video.user.url,
      },
      rights: {
        status: "platform_license",
        licenseName: "Pexels License",
        licenseUrl: PEXELS_TERMS_URL,
        attributionRequired: false,
        commercialUse: "allowed",
        derivatives: "allowed",
        restrictions: [
          "Identifiable persons may not be depicted in a defamatory or sensitive manner",
          "Do not redistribute or sell the photos/videos as-is without modification",
        ],
        verifiedAt: new Date().toISOString(),
        evidence: {
          capturedAt: new Date().toISOString(),
          referenceUrl: PEXELS_TERMS_URL,
          fields: {
            policyRevision: PEXELS_POLICY_REVISION,
            source: "pexels_api",
            videoId: video.id,
          },
        },
      },
      retrievedAt: new Date().toISOString(),
      matchedQueryId: input.queryId,
      rank,
    };
  }

  /**
   * Maps Pexels orientation to internal orientation.
   */
  private mapOrientation(pexelsOrientation: string): "portrait" | "landscape" | "square" {
    switch (pexelsOrientation) {
      case "portrait":
        return "portrait";
      case "landscape":
        return "landscape";
      default:
        return "square";
    }
  }

  /**
   * Infers orientation from dimensions.
   */
  private inferOrientation(width: number, height: number): "portrait" | "landscape" | "square" {
    const ratio = width / height;
    if (ratio > 1.1) return "landscape";
    if (ratio < 0.9) return "portrait";
    return "square";
  }
}
