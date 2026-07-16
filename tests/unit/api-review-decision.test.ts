/**
 * Integration tests for PUT /api/scenes/:sceneId/selection and
 * PUT /api/scenes/:sceneId/skip API endpoints (M4-06).
 *
 * Tests verify:
 *  1. Select existing candidate success
 *  2. Selection persists selectedAt
 *  3. Selection saves complete candidate snapshot and rights metadata
 *  4. Selection does not allow selecting another scene's candidate
 *  5. Selection candidate not found returns stable error (409 conflict)
 *  6. Restricted rights without acknowledgement rejected (409 conflict)
 *  7. rightsAcknowledged = true succeeds for restricted rights
 *  8. Skip scene success
 *  9. Skip scene preserves candidates
 * 10. Skip scene writes decidedAt and note
 * 11. Skip after GET /api/project reflects skipped status
 * 12. Missing token → 401 session_required
 * 13. Wrong token → 403 session_rejected
 * 14. Bad Origin → 403 origin_rejected
 * 15. Evil Host → 403 host_rejected (before body parse)
 * 16. Malformed JSON → 400 invalid_json
 * 17. Unsupported Content-Type → 415 unsupported_media_type
 * 18. Unknown body fields → 400 invalid_request
 * 19. Body projectRoot/sceneId override attempts → 400 invalid_request
 * 20. Malformed percent-encoding path → 400 invalid_request
 * 21. Response does not leak projectRoot/token/stack
 * 22. 405 Allow header for GET on PUT-only routes
 * 23. Scene not found → 404 not_found
 * 24. Empty body for selection → 400 invalid_json
 * 25. Body too large → 413 payload_too_large
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
import { selectCandidate } from "../../src/application/select-candidate.js";
import { skipScene } from "../../src/application/skip-scene.js";
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

function makeSafeCandidate(): unknown {
  return {
    id: "cand-safe",
    provider: {
      id: "fixture",
      name: "Fixture Asset Provider",
      homepageUrl: "https://example.com/fixture",
      termsUrl: "https://example.com/fixture/terms",
      policyRevision: "fixture-policy-2026-07-14",
      termsCheckedAt: FIXED_NOW,
    },
    providerAssetId: "fixture-asset-1",
    mediaType: "photo",
    thumbnailUrl: "https://example.com/fixture/cand-safe/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-safe",
    width: 1080,
    height: 1920,
    orientation: "portrait",
    creator: { name: "Fixture Creator", profileUrl: "https://example.com/fixture/creator/1" },
    rights: {
      status: "platform_license",
      licenseName: "Safe License",
      licenseUrl: "https://example.com/fixture/terms",
      attributionRequired: false,
      commercialUse: "allowed",
      derivatives: "allowed",
      verifiedAt: FIXED_NOW,
      evidence: {
        capturedAt: FIXED_NOW,
        referenceUrl: "https://example.com/fixture/terms",
        fields: { commercialUse: "allowed", derivatives: "allowed" },
      },
    },
    retrievedAt: FIXED_NOW,
    matchedQueryId: "q-001",
    rank: 1,
  };
}

function makeRestrictedCandidate(): unknown {
  const c = makeSafeCandidate() as Record<string, unknown>;
  return {
    ...c,
    id: "cand-restricted",
    providerAssetId: "fixture-asset-2",
    thumbnailUrl: "https://example.com/fixture/cand-restricted/thumb.jpg",
    sourcePageUrl: "https://example.com/fixture/cand-restricted",
    rights: {
      ...(c.rights as Record<string, unknown>),
      restrictions: ["Do not redistribute as standalone"],
    },
    rank: 2,
  };
}

function makeTestProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-decision-api-test",
      title: "Decision API Test",
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
          candidates: [makeSafeCandidate(), makeRestrictedCandidate()],
          lastSearchedAt: FIXED_NOW,
        },
        review: { kind: "pending" },
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
    project?: SpeechToSceneProject;
  } = {},
): Promise<{
  handle: ReviewServerHandle;
  port: number;
  repo: InMemoryRepository;
  projectRoot: string;
}> {
  const repo = overrides.repo ?? new InMemoryRepository();
  const projectRoot = overrides.projectRoot ?? "/test/decision-api";

  repo.setProject(projectRoot, overrides.project ?? makeTestProject());

  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: () => {
      throw new Error("search not available in decision API tests");
    },
    selectCandidate,
    skipScene,
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
  return { handle, port: handle.port, repo, projectRoot };
}

// ---------------------------------------------------------------------------
// Tests: PUT /api/scenes/:sceneId/selection
// ---------------------------------------------------------------------------

describe("PUT /api/scenes/:sceneId/selection", () => {
  it("1. select existing safe candidate success", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const project = (body as { project: unknown }).project;
    const scenes = (project as { scenes: Array<{ review: { kind: string } }> }).scenes;
    expect(scenes[0]!.review.kind).toBe("candidate_selected");
  });

  it("2. selection persists selectedAt", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          review: {
            kind: string;
            selection?: { selectedAt: string };
          };
        }>;
      }
    ).scenes[0]!;
    expect(scene.review.selection!.selectedAt).toBeTruthy();
  });

  it("3. selection saves complete candidate snapshot and rights metadata", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        candidateId: "cand-restricted",
        rightsAcknowledged: true,
      }),
    });

    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          review: {
            kind: string;
            selection?: {
              candidate: {
                id: string;
                rights: {
                  status: string;
                  restrictions?: string[];
                };
              };
              rightsAcknowledgement?: {
                acknowledgedAt: string;
                warningCodes: string[];
              };
            };
          };
        }>;
      }
    ).scenes[0]!;

    expect(scene.review.selection!.candidate.id).toBe("cand-restricted");
    expect(scene.review.selection!.candidate.rights.status).toBe("platform_license");
    expect(scene.review.selection!.candidate.rights.restrictions).toEqual([
      "Do not redistribute as standalone",
    ]);
    expect(scene.review.selection!.rightsAcknowledgement).toBeDefined();
    expect(scene.review.selection!.rightsAcknowledgement!.warningCodes).toContain(
      "restrictions_present",
    );
  });

  it("4. selection does not allow selecting another scene's candidate", async () => {
    const { port } = await startTestServer({ token: "tok" });
    // cand-safe exists in scene-001, not scene-002
    const { status, body } = await httpRequest(port, "/api/scenes/scene-002/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("5. selection candidate not found returns stable error (409 conflict)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "non-existent" }),
    });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("6. restricted rights without acknowledgement rejected (409 conflict)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-restricted" }),
    });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("conflict");
  });

  it("7. rightsAcknowledged = true succeeds for restricted rights", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({
        candidateId: "cand-restricted",
        rightsAcknowledged: true,
      }),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
  });

  it("8. safe rights can be selected without rightsAcknowledged", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(200);
    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          review: {
            kind: string;
            selection?: { rightsAcknowledgement?: unknown };
          };
        }>;
      }
    ).scenes[0]!;
    // Safe rights should not have rightsAcknowledgement
    expect(scene.review.selection!.rightsAcknowledgement).toBeUndefined();
  });

  it("9. scene not found → 404 not_found", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/non-existent/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("10. response does not leak projectRoot/token/stack", async () => {
    const { port } = await startTestServer({
      token: "super-secret-token",
      projectRoot: "/very/secret/path",
    });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "super-secret-token",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/very/secret/path");
    expect(bodyStr).not.toContain("super-secret-token");
    expect(bodyStr).not.toContain("stack");
  });

  it("11. 405 Allow header for GET on PUT-only selection route", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, headers } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toContain("PUT");
  });
});

// ---------------------------------------------------------------------------
// Tests: PUT /api/scenes/:sceneId/skip
// ---------------------------------------------------------------------------

describe("PUT /api/scenes/:sceneId/skip", () => {
  it("12. skip scene success", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const project = (body as { project: unknown }).project;
    const scenes = (project as { scenes: Array<{ review: { kind: string } }> }).scenes;
    expect(scenes[0]!.review.kind).toBe("skipped");
  });

  it("13. skip scene preserves candidates", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({}),
    });

    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          search: { candidates: unknown[] };
          review: { kind: string };
        }>;
      }
    ).scenes[0]!;
    // candidates should still be present (2 candidates)
    expect(scene.search.candidates).toHaveLength(2);
  });

  it("14. skip scene writes decidedAt and note", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ note: "No external asset needed" }),
    });

    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          review: {
            kind: string;
            decidedAt?: string;
            note?: string;
          };
        }>;
      }
    ).scenes[0]!;
    expect(scene.review.kind).toBe("skipped");
    expect(scene.review.decidedAt).toBeTruthy();
    expect(scene.review.note).toBe("No external asset needed");
  });

  it("15. skip without note works (empty body)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(200);
    const project = (body as { project: unknown }).project;
    const scene = (
      project as {
        scenes: Array<{
          review: { kind: string; decidedAt?: string; note?: string };
        }>;
      }
    ).scenes[0]!;
    expect(scene.review.kind).toBe("skipped");
    expect(scene.review.decidedAt).toBeTruthy();
    expect(scene.review.note).toBeUndefined();
  });

  it("16. skip after GET /api/project reflects skipped status", async () => {
    const { port } = await startTestServer({ token: "tok" });

    // Before skip: scene-001 should not be skipped
    const before = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const beforeScenes = (
      before.body as { project: { scenes: Array<{ review: { kind: string } }> } }
    ).project.scenes;
    expect(beforeScenes[0]!.review.kind).toBe("pending");

    // Perform skip
    await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ note: "skipping" }),
    });

    // After skip: GET /api/project should reflect skipped
    const after = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const afterScenes = (
      after.body as {
        project: {
          scenes: Array<{
            review: { kind: string; decidedAt?: string; note?: string };
            status?: string;
          }>;
        };
      }
    ).project.scenes;
    expect(afterScenes[0]!.review.kind).toBe("skipped");
    expect(afterScenes[0]!.review.decidedAt).toBeTruthy();
    expect(afterScenes[0]!.review.note).toBe("skipping");
  });

  it("17. skip scene not found → 404 not_found", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/non-existent/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("18. 405 Allow header for GET on PUT-only skip route", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, headers } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });

    expect(status).toBe(405);
    expect(headers["allow"]).toContain("PUT");
  });
});

// ---------------------------------------------------------------------------
// Tests: Security for both endpoints
// ---------------------------------------------------------------------------

describe("Security: PUT selection and skip endpoints", () => {
  it("19. missing token → 401 session_required (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("session_required");
  });

  it("20. wrong token → 403 session_rejected (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "wrong",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("session_rejected");
  });

  it("21. missing token → 401 session_required (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      body: JSON.stringify({}),
    });

    expect(status).toBe(401);
    expect((body as { error: { code: string } }).error.code).toBe("session_required");
  });

  it("22. wrong token → 403 session_rejected (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "wrong",
      body: JSON.stringify({}),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("session_rejected");
  });

  it("23. bad Origin → 403 origin_rejected (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      origin: "https://evil.example",
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("origin_rejected");
  });

  it("24. bad Origin → 403 origin_rejected (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      origin: "https://evil.example",
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("origin_rejected");
  });

  it("25. evil Host → 403 host_rejected (before body parse, selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: "evil.example:3210",
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
  });

  it("26. evil Host → 403 host_rejected (before body parse, skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: "evil.example:3210",
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(403);
    expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
  });

  it("27. malformed JSON → 400 invalid_json (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: "{broken json",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  });

  it("28. unsupported Content-Type → 415 unsupported_media_type (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      contentType: "text/plain",
      body: "not json",
    });

    expect(status).toBe(415);
    expect((body as { error: { code: string } }).error.code).toBe("unsupported_media_type");
  });

  it("29. unknown body field → 400 invalid_request (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe", extra: "bad" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("30. unknown body field → 400 invalid_request (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ note: "ok", extra: "bad" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("31. body projectRoot override attempt → 400 (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe", projectRoot: "/evil" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("32. body sceneId override attempt → 400 (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe", sceneId: "evil-scene" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("33. body projectRoot override attempt → 400 (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ note: "ok", projectRoot: "/evil" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("34. malformed percent-encoding path → 400 invalid_request (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/%E0%A4%A/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("35. malformed percent-encoding path → 400 invalid_request (skip)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/%E0%A4%A/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({}),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("36. empty body → 400 invalid_json (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: "",
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
  });

  it("37. body too large → 413 payload_too_large (selection)", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const largeValue = "x".repeat(1024 * 1024 + 100);
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe", extra: largeValue }),
    });

    expect(status).toBe(413);
    expect((body as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("38. skip with whitespace note → 400 invalid_request", async () => {
    const { port } = await startTestServer({ token: "tok" });
    const { status, body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ note: "  spaced  " }),
    });

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  it("39. skip response does not leak projectRoot/token", async () => {
    const { port } = await startTestServer({
      token: "super-secret-token",
      projectRoot: "/very/secret/path",
    });
    const { body } = await httpRequest(port, "/api/scenes/scene-001/skip", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "super-secret-token",
      body: JSON.stringify({}),
    });

    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("/very/secret/path");
    expect(bodyStr).not.toContain("super-secret-token");
  });

  it("40. GET /api/project reflects selection status", async () => {
    const { port } = await startTestServer({ token: "tok" });

    // Before selection: scene-001 is pending
    const before = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const beforeScenes = (
      before.body as { project: { scenes: Array<{ review: { kind: string } }> } }
    ).project.scenes;
    expect(beforeScenes[0]!.review.kind).toBe("pending");

    // Perform selection
    await httpRequest(port, "/api/scenes/scene-001/selection", {
      method: "PUT",
      host: `127.0.0.1:${port}`,
      token: "tok",
      body: JSON.stringify({ candidateId: "cand-safe" }),
    });

    // After selection: GET /api/project should reflect candidate_selected
    const after = await httpRequest(port, "/api/project", {
      method: "GET",
      host: `127.0.0.1:${port}`,
      token: "tok",
    });
    const afterScenes = (
      after.body as {
        project: {
          scenes: Array<{
            review: {
              kind: string;
              selection?: { selectedAt: string; candidate: { id: string } };
            };
          }>;
        };
      }
    ).project.scenes;
    expect(afterScenes[0]!.review.kind).toBe("candidate_selected");
    expect(afterScenes[0]!.review.selection!.candidate.id).toBe("cand-safe");
  });
});
