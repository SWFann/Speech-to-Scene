/**
 * Integration tests for malformed percent-encoding in URL paths.
 *
 * M4-04BF P1-2: decodeURIComponent in matchPath must not throw on
 * malformed percent-encoding (e.g. `%E0%A4%A` — truncated UTF-8).
 *
 * Tests verify:
 *  1. PATCH with malformed sceneId → 400 invalid_request (not 500)
 *  2. PUT with malformed sceneId → 400 invalid_request (not 500)
 *  3. 405 path-only matching with malformed segment → 400 (not 500)
 *  4. GET on PATCH route with malformed segment → 400 (not 405, not 500)
 *  5. DELETE on PUT route with malformed segment → 400 (not 405, not 500)
 *  6. Valid percent-encoding still works (e.g. %20 → space in non-param segment)
 *  7. No token + malformed path → still 400 (malformed check before token)
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
// In-memory repository (minimal)
// ---------------------------------------------------------------------------

class InMemoryRepository implements ProjectRepository {
  private projects = new Map<string, SpeechToSceneProject>();
  async exists(): Promise<boolean> {
    await Promise.resolve();
    return true;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(projectRoot: string): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    const entry = this.projects.get(projectRoot);
    if (!entry) throw new Error(`Project not found at ${projectRoot}`);
    return JSON.parse(JSON.stringify(entry)) as SpeechToSceneProject;
  }
  async save(projectRoot: string, project: SpeechToSceneProject): Promise<void> {
    await Promise.resolve();
    this.projects.set(projectRoot, JSON.parse(JSON.stringify(project)) as SpeechToSceneProject);
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
      id: "proj-malformed-test",
      title: "Malformed Encoding Test",
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
  overrides: { projectRoot?: string; token?: string } = {},
): Promise<{ handle: ReviewServerHandle; port: number }> {
  const repo = new InMemoryRepository();
  const projectRoot = overrides.projectRoot ?? "/test/malformed-encoding";
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
  return { handle, port: handle.port };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Malformed percent-encoding: `%E0%A4%A` is a truncated UTF-8 sequence
 * that causes `decodeURIComponent` to throw `URIError`.
 */
const MALFORMED_SEGMENT = "%E0%A4%A";

describe("Malformed percent-encoding in parameterized routes (M4-04BF P1-2)", () => {
  it("1. PATCH /api/scenes/%E0%A4%A → 400 invalid_request (not 500)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, `/api/scenes/${MALFORMED_SEGMENT}`, {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ visualPlan: { rationale: "test" } }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("2. PUT /api/scenes/%E0%A4%A/queries → 400 invalid_request (not 500)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, `/api/scenes/${MALFORMED_SEGMENT}/queries`, {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        queries: [{ id: "q-001", language: "en", query: "x", purpose: "main", enabled: true }],
      }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("3. 405 path-only matching with malformed segment does not crash (GET on PATCH route)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, `/api/scenes/${MALFORMED_SEGMENT}`, {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    // Should be 400 (malformed encoding detected before 405/404 fallthrough),
    // NOT 500 (crash) or 405 (method not allowed).
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("4. DELETE on PUT route with malformed segment → 400 (not 405, not 500)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, `/api/scenes/${MALFORMED_SEGMENT}/queries`, {
      method: "DELETE",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("5. No token + malformed path → still 400 (malformed check before token gate)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, `/api/scenes/${MALFORMED_SEGMENT}`, {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      // No token — should still get 400 for malformed encoding
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("6. Valid percent-encoding in sceneId still works", async () => {
    // %73%63%65%6e%65%2d%30%30%31 = "scene-001"
    const { port } = await startTestServer({ token: "tok" });
    const { status } = await httpRequest(port, "/api/scenes/%73%63%65%6e%65%2d%30%30%31", {
      method: "PATCH",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ visualPlan: { rationale: "test" } }),
    });

    expect(status).toBe(200);
  }, 10000);

  it("7. Malformed encoding in non-param segment → 400 (not 404, not 500)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status } = await httpRequest(port, `/api/health${MALFORMED_SEGMENT}`, {
      method: "GET",
      host: `127.0.0.1:${port}`,
    });

    // Static route /api/health won't match /api/health%E0%A4%A, and the
    // malformed encoding check should return 400 before falling to 404.
    expect(status).toBe(400);
  }, 10000);
});
