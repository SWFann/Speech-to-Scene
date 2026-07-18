/**
 * StepFun image generator adapter.
 *
 * Implements ImageGenerator for StepFun's text-to-image API.
 *
 * StepFun uses an OpenAI-compatible /images/generations endpoint:
 * - POST {baseUrl}/images/generations
 * - Body: { model, prompt, n: 1, size: "1024x1024" | "1024x1792" | "1792x1024" }
 * - Response: { data: [{ url }] }
 *
 * Rules:
 * - Do not hard-code API keys.
 * - Base URL and model are configurable through settings or constructor options.
 * - Non-2xx responses become InvalidArgumentError.
 * - Invalid response shape becomes InvalidArgumentError.
 */

import type { HttpJsonClient } from "../../infrastructure/http-json-client.js";
import { HttpJsonClient as HttpClientClass } from "../../infrastructure/http-json-client.js";
import type {
  ImageGenerator,
  ImageGenerateInput,
  ImageGenerateResult,
} from "../../application/ports/image-generator.js";
import type { AssetProviderSnapshot } from "../../application/ports/asset-provider.js";
import { InvalidArgumentError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_STEPFUN_IMAGE_MODEL = "step-image-edit-2";
export const DEFAULT_STEPFUN_IMAGE_BASE_URL = "https://api.stepfun.com/v1";
export const DEFAULT_STEPFUN_IMAGE_TIMEOUT_MS = 120_000;

const STEPFUN_IMAGE_PROVIDER_ID = "stepfun-image";
const STEPFUN_IMAGE_POLICY_REVISION = "stepfun-image-policy-2026-07-18";

const STEPFUN_IMAGE_SNAPSHOT: AssetProviderSnapshot = {
  id: STEPFUN_IMAGE_PROVIDER_ID,
  name: "StepFun Image Generator",
  homepageUrl: "https://platform.stepfun.com",
  termsUrl: "https://platform.stepfun.com/terms",
  policyRevision: STEPFUN_IMAGE_POLICY_REVISION,
  termsCheckedAt: "2026-07-18T00:00:00.000Z",
};

// Aspect ratio → size mapping (StepFun uses OpenAI-compatible size strings)
const ASPECT_SIZE: Record<string, string> = {
  "9:16": "1024x1792",
  "16:9": "1792x1024",
  "1:1": "1024x1024",
};

// Size → dimensions mapping for parsing the response
const SIZE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "1024x1024": { width: 1024, height: 1024 },
  "1024x1792": { width: 1024, height: 1792 },
  "1792x1024": { width: 1792, height: 1024 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepFunImageGeneratorOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Allows injecting a fake HTTP client for tests. */
  readonly client?: HttpJsonClient;
}

// ---------------------------------------------------------------------------
// StepFun image generator implementation
// ---------------------------------------------------------------------------

/**
 * StepFunImageGenerator implements ImageGenerator for StepFun's text-to-image API.
 *
 * Uses the OpenAI-compatible /images/generations endpoint.
 */
export class StepFunImageGenerator implements ImageGenerator {
  readonly providerId = STEPFUN_IMAGE_PROVIDER_ID;
  readonly providerSnapshot = STEPFUN_IMAGE_SNAPSHOT;

  private readonly client: HttpJsonClient;
  private readonly model: string;

  constructor(options: StepFunImageGeneratorOptions) {
    if (!options.apiKey || options.apiKey.trim() === "") {
      throw new InvalidArgumentError(
        "StepFun API key is required",
        "在设置页配置 StepFun API Key",
      );
    }

    this.model = options.model ?? DEFAULT_STEPFUN_IMAGE_MODEL;
    this.client =
      options.client ??
      new HttpClientClass({
        baseUrl: options.baseUrl ?? DEFAULT_STEPFUN_IMAGE_BASE_URL,
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs ?? DEFAULT_STEPFUN_IMAGE_TIMEOUT_MS,
      });
  }

  async generate(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const size = ASPECT_SIZE[input.aspectRatio] ?? ASPECT_SIZE["1:1"]!;
    const model = input.model ?? this.model;

    const response = await this.client.post<{
      data: Array<{ url?: string; b64_json?: string }>;
      model?: string;
    }>("/images/generations", {
      model,
      prompt: input.prompt,
      n: 1,
      size,
    });

    if (!response.ok) {
      const errorData = response.data as { error?: { message?: string } };
      const message = errorData?.error?.message ?? `StepFun API error: ${response.status}`;
      throw new InvalidArgumentError(
        `StepFun image generation failed: ${message}`,
        "请检查 StepFun API 密钥和网络连接，或稍后重试",
      );
    }

    const imageData = response.data.data?.[0];
    if (!imageData) {
      throw new InvalidArgumentError(
        "StepFun returned no image data",
        "API 返回了空响应，请重试",
      );
    }

    // StepFun may return either a URL or base64-encoded image
    const imageUrl = imageData.url;
    if (!imageUrl || typeof imageUrl !== "string") {
      throw new InvalidArgumentError(
        "StepFun returned no image URL",
        "API 返回了无效的响应格式",
      );
    }

    const dims = SIZE_DIMENSIONS[size] ?? { width: 1024, height: 1024 };

    return {
      imageUrl,
      thumbnailUrl: imageUrl,
      width: dims.width,
      height: dims.height,
      model: response.data.model ?? model,
      providerSnapshot: STEPFUN_IMAGE_SNAPSHOT,
    };
  }
}
