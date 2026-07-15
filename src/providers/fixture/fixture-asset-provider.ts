/**
 * Fixture asset provider.
 *
 * A deterministic asset provider implementation that produces fixed candidates
 * for testing. No network calls are made.
 *
 * This provider:
 * - Returns photo candidates for all queries
 * - Assigns deterministic IDs and ranks
 * - Uses platform_license rights with Pexels-like terms
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
import type { Clock } from "../../application/ports/clock.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_PROVIDER_ID = "fixture";
const FIXTURE_POLICY_REVISION = "fixture-policy-2026-07-14";

const FIXTURE_SNAPSHOT: AssetProviderSnapshot = {
  id: FIXTURE_PROVIDER_ID,
  name: "Fixture Asset Provider",
  homepageUrl: "https://example.com/fixture",
  termsUrl: "https://example.com/fixture/terms",
  policyRevision: FIXTURE_POLICY_REVISION,
  termsCheckedAt: "2026-07-14T00:00:00.000Z",
};

const FIXTURE_CAPABILITIES: ProviderCapabilities = {
  photos: true,
  videos: true,
  orientationFilter: true,
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * FixtureAssetProvider provides deterministic asset candidates for testing.
 *
 * Generates 2 candidates per query (1 photo, 1 video) with sequential ranks.
 */
export class FixtureAssetProvider implements AssetProvider {
  readonly providerId = FIXTURE_PROVIDER_ID;
  readonly providerSnapshot = FIXTURE_SNAPSHOT;
  readonly capabilities = FIXTURE_CAPABILITIES;

  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  /**
   * Search for asset candidates.
   *
   * Generates deterministic candidates based on the query input.
   */
  async search(input: AssetSearchInput): Promise<AssetSearchResult> {
    // Simulate async operation
    await Promise.resolve();

    const candidates: AssetCandidate[] = [];
    const warnings: ProviderWarning[] = [];
    let rank = 1;

    for (const mediaType of input.mediaTypes) {
      const candidate = this.buildCandidate(input, mediaType, rank);
      candidates.push(candidate);
      rank++;
    }

    return {
      candidates,
      warnings,
    };
  }

  /**
   * Builds a single fixture candidate.
   */
  private buildCandidate(
    input: AssetSearchInput,
    mediaType: "photo" | "video",
    rank: number,
  ): AssetCandidate {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const width = mediaType === "video" ? 1920 : 1080;
    const height = mediaType === "video" ? 1080 : 1920;
    const orientation = this.inferOrientationFromDimensions(width, height);

    return {
      id: `${FIXTURE_PROVIDER_ID}-${input.queryId}-${mediaType}-${rank}`,
      provider: FIXTURE_SNAPSHOT,
      providerAssetId: `fixture-asset-${rank}`,
      mediaType,
      thumbnailUrl: `https://example.com/fixture/${input.queryId}/${mediaType}/${rank}/thumb.jpg`,
      ...(mediaType === "video"
        ? {
            previewUrl: `https://example.com/fixture/${input.queryId}/${mediaType}/${rank}/preview.mp4`,
          }
        : {}),
      sourcePageUrl: `https://example.com/fixture/${input.queryId}/${mediaType}/${rank}`,
      width,
      height,
      ...(mediaType === "video" ? { durationSeconds: 30 } : {}),
      orientation,
      creator: {
        name: `Fixture Creator ${rank}`,
        profileUrl: `https://example.com/fixture/creator/${rank}`,
      },
      rights: {
        status: "platform_license",
        licenseName: "Fixture License",
        licenseUrl: "https://example.com/fixture/terms",
        attributionRequired: false,
        commercialUse: "allowed",
        derivatives: "allowed",
        restrictions: ["Do not redistribute as standalone"],
        verifiedAt: nowIso,
        evidence: {
          capturedAt: nowIso,
          referenceUrl: "https://example.com/fixture/terms",
          fields: {
            policyRevision: FIXTURE_POLICY_REVISION,
            commercialUse: "allowed",
            derivatives: "allowed",
          },
        },
      },
      retrievedAt: nowIso,
      matchedQueryId: input.queryId,
      rank,
    };
  }

  /**
   * Infers orientation from width and height dimensions.
   */
  private inferOrientationFromDimensions(
    width: number,
    height: number,
  ): "portrait" | "landscape" | "square" {
    const ratio = width / height;
    if (ratio > 1.1) return "landscape";
    if (ratio < 0.9) return "portrait";
    return "square";
  }
}
