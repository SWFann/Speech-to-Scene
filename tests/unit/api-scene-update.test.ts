/**
 * Integration tests for PATCH /api/scenes/:sceneId API endpoint.
 *
 * Tests verify:
 *  1. Correct token successfully updates visualPlan
 *  2. Correct token successfully sets reviewNote
 *  3. reviewNote null deletes note
 *  4. { visualPlan: {} } → 400 invalid_request
 *  5. PATCH succeeds without session token (Phase 3)
 *  7. Evil Host → 403 (before body parse)
 *  8. Bad Origin → 403 origin_rejected
 *  9. Malformed JSON → 400 invalid_json
 * 10. Unknown field in body → 400 invalid_request
 * 11. Scene not found → 404 not_found
 * 12. stock_asset without enabled query → 409 conflict
 * 13. Response does not leak projectRoot/token/stack
 * 14. PATCH then GET /api/project shows the update
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
// In-memory repository
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  loadCount = 0;
  saveCount = 0;
  savedProjects: SpeechToSceneProject[] = [];

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
    this.savedProjects.push(clone);
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

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-scene-api-test",
      title: "Scene API Test",
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
          candidates: [],
          lastSearchedAt: FIXED_NOW,
        },
      },
      {
        id: "scene-002",
        order: 2,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Hello world content.",
        summary: "Second scene",
        narrativeRole: "conclusion",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Speaker only",
          preferredMedia: ["video"],
          visualKeywords: ["speaker"],
        },
        search: { queries: [], candidates: [] },
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
  const projectRoot = overrides.projectRoot ?? "/test/scene-api";
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

describe("PATCH /api/scenes/:sceneId", () => {
  it("1. successfully updates visualPlan", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({
        visualPlan: { rationale: "Updated rationale" },
      }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const project = (body as { project: { scenes: Array<{ visualPlan: { rationale: string } }> } })
      .project;
    expect(project.scenes[0]!.visualPlan.rationale).toBe("Updated rationale");
  }, 10000);

  it("2. reviewNote field is now rejected (unknown field) → 400 invalid_request", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ reviewNote: "A note from API" }),
    });

    // Phase 1 redesign: reviewNote is no longer a valid field — only visualPlan is accepted.
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("3. visualPlan update with multiple fields succeeds", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({
        visualPlan: { rationale: "Updated rationale", decision: "title_card" },
      }),
    });

    expect(status).toBe(200);
    const project = (
      body as {
        project: { scenes: Array<{ visualPlan: { rationale: string; decision: string } }> };
      }
    ).project;
    expect(project.scenes[0]!.visualPlan.rationale).toBe("Updated rationale");
    expect(project.scenes[0]!.visualPlan.decision).toBe("title_card");
  }, 10000);

  it("4. { visualPlan: {} } → 400 invalid_request", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: {} }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("5. PATCH succeeds without session token (Phase 3)", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
  }, 10000);

  it("7. evil Host → 403 (before body parse)", async () => {
    const { port, repo } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: "evil.example:3210",
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
    // Save should not have been called
    expect(repo.saveCount).toBe(0);
  }, 10000);

  it("8. bad Origin → 403 origin_rejected", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      origin: "https://evil.example",
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("origin_rejected");
  }, 10000);

  it("9. malformed JSON → 400 invalid_json", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: "{not valid json",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  }, 10000);

  it("10. unknown field in body → 400 invalid_request", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "x" }, extraField: "bad" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("11. scene not found → 404 not_found", async () => {
    const { port } = await startTestServer();
    const { status, body } = await httpRequest(port, "/api/scenes/non-existent", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  }, 10000);

  it("12. stock_asset without enabled query → PATCH succeeds (gating removed)", async () => {
    const repo = new InMemoryRepository();
    const projectRoot = "/test/conflict";
    const { port } = await startTestServer({ projectRoot, repo });

    // Overwrite the default project with one that has no enabled queries
    const project = makeTestProject();
    project.scenes[0]!.search.queries = [];
    project.scenes[0]!.search.lastSearchedAt = undefined;
    repo.setProject(projectRoot, project);
    const { status } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "still stock" } }),
    });

    // Phase 1 redesign: stock_asset gating removed — PATCH succeeds.
    expect(status).toBe(200);
  }, 10000);

  it("13. response does not leak projectRoot/stack", async () => {
    const { port } = await startTestServer({
      projectRoot: "/very/secret/path",
    });
    const { body } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/very/secret/path");
    expect(bodyStr).not.toContain("stack");
  }, 10000);

  it("14. PATCH then GET /api/project shows the update", async () => {
    const { port } = await startTestServer();

    // PATCH: update visualPlan
    await httpRequest(port, "/api/scenes/scene-001", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({
        visualPlan: { decision: "title_card", rationale: "Changed via PATCH" },
      }),
    });

    // GET: verify the update persisted
    const { status, body } = await httpRequest(port, "/api/project", {
      host: `127.0.0.1:${port}`,
    });

    expect(status).toBe(200);
    const scenes = (
      body as {
        project: { scenes: Array<{ visualPlan: { decision: string; rationale: string } }> };
      }
    ).project.scenes;
    expect(scenes[0]!.visualPlan.decision).toBe("title_card");
    expect(scenes[0]!.visualPlan.rationale).toBe("Changed via PATCH");
  }, 10000);

  it("405 Allow header for GET on PATCH-only route", async () => {
    const { port } = await startTestServer();
    const { status, headers } = await httpRequest(port, "/api/scenes/scene-001", {
      method: "GET",
      host: `127.0.0.1:${port}`,
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toContain("PATCH");
  }, 10000);

  it("rejects invalid sceneId with path traversal", async () => {
    const { port } = await startTestServer();
    const { status } = await httpRequest(port, "/api/scenes/..", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ visualPlan: { rationale: "x" } }),
    });

    expect(status).toBe(400);
  }, 10000);
});
