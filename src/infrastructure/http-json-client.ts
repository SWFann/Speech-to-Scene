/**
 * HTTP JSON client for infrastructure providers.
 *
 * Provides a thin, testable wrapper around Node.js fetch for JSON APIs.
 * No provider-specific logic lives here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpJsonClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly timeoutMs?: number;
}

export interface HttpJsonResponse<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly headers: Headers;
  readonly requestId?: string;
}

export interface HttpJsonError {
  readonly message: string;
  readonly statusCode?: number;
  readonly requestId?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Minimal HTTP JSON client.
 *
 * Uses the global fetch API (available in Node.js 18+).
 */
export class HttpJsonClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: HttpJsonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, ""); // strip trailing slashes
    this.apiKey = options.apiKey;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...options.defaultHeaders,
    };
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * Performs a JSON POST request.
   */
  async post<T = unknown>(path: string, body: unknown): Promise<HttpJsonResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...this.defaultHeaders,
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const requestId = response.headers.get("x-request-id");
      let data: T;
      try {
        data = (await response.json()) as T;
      } catch {
        data = {} as T;
      }

      const result: HttpJsonResponse<T> = {
        ok: response.ok,
        status: response.status,
        data,
        headers: response.headers,
      };
      if (requestId !== null) {
        (result as { requestId?: string }).requestId = requestId;
      }
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
