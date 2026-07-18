/**
 * ImageGenerator port.
 *
 * Abstraction over AI text-to-image generation providers (StepFun, etc.).
 * The Application layer defines the contract; Infrastructure provides
 * implementations (fixture, stepfun, etc.).
 *
 * The generator is responsible for:
 * - Receiving a prompt and aspect ratio
 * - Returning a generated image URL with dimensions and model metadata
 * - Reporting non-fatal warnings (none currently, but reserved for future)
 *
 * The Application layer never calls a specific provider SDK, model name, or
 * API base URL.
 */

import type { AssetProviderSnapshot } from "./asset-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for an image generation request.
 */
export interface ImageGenerateInput {
  readonly prompt: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly model?: string;
}

/**
 * Result of an image generation request.
 */
export interface ImageGenerateResult {
  readonly imageUrl: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly model: string;
  readonly providerSnapshot: AssetProviderSnapshot;
}

/**
 * ImageGenerator port.
 *
 * Implementations must:
 * - Never return API keys or raw provider responses
 * - Map all external data through typed guards before returning
 * - Never make real network calls in tests
 */
export interface ImageGenerator {
  /** Stable provider identifier (e.g., "fixture-image", "stepfun-image"). */
  readonly providerId: string;

  /** Provider snapshot at generation time. */
  readonly providerSnapshot: AssetProviderSnapshot;

  /**
   * Generate an image from a text prompt.
   *
   * @param input - Generation parameters (prompt, aspect ratio, optional model)
   * @returns Generated image URL, dimensions, and model metadata
   */
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}
