/**
 * Integration tests for PUT /api/scenes/:sceneId/queries API endpoint.
 *
 * Tests verify:
 *  1. Correct token successfully replaces queries
 *  2. Candidates are preserved
 *  3. lastSearchedAt is preserved
 *  4. Missing token → 401 session_required
 *  5. Wrong token → 403 session_rejected
 *  6. Evil Host → 403 host_rejected
 *  7. Bad Origin → 403 origin_rejected
 *  8. Malformed JSON → 400 invalid_json
 *  9. Duplicate query id → 400 invalid_request
 * 10. stock_asset without enabled query → 409 conflict
 * 11. Replacing query IDs that invalidate candidates → 409 conflict
 * 12. Scene not found → 404 not_found
 * 13. 405 Allow header
 * 14. Response does not leak sensitive info
 * 15. Unknown top-level field 'extra' → 400 invalid_request (M4-04BF)
 * 16. Body attempting to override projectRoot → 400 (M4-04BF)
 * 17. Body attempting to override sceneId → 400 (M4-04BF)
 * 18. Body with only unknown field → 400 (M4-04BF)
 * 19. queries as non-array → 400 (M4-04BF)
 */

import http from "node:http";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type {
  ReviewServerHandle,
  ReviewServerDependencies,
} from "../../src/review/review-types.js";
import { getReviewProject } from "../../src/application/get-review-project.js";
import { updateScene } from "../../src/application/update-scene.js";
import { updateSceneQueries } from "../../src/application/update-scene-queries.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import type { AssetCandidate } from "../../src/domain/asset-schema.js";

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  loadCount = 0;
  saveCount = 0;

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return true;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    this.loadCount++;
    const entry = this.projects.get(projectRoot);
    if (!entry) throw new Error(`Project not found at ${projectRoot}`);
    return JSON.parse(JSON.stringify(entry)) as SpeechToSceneProject;
  }
  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
    const clone = JSON.parse(JSON.stringify(project)) as SpeechToSceneProject;
    this.projects.set(projectRoot, clone);
    void projectRoot;
  }
  setProject(root: string, project: SpeechToSceneProject): void {
    this.projects.set(root, JSON.parse(JSON.stringify(project)) as SpeechToSceneProject);
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function httpRequest(
  port: number,
  path: string,
  options: {
    method?: string;
    host?: string;
    origin?: string;
    token?: string;
    body?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          "content-type": "application/json",
          ...(options.host !== undefined ? { host: options.host } : {}),
          ...(options.origin !== undefined ? { origin: options.origin } : {}),
          ...(options.token !== undefined ? { "x-s2s-session": options.token } : {}),
        },
      },
      (res) => {
        const chunks: Array<Buffer | Uint8Array> = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer | Uint8Array));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              responseHeaders[key.toLowerCase()] = value;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: responseHeaders, body });
        });
      },
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test project
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeTestCandidate(): AssetCandidate {
  return {
    kind: "asset" as const,
    id: "cand-001",
    provider: {
      id: "fixture",
      name: "Fixture",
      homepageUrl: "https://example.com",
      termsUrl: "https://example.com/terms",
      policyRevision: "1.0",
      termsCheckedAt: "2025-01-01T00:00:00.000Z",
    },
    providerAssetId: "asset-1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/thumb.jpg",
    sourcePageUrl: "https://example.com/page",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Test Creator" },
    rights: {
      status: "platform_license",
      licenseUrl: "https://www.pexels.com/license/",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: "2026-07-14T10:00:00.000Z",
      evidence: {
        capturedAt: "2026-07-14T10:00:00.000Z",
        referenceUrl: "https://www.pexels.com/license/",
        fields: { source: "pexels_api" },
      },
    },
    retrievedAt: "2026-07-14T10:00:00.000Z",
    matchedQueryId: "q-001",
    rank: 1,
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-queries-api-test",
      title: "Queries API Test",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: "a".repeat(64),
      encoding: "utf-8",
      sizeBytes: 50,
      textLengthUtf16: 25,
      offsetUnit: "utf16_code_unit",
      blocks: [
        { id: "block-001", order: 1, kind: "paragraph", sourceRange: { start: 0, end: 25 } },
      ],
    },
    generation: {
      plannerProvider: "fixture",
      promptVersion: "v1",
      plannerOutputSchemaVersion: "0.1",
      sourceBlockVersion: "0.1",
      generatedAt: FIXED_NOW,
    },
    scenes: [
      {
        id: "scene-001",
        order: 1,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Hello world content.",
        summary: "Test scene",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need visual",
          preferredMedia: ["photo"],
          visualKeywords: ["tech"],
        },
        search: {
          queries: [
            { id: "q-001", language: "en", query: "tech photo", purpose: "main", enabled: true },
          ],
          candidates: [makeTestCandidate()],
          lastSearchedAt: FIXED_NOW,
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const servers: Array<{ handle: ReviewServerHandle }> = [];

afterEach(async () => {
  for (const { handle } of servers) {
    try {
      await handle.close();
    } catch {
      // best-effort
    }
  }
  servers.length = 0;
});

async function startTestServer(
  overrides: {
    projectRoot?: string;
    token?: string;
    repo?: InMemoryRepository;
  } = {},
): Promise<{ handle: ReviewServerHandle; port: number; repo: InMemoryRepository }> {
  const repo = overrides.repo ?? new InMemoryRepository();
  const projectRoot = overrides.projectRoot ?? "/test/queries-api";
  repo.setProject(projectRoot, makeTestProject());

  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: () =>
      Promise.reject(new Error("searchSceneAssets not configured for this test")),
  };

  const handle = await startReviewServer(
    {
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      ...(overrides.token !== undefined ? { token: overrides.token } : {}),
    },
    deps,
  );
  servers.push({ handle });
  return { handle, port: handle.port, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/scenes/:sceneId/queries", () => {
  it("1. correct token successfully replaces queries", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [
          { id: "q-001", language: "zh", query: "新查询", purpose: "main", enabled: true },
          { id: "q-new-2", language: "en", query: "new search", purpose: "alt", enabled: false },
        ],
      }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    // Step-by-step casts to avoid parser issues with nested generics
    const qProject = (body as { project: unknown }).project;
    const qScenes = (qProject as { scenes: unknown[] }).scenes;
    const qScene0 = qScenes[0] as { search: { queries: Array<{ id: string }> } };
    const queries = qScene0.search.queries;
    expect(queries).toHaveLength(2);
    expect(queries[0]!.id).toBe("q-001");
    expect(queries[1]!.id).toBe("q-new-2");
  }, 10000);

  it("2. candidates are preserved after query replacement", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [
          { id: "q-001", language: "en", query: "updated query", purpose: "main", enabled: true },
        ],
      }),
    });

    expect(status).toBe(200);
    const candidates = (
      body as { project: { scenes: Array<{ search: { candidates: unknown[] } }> } }
    ).project.scenes[0]!.search.candidates;
    expect(candidates).toHaveLength(1);
  }, 10000);

  it("3. lastSearchedAt is preserved", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [
          { id: "q-001", language: "en", query: "updated", purpose: "main", enabled: true },
        ],
      }),
    });

    expect(status).toBe(200);
    const lastSearchedAt = (
      body as { project: { scenes: Array<{ search: { lastSearchedAt: string | null } }> } }
    ).project.scenes[0]!.search.lastSearchedAt;
    expect(lastSearchedAt).toBe(FIXED_NOW);
  }, 10000);

  it("4. missing token → 401 session_required", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("session_required");
  }, 10000);

  it("5. wrong token → 403 session_rejected", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "wrong",
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("session_rejected");
  }, 10000);

  it("6. evil Host → 403 host_rejected", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: "evil.example:3210",
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
  }, 10000);

  it("7. bad Origin → 403 origin_rejected", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      origin: "https://evil.example",
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("origin_rejected");
  }, 10000);

  it("8. malformed JSON → 400 invalid_json", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: "{broken json",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  }, 10000);

  it("9. duplicate query id → 400 invalid_request", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [
          { id: "q-dup", language: "en", query: "first", purpose: "main", enabled: true },
          { id: "q-dup", language: "en", query: "second", purpose: "alt", enabled: false },
        ],
      }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("10. stock_asset without enabled query → 409 conflict", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: false }],
      }),
    });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("conflict");
  }, 10000);

  it("11. replacing query IDs that invalidate candidates → 409 conflict", async () => {
    const { port } = await startTestServer({ token: "tok" });
    // scene-001 has candidate with matchedQueryId "q-001"
    // We replace with query IDs that don't include "q-001"
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [
          { id: "q-different", language: "en", query: "x", purpose: "main", enabled: true },
        ],
      }),
    });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("conflict");
  }, 10000);

  it("12. scene not found → 404 not_found", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/non-existent/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-1", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  }, 10000);

  it("13. 405 Allow header for GET on PUT-only route", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, headers } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toContain("PUT");
  }, 10000);

  it("14. response does not leak sensitive info", async () => {
    const { port } = await startTestServer({
      token: "super-secret-token",
      projectRoot: "/very/secret/path",
    });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "super-secret-token",
      body: JSON.stringify({
        queries: [{ id: "q-001", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/very/secret/path");
    expect(bodyStr).not.toContain("super-secret-token");
    expect(bodyStr).not.toContain("stack");
  }, 10000);

  // -----------------------------------------------------------------------
  // M4-04BF P1-1: strict body validation — unknown top-level fields
  // -----------------------------------------------------------------------

  it("15. rejects unknown top-level field 'extra' → 400 invalid_request", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-001", language: "en", query: "x", purpose: "main", enabled: true }],
        extra: "bad",
      }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("16. rejects body attempting to override projectRoot → 400", async () => {
    const { port, repo } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-001", language: "en", query: "x", purpose: "main", enabled: true }],
        projectRoot: "/evil/path",
      }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
    // Verify the actual project root was NOT overridden
    const proj = await repo.load("/test/queries-api");
    expect(proj.project.id).toBe("proj-queries-api-test");
  }, 10000);

  it("17. rejects body attempting to override sceneId → 400", async () => {
    const { port, repo } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-001", language: "en", query: "x", purpose: "main", enabled: true }],
        sceneId: "evil-scene",
      }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
    // Verify scene-001 still exists (sceneId not overridden)
    const proj = await repo.load("/test/queries-api");
    expect(proj.scenes[0]!.id).toBe("scene-001");
  }, 10000);

  it("18. rejects body with only unknown field (no queries) → 400", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ extra: "bad" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("19. rejects body with queries as non-array → 400", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/queries", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ queries: "not-an-array" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);
});
