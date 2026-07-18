import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ReviewApiClient, ReviewApiError } from "../../../web/src/api/review-api.js";
import type { ProjectApiResponse } from "../../../web/src/types.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetchSuccess(): void {
  const project = createMinimalProject();
  const response: ProjectApiResponse = { ok: true, project };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
    }),
  );
}

function mockFetchError(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchNetworkError(): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
}

describe("ReviewApiClient", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. getProject success — parses project correctly", async () => {
    mockFetchSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const project = await client.getProject();

    expect(project.schemaVersion).toBe("0.1");
    expect(project.project.title).toBe("测试项目");
    expect(project.scenes).toHaveLength(2);
    expect(project.scenes[0]!.search.candidates).toHaveLength(1);
  });

  it("2. getProject 401 — returns session_required error", async () => {
    mockFetchError(401, {
      ok: false,
      error: {
        code: "session_required",
        message: "Session token is required",
        hint: "Provide X-S2S-Session header",
      },
    });

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "wrong-token",
    });

    await expect(client.getProject()).rejects.toThrow(ReviewApiError);

    try {
      await client.getProject();
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("session_required");
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.message).toBe("Session token is required");
    }
  });

  it("3. getProject 403 — returns session_rejected error", async () => {
    mockFetchError(403, {
      ok: false,
      error: {
        code: "session_rejected",
        message: "Session token is invalid",
      },
    });

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "bad-token",
    });

    try {
      await client.getProject();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("session_rejected");
      expect(apiErr.statusCode).toBe(403);
    }
  });

  it("4. getProject network failure — returns network_error", async () => {
    mockFetchNetworkError();

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.getProject();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("network_error");
      expect(apiErr.message).toContain("无法连接到本地 Review Server");
      expect(apiErr.hint).toContain("pnpm start");
    }
  });

  it("5. getHealth success — does not require token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            projectRoot: "/tmp/project",
            host: "127.0.0.1",
            port: 3210,
            version: "s2s-review-server/0.1",
          }),
      }),
    );

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const health = await client.getHealth();

    expect(health.ok).toBe(true);
    expect(health.host).toBe("127.0.0.1");
    expect(health.port).toBe(3210);

    // Verify fetch was called without X-S2S-Session header
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-S2S-Session"]).toBeUndefined();
  });

  it("6. getProject sends X-S2S-Session header", async () => {
    mockFetchSuccess();

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "my-secret-token",
    });

    await client.getProject();

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-S2S-Session"]).toBe("my-secret-token");
  });

  it("7. getProject 404 — returns not_found error", async () => {
    mockFetchError(404, {
      ok: false,
      error: { code: "not_found", message: "Not found" },
    });

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.getProject();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("not_found");
      expect(apiErr.statusCode).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Mutation methods — searchScene (Phase 1 material-discovery redesign)
//
// selectCandidate / skipScene / uploadLocalAsset have been removed. Only the
// multi-source search mutation remains.
// ---------------------------------------------------------------------------

describe("ReviewApiClient — searchScene mutation", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockMutationSuccess(): void {
    const project = createMinimalProject();
    const response: ProjectApiResponse = { ok: true, project };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(response),
      }),
    );
  }

  it("8. searchScene sends POST /api/scenes/:sceneId/search with providers/refresh/limit", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.searchScene("scene-001", {
      providers: ["fixture", "pexels"],
      refresh: true,
      limit: 12,
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;

    expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/search");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["X-S2S-Session"]).toBe("test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.providers).toEqual(["fixture", "pexels"]);
    expect(body.refresh).toBe(true);
    expect(body.limit).toBe(12);
    // Body must NOT contain forbidden fields
    expect(body.projectRoot).toBeUndefined();
    expect(body.sceneId).toBeUndefined();
    expect(body.provider).toBeUndefined();
  });

  it("9. searchScene omits providers when not specified", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.searchScene("scene-001", { refresh: true, limit: 12 });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const init = fetchCall[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.providers).toBeUndefined();
    expect(body.refresh).toBe(true);
    expect(body.limit).toBe(12);
  });

  it("10. searchScene returns project from { ok:true, project }", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const project = await client.searchScene("scene-001", { refresh: true });

    expect(project.schemaVersion).toBe("0.1");
    expect(project.project.title).toBe("测试项目");
  });

  it("11. searchScene 409 conflict — returns ReviewApiError with code/status/message/hint", async () => {
    mockFetchError(409, {
      ok: false,
      error: {
        code: "conflict",
        message: "Conflict with current project state",
        hint: "Refresh the project and retry",
      },
    });

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.searchScene("scene-001", { refresh: true });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("conflict");
      expect(apiErr.statusCode).toBe(409);
      expect(apiErr.message).toBe("Conflict with current project state");
      expect(apiErr.hint).toBe("Refresh the project and retry");
    }
  });

  it("12. searchScene network error — returns network_error without token in message", async () => {
    mockFetchNetworkError();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "super-secret-token-123",
    });

    try {
      await client.searchScene("scene-001", { refresh: true });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("network_error");
      // Token must not appear in error message or hint
      expect(apiErr.message).not.toContain("super-secret-token-123");
      expect(apiErr.hint ?? "").not.toContain("super-secret-token-123");
    }
  });

  it("13. searchScene 401 — returns session_required, token not in message", async () => {
    mockFetchError(401, {
      ok: false,
      error: { code: "session_required", message: "Session token is required" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "my-secret-token",
    });

    try {
      await client.searchScene("scene-001", { refresh: true });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("session_required");
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.message).not.toContain("my-secret-token");
    }

    // Verify the token was sent in the header
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-S2S-Session"]).toBe("my-secret-token");
  });

  it("14. searchScene 400 invalid_request — returns invalid_request error", async () => {
    mockFetchError(400, {
      ok: false,
      error: { code: "invalid_request", message: "Invalid request body" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.searchScene("scene-001", { providers: ["unknown" as never] });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("invalid_request");
      expect(apiErr.statusCode).toBe(400);
    }
  });

  it("15. searchScene 500 internal_error — returns generic message without stack/path", async () => {
    mockFetchError(500, {
      ok: false,
      error: { code: "internal_error", message: "Internal server error" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.searchScene("scene-001", { refresh: true });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("internal_error");
      expect(apiErr.statusCode).toBe(500);
      // No stack trace or absolute path in message
      expect(apiErr.message).not.toContain("/home/");
      expect(apiErr.message).not.toContain("at ");
    }
  });

  it("16. searchScene 403 session_rejected — returns session_rejected error", async () => {
    mockFetchError(403, {
      ok: false,
      error: { code: "session_rejected", message: "Session token is invalid" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "bad-token",
    });

    try {
      await client.searchScene("scene-001", { refresh: true });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("session_rejected");
      expect(apiErr.statusCode).toBe(403);
    }
  });
});
