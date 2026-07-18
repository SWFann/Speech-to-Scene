/**
 * Static file serving tests for the Review Server (M5-03).
 *
 * Tests verify:
 * - GET / returns HTML with id="root"
 * - GET /index.html returns HTML
 * - GET /assets/<built-js-or-css> returns 200 and correct Content-Type
 * - GET /missing-asset.js returns 404
 * - GET /api/unknown does NOT return React index HTML (API 404)
 * - Path traversal: GET /../package.json, GET /assets/%2e%2e/package.json → 400/404
 * - Missing web/dist: GET / returns friendly error, API /api/health still works
 * - SPA fallback: GET /review returns index.html
 * - POST / returns 404 (not API mutation)
 * - HEAD / returns headers without body
 * - Security headers present on static responses
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type { ReviewServerHandle } from "../../src/review/review-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function httpGet(
  port: number,
  urlPath: string,
  method = "GET",
  options: { host?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...(options.host !== undefined ? { host: options.host } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Array<Buffer | Uint8Array> = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer | Uint8Array));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              headers[key.toLowerCase()] = value;
            }
          }
          resolve({ status: res.statusCode ?? 0, body: raw, headers });
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a fake static root directory with:
 * - index.html (contains id="root")
 * - assets/app.js
 * - assets/style.css
 * - assets/logo.svg
 * - assets/image.png (minimal valid PNG)
 */
async function createFakeStaticRoot(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });

  await fs.writeFile(
    path.join(dir, "index.html"),
    '<!doctype html>\n<html>\n<head><title>Test</title></head>\n<body><div id="root"></div></body>\n</html>\n',
    "utf-8",
  );

  await fs.writeFile(path.join(dir, "assets", "app.js"), 'console.log("test app");\n', "utf-8");

  await fs.writeFile(path.join(dir, "assets", "style.css"), "body { margin: 0; }\n", "utf-8");

  await fs.writeFile(
    path.join(dir, "assets", "logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n',
    "utf-8",
  );

  // Minimal valid PNG (1x1 transparent pixel)
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  await fs.writeFile(path.join(dir, "assets", "image.png"), pngBytes);
}

/**
 * Creates a fake static root WITHOUT index.html (missing build scenario).
 */
async function createEmptyDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tests with a fake static root
// ---------------------------------------------------------------------------

