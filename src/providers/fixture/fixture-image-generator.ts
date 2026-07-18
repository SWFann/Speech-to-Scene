/**
 * Fixture image generator.
 *
 * A deterministic image generator implementation that returns fixed placeholder
 * images for testing. No network calls are made.
 *
 * Returns a placehold.co URL with dimensions matching the requested aspect ratio.
 */

import type {
  ImageGenerator,
  ImageGenerateInput,
  ImageGenerateResult,
} from "../../application/ports/image-generator.js";
import type { AssetProviderSnapshot } from "../../application/ports/asset-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXTURE_IMAGE_PROVIDER_ID = "fixture-image";
const FIXTURE_IMAGE_POLICY_REVISION = "fixture-image-policy-2026-07-18";

const FIXTURE_IMAGE_SNAPSHOT: AssetProviderSnapshot = {
  id: FIXTURE_IMAGE_PROVIDER_ID,
  name: "Fixture Image Generator",
  homepageUrl: "https://example.com/fixture-image",
  termsUrl: "https://example.com/fixture-image/terms",
  policyRevision: FIXTURE_IMAGE_POLICY_REVISION,
  termsCheckedAt: "2026-07-18T00:00:00.000Z",
};

const FIXTURE_IMAGE_MODEL = "fixture-image-v1";

// Aspect ratio → dimensions mapping
const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1024, height: 1792 },
  "16:9": { width: 1792, height: 1024 },
  "1:1": { width: 1024, height: 1024 },
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * FixtureImageGenerator provides deterministic placeholder images for testing.
 *
 * Returns a placehold.co URL with dimensions matching the requested aspect ratio.
 * The prompt is not used in the URL (placehold.co doesn't support text in URLs
 * with non-ASCII characters), but is returned in the result metadata.
 */
export class FixtureImageGenerator implements ImageGenerator {
  readonly providerId = FIXTURE_IMAGE_PROVIDER_ID;
  readonly providerSnapshot = FIXTURE_IMAGE_SNAPSHOT;

  async generate(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    await Promise.resolve();
    const dims = ASPECT_DIMENSIONS[input.aspectRatio] ?? ASPECT_DIMENSIONS["1:1"]!;
    const imageUrl = `https://placehold.co/${dims.width}x${dims.height}?text=Generated`;

    return {
      imageUrl,
      thumbnailUrl: imageUrl,
      width: dims.width,
      height: dims.height,
      model: input.model ?? FIXTURE_IMAGE_MODEL,
      providerSnapshot: FIXTURE_IMAGE_SNAPSHOT,
    };
  }
}
