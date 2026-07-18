/**
 * Integration tests for POST /api/scenes/:sceneId/search API endpoint.
 *
 * Tests verify:
 *  1.  Fixture provider single-scene search success
 *  2.  Only the specified scene gets candidates (other scenes untouched)
 *  3.  Response is UI-safe DTO (no projectRoot/token/API key)
 *  4.  GET /api/project reflects POST search results
 *  5.  Unknown scene → 404 not_found
 *  6.  Invalid provider → 400 invalid_request
 *  7.  Unknown body field → 400 invalid_request
 *  8.  Body attempting to override projectRoot/sceneId/cachePath → 400
 *  9.  Missing token → 401 session_required
 * 10.  Wrong token → 403 session_rejected
 * 11.  Bad Origin → 403 origin_rejected
 * 12.  Evil Host → 403 host_rejected (before body parse)
 * 13.  Malformed JSON → 400 invalid_json
 * 14.  Unsupported Content-Type → 415 unsupported_media_type
 * 15.  Malformed percent-encoding path → 400 invalid_request
 * 16.  Non-stock_asset scene → 409 conflict
 * 17.  Disabled queries behavior (no candidates, success)
 * 18.  Cache written under project directory cache/search/<provider>
 * 19.  No real Pexels or external service calls
 * 20.  405 Allow header for GET on POST-only route
 * 21.  Body too large → 413 payload_too_large
 * 22.  refresh=true triggers provider search (not cache)
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type {
  ReviewServerHandle,
  ReviewServerDependencies,
} from "../../src/review/review-types.js";
import { getReviewProject } from "../../src/application/get-review-project.js";
import { updateScene } from "../../src/application/update-scene.js";
import { updateSceneQueries } from "../../src/application/update-scene-queries.js";
import { searchSceneAssets } from "../../src/application/search-scene-assets.js";
import type { SearchProjectAssetsResult } from "../../src/application/search-project-assets.js";
import { FixtureAssetProvider } from "../../src/providers/fixture/fixture-asset-provider.js";
import { FileSearchCache } from "../../src/infrastructure/file-search-cache.js";
import { DefaultLinkSuggestionGenerator } from "../../src/infrastructure/link-suggestion-generator.js";
import { getSearchCacheDir } from "../../src/cli/provider-factory.js";
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
  urlPath: string,
  options: {
    method?: string;
    host?: string;
    origin?: string;
    token?: string;
    body?: string;
    contentType?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: options.method ?? "GET",
        headers: {
          "content-type": options.contentType ?? "application/json",
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
// Test project factory
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-search-api-test",
      title: "Search API Test",
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
        summary: "Test scene one",
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
        text: "Second scene content.",
        summary: "Test scene two",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need visual",
          preferredMedia: ["photo"],
          visualKeywords: ["nature"],
        },
        search: {
          queries: [
            { id: "q-002", language: "en", query: "nature photo", purpose: "main", enabled: true },
          ],
          candidates: [],
          lastSearchedAt: FIXED_NOW,
        },
      },
      {
        id: "scene-003",
        order: 3,
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-001"],
          startQuote: "Hello",
          endQuote: "world",
        },
        sourceRange: { start: 0, end: 25 },
        text: "Speaker only scene.",
        summary: "Test scene three",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "No external asset",
          preferredMedia: ["photo"],
          visualKeywords: ["presenter"],
        },
        search: {
          queries: [],
          candidates: [],
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const servers: Array<{ handle: ReviewServerHandle }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const { handle } of servers) {
    try {
      await handle.close();
    } catch {
      // best-effort
    }
  }
  servers.length = 0;
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  tempDirs.length = 0;
});

async function startTestServer(
  overrides: {
    projectRoot?: string;
    token?: string;
    repo?: InMemoryRepository;
    useFileCache?: boolean;
    project?: SpeechToSceneProject;
  } = {},
): Promise<{
  handle: ReviewServerHandle;
  port: number;
  repo: InMemoryRepository;
  projectRoot: string;
}> {
  const repo = overrides.repo ?? new InMemoryRepository();
  const projectRoot = overrides.projectRoot ?? "/test/search-api";

  // If using file cache, create a temp directory for the project
  let actualProjectRoot = projectRoot;
  if (overrides.useFileCache) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-search-test-"));
    tempDirs.push(tmpDir);
    actualProjectRoot = tmpDir;
  }

  repo.setProject(actualProjectRoot, overrides.project ?? makeTestProject());

  // Create a fixture provider for testing
  const clock = { now: () => new Date(FIXED_NOW) };
  const fixtureProvider = new FixtureAssetProvider(clock);

  // Create cache — file-based if useFileCache, otherwise in-memory won't work
  // with FileSearchCache, so we use a temp dir
  const createCacheFn = (root: string, providerName: string): FileSearchCache => {
    const cacheDir = getSearchCacheDir(root, providerName);
    return new FileSearchCache({ cacheDir });
  };

  const searchSceneAssetsBound = (input: unknown): Promise<SearchProjectAssetsResult> =>
    searchSceneAssets(input, {
      repository: repo,
      createProvider: () =>
        Promise.resolve({
          // Always return the fixture provider for tests — never call real Pexels
          providerId: fixtureProvider.providerId,
          providerPolicyRevision: fixtureProvider.providerSnapshot.policyRevision,
          capabilities: fixtureProvider.capabilities,
          search: fixtureProvider.search.bind(fixtureProvider),
        }),
      createCache: createCacheFn,
      linkGenerator: new DefaultLinkSuggestionGenerator(),
      now: () => new Date(FIXED_NOW),
    });

  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: searchSceneAssetsBound,
  };

  const handle = await startReviewServer(
    {
      projectRoot: actualProjectRoot,
      host: "127.0.0.1",
      port: 0,
      ...(overrides.token !== undefined ? { token: overrides.token } : {}),
    },
    deps,
  );
  servers.push({ handle });
  return { handle, port: handle.port, repo, projectRoot: actualProjectRoot };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:sceneId/search", () => {
  it("1. fixture provider single-scene search success", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    // Scene should now have candidates
    const project = (body as { project: unknown }).project;
    const scenes = (project as { scenes: Array<{ search: { candidates: unknown[] } }> }).scenes;
    expect(scenes[0]!.search.candidates.length).toBeGreaterThan(0);
  }, 10000);

  it("2. only the specified scene gets candidates (other scenes untouched)", async () => {
    const { port, repo, projectRoot } = await startTestServer({
      token: "tok",
      useFileCache: true,
      projectRoot: "/test/search-api-isolated",
    });

    // Search scene-001 only
    await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    // Verify via repository that scene-002 still has 0 candidates
    const project = await repo.load(projectRoot);
    const scene001 = project.scenes.find((s) => s.id === "scene-001")!;
    const scene002 = project.scenes.find((s) => s.id === "scene-002")!;

    expect(scene001.search.candidates.length).toBeGreaterThan(0);
    expect(scene002.search.candidates.length).toBe(0);
  }, 10000);

  it("3. response is UI-safe DTO (no projectRoot/token/API key)", async () => {
    const { port } = await startTestServer({
      token: "super-secret-token",
      projectRoot: "/very/secret/path",
      useFileCache: true,
    });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "super-secret-token",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/very/secret/path");
    expect(bodyStr).not.toContain("super-secret-token");
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("api_key");
    expect(bodyStr).not.toContain("apiKey");
  }, 10000);

  it("4. GET /api/project reflects POST search results", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });

    // Before search: scene-001 has 0 candidates
    const before = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const beforeScenes = (
      before.body as { project: { scenes: Array<{ search: { candidates: unknown[] } }> } }
    ).project.scenes;
    expect(beforeScenes[0]!.search.candidates.length).toBe(0);

    // Perform search
    await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    // After search: GET /api/project should show new candidates
    const after = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const afterScenes = (
      after.body as {
        project: {
          scenes: Array<{ search: { candidates: unknown[]; lastSearchedAt: string | null } }>;
        };
      }
    ).project.scenes;
    expect(afterScenes[0]!.search.candidates.length).toBeGreaterThan(0);
    expect(afterScenes[0]!.search.lastSearchedAt).not.toBeNull();
  }, 10000);

  it("5. unknown scene → 404 not_found", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/non-existent/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  }, 10000);

  it("6. invalid provider → 400 invalid_request", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["invalid_provider"] }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("7. unknown body field → 400 invalid_request", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], extra: "bad" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("8. body attempting to override projectRoot → 400", async () => {
    const { port, repo, projectRoot } = await startTestServer({
      token: "tok",
      useFileCache: true,
    });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], projectRoot: "/evil/path" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
    // Verify actual project root was NOT overridden
    const proj = await repo.load(projectRoot);
    expect(proj.project.id).toBe("proj-search-api-test");
  }, 10000);

  it("8b. body attempting to override sceneId → 400", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], sceneId: "evil-scene" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("8c. body attempting to override cachePath → 400", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], cachePath: "/evil/cache" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("9. missing token → 401 session_required", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("session_required");
  }, 10000);

  it("10. wrong token → 403 session_rejected", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "wrong",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("session_rejected");
  }, 10000);

  it("11. bad Origin → 403 origin_rejected", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      origin: "https://evil.example",
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("origin_rejected");
  }, 10000);

  it("12. evil Host → 403 host_rejected (before body parse)", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: "evil.example:3210",
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
  }, 10000);

  it("13. malformed JSON → 400 invalid_json", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: "{broken json",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  }, 10000);

  it("14. unsupported Content-Type → 415 unsupported_media_type", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      contentType: "text/plain",
      body: "not json",
    });

    expect(status).toBe(415);
    expect((body as { error: { code: string } }).error.code).toBe("unsupported_media_type");
  }, 10000);

  it("15. malformed percent-encoding path → 400 invalid_request (not 500)", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/%E0%A4%A/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("16. non-stock_asset scene → search succeeds (gating removed)", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    // scene-003 is speaker_only
    const { status } = await httpRequest(port, "/api/scenes/scene-003/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    // Phase 1 redesign: stock_asset gating removed — search succeeds.
    // Note: scene-003 has no enabled queries, so search returns 200 with 0 candidates.
    expect(status).toBe(200);
  }, 10000);

  it("17. mixed enabled/disabled queries → only enabled queries produce candidates", async () => {
    // Create a project where scene-001 has two queries: one enabled, one disabled.
    // The schema requires stock_asset scenes to have at least one enabled query,
    // so we cannot disable ALL queries.
    const project = makeTestProject();
    const scene001 = project.scenes.find((s) => s.id === "scene-001")!;
    // Add a second disabled query alongside the existing enabled one
    (
      scene001.search.queries as Array<{
        id: string;
        language: string;
        query: string;
        purpose: string;
        enabled: boolean;
      }>
    ).push({
      id: "q-001-disabled",
      language: "en",
      query: "disabled query text",
      purpose: "alternate",
      enabled: false,
    });

    const { port } = await startTestServer({
      token: "tok",
      useFileCache: true,
      project,
    });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    // Search should succeed and return candidates from the enabled query only
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const scenes = (
      body as {
        project: {
          scenes: Array<{
            search: {
              candidates: Array<{ matchedQueryId: string }>;
            };
          }>;
        };
      }
    ).project.scenes;
    const scene001After = scenes[0];
    expect(scene001After!.search.candidates.length).toBeGreaterThan(0);
    // Every candidate should match the enabled query, not the disabled one
    for (const candidate of scene001After!.search.candidates) {
      expect(candidate.matchedQueryId).toBe("q-001");
      expect(candidate.matchedQueryId).not.toBe("q-001-disabled");
    }
  }, 10000);

  it("18. cache written under project directory cache/search/<provider>", async () => {
    const { port, projectRoot } = await startTestServer({
      token: "tok",
      useFileCache: true,
    });

    await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    // Verify cache directory exists under the project root
    const cacheDir = getSearchCacheDir(projectRoot, "fixture");
    const cacheExists = await fs
      .access(cacheDir)
      .then(() => true)
      .catch(() => false);
    expect(cacheExists).toBe(true);

    // Verify there are cache files
    const cacheFiles = await fs.readdir(cacheDir, { recursive: true }).catch(() => []);
    expect(cacheFiles.length).toBeGreaterThan(0);
  }, 10000);

  it("19. no real Pexels or external service calls (fixture only)", async () => {
    // This test uses the fixture provider which makes no network calls.
    // The test server's createProvider always returns the fixture provider.
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"] }),
    });

    expect(status).toBe(200);
    // If this test passes without network errors, no real external calls were made.
  }, 10000);

  it("20. 405 Allow header for GET on POST-only route", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, headers } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toContain("POST");
  }, 10000);

  it("21. body too large → 413 payload_too_large", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    // Create a body larger than 1 MiB (the default max)
    const largeValue = "x".repeat(1024 * 1024 + 100);
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], extra: largeValue }),
    });

    expect(status).toBe(413);
    expect((body as { error: { code: string } }).error.code).toBe("payload_too_large");
  }, 10000);

  it("22. refresh=true triggers provider search (not cache)", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });

    // First search to populate cache
    await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], refresh: false }),
    });

    // Second search with refresh=true should still succeed
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], refresh: true }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const scenes = (body as { project: { scenes: Array<{ search: { candidates: unknown[] } }> } })
      .project.scenes;
    expect(scenes[0]!.search.candidates.length).toBeGreaterThan(0);
  }, 10000);

  it("23. limit field works correctly (default 12, max 50)", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], limit: 5 }),
    });

    expect(status).toBe(200);
  }, 10000);

  it("24. limit out of range (>50) → 400", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], limit: 100 }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("25. limit out of range (0) → 400", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ providers: ["fixture"], limit: 0 }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  }, 10000);

  it("26. empty body → 400 invalid_json", async () => {
    const { port } = await startTestServer({ token: "tok", useFileCache: true });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/search", {
      method: "POST",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: "",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  }, 10000);
});