describe("review-server static serving (fake static root)", () => {
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

  async function startServer(
    staticRoot: string,
  ): Promise<{ handle: ReviewServerHandle; port: number }> {
    const handle = await startReviewServer({
      projectRoot: "/tmp/test-project",
      host: "127.0.0.1",
      port: 0,
      staticRoot,
    });
    servers.push({ handle });
    return { handle, port: handle.port };
  }

  // -------------------------------------------------------------------------
  // GET / returns HTML
  // -------------------------------------------------------------------------

  it('GET / returns HTML containing id="root"', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // GET /index.html returns HTML
  // -------------------------------------------------------------------------

  it("GET /index.html returns HTML", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/index.html", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // GET /assets/app.js returns 200 and correct Content-Type
  // -------------------------------------------------------------------------

  it("GET /assets/app.js returns 200 with text/javascript Content-Type", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/assets/app.js", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.body).toContain("test app");
  });

  // -------------------------------------------------------------------------
  // GET /assets/style.css returns 200 and correct Content-Type
  // -------------------------------------------------------------------------

  it("GET /assets/style.css returns 200 with text/css Content-Type", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/assets/style.css", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  // -------------------------------------------------------------------------
  // GET /assets/logo.svg returns 200 and correct Content-Type
  // -------------------------------------------------------------------------

  it("GET /assets/logo.svg returns 200 with image/svg+xml Content-Type", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/assets/logo.svg", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml");
  });

  // -------------------------------------------------------------------------
  // GET /assets/image.png returns 200 and correct Content-Type
  // -------------------------------------------------------------------------

  it("GET /assets/image.png returns 200 with image/png Content-Type", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/assets/image.png", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  // -------------------------------------------------------------------------
  // GET /missing-asset.js returns 404
  // -------------------------------------------------------------------------

  it("GET /missing-asset.js returns 404", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/missing-asset.js", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(404);
    // Should NOT return index.html for missing assets with file extensions
    expect(res.body).not.toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // GET /api/unknown does NOT return React index HTML
  // -------------------------------------------------------------------------

  it("GET /api/unknown returns API 404 JSON, not index.html", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/api/unknown", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    // Must NOT return HTML
    expect(res.body).not.toContain('id="root"');
    expect(res.body).not.toContain("<!doctype html>");

    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  // -------------------------------------------------------------------------
  // Path traversal: GET /../package.json
  // -------------------------------------------------------------------------

  it("GET /../package.json does not leak file contents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);

    // Node's HTTP server normalizes /../ in the URL path, so this may
    // arrive as /package.json. But we still test it.
    const res = await httpGet(port, "/package.json", "GET", { host: `127.0.0.1:${port}` });

    // /package.json doesn't exist in the static root, so it should
    // either return 404 (no extension? no, .json is an extension)
    // or SPA fallback. Since .json is a file extension, it should 404.
    expect(res.status).toBe(404);
    // Must not contain actual package.json contents
    expect(res.body).not.toContain("speech-to-scene");
  });

  // -------------------------------------------------------------------------
  // Path traversal: GET /assets/%2e%2e/package.json (encoded)
  // -------------------------------------------------------------------------

  it("GET /assets/%2e%2e/package.json returns 400 or 404, no file contents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);

    // %2e%2e decodes to .. — this is an encoded traversal attempt
    const res = await httpGet(port, "/assets/%2e%2e/package.json", "GET", {
      host: `127.0.0.1:${port}`,
    });

    // Should be rejected (400 for traversal, or 404)
    expect([400, 404]).toContain(res.status);
    // Must not leak file contents
    expect(res.body).not.toContain("speech-to-scene");
    expect(res.body).not.toContain('"name"');
  });

  // -------------------------------------------------------------------------
  // Path traversal: literal .. in URL
  // -------------------------------------------------------------------------

  it("GET /assets/../package.json is rejected", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);

    // Node may normalize this path. We send it raw.
    const res = await httpGet(port, "/assets/../package.json", "GET", {
      host: `127.0.0.1:${port}`,
    });

    // Should not leak package.json contents regardless of how it's handled
    expect(res.body).not.toContain("speech-to-scene");
  });

  // -------------------------------------------------------------------------
  // Missing web/dist: GET / returns friendly error, API /api/health still works
  // -------------------------------------------------------------------------

  it("missing build: GET / returns friendly error, API still works", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-empty-"));
    tempDirs.push(dir);
    await createEmptyDir(dir);

    const { port } = await startServer(dir);

    // GET / should return a friendly error page
    const rootRes = await httpGet(port, "/", "GET", { host: `127.0.0.1:${port}` });
    expect(rootRes.status).toBe(503);
    expect(rootRes.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(rootRes.body).toContain("Review Board build is missing");
    expect(rootRes.body).toContain("pnpm web:build");
    // Must not leak absolute path
    expect(rootRes.body).not.toContain(dir);

    // API /api/health should still work
    const healthRes = await httpGet(port, "/api/health", "GET", { host: `127.0.0.1:${port}` });
    expect(healthRes.status).toBe(200);
    const healthBody = JSON.parse(healthRes.body) as { ok: boolean };
    expect(healthBody.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // SPA fallback: GET /review returns index.html
  // -------------------------------------------------------------------------

  it("GET /review returns index.html (SPA fallback)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/review", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // SPA fallback: GET /scenes/scene-001 returns index.html
  // -------------------------------------------------------------------------

  it("GET /scenes/scene-001 returns index.html (SPA fallback)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/scenes/scene-001", "GET", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('id="root"');
  });

  // -------------------------------------------------------------------------
  // POST / returns 404 (not API mutation)
  // -------------------------------------------------------------------------

  it("POST / returns 404, does not enter API mutation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/", "POST", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  // -------------------------------------------------------------------------
  // HEAD / returns headers without body
  // -------------------------------------------------------------------------

  it("HEAD / returns 200 with empty body", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/", "HEAD", { host: `127.0.0.1:${port}` });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toBe("");
  });

  // -------------------------------------------------------------------------
  // Security headers present on static responses
  // -------------------------------------------------------------------------

  it("static responses include security headers", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/", "GET", { host: `127.0.0.1:${port}` });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toBeDefined();
    // CSP should NOT be default-src 'none' (that would block the SPA)
    expect(res.headers["content-security-policy"]).not.toContain("default-src 'none'");
  });

  // -------------------------------------------------------------------------
  // No wildcard CORS
  // -------------------------------------------------------------------------

  it("static responses do not include wildcard CORS", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);
    const res = await httpGet(port, "/", "GET", { host: `127.0.0.1:${port}` });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // NUL character in path is rejected
  // -------------------------------------------------------------------------

  it("GET /assets/%00secret returns 400 or 404", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-static-"));
    tempDirs.push(dir);
    await createFakeStaticRoot(dir);

    const { port } = await startServer(dir);

    // %00 is NUL character
    const res = await httpGet(port, "/assets/%00secret", "GET", {
      host: `127.0.0.1:${port}`,
    });

    expect([400, 404]).toContain(res.status);
  });
});
