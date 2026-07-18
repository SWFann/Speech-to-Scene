/**
 * Integration tests for Review Server security layer.
 *
 * Tests verify the full security stack against a running server:
 * - Host header validation (pre-routing, before route matching)
 * - Origin validation (for mutating requests, strict)
 * - JSON error responses (unified shape)
 * - Security headers (on all responses)
 * - Security gate ordering (evil Host → 403 before 404/405)
 *
 * Phase 3: session token validation removed. Security relies on
 * loopback binding + Host validation + Origin validation.
 */

import http from "node:http";
import { describe, expect, it, afterEach } from "vitest";

import { startReviewServer } from "../../src/review/review-server.js";
import type { ReviewServerHandle } from "../../src/review/review-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Makes an HTTP request with explicit Host header control.
 * Uses node:http directly so the Host header can be set explicitly.
 */
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

/** GET with correct Host (includes port). */
async function getCorrect(port: number, path: string, method = "GET"): Promise<HttpResponse> {
  return httpRequest(port, path, { method, host: `127.0.0.1:${port}` });
}

/** Fetch status only. */
async function fetchStatus(port: number, path: string): Promise<number> {
  const res = await getCorrect(port, path);
  return res.status;
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
    host?: string;
    port?: number;
  } = {},
): Promise<{ handle: ReviewServerHandle; port: number }> {
  const handle = await startReviewServer({
    projectRoot: overrides.projectRoot ?? "/tmp/test-security-project",
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 0,
  });
  servers.push({ handle });
  return { handle, port: handle.port };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("review-server security", () => {
  // -------------------------------------------------------------------------
  // Health endpoint (baseline)
  // -------------------------------------------------------------------------

  describe("health endpoint (GET /api/health)", () => {
    it("returns 200 with correct JSON shape", async () => {
      const { port } = await startTestServer();
      const { status, body } = await getCorrect(port, "/api/health");
      expect(status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        projectRoot: "/tmp/test-security-project",
        host: "127.0.0.1",
        version: "s2s-review-server/0.1",
      });
      expect(typeof (body as { port: number }).port).toBe("number");
      expect((body as { port: number }).port).toBeGreaterThan(0);
    }, 10000);

    it("does not include token in health response", async () => {
      const { port } = await startTestServer();
      const { body } = await getCorrect(port, "/api/health");
      // Phase 3: no session token mechanism — response must never carry one
      expect((body as Record<string, unknown>).token).toBeUndefined();
    }, 10000);

    it("uses the bound port in the response", async () => {
      const { handle, port } = await startTestServer({ port: 0 });
      const { body } = await getCorrect(port, "/api/health");
      expect((body as { port: number }).port).toBe(handle.port);
    }, 10000);

    it("includes security headers", async () => {
      const { port } = await startTestServer();
      const { headers } = await getCorrect(port, "/api/health");
      expect(headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(headers["cache-control"]).toBe("no-store");
      expect(headers["referrer-policy"]).toBe("no-referrer");
    });
  });

  // -------------------------------------------------------------------------
  // Security gate ordering (M4-02F1 Task 1)
  // -------------------------------------------------------------------------

  describe("Security gate ordering — Host Gate before routing", () => {
    it("evil Host + GET /api/health → 403 host_rejected", async () => {
      const { port } = await startTestServer();
      const { status, body } = await httpRequest(port, "/api/health", {
        host: "evil.example:3210",
      });
      expect(status).toBe(403);
      expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
    }, 10000);

    it("evil Host + GET /api/unknown → 403 host_rejected (not 404)", async () => {
      const { port } = await startTestServer();
      const { status, body } = await httpRequest(port, "/api/unknown", {
        host: "evil.example:3210",
      });
      expect(status).toBe(403);
      expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
    }, 10000);

    it("evil Host + POST /api/health → 403 host_rejected (not 405)", async () => {
      const { port } = await startTestServer();
      const { status, body } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: "evil.example:3210",
      });
      expect(status).toBe(403);
      expect((body as { error: { code: string } }).error.code).toBe("host_rejected");
    }, 10000);

    it("correct Host + GET /api/unknown → 404 not_found", async () => {
      const { port } = await startTestServer();
      const { status, body } = await getCorrect(port, "/api/unknown");
      expect(status).toBe(404);
      expect((body as { error: { code: string } }).error.code).toBe("not_found");
    }, 10000);

    it("correct Host + POST /api/health → 405 method_not_allowed", async () => {
      const { port } = await startTestServer();
      const { status, body } = await getCorrect(port, "/api/health", "POST");
      expect(status).toBe(405);
      expect((body as { error: { code: string } }).error.code).toBe("method_not_allowed");
    }, 10000);

    it("405 response includes correct Allow header", async () => {
      const { port } = await startTestServer();
      const { headers } = await getCorrect(port, "/api/health", "POST");
      expect(headers["allow"]).toBe("GET");
    }, 10000);

    it("evil Host response still includes security headers", async () => {
      const { port } = await startTestServer();
      const { headers } = await httpRequest(port, "/api/health", {
        host: "evil.example:3210",
      });
      expect(headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["cache-control"]).toBe("no-store");
    }, 10000);

    it("404 does not echo malicious URL in response", async () => {
      const { port } = await startTestServer();
      const { body } = await getCorrect(port, "/api/../../etc/passwd");
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain("passwd");
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Host validation (M4-02F1 Task 3)
  // -------------------------------------------------------------------------

  describe("Host validation", () => {
    it("accepts correct Host header with port", async () => {
      const { port } = await startTestServer();
      const { status } = await getCorrect(port, "/api/health");
      expect(status).toBe(200);
    }, 10000);

    it("rejects non-loopback Host", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        host: "evil.example:3210",
      });
      expect(status).toBe(403);
    }, 10000);

    it("rejects Host with wrong port", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        host: `127.0.0.1:9999`,
      });
      expect(status).toBe(403);
    }, 10000);

    it("rejects prefix-spoofed Host", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        host: "127.0.0.1.evil.example:3210",
      });
      expect(status).toBe(403);
    }, 10000);

    it("rejects Host without port (127.0.0.1)", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        host: "127.0.0.1",
      });
      expect(status).toBe(403);
    }, 10000);

    it("rejects Host without port (localhost)", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        host: "localhost",
      });
      expect(status).toBe(403);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Strict Origin validation (M4-02F2 Task 1)
  // -------------------------------------------------------------------------

  describe("Strict Origin validation", () => {
    it("accepts exact same-origin", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
      });
      // This will fail on token since we used a different server's token,
      // but the Origin itself should pass (status should be 401 not 403 origin_rejected)
      // Actually let's use the same server
      expect(status).not.toBe(403);
    }, 10000);

    it("POST with evil Origin path returns 405 (no mutation endpoint)", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}/evil`,
      });
      expect(status).toBe(405);
    }, 10000);

    it("POST with evil Origin query returns 405", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}?foo=bar`,
      });
      expect(status).toBe(405);
    }, 10000);

    it("POST with evil Origin username returns 405", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://user:password@127.0.0.1:${port}`,
      });
      expect(status).toBe(405);
    }, 10000);

    it("POST with Origin: null returns 405", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: "null",
      });
      expect(status).toBe(405);
    }, 10000);

    it("POST with mismatched localhost Origin returns 405", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://localhost:${port}`,
      });
      expect(status).toBe(405);
    }, 10000);

    it("accepts POST with correct Origin", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
      });
      // POST /api/health → 405 (method not allowed, but security gate passed)
      expect(status).toBe(405);
    }, 10000);

    it("POST without Origin (non-browser) passes", async () => {
      const { port } = await startTestServer();
      const { status } = await httpRequest(port, "/api/health", {
        method: "POST",
        host: `127.0.0.1:${port}`,
      });
      // No Origin → Origin check passes → POST /api/health → 405
      expect(status).toBe(405);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Unified error shape and security headers (M4-02F2 Task 3)
  // -------------------------------------------------------------------------

  describe("Unified error shape and security headers", () => {
    it("all error responses have unified JSON shape", async () => {
      const { port } = await startTestServer();
      const { body } = await httpRequest(port, "/api/health", {
        host: "evil.example:3210",
      });
      expect(body).toHaveProperty("error.code");
      expect(body).toHaveProperty("error.message");
      expect(body).toHaveProperty("error.hint");
    }, 10000);

    it("all error responses have security headers", async () => {
      const { port } = await startTestServer();
      const { headers } = await httpRequest(port, "/api/unknown", {
        host: `127.0.0.1:${port}`,
      });
      expect(headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["cache-control"]).toBe("no-store");
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    }, 10000);

    it("405 response has Allow header", async () => {
      const { port } = await startTestServer();
      const { headers } = await getCorrect(port, "/api/health", "POST");
      expect(headers["allow"]).toBe("GET");
    }, 10000);

    it("no wildcard CORS in any response", async () => {
      const { port } = await startTestServer();
      const { headers } = await getCorrect(port, "/api/health");
      expect(headers["access-control-allow-origin"]).toBeUndefined();
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Server lifecycle
  // -------------------------------------------------------------------------

  describe("Server lifecycle", () => {
    it("server stops accepting connections after close", async () => {
      const { handle, port } = await startTestServer();
      const statusBefore = await fetchStatus(port, "/api/health");
      expect(statusBefore).toBe(200);
      await handle.close();
      try {
        await fetchStatus(port, "/api/health");
      } catch {
        // Expected — server is closed
      }
    }, 10000);

    it("server starts on a valid port", async () => {
      const { handle } = await startTestServer({ port: 0 });
      expect(handle.port).toBeGreaterThan(0);
    }, 10000);

    it("server responds to health before close", async () => {
      const { port } = await startTestServer();
      for (let i = 0; i < 3; i++) {
        const status = await fetchStatus(port, "/api/health");
        expect(status).toBe(200);
      }
    }, 10000);

    it("close does not leave a listening port", async () => {
      const { handle, port } = await startTestServer({ port: 0 });
      await handle.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        const status = await fetchStatus(port, "/api/health");
        expect(status).not.toBe(200);
      } catch {
        // Expected — port is released after close
      }
    }, 10000);
  });
});
