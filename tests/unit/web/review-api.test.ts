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
// Mutation methods (M5-02)
// ---------------------------------------------------------------------------

describe("ReviewApiClient — mutation methods", () => {
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

  it("8. selectCandidate sends PUT /api/scenes/:sceneId/selection with correct body", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.selectCandidate("scene-001", {
      candidateId: "cand-safe",
      rightsAcknowledged: false,
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;

    expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/selection");
    expect(init.method).toBe("PUT");

    const headers = init.headers as Record<string, string>;
    expect(headers["X-S2S-Session"]).toBe("test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.candidateId).toBe("cand-safe");
    expect(body.rightsAcknowledged).toBe(false);
    // Body must NOT contain forbidden fields
    expect(body.projectRoot).toBeUndefined();
    expect(body.sceneId).toBeUndefined();
  });

  it("9. selectCandidate returns project from { ok:true, project }", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const project = await client.selectCandidate("scene-001", {
      candidateId: "cand-safe",
      rightsAcknowledged: false,
    });

    expect(project.schemaVersion).toBe("0.1");
    expect(project.project.title).toBe("测试项目");
  });

  it("10. selectCandidate 409 conflict — returns ReviewApiError with code/status/message/hint", async () => {
    mockFetchError(409, {
      ok: false,
      error: {
        code: "conflict",
        message: "Candidate requires rights acknowledgement",
        hint: "Confirm the rights warning and retry",
      },
    });

    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.selectCandidate("scene-001", {
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("conflict");
      expect(apiErr.statusCode).toBe(409);
      expect(apiErr.message).toBe("Candidate requires rights acknowledgement");
      expect(apiErr.hint).toBe("Confirm the rights warning and retry");
    }
  });

  it("11. skipScene sends PUT /api/scenes/:sceneId/skip", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.skipScene("scene-001", { note: "不需要" });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;

    expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/skip");
    expect(init.method).toBe("PUT");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.note).toBe("不需要");
    expect(body.projectRoot).toBeUndefined();
    expect(body.sceneId).toBeUndefined();
  });

  it("12. skipScene without note sends empty object", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.skipScene("scene-001");

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const init = fetchCall[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toHaveLength(0);
  });

  it("13. searchScene sends POST /api/scenes/:sceneId/search with provider/refresh/limit", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    await client.searchScene("scene-001", {
      provider: "fixture",
      refresh: true,
      limit: 12,
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;

    expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/search");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.provider).toBe("fixture");
    expect(body.refresh).toBe(true);
    expect(body.limit).toBe(12);
    expect(body.projectRoot).toBeUndefined();
  });

  it("14. uploadLocalAsset sends FormData without manual Content-Type", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const file = new File(["fake-png-bytes"], "photo.png", { type: "image/png" });

    await client.uploadLocalAsset("scene-001", {
      file,
      provenance: { kind: "user_owned" },
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;

    expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/local-asset");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // X-S2S-Session should be set
    expect(headers["X-S2S-Session"]).toBe("test-token");
    // Content-Type must NOT be set manually — browser sets it with boundary
    expect(headers["Content-Type"]).toBeUndefined();

    // Body should be FormData
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("provenance")).toBe(JSON.stringify({ kind: "user_owned" }));
  });

  it("15. uploadLocalAsset with selected_candidate provenance sends candidateId", async () => {
    mockMutationSuccess();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const file = new File(["fake-png-bytes"], "photo.png", { type: "image/png" });

    await client.uploadLocalAsset("scene-001", {
      file,
      provenance: { kind: "selected_candidate", candidateId: "cand-safe" },
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const init = fetchCall[1] as RequestInit;
    const formData = init.body as FormData;
    const provenance = JSON.parse(formData.get("provenance") as string) as Record<string, unknown>;
    expect(provenance.kind).toBe("selected_candidate");
    expect(provenance.candidateId).toBe("cand-safe");
  });

  it("16. mutation network error — returns network_error without token in message", async () => {
    mockFetchNetworkError();
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "super-secret-token-123",
    });

    try {
      await client.skipScene("scene-001");
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

  it("17. mutation 401 error — headers include token but error message does not", async () => {
    mockFetchError(401, {
      ok: false,
      error: { code: "session_required", message: "Session token is required" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "my-secret-token",
    });

    try {
      await client.selectCandidate("scene-001", {
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      });
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

  it("18. mutation 400 invalid_request — returns invalid_request error", async () => {
    mockFetchError(400, {
      ok: false,
      error: { code: "invalid_request", message: "Invalid request body" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.searchScene("scene-001", { provider: "fixture" });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("invalid_request");
      expect(apiErr.statusCode).toBe(400);
    }
  });

  it("19. upload 413 payload_too_large — returns payload_too_large error", async () => {
    mockFetchError(413, {
      ok: false,
      error: { code: "payload_too_large", message: "Upload exceeds size limit" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const file = new File(["x".repeat(100)], "big.png", { type: "image/png" });

    try {
      await client.uploadLocalAsset("scene-001", {
        file,
        provenance: { kind: "user_owned" },
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("payload_too_large");
      expect(apiErr.statusCode).toBe(413);
    }
  });

  it("20. upload 415 unsupported_media_type — returns unsupported_media_type error", async () => {
    mockFetchError(415, {
      ok: false,
      error: { code: "unsupported_media_type", message: "Only PNG/JPEG supported" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    const file = new File(["x"], "file.svg", { type: "image/svg+xml" });

    try {
      await client.uploadLocalAsset("scene-001", {
        file,
        provenance: { kind: "user_owned" },
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("unsupported_media_type");
      expect(apiErr.statusCode).toBe(415);
    }
  });

  it("21. mutation 500 internal_error — returns generic message without stack/path", async () => {
    mockFetchError(500, {
      ok: false,
      error: { code: "internal_error", message: "Internal server error" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "test-token",
    });

    try {
      await client.skipScene("scene-001");
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

  it("22. selectCandidate 403 session_rejected — returns session_rejected error", async () => {
    mockFetchError(403, {
      ok: false,
      error: { code: "session_rejected", message: "Session token is invalid" },
    });
    const client = new ReviewApiClient({
      baseUrl: "http://127.0.0.1:3210",
      token: "bad-token",
    });

    try {
      await client.selectCandidate("scene-001", {
        candidateId: "cand-safe",
        rightsAcknowledged: false,
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReviewApiError);
      const apiErr = err as ReviewApiError;
      expect(apiErr.code).toBe("session_rejected");
      expect(apiErr.statusCode).toBe(403);
    }
  });
});
