/**
 * Pexels API types.
 *
 * These types represent the raw responses from the Pexels API.
 * They are internal to the Pexels provider infrastructure and should not
 * leak outside this package.
 */

// ---------------------------------------------------------------------------
// API Request / Response Types
// ---------------------------------------------------------------------------

/**
 * Pexels photo response wrapper (contains array of photos).
 */
export interface PexelsPhotoResponse {
  readonly totalResults: number;
  readonly page: number;
  readonly perPage: number;
  readonly photos: ReadonlyArray<{
    readonly id: number;
    readonly width: number;
    readonly height: number;
    readonly url: string;
    readonly photographer: string;
    readonly photographer_url: string;
    readonly src: {
      readonly original: string;
      readonly large2x: string;
      readonly large: string;
      readonly medium: string;
      readonly small: string;
      readonly portrait: string;
      readonly landscape: string;
      readonly tiny: string;
    };
    readonly liked: boolean;
    readonly alt: string;
  }>;
}

/**
 * Pexels video response wrapper (contains array of videos).
 */
export interface PexelsVideoResponse {
  readonly totalResults: number;
  readonly page: number;
  readonly perPage: number;
  readonly videos: ReadonlyArray<{
    readonly id: number;
    readonly width: number;
    readonly height: number;
    readonly url: string;
    readonly image: string;
    readonly duration: number;
    readonly user: {
      readonly id: number;
      readonly name: string;
      readonly url: string;
    };
    readonly video_files: ReadonlyArray<{
      readonly id: number;
      readonly quality: string;
      readonly file_type: string;
      readonly width: number;
      readonly height: number;
      readonly link: string;
    }>;
    readonly video_pictures: ReadonlyArray<{
      readonly id: number;
      readonly picture: string;
      readonly nr: number;
    }>;
  }>;
}

/**
 * Pexels API error response.
 */
export interface PexelsErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------------------
// Pexels API Configuration
// ---------------------------------------------------------------------------

/**
 * Pexels API configuration.
 */
export interface PexelsApiConfig {
  readonly apiKey: string;
  readonly photosBaseUrl?: string;
  readonly videosBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Pexels Policy
// ---------------------------------------------------------------------------

/**
 * Pexels license terms as of policy revision.
 */
export const PEXELS_POLICY_REVISION = "pexels-policy-2025-06";

export const PEXELS_TERMS_URL = "https://www.pexels.com/license/";

/**
 * Maps Pexels API data to internal rights status.
 *
 * Pexels photos and videos are licensed under the Pexels License which allows:
 * - Commercial use
 * - Modification
 * - No attribution required (but appreciated)
 */
export function mapPexelsRights(): {
  status: "platform_license";
  licenseName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  commercialUse: "allowed";
  derivatives: "allowed";
  restrictions: readonly string[];
  verifiedAt: string;
  evidence: {
    capturedAt: string;
    referenceUrl: string;
    fields: Record<string, string>;
  };
} {
  const now = new Date().toISOString();
  return {
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
    verifiedAt: now,
    evidence: {
      capturedAt: now,
      referenceUrl: PEXELS_TERMS_URL,
      fields: {
        policyRevision: PEXELS_POLICY_REVISION,
        source: "pexels_api",
      },
    },
  };
}
