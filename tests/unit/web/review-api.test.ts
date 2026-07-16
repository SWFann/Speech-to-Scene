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
      expect(apiErr.hint).toContain("pnpm s2s review");
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
