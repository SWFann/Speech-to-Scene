/**
 * Real dist smoke test for the Review Server Project API.
 *
 * This test runs `node dist/cli/index.js review ...` (NOT tsx) and verifies
 * the full production binary lifecycle including GET /api/project.
 *
 * Uses `spawn` (not `exec`) so SIGINT goes directly to the node process,
 * not through a shell layer.
 *
 * Requirements:
 * 1. Read OS-assigned port from stdout
 * 2. GET /api/health without token → 200
 * 3. GET /api/project without token → 401
 * 4. GET /api/project with wrong token → 403
 * 5. GET /api/project with correct token → 200
 * 6. Evil Host → 403
 * 7. Response data has no projectRoot or absolute paths
 * 8. SIGINT → exit code 0
 * 9. Port released, no residual process
 * 10. stderr has no unhandled exceptions
 *
 * Must set timeout and finally cleanup, kill child on failure.
 */

import { spawn, execSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { describe, expect, it, afterAll } from "vitest";

import { SpeechToSceneProjectSchema } from "../../src/domain/project-schema.js";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";
import { PROJECT_FILE_NAME } from "../../src/shared/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-07-13T10:00:00.000Z";

function makeValidProject(): SpeechToSceneProject {
  return SpeechToSceneProjectSchema.parse({
    schemaVersion: "0.1",
    project: {
      id: "proj-smoke-0000",
      title: "Smoke Test Project",
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
        review: { kind: "pending" },
      },
    ],
  });
}

interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

async function httpGet(
  port: number,
  urlPath: string,
  options: { host?: string; token?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: "GET",
        headers: {
          ...(options.host !== undefined ? { host: options.host } : {}),
          ...(options.token !== undefined ? { "x-s2s-session": options.token } : {}),
        },
        timeout: 5000,
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
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              headers[key.toLowerCase()] = value;
            }
          }
          resolve({ status: res.statusCode ?? 0, body, headers });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

interface ServerHandle {
  port: number;
  child: ChildProcessWithoutNullStreams;
  stderrChunks: string[];
  kill: () => Promise<void>;
}

/**
 * Spawns the dist binary directly (no shell), waits for port, returns handle.
 */
