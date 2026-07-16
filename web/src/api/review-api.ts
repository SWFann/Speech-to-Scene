/**
 * API client for the Speech-to-Scene local Review Server.
 *
 * All requests go through the local HTTP API. The client never accesses
 * the filesystem directly.
 *
 * Token handling:
 * - The session token is read from the URL query (?token=...), localStorage,
 *   or a constructor parameter — never hardcoded.
 * - The token is sent via the X-S2S-Session header.
 * - The token is never logged or exposed in error messages.
 */

import type {
  ProjectApiResponse,
  HealthApiResponse,
  ApiErrorResponse,
  ReviewProjectView,
} from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewApiConfig {
  /** Base URL of the local review server, e.g. http://127.0.0.1:3210 */
  baseUrl: string;
  /** Session token for authenticated requests. */
  token: string;
}

export class ReviewApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "ReviewApiError";
  }
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the session token from multiple sources (in priority order):
 * 1. URL query parameter ?token=...
 * 2. localStorage key "s2s:session-token"
 * 3. null if not found
 *
 * In production, the user typically copies the token from the CLI output.
 */
export function resolveSessionToken(): string | null {
  if (typeof window === "undefined") return null;

  // 1. URL query
  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get("token");
  if (queryToken) {
    // Persist for subsequent visits
    try {
      localStorage.setItem("s2s:session-token", queryToken);
    } catch {
      // localStorage might be unavailable (private mode)
    }
    return queryToken;
  }

  // 2. localStorage
  try {
    const stored = localStorage.getItem("s2s:session-token");
    if (stored) return stored;
  } catch {
    // localStorage might be unavailable
  }

  return null;
}

/**
 * Persist a session token to localStorage.
 */
export function saveSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("s2s:session-token", token);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Resolve the API base URL from the current browser location.
 * In dev mode, the Vite proxy handles /api requests, so the base URL is empty.
 * In production (served by the review server), same-origin applies.
 */
export function resolveBaseUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:3210";

  const params = new URLSearchParams(window.location.search);
  const port = params.get("port");
  if (port) {
    return `http://127.0.0.1:${port}`;
  }

  // Default: same origin (Vite proxy or review server static serving)
  return window.location.origin;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export class ReviewApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: ReviewApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private getHeaders(): Record<string, string> {
    return {
      "X-S2S-Session": this.token,
      Accept: "application/json",
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let errorBody: ApiErrorResponse | null = null;
      try {
        const body = (await response.json()) as unknown;
        if (
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof (body as Record<string, unknown>).error === "object"
        ) {
          errorBody = body as ApiErrorResponse;
        }
      } catch {
        // JSON parse failed; use status text
      }

      if (errorBody) {
        throw new ReviewApiError(
          errorBody.error.message,
          errorBody.error.code,
          response.status,
          errorBody.error.hint,
        );
      }

      // Map common status codes to user-friendly messages
      const code = response.status;
      let message: string;
      let errorCode: string;
      switch (code) {
        case 401:
          message = "需要提供 session token";
          errorCode = "session_required";
          break;
        case 403:
          message = "session token 无效或来源被拒绝";
          errorCode = "session_rejected";
          break;
        case 404:
          message = "请求的资源不存在";
          errorCode = "not_found";
          break;
        default:
          message = `服务器返回错误 ${code}`;
          errorCode = "server_error";
      }
      throw new ReviewApiError(message, errorCode, code);
    }

    const body = (await response.json()) as unknown;
    return body as T;
  }

  /**
   * GET /api/health
   * Does not require a token.
   */
  async getHealth(): Promise<HealthApiResponse> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl("/api/health"), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new ReviewApiError(
        "无法连接到本地 Review Server，请确认服务器已启动",
        "network_error",
        0,
        "运行 pnpm s2s review <project> --no-open 启动服务器",
      );
    }
    return this.handleResponse<HealthApiResponse>(response);
  }

  /**
   * GET /api/project
   * Requires a valid session token.
   */
  async getProject(): Promise<ReviewProjectView> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl("/api/project"), {
        method: "GET",
        headers: this.getHeaders(),
      });
    } catch {
      throw new ReviewApiError(
        "无法连接到本地 Review Server，请确认服务器已启动",
        "network_error",
        0,
        "运行 pnpm s2s review <project> --no-open 启动服务器",
      );
    }

    const result = await this.handleResponse<ProjectApiResponse>(response);
    return result.project;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ReviewApiClient from the current browser environment.
 * Returns null if no token is available.
 */
export function createClientFromEnv(): ReviewApiClient | null {
  const token = resolveSessionToken();
  if (!token) return null;

  const baseUrl = resolveBaseUrl();
  return new ReviewApiClient({ baseUrl, token });
}
