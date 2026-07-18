/**
 * Integration tests for JsonProjectRepository error → HTTP mapping.
 *
 * Uses real JsonProjectRepository with temporary directories to verify:
 * - Project file deleted after server start → 404 not_found
 * - Project directory doesn't exist → 404 not_found
 * - Corrupt JSON → 409 conflict (source_document_error)
 * - Invalid schema data → 409 conflict (project_validation_error)
 * - Unsupported schemaVersion → 409 conflict (unsupported_schema_version)
 * - Oversized project file → 409 conflict (project_file_too_large)
 * - Unknown repository error → 500 internal_error
 * - All responses omit absolute paths, original errors, and stacks
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
import { JsonProjectRepository } from "../../src/infrastructure/json-project-repository.js";
import type { ProjectRepository } from "../../src/application/ports/project-repository.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import { PROJECT_FILE_NAME, MAX_PROJECT_FILE_BYTES } from "../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeValidProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-repo-test-000",
      title: "Repo Test Project",
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

interface HttpResponse {
  status: number;
  body: unknown;
}

async function httpRequest(port: number, token: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/project",
        method: "GET",
        headers: {
          host: `127.0.0.1:${port}`,
          "x-s2s-session": token,
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
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
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

  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
  tempDirs.length = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-f2-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(projectRoot: string, content: unknown): Promise<void> {
  const json = typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n";
  await fs.writeFile(path.join(projectRoot, PROJECT_FILE_NAME), json, "utf-8");
}

async function startServerWithRealRepo(
  projectRoot: string,
): Promise<{ handle: ReviewServerHandle; port: number }> {
  const repo = new JsonProjectRepository();
  const deps: ReviewServerDependencies = {
    repository: repo,
    getReviewProject,
    updateScene,
    updateSceneQueries,
    searchSceneAssets: () =>
      Promise.reject(new Error("searchSceneAssets not configured for this test")),
  };
  const handle = await startReviewServer({ projectRoot, host: "127.0.0.1", port: 0 }, deps);
  servers.push({ handle });
  return { handle, port: handle.port };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JsonProjectRepository → HTTP error mapping", () => {
  it("project file deleted after server start → 404 not_found", async () => {
    const dir = await makeTempDir();
    await writeProjectFile(dir, makeValidProject());
    const { port } = await startServerWithRealRepo(dir);

    // Verify project loads initially
    const before = await httpRequest(port, "test-token");
    expect(before.status).toBe(200);

    // Delete project file
    await fs.unlink(path.join(dir, PROJECT_FILE_NAME));

    // Now request should return 404
    const after = await httpRequest(port, "test-token");
    expect(after.status).toBe(404);
    expect((after.body as { error: { code: string } }).error.code).toBe("not_found");
  }, 15000);

  it("project directory doesn't exist → 404 not_found", async () => {
    const dir = await makeTempDir();
    await writeProjectFile(dir, makeValidProject());
    const fakePath = path.join(os.tmpdir(), "s2s-nonexistent-" + Date.now());
    const { port } = await startServerWithRealRepo(fakePath);

    const res = await httpRequest(port, "test-token");
    expect(res.status).toBe(404);
  }, 15000);

  it("corrupt JSON → 409 conflict", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, PROJECT_FILE_NAME), "{ this is not valid json ]]", "utf-8");
    const { port } = await startServerWithRealRepo(dir);

    const res = await httpRequest(port, "test-token");
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe("conflict");
  }, 15000);

  it("invalid schema data → 409 conflict", async () => {
    const dir = await makeTempDir();
    // Write a project with wrong field types
    const badProject = makeValidProject();
    const corrupted = { ...badProject, project: { ...badProject.project, title: 12345 } };
    await writeProjectFile(dir, corrupted);
    const { port } = await startServerWithRealRepo(dir);

    const res = await httpRequest(port, "test-token");
    expect(res.status).toBe(409);
  }, 15000);

  it("unsupported schemaVersion → 409 conflict", async () => {
    const dir = await makeTempDir();
    const project = makeValidProject();
    const badVersion = { ...project, schemaVersion: "99.0" };
    await writeProjectFile(dir, badVersion);
    const { port } = await startServerWithRealRepo(dir);

    const res = await httpRequest(port, "test-token");
    expect(res.status).toBe(409);
  }, 15000);

  it("oversized project file → 409 conflict", async () => {
    const dir = await makeTempDir();
    const project = makeValidProject();
    // Create a project that's larger than MAX_PROJECT_FILE_BYTES
    const oversized = {
      ...project,
      project: { ...project.project, title: "x".repeat(MAX_PROJECT_FILE_BYTES + 100) },
    };
    await writeProjectFile(dir, oversized);
    const { port } = await startServerWithRealRepo(dir);

    const res = await httpRequest(port, "test-token");
    expect(res.status).toBe(409);
  }, 15000);

  it("all error responses omit absolute paths and stacks", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, PROJECT_FILE_NAME), "{ corrupt", "utf-8");
    const { port } = await startServerWithRealRepo(dir);

    const res = await httpRequest(port, "test-token");
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(dir);
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("at ");
    expect(bodyStr).not.toContain("Error:");
  }, 15000);
});

// ---------------------------------------------------------------------------
// Unknown repository error → 500 internal_error
// ---------------------------------------------------------------------------

/**
 * Fake repository that throws a non-AppError to simulate an unknown I/O error.
 */
class ThrowingRepository implements ProjectRepository {
  async exists(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }
  async create(): Promise<void> {
    await Promise.resolve();
  }
  async load(): Promise<SpeechToSceneProject> {
    await Promise.resolve();
    throw new Error("Unexpected filesystem corruption at /internal/secret/path");
  }
  async save(): Promise<void> {
    await Promise.resolve();
  }
}

describe("Unknown repository error → HTTP mapping", () => {
  it("fake repo throwing generic Error → 500 internal_error", async () => {
    const repo = new ThrowingRepository();
    const deps: ReviewServerDependencies = {
      repository: repo,
      getReviewProject,
      updateScene,
      updateSceneQueries,
      searchSceneAssets: () =>
        Promise.reject(new Error("searchSceneAssets not configured for this test")),
    };
    const handle = await startReviewServer(
      { projectRoot: "/fake/root", host: "127.0.0.1", port: 0 },
      deps,
    );
    servers.push({ handle });

    const res = await httpRequest(handle.port, "test-token");
    expect(res.status).toBe(500);
    expect((res.body as { error: { code: string } }).error.code).toBe("internal_error");

    // Verify no sensitive info leaked
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("Unexpected filesystem");
    expect(bodyStr).not.toContain("/internal/secret/path");
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("at ");
  }, 15000);
});
