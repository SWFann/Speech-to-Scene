/**
 * Pexels HTTP client.
 *
 * Thin wrapper around the Pexels API that handles authentication,
 * timeouts, rate limiting, and retries. Does not map to domain types —
 * that's the provider's job.
 */

import type {
  PexelsPhotoResponse,
  PexelsVideoResponse,
  PexelsErrorResponse,
} from "./pexels-types.js";

const DEFAULT_PHOTOS_BASE_URL = "https://api.pexels.com/v1";
const DEFAULT_VIDEOS_BASE_URL = "https://api.pexels.com/videos";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_BASE_MS = 1_000;

/**
 * Minimal HTTP JSON client interface for Pexels.
 */
export interface HttpGetClient {
  get<T>(url: string, options?: { signal?: AbortSignal }): Promise<T>;
  post<T>(url: string, body: unknown): Promise<T>;
}

export interface PexelsClientOptions {
  readonly apiKey: string;
  readonly photosBaseUrl: string | undefined;
  readonly videosBaseUrl: string | undefined;
  readonly httpClient: HttpGetClient | undefined;
}

export class PexelsClient {
  private readonly apiKey: string;
  private readonly photosBaseUrl: string;
  private readonly videosBaseUrl: string;
  private readonly httpClient: HttpGetClient;

  constructor(options: PexelsClientOptions) {
    this.apiKey = options.apiKey;
    this.photosBaseUrl = options.photosBaseUrl ?? DEFAULT_PHOTOS_BASE_URL;
    this.videosBaseUrl = options.videosBaseUrl ?? DEFAULT_VIDEOS_BASE_URL;
    this.httpClient = options.httpClient ?? new DefaultPexelsHttpClient(this.apiKey);
  }

  /**
   * Search for photos.
   */
  async searchPhotos(
    query: string,
    perPage: number,
    page: number,
    orientation?: string,
  ): Promise<PexelsPhotoResponse> {
    const params = new URLSearchParams({
      query,
      per_page: String(perPage),
      page: String(page),
    });
    if (orientation) {
      params.set("orientation", orientation);
    }

    const url = `${this.photosBaseUrl}/search?${params.toString()}`;
    return this.requestWithRetry<PexelsPhotoResponse>(url);
  }

  /**
   * Search for videos.
   */
  async searchVideos(
    query: string,
    perPage: number,
    page: number,
    orientation?: string,
  ): Promise<PexelsVideoResponse> {
    const params = new URLSearchParams({
      query,
      per_page: String(perPage),
      page: String(page),
    });
    if (orientation) {
      params.set("orientation", orientation);
    }

    const url = `${this.videosBaseUrl}/search?${params.toString()}`;
    return this.requestWithRetry<PexelsVideoResponse>(url);
  }

  /**
   * Makes an HTTP GET request with timeout and retry logic.
   */
  private async requestWithRetry<T>(url: string, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.httpClient.get<T>(url, { signal: controller.signal });

      // Clear timeout on success
      clearTimeout(timeoutId);

      // Check for Pexels-style error response even with 200 status
      if (response && typeof response === "object" && "error" in response) {
        const errorResponse = response as { error: string };
        throw new Error(`Pexels API error: ${errorResponse.error}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Handle rate limiting (429)
      if (errorMessage.includes("429") || errorMessage.includes("Rate limit")) {
        const err = new Error(`Pexels rate limit exceeded: ${errorMessage}`);
        if (error instanceof Error) {
          err.cause = error;
        }
        throw err;
      }

      // Handle auth errors (401)
      if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
        const err = new Error(`Pexels authentication failed: ${errorMessage}`);
        if (error instanceof Error) {
          err.cause = error;
        }
        throw err;
      }

      // Retry on 5xx and network errors (but not on 4xx client errors)
      const isRetryable =
        errorMessage.includes("5") || // 5xx
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("AbortError") ||
        (error instanceof Error && error.name === "AbortError");

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.requestWithRetry<T>(url, attempt + 1);
      }

      // Re-throw non-retryable errors or exhausted retries
      throw error;
    }
  }
}

/**
 * Default HTTP client for Pexels API using fetch with Authorization header.
 */
class DefaultPexelsHttpClient implements HttpGetClient {
  constructor(private readonly apiKey: string) {}

  async get<T>(url: string, options?: { signal?: AbortSignal | undefined }): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
      },
      signal: options?.signal ?? null,
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = await response.text();
        try {
          const errorJson = JSON.parse(errorBody) as PexelsErrorResponse;
          errorMessage = errorJson.error ?? `HTTP ${response.status}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorBody.slice(0, 200)}`;
        }
      } catch {
        errorMessage = `HTTP ${response.status}`;
      }

      // Throw typed error based on status
      if (response.status === 429) {
        throw new Error(`Pexels rate limit exceeded: ${errorMessage}`);
      }
      if (response.status === 401) {
        throw new Error(`Pexels authentication failed: ${errorMessage}`);
      }
      throw new Error(`Pexels API error: ${errorMessage}`);
    }

    return response.json() as Promise<T>;
  }

  post<T>(_url: string, _body: unknown): Promise<T> {
    void _url;
    void _body;
    // Pexels API only uses GET for search endpoints
    throw new Error("PexelsClient does not support POST requests");
  }
}
