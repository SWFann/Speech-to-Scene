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
 *
 * Phase 1 material-discovery redesign:
 * - selectCandidate / skipScene / uploadLocalAsset have been removed.
 * - searchScene / searchProject accept a `providers` array (multi-source).
 */

import type {
  ProjectApiResponse,
  HealthApiResponse,
  ApiErrorResponse,
  ReviewProjectView,
  SettingsView,
  SearchProviderName,
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
  if (port && /^[0-9]{1,5}$/.test(port)) {
    const portNumber = Number(port);
    if (portNumber >= 1 && portNumber <= 65535) {
      return `http://127.0.0.1:${portNumber}`;
    }
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
        case 400:
          message = "请求无效";
          errorCode = "invalid_request";
          break;
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
        case 409:
          message = "当前操作与项目状态冲突";
          errorCode = "conflict";
          break;
        case 422:
          message = "LLM 规划输出不符合要求";
          errorCode = "planner_error";
          break;
        case 500:
          message = "服务器内部错误";
          errorCode = "internal_error";
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
        "运行 pnpm start 启动服务器",
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
        "运行 pnpm start 启动服务器",
      );
    }

    const result = await this.handleResponse<ProjectApiResponse>(response);
    return result.project;
  }

  // ---------------------------------------------------------------------
  // Mutation methods
  // ---------------------------------------------------------------------

  /**
   * Shared helper for JSON mutation requests.
   */
  private async jsonMutation(
    path: string,
    method: "PUT" | "POST" | "PATCH",
    body: unknown,
  ): Promise<ReviewProjectView> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path), {
        method,
        headers: {
          ...this.getHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ReviewApiError(
        "无法连接到本地 Review Server，请确认服务器已启动",
        "network_error",
        0,
        "运行 pnpm start 启动服务器",
      );
    }

    const result = await this.handleResponse<ProjectApiResponse>(response);
    return result.project;
  }

  /**
   * POST /api/scenes/:sceneId/search
   *
   * Triggers a multi-source asset search for exactly one scene.
   * Returns the fresh UI-safe project view after search completes.
   */
  async searchScene(
    sceneId: string,
    input: { providers?: readonly SearchProviderName[]; refresh?: boolean; limit?: number },
  ): Promise<ReviewProjectView> {
    const body: Record<string, unknown> = {};
    if (input.providers !== undefined && input.providers.length > 0) {
      body.providers = input.providers;
    }
    if (input.refresh !== undefined) body.refresh = input.refresh;
    if (input.limit !== undefined) body.limit = input.limit;
    return this.jsonMutation(`/api/scenes/${encodeURIComponent(sceneId)}/search`, "POST", body);
  }

  /**
   * POST /api/scenes/:sceneId/generate
   *
   * Generates an AI image for a scene using a text-to-image model.
   * Returns the fresh UI-safe project view after generation completes.
   */
  async generateSceneImage(
    sceneId: string,
    input: { prompt: string; aspectRatio?: "9:16" | "16:9" | "1:1" },
  ): Promise<ReviewProjectView> {
    const body: Record<string, unknown> = { prompt: input.prompt };
    if (input.aspectRatio !== undefined) body.aspectRatio = input.aspectRatio;
    return this.jsonMutation(`/api/scenes/${encodeURIComponent(sceneId)}/generate`, "POST", body);
  }

  // ---- F1: one-click project lifecycle + settings ----

  /**
   * POST /api/project/create — create project from uploaded text content.
   */
  async createProject(input: {
    content: string;
    fileName?: string;
    title?: string;
    language?: "zh-CN" | "en-US";
    aspectRatio?: "9:16" | "16:9" | "1:1";
    style?: "knowledge" | "story" | "commentary";
    intendedUse?: "commercial_capable" | "noncommercial" | "editorial";
    willModify?: boolean;
    force?: boolean;
  }): Promise<ReviewProjectView> {
    const body: Record<string, unknown> = { content: input.content };
    if (input.fileName !== undefined) body.fileName = input.fileName;
    if (input.title !== undefined) body.title = input.title;
    if (input.language !== undefined) body.language = input.language;
    if (input.aspectRatio !== undefined) body.aspectRatio = input.aspectRatio;
    if (input.style !== undefined) body.style = input.style;
    if (input.intendedUse !== undefined) body.intendedUse = input.intendedUse;
    if (input.willModify !== undefined) body.willModify = input.willModify;
    if (input.force !== undefined) body.force = input.force;
    return this.jsonMutation("/api/project/create", "POST", body);
  }

  /**
   * POST /api/project/plan — slice script into scenes via planner.
   */
  async planProject(input: {
    provider: "fixture" | "deepseek" | "stepfun";
    maxScenes?: number;
    force?: boolean;
  }): Promise<ReviewProjectView> {
    const body: Record<string, unknown> = { provider: input.provider };
    if (input.maxScenes !== undefined) body.maxScenes = input.maxScenes;
    if (input.force !== undefined) body.force = input.force;
    return this.jsonMutation("/api/project/plan", "POST", body);
  }

  /**
   * POST /api/project/search — search assets for all scenes (multi-source).
   */
  async searchProject(input: {
    providers?: readonly SearchProviderName[];
    refresh?: boolean;
    limit?: number;
  }): Promise<ReviewProjectView> {
    const body: Record<string, unknown> = {};
    if (input.providers !== undefined && input.providers.length > 0) {
      body.providers = input.providers;
    }
    if (input.refresh !== undefined) body.refresh = input.refresh;
    if (input.limit !== undefined) body.limit = input.limit;
    return this.jsonMutation("/api/project/search", "POST", body);
  }

  /**
   * GET /api/settings — load desensitized settings view.
   */
  async getSettings(): Promise<SettingsView> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl("/api/settings"), {
        method: "GET",
        headers: this.getHeaders(),
      });
    } catch {
      throw new ReviewApiError(
        "无法连接到本地 Review Server，请确认服务器已启动",
        "network_error",
        0,
        "运行 pnpm start 启动服务器",
      );
    }
    const result = await this.handleResponse<{ settings: SettingsView }>(response);
    return result.settings;
  }

  /**
   * PUT /api/settings — persist API keys to workspace .s2s/settings.json.
   */
  async saveSettings(input: Record<string, unknown>): Promise<SettingsView> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl("/api/settings"), {
        method: "PUT",
        headers: { ...this.getHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      throw new ReviewApiError(
        "无法连接到本地 Review Server，请确认服务器已启动",
        "network_error",
        0,
        "运行 pnpm start 启动服务器",
      );
    }
    const result = await this.handleResponse<{ settings: SettingsView }>(response);
    return result.settings;
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
