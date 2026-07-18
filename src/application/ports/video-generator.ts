/**
 * VideoGenerator port (reserved for future text-to-video generation).
 *
 * This interface is defined to reserve the contract for Phase 2's video
 * generation feature. No concrete implementation is provided yet — only
 * the port exists so that future providers (StepFun video, etc.) can be
 * added without changing the Application layer contract.
 *
 * The Application layer never calls a specific provider SDK, model name, or
 * API base URL.
 */

import type { AssetProviderSnapshot } from "./asset-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for a video generation request.
 */
export interface VideoGenerateInput {
  readonly prompt: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly durationSeconds?: number;
  readonly model?: string;
}

/**
 * Result of a video generation request.
 */
export interface VideoGenerateResult {
  readonly videoUrl: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly model: string;
  readonly providerSnapshot: AssetProviderSnapshot;
}

/**
 * VideoGenerator port (reserved — not yet implemented).
 *
 * When a concrete provider is added, it must:
 * - Never return API keys or raw provider responses
 * - Map all external data through typed guards before returning
 * - Never make real network calls in tests
 */
export interface VideoGenerator {
  /** Stable provider identifier (e.g., "stepfun-video"). */
  readonly providerId: string;

  /** Provider snapshot at generation time. */
  readonly providerSnapshot: AssetProviderSnapshot;

  /**
   * Generate a video from a text prompt.
   *
   * @param input - Generation parameters (prompt, aspect ratio, duration, model)
   * @returns Generated video URL, thumbnail, dimensions, and model metadata
   */
  generate(input: VideoGenerateInput): Promise<VideoGenerateResult>;
}