async function spawnDistServer(projectRoot: string, token: string): Promise<ServerHandle> {
  const stderrChunks: string[] = [];

  const child = spawn(
    "node",
    [
      "dist/cli/index.js",
      "review",
      projectRoot,
      "--no-open",
      "--port",
      "0",
      "--token",
      token,
      "--host",
      "127.0.0.1",
    ],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
  );

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 15s"));
    }, 15000);

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1]!, 10));
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderrChunks.push(data.toString("utf-8"));
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });

  await new Promise((r) => setTimeout(r, 500));

  return {
    port,
    child,
    stderrChunks,
    kill: async () => {
      child.kill("SIGINT");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 10000);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe("dist smoke test — Project API", () => {
  it("full lifecycle: health, project token gates, evil host, graceful shutdown", async () => {
    // Ensure dist is built fresh — never rely on stale artifacts
    try {
      execSync("pnpm build", { stdio: "pipe", cwd: process.cwd() });
    } catch {
      throw new Error("pnpm build failed — cannot run dist smoke without fresh build");
    }

    // Create temp project
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-smoke-"));
    tempDirs.push(dir);
    await fs.writeFile(
      path.join(dir, PROJECT_FILE_NAME),
      JSON.stringify(makeValidProject(), null, 2) + "\n",
      "utf-8",
    );

    const TOKEN = "smoke-test-token";
    const server = await spawnDistServer(dir, TOKEN);

    try {
      // 1. GET /api/health without token → 200
      const health = await httpGet(server.port, "/api/health", {
        host: `127.0.0.1:${server.port}`,
      });
      expect(health.status).toBe(200);

      // 2. GET /api/project without token → 401
      const noToken = await httpGet(server.port, "/api/project", {
        host: `127.0.0.1:${server.port}`,
      });
      expect(noToken.status).toBe(401);

      // 3. GET /api/project with wrong token → 403
      const wrongToken = await httpGet(server.port, "/api/project", {
        host: `127.0.0.1:${server.port}`,
        token: "wrong-token",
      });
      expect(wrongToken.status).toBe(403);

      // 4. GET /api/project with correct token → 200
      const correctToken = await httpGet(server.port, "/api/project", {
        host: `127.0.0.1:${server.port}`,
        token: TOKEN,
      });
      expect(correctToken.status).toBe(200);
      expect((correctToken.body as { ok: boolean }).ok).toBe(true);

      // 5. Evil Host → 403
      const evilHost = await httpGet(server.port, "/api/project", {
        host: "evil.example:3210",
        token: TOKEN,
      });
      expect(evilHost.status).toBe(403);

      // 6. Response has no projectRoot or absolute paths
      const bodyStr = JSON.stringify(correctToken.body);
      expect(bodyStr).not.toContain(dir);
      expect(bodyStr).not.toContain("/tmp");
      expect(bodyStr).not.toContain(os.tmpdir());

      // 7. Graceful shutdown via SIGINT
      // On POSIX (Linux/macOS/WSL), SIGINT to the node process triggers graceful
      // shutdown and the process exits with code 0.
      // On Windows, SIGINT semantics differ and the process may not exit with
      // code 0. We skip the exit-code-0 assertion on Windows and instead
      // verify cleanup (no residual process).
      if (process.platform === "win32") {
        // Windows: verify cleanup without asserting SIGINT exit code 0
        await server.kill();
        // Process should be terminated after kill
        expect(server.child.exitCode).not.toBeNull();
      } else {
        // POSIX: verify SIGINT → exit code 0
        const exitCode = await new Promise<number>((resolve) => {
          server.child.on("exit", (code) => resolve(code ?? -1));
          server.child.kill("SIGINT");
          setTimeout(() => {
            server.child.kill("SIGKILL");
            resolve(-1);
          }, 10000);
        });
        expect(exitCode).toBe(0);
      }

      // 8. stderr has no unhandled exceptions
      const stderr = server.stderrChunks.join("");
      expect(stderr).not.toContain("Unhandled");
      expect(stderr).not.toContain("TypeError");
      expect(stderr).not.toContain("ReferenceError");
    } finally {
      // Ensure child is killed even on failure
      if (server.child.exitCode === null && server.child.pid !== null) {
        await server.kill();
      }
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// Helper: generic HTTP request with method + body support
// ---------------------------------------------------------------------------

async function httpRequestWithBody(
  port: number,
  method: string,
  urlPath: string,
  options: { host?: string; token?: string; body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          "content-type": "application/json",
          ...(options.host !== undefined ? { host: options.host } : {}),
          ...(options.token !== undefined ? { "x-s2s-session": options.token } : {}),
        },
        timeout: 5000,
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
          resolve({ status: res.statusCode ?? 0, body, headers: {} });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Scene Update + Queries lifecycle smoke test
// ---------------------------------------------------------------------------

describe("dist smoke test — Scene Update + Queries API", () => {
  it("PATCH scene, PUT queries, verify persistence, SIGINT shutdown", async () => {
    // Ensure dist is built fresh
    try {
      execSync("pnpm build", { stdio: "pipe", cwd: process.cwd() });
    } catch {
      throw new Error("pnpm build failed — cannot run dist smoke without fresh build");
    }

    // Create temp project
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-smoke-scene-"));
    tempDirs.push(dir);
    await fs.writeFile(
      path.join(dir, PROJECT_FILE_NAME),
      JSON.stringify(makeValidProject(), null, 2) + "\n",
      "utf-8",
    );

    const TOKEN = "smoke-scene-token";
    const server = await spawnDistServer(dir, TOKEN);

    try {
      const host = `127.0.0.1:${server.port}`;

      // 1. PATCH /api/scenes/scene-001 — update visualPlan
      const patchRes = await httpRequestWithBody(server.port, "PATCH", "/api/scenes/scene-001", {
        host,
        token: TOKEN,
        body: JSON.stringify({
          visualPlan: { rationale: "Smoke PATCH rationale" },
        }),
      });
      expect(patchRes.status).toBe(200);
      expect((patchRes.body as { ok: boolean }).ok).toBe(true);

      // 2. GET /api/project — verify PATCH persisted
      const getAfterPatch = await httpGet(server.port, "/api/project", {
        host,
        token: TOKEN,
      });
      expect(getAfterPatch.status).toBe(200);
      // Step-by-step casts to avoid parser issues with nested generics
      const patchProject = (getAfterPatch.body as { project: unknown }).project;
      const patchScenes = (patchProject as { scenes: Array<{ visualPlan: { rationale: string } }> })
        .scenes;
      expect(patchScenes[0]!.visualPlan.rationale).toBe("Smoke PATCH rationale");

      // 3. PUT /api/scenes/scene-001/queries — replace queries
      const putRes = await httpRequestWithBody(
        server.port,
        "PUT",
        "/api/scenes/scene-001/queries",
        {
          host,
          token: TOKEN,
          body: JSON.stringify({
            queries: [
              {
                id: "q-smoke-1",
                language: "zh",
                query: "烟雾测试",
                purpose: "main",
                enabled: true,
              },
              {
                id: "q-smoke-2",
                language: "en",
                query: "smoke test",
                purpose: "alt",
                enabled: false,
              },
            ],
          }),
        },
      );
      expect(putRes.status).toBe(200);
      expect((putRes.body as { ok: boolean }).ok).toBe(true);

      // 4. GET /api/project — verify queries persisted
      const getAfterPut = await httpGet(server.port, "/api/project", {
        host,
        token: TOKEN,
      });
      expect(getAfterPut.status).toBe(200);
      // Step-by-step casts to avoid parser issues with nested generics
      const putProject = (getAfterPut.body as { project: unknown }).project;
      const putScenes = (putProject as { scenes: unknown[] }).scenes;
      const putScene0 = putScenes[0] as { search: { queries: Array<{ id: string }> } };
      const queriesAfterPut = putScene0.search.queries;
      expect(queriesAfterPut).toHaveLength(2);
      expect(queriesAfterPut[0]!.id).toBe("q-smoke-1");
      expect(queriesAfterPut[1]!.id).toBe("q-smoke-2");

      // 5. Verify response does not leak sensitive info
      const bodyStr = JSON.stringify(putRes.body);
      expect(bodyStr).not.toContain(dir);
      expect(bodyStr).not.toContain(TOKEN);

      // 6. SIGINT clean shutdown (POSIX only)
      if (process.platform !== "win32") {
        const exitCode = await new Promise<number>((resolve) => {
          server.child.on("exit", (code) => resolve(code ?? -1));
          server.child.kill("SIGINT");
          setTimeout(() => {
            server.child.kill("SIGKILL");
            resolve(-1);
          }, 10000);
        });
        expect(exitCode).toBe(0);
      } else {
        await server.kill();
        expect(server.child.exitCode).not.toBeNull();
      }

      // 7. stderr has no unhandled exceptions
      const stderr = server.stderrChunks.join("");
      expect(stderr).not.toContain("Unhandled");
      expect(stderr).not.toContain("TypeError");
    } finally {
      if (server.child.exitCode === null && server.child.pid !== null) {
        await server.kill();
      }
    }
  }, 30000);
});
