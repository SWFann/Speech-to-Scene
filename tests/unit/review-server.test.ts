/**
 * Unit tests for the review server.
 *
 * Tests verify:
 * - Server starts on loopback
 * - GET /api/health returns correct JSON
 * - Server closes cleanly
 * - Non-loopback host is rejected
 * - Token handling (default generation, explicit, not leaked in health)
 * - Path resolution (relative -> absolute)
 * - Server lifecycle (keeps responding, stops after close)
 */

import http from "node:http";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type { ReviewServerHandle } from "../../src/review/review-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Makes an HTTP request and returns the parsed JSON body.
 */
async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
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

/**
 * Makes an HTTP request and returns the status code.
 */
async function fetchStatus(url: string): Promise<number> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: "GET",
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", () => resolve(0));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("review-server", () => {
  const servers: Array<{ handle: ReviewServerHandle; url: string }> = [];

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
      host?: string;
      port?: number;
      token?: string;
    } = {},
  ): Promise<{ handle: ReviewServerHandle; url: string }> {
    const handle = await startReviewServer({
      projectRoot: overrides.projectRoot ?? "/tmp/test-project",
      host: overrides.host ?? "127.0.0.1",
      port: overrides.port ?? 0, // OS-assigned port for test isolation
      ...(overrides.token !== undefined ? { token: overrides.token } : {}),
    });
    const url = `http://127.0.0.1:${handle.port}`;
    servers.push({ handle, url });
    return { handle, url };
  }

  // ---------------------------------------------------------------------------
  // Health endpoint
  // ---------------------------------------------------------------------------

  describe("health endpoint", () => {
    it("returns 200 with correct JSON shape", async () => {
      const { url } = await startTestServer();

      const { status, body } = await fetchJson(`${url}/api/health`);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        projectRoot: "/tmp/test-project",
        host: "127.0.0.1",
        version: "s2s-review-server/0.1",
      });
      expect(typeof (body as { port: number }).port).toBe("number");
      expect((body as { port: number }).port).toBeGreaterThan(0);
    });

    it("uses the provided projectRoot", async () => {
      const { url } = await startTestServer({ projectRoot: "/custom/path" });

      const { body } = await fetchJson(`${url}/api/health`);

      expect((body as { projectRoot: string }).projectRoot).toBe("/custom/path");
    });

    it("uses the bound port in the response", async () => {
      const { handle, url } = await startTestServer({ port: 0 });

      const { body } = await fetchJson(`${url}/api/health`);

      expect((body as { port: number }).port).toBe(handle.port);
    });
  });

  // ---------------------------------------------------------------------------
  // Token handling
  // ---------------------------------------------------------------------------

  describe("token handling", () => {
    it("generates a non-empty token when not specified", async () => {
      const { handle } = await startTestServer();

      expect(handle.token).toBeTruthy();
      expect(typeof handle.token).toBe("string");
      expect(handle.token.length).toBeGreaterThan(0);
    });

    it("returns the provided token when specified", async () => {
      const expectedToken = "my-custom-token-123";
      const { handle } = await startTestServer({ token: expectedToken });

      expect(handle.token).toBe(expectedToken);
    });

    it("health response does not include token field", async () => {
      const { url } = await startTestServer({ token: "secret-token" });

      const { body } = await fetchJson(`${url}/api/health`);

      expect((body as Record<string, unknown>).token).toBeUndefined();
    });

    it("generated token is a UUID format (36 chars with dashes)", async () => {
      const { handle } = await startTestServer();

      // randomUUID() returns a UUID v4 string: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(handle.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Path resolution
  // ---------------------------------------------------------------------------

  describe("path resolution", () => {
    it("resolves relative projectRoot to absolute path", async () => {
      const { body } = await fetchJson(
        `http://127.0.0.1:${(await startTestServer({ projectRoot: "relative/path" })).handle.port}/api/health`,
      );

      const projectRoot = (body as { projectRoot: string }).projectRoot;
      expect(path.isAbsolute(projectRoot)).toBe(true);
      // Should contain the relative path components
      expect(projectRoot).toContain("relative");
      expect(projectRoot).toContain("path");
    });

    it("resolves '.' to cwd", async () => {
      const cwd = process.cwd();
      const { body } = await fetchJson(
        `http://127.0.0.1:${(await startTestServer({ projectRoot: "." })).handle.port}/api/health`,
      );

      expect((body as { projectRoot: string }).projectRoot).toBe(path.resolve(cwd));
    });

    it("starts server for directory name containing '..'", async () => {
      const { handle, url } = await startTestServer({ projectRoot: "project..backup" });
      const { body } = await fetchJson(`${url}/api/health`);
      const projectRoot = (body as { projectRoot: string }).projectRoot;
      expect(path.isAbsolute(projectRoot)).toBe(true);
      expect(projectRoot).toContain("project..backup");
      expect(handle.port).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Server lifecycle
  // ---------------------------------------------------------------------------

  describe("server lifecycle", () => {
    it("starts and closes without error", async () => {
      const { handle } = await startTestServer();

      // Server is already added to cleanup array; just verify close resolves
      await handle.close();
      expect(true).toBe(true); // close resolved without throwing
    });

    it("returns a valid port from start", async () => {
      const { handle } = await startTestServer({ port: 0 });

      expect(handle.port).toBeGreaterThan(0);
    });

    it("keeps responding to health requests before close", async () => {
      const { url } = await startTestServer();

      // Make multiple requests to verify server stays alive
      for (let i = 0; i < 3; i++) {
        const { status } = await fetchJson(`${url}/api/health`);
        expect(status).toBe(200);
      }
    });

    it("stops accepting connections after close", async () => {
      const { handle, url } = await startTestServer();

      // Verify server is responding
      const { status: statusBefore } = await fetchJson(`${url}/api/health`);
      expect(statusBefore).toBe(200);

      // Close the server
      await handle.close();

      // Try to connect - should fail or get connection refused
      const statusAfter = await fetchStatus(`${url}/api/health`);
      expect(statusAfter).not.toBe(200);
    });

    it("close lifecycle does not leave a listening port", async () => {
      const { handle } = await startTestServer({ port: 0 });
      const boundPort = handle.port;

      await handle.close();

      // Give the OS a moment to release the port
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify port is no longer listening by attempting connection
      const status = await fetchStatus(`http://127.0.0.1:${boundPort}/api/health`);
      expect(status).not.toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Host validation
  // ---------------------------------------------------------------------------

  describe("host validation", () => {
    it("rejects non-loopback host", async () => {
      await expect(
        startReviewServer({
          projectRoot: "/tmp/test",
          host: "0.0.0.0",
          port: 0,
          token: "test",
          version: "test",
        }),
      ).rejects.toThrow("Host must be a loopback address");
    });

    it("accepts 127.0.0.1", async () => {
      const { url } = await startTestServer({ host: "127.0.0.1" });
      const { status } = await fetchJson(`${url}/api/health`);
      expect(status).toBe(200);
    });

    it("accepts localhost", async () => {
      const { url } = await startTestServer({ host: "localhost" });
      const { status } = await fetchJson(`${url}/api/health`);
      expect(status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  describe("routing", () => {
    it("returns 404 for unknown routes", async () => {
      const { url } = await startTestServer();

      const { status, body } = await fetchJson(`${url}/api/unknown`);

      expect(status).toBe(404);
      expect((body as { error: { code: string } }).error.code).toBe("not_found");
    });

    it("returns 405 for POST to health (method not allowed)", async () => {
      const { url } = await startTestServer();

      const result = await new Promise<{ status: number; body: unknown }>((resolve) => {
        const req = http.request(`${url}/api/health`, { method: "POST" }, (res) => {
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
        });
        req.on("error", () => resolve({ status: 0, body: null }));
        req.end();
      });

      expect(result.status).toBe(405);
      expect((result.body as { error: { code: string } }).error.code).toBe("method_not_allowed");
    });
  });
});
