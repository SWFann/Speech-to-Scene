/**
 * Unit tests for request security middleware composition.
 *
 * Tests the two-phase security gate:
 * - Phase 1: checkHostGate (pre-routing, Host only)
 * - Phase 2: runPostRoutingGate (post-routing, method/Origin)
 */

import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  checkHost,
  checkOrigin,
  checkHostGate,
  runPostRoutingGate,
  type RequestSecurityConfig,
} from "../../src/review/request-security.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock IncomingMessage with the given headers and method.
 */
function createMockRequest(
  method: string,
  headers: Record<string, string | string[]> = {},
): http.IncomingMessage {
  // @ts-expect-error IncomingMessage requires a real Socket; we construct a lightweight mock for testing
  const req = new http.IncomingMessage(new http.ServerResponse({ method }));
  req.headers = headers;
  return req;
}

const BASE_CONFIG: RequestSecurityConfig = {
  boundHost: "127.0.0.1",
  boundPort: 3210,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("request-security", () => {
  // ---------------------------------------------------------------------------
  // checkHost (individual validator)
  // ---------------------------------------------------------------------------

  describe("checkHost", () => {
    it("passes with correct Host header", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1:3210" });
      const result = checkHost(req, BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("rejects missing Host header", () => {
      const req = createMockRequest("GET", {});
      const result = checkHost(req, BASE_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
      expect(result!.code).toBe("host_rejected");
    });

    it("rejects non-loopback host", () => {
      const req = createMockRequest("GET", { host: "evil.com:3210" });
      const result = checkHost(req, BASE_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
    });

    it("rejects wrong port", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1:8080" });
      const result = checkHost(req, BASE_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
      expect(result!.message).toContain("not allowed");
    });

    it("rejects Host without port", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1" });
      const result = checkHost(req, BASE_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // checkOrigin (individual validator)
  // ---------------------------------------------------------------------------

  describe("checkOrigin", () => {
    it("passes with no Origin header", () => {
      const req = createMockRequest("POST", {});
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("passes with exact same-origin", () => {
      const req = createMockRequest("POST", { origin: "http://127.0.0.1:3210" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).toBeNull();
    });

    it("rejects evil origin", () => {
      const req = createMockRequest("POST", { origin: "https://evil.example" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.statusCode).toBe(403);
      expect(result!.code).toBe("origin_rejected");
    });

    it("rejects Origin: null", () => {
      const req = createMockRequest("POST", { origin: "null" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).not.toBeNull();
    });

    it("rejects wrong port in Origin", () => {
      const req = createMockRequest("POST", { origin: "http://127.0.0.1:8080" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).not.toBeNull();
    });

    it("rejects origin with path", () => {
      const req = createMockRequest("POST", { origin: "http://127.0.0.1:3210/evil" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).not.toBeNull();
    });

    it("rejects origin with query string", () => {
      const req = createMockRequest("POST", { origin: "http://127.0.0.1:3210?foo=bar" });
      const result = checkOrigin(req, BASE_CONFIG);
      expect(result).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // checkHostGate (pre-routing, Host only)
  // ---------------------------------------------------------------------------

  describe("checkHostGate (pre-routing)", () => {
    it("passes with correct Host", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1:3210" });
      const result = checkHostGate(req, BASE_CONFIG);
      expect(result.passed).toBe(true);
    });

    it("rejects GET with wrong Host", () => {
      const req = createMockRequest("GET", { host: "evil.com:3210" });
      const result = checkHostGate(req, BASE_CONFIG);
      expect(result.passed).toBe(false);
      expect(result.rejection!.statusCode).toBe(403);
    });

    it("rejects POST with wrong Host", () => {
      const req = createMockRequest("POST", {
        host: "evil.com:3210",
      });
      const result = checkHostGate(req, BASE_CONFIG);
      expect(result.passed).toBe(false);
      expect(result.rejection!.statusCode).toBe(403);
    });

    it("rejection has correct status code for 403 host", () => {
      const req = createMockRequest("GET", { host: "evil.com:3210" });
      const result = checkHostGate(req, BASE_CONFIG);
      expect(result.passed).toBe(false);
      expect(result.rejection!.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // runPostRoutingGate (post-routing, method/Origin/Token)
  // ---------------------------------------------------------------------------

  describe("runPostRoutingGate (post-routing)", () => {
    // --- GET requests (safe) ---

    it("allows GET with correct method", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1:3210" });
      const result = runPostRoutingGate(req, "GET", ["GET"], BASE_CONFIG);
      expect(result.passed).toBe(true);
    });

    it("allows GET without token", () => {
      const req = createMockRequest("GET", { host: "127.0.0.1:3210" });
      const result = runPostRoutingGate(req, "GET", ["GET"], BASE_CONFIG);
      expect(result.passed).toBe(true);
    });

    // --- Mutating requests ---

    it("allows POST with valid Origin", () => {
      const req = createMockRequest("POST", {
        host: "127.0.0.1:3210",
        origin: "http://127.0.0.1:3210",
      });
      const result = runPostRoutingGate(req, "POST", ["POST"], BASE_CONFIG);
      expect(result.passed).toBe(true);
    });

    it("rejects POST with evil Origin", () => {
      const req = createMockRequest("POST", {
        host: "127.0.0.1:3210",
        origin: "https://evil.example",
      });
      const result = runPostRoutingGate(req, "POST", ["POST"], BASE_CONFIG);
      expect(result.passed).toBe(false);
      expect(result.rejection!.statusCode).toBe(403);
    });

    it("allows mutating request without Origin", () => {
      const req = createMockRequest("PUT", {
        host: "127.0.0.1:3210",
      });
      const result = runPostRoutingGate(req, "PUT", ["PUT"], BASE_CONFIG);
      expect(result.passed).toBe(true);
    });

    // --- Method not allowed ---

    it("returns 405 for disallowed method", () => {
      const req = createMockRequest("POST", { host: "127.0.0.1:3210" });
      const result = runPostRoutingGate(req, "POST", ["GET"], BASE_CONFIG);
      expect(result.passed).toBe(false);
      expect(result.rejection!.statusCode).toBe(405);
    });
  });
});
