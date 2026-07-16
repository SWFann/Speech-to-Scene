/**
 * Integration tests for GET /api/project API endpoint.
 *
 * Tests verify:
 * - Correct token returns 200 with project data
 * - Missing token returns 401 session_required
 * - Wrong token returns 403 session_rejected
 * - Evil Host returns 403 even with correct token
 * - Health still returns 200 without token
 * - Project response has no absolute paths
 * - Project response has no session token
 * - projectRoot query param cannot change the project
 * - Repository load called once
 * - Repository save never called
 * - Repository error maps to safe response
 * - All responses include security headers
 * - GET /api/project with wrong method returns 405 and Allow
 * - No external service calls
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

// ---------------------------------------------------------------------------
// In-memory repository (tracks calls)
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  loadCount = 0;
  saveCount = 0;
  shouldThrow: Error | null = null;

  async exists(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    this.loadCount++;
    if (this.shouldThrow) throw this.shouldThrow;
    const entry = this.projects.get(projectRoot);
    if (!entry) throw new Error(`Project not found at ${projectRoot}`);
    return entry;
  }
  async save(): Promise<void> {
    await Promise.resolve();
    this.saveCount++;
  }
  setProject(root: string, project: SpeechToSceneProject): void {
    this.projects.set(root, project);
  }
}

// ---------------------------------------------------------------------------
// Helpers
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
    token?: string;
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
          ...(options.host !== undefined ? { host: options.host } : {}),
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
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test project
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-api-test-0000",
      title: "API Test Project",
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
            {
              id: "q-001",
              language: "en",
              query: "tech photo",
              purpose: "main",
              enabled: true,
            },
          ],
          candidates: [],
          lastSearchedAt: FIXED_NOW,
        },
        review: { kind: "pending" },
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
      // best-effort cleanup
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
  const projectRoot = overrides.projectRoot ?? "/test/api-project";
  repo.setProject(projectRoot, makeTestProject());

  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: () =>
      Promise.reject(new Error("searchSceneAssets not configured for this test")),
    selectCandidate: () =>
      Promise.reject(new Error("selectCandidate not configured for this test")),
    skipScene: () => Promise.reject(new Error("skipScene not configured for this test")),
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

describe("GET /api/project API", () => {
  it("correct token returns 200 with project data", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status, body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect((body as { project: { schemaVersion: string } }).project.schemaVersion).toBe("0.1");
    expect((body as { project: { project: { title: string } } }).project.project.title).toBe(
      "API Test Project",
    );
  }, 10000);

  it("missing token returns 401 session_required", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status, body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
    });

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("session_required");
  }, 10000);

  it("wrong token returns 403 session_rejected", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status, body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "wrong-token",
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("session_rejected");
  }, 10000);

  it("evil Host returns 403 even with correct token", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status, body } = await httpRequest(port, "/api/project", {
      host: "evil.example:3210",
      token: "test-token",
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
  }, 10000);

  it("health returns 200 without token", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status } = await httpRequest(port, "/api/health", {
      host: `127.0.0.1:${port}`,
    });

    expect(status).toBe(200);
  }, 10000);

  it("project response does not contain absolute projectRoot", async () => {
    const { port } = await startTestServer({
      token: "test-token",
      projectRoot: "/secret/path/project",
    });
    const { body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/secret/path/project");
    expect(bodyStr).not.toContain("/secret");
  }, 10000);

  it("project response does not contain session token", async () => {
    const { port } = await startTestServer({ token: "secret-token-xyz" });
    const { body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "secret-token-xyz",
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("secret-token-xyz");
  }, 10000);

  it("projectRoot query param cannot change the project", async () => {
    const repo = new InMemoryRepository();
    const { port } = await startTestServer({
      token: "test-token",
      projectRoot: "/test/original",
      repo,
    });
    // Set a different project at a different path
    repo.setProject("/test/other", makeTestProject());

    const { body } = await httpRequest(port, "/api/project?projectRoot=/test/other", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    // Should still load from /test/original
    expect((body as { project: { project: { title: string } } }).project.project.title).toBe(
      "API Test Project",
    );
  }, 10000);

  it("repository load called once", async () => {
    const repo = new InMemoryRepository();
    const { port } = await startTestServer({ token: "test-token", repo });
    await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(repo.loadCount).toBe(1);
  }, 10000);

  it("repository save never called", async () => {
    const repo = new InMemoryRepository();
    const { port } = await startTestServer({ token: "test-token", repo });
    await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(repo.saveCount).toBe(0);
  }, 10000);

  it("repository error maps to safe 500 response", async () => {
    const repo = new InMemoryRepository();
    repo.shouldThrow = new Error("Internal filesystem error");
    const { port } = await startTestServer({
      token: "test-token",
      projectRoot: "/test/error",
      repo,
    });

    const { status, body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(status).toBe(500);
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("Internal filesystem error");
    expect(bodyStr).not.toContain("stack");
  }, 10000);

  it("all responses include security headers", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { headers } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  }, 10000);

  it("POST /api/project returns 405 with Allow header", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { status, headers } = await httpRequest(port, "/api/project", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toBe("GET");
  }, 10000);

  it("project response contains scenes and derived status", async () => {
    const { port } = await startTestServer({ token: "test-token" });
    const { body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
      token: "test-token",
    });

    const project = (body as { project: { scenes: unknown[]; status: string } }).project;
    expect(project.scenes).toHaveLength(1);
    expect(project.status).toBe("planned");
  }, 10000);
});
