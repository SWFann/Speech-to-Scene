/**
 * Integration tests for POST /api/scenes/:sceneId/generate API endpoint.
 *
 * Phase 2: AI image generation.
 *
 * Tests verify:
 *  1.  Successful generation appends a generated candidate
 *  2.  Response is UI-safe DTO with the new candidate
 *  3.  Unknown scene → 404 not_found
 *  4.  Invalid body (empty prompt) → 400 invalid_request
 *  5.  Unknown body field → 400 invalid_request
 *  6.  POST generate succeeds without session token (Phase 3)
 *  8.  Route not registered when generateSceneImage dep is absent
 *  9.  405 Allow header for GET on POST-only route
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
import { searchSceneAssets } from "../../src/application/search-scene-assets.js";
import { generateSceneImage } from "../../src/application/generate-scene-image.js";
import type { SearchProjectAssetsResult } from "../../src/application/search-project-assets.js";
import { FixtureImageGenerator } from "../../src/providers/fixture/fixture-image-generator.js";
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
        path: urlPath,
        method: options.method ?? "GET",
        headers: {
          "content-type": "application/json",
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

const FIXED_NOW = "2026-07-18T10:00:00.000Z";

interface GenerateResponseBody {
  ok: boolean;
  project: {
    scenes: Array<{
      search: {
        candidates: Array<{ kind: string; width?: number; height?: number }>;
      };
    }>;
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-gen-api-test",
      title: "Generate API Test",
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
        summary: "A city skyline at sunset",
        narrativeRole: "hook",
        visualPlan: {
          decision: "stock_asset",
          rationale: "Need stock photo",
          preferredMedia: ["photo"],
          visualKeywords: ["city", "sunset"],
        },
        search: {
          queries: [
            { id: "q-001", language: "en", query: "city skyline", purpose: "main", enabled: true },
          ],
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
    withoutGenerate?: boolean;
  } = {},
): Promise<{
  handle: ReviewServerHandle;
  port: number;
  repo: InMemoryRepository;
}> {
  const repo = new InMemoryRepository();
  const projectRoot = "/test/generate-api";
  repo.setProject(projectRoot, makeTestProject());

  const fixtureProvider = new FixtureAssetProvider({ now: () => new Date(FIXED_NOW) });
  const imageGenerator = new FixtureImageGenerator();

  const searchSceneAssetsBound = (input: unknown): Promise<SearchProjectAssetsResult> =>
    searchSceneAssets(input, {
      repository: repo,
      createProvider: () =>
        Promise.resolve({
          providerId: fixtureProvider.providerId,
          providerPolicyRevision: fixtureProvider.providerSnapshot.policyRevision,
          capabilities: fixtureProvider.capabilities,
          search: fixtureProvider.search.bind(fixtureProvider),
        }),
      createCache: (root: string, providerName: string) => {
        const cacheDir = getSearchCacheDir(root, providerName);
        return new FileSearchCache({ cacheDir });
      },
      linkGenerator: new DefaultLinkSuggestionGenerator(),
      now: () => new Date(FIXED_NOW),
    });

  const generateSceneImageBound = (input: unknown): Promise<SpeechToSceneProject> =>
    generateSceneImage(input, {
      repository: repo,
      imageGenerator,
      generateId: () => `gen-${Date.now()}`,
      now: () => new Date(FIXED_NOW),
    });

  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: searchSceneAssetsBound,
    ...(overrides.withoutGenerate ? {} : { generateSceneImage: generateSceneImageBound }),
  };

  const handle = await startReviewServer(
    {
      projectRoot,
      host: "127.0.0.1",
      port: 0,
    },
    deps,
  );
  servers.push({ handle });
  return { handle, port: handle.port, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:sceneId/generate", () => {
  it("1. successful generation appends a generated candidate", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "A beautiful city skyline", aspectRatio: "9:16" }),
    });

    expect(res.status).toBe(200);
    const body = res.body as GenerateResponseBody;
    expect(body.ok).toBe(true);
    const scene = body.project.scenes[0]!;
    expect(scene.search.candidates.length).toBeGreaterThanOrEqual(1);
    const generated = scene.search.candidates.find((c) => c.kind === "generated");
    expect(generated).toBeDefined();
  });

  it("2. response is UI-safe DTO (no projectRoot/token/API key)", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "A beautiful city" }),
    });

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    // Should not contain API keys or tokens
    expect(bodyStr).not.toContain("apiKey");
    expect(bodyStr).not.toContain("test-token");
    expect(bodyStr).not.toContain("/test/generate-api");
  });

  it("3. unknown scene → 404 not_found", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/nonexistent/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(res.status).toBe(404);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("4. invalid body (empty prompt) → 400 invalid_request", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "   " }),
    });

    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("5. unknown body field → 400 invalid_request", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "test", extraField: "bad" }),
    });

    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("6. POST generate succeeds without session token (Phase 3)", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("8. route not registered when generateSceneImage dep is absent", async () => {
    const { port } = await startTestServer({ withoutGenerate: true });

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: "http://127.0.0.1:3210",
      body: JSON.stringify({ prompt: "test" }),
    });

    // Without the dep, the route should not be registered → 404
    expect(res.status).toBe(404);
  });

  it("9. 405 Allow header for GET on POST-only route", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "GET",
      origin: `http://127.0.0.1:${port}`,
    });

    expect(res.status).toBe(405);
    expect(res.headers.allow).toContain("POST");
  });

  it("10. default aspectRatio is 9:16 when not specified", async () => {
    const { port } = await startTestServer();

    const res = await httpRequest(port, "/api/scenes/scene-001/generate", {
      method: "POST",
      origin: `http://127.0.0.1:${port}`,
      body: JSON.stringify({ prompt: "test prompt" }),
    });

    expect(res.status).toBe(200);
    const body = res.body as GenerateResponseBody;
    const scene = body.project.scenes[0]!;
    const generated = scene.search.candidates.find((c) => c.kind === "generated")!;
    // 9:16 → portrait → 1024x1792
    expect(generated.width).toBe(1024);
    expect(generated.height).toBe(1792);
  });
});
