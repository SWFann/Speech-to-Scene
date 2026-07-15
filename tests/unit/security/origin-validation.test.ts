/**
 * Unit tests for Origin header validation.
 */

import http from "node:http";
import { describe, expect, it } from "vitest";

import { validateOrigin } from "../../../src/review/security/origin-validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock IncomingMessage with the given headers.
 */
function createMockRequest(headers: Record<string, string>): http.IncomingMessage {
  // @ts-expect-error IncomingMessage requires a real Socket; we construct a lightweight mock for testing
  const req = new http.IncomingMessage(new http.ServerResponse({ method: "GET" }));
  req.headers = headers;
  return req;
}

const BOUND_HOST = "127.0.0.1";
const BOUND_PORT = 3210;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("origin-validation", () => {
  // --- No Origin header (non-browser request) ---

  it("allows request without Origin header", () => {
    const req = createMockRequest({});
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(true);
  });

  // --- Same-origin (exact match) ---

  it("allows exact same-origin http://127.0.0.1:3210", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(true);
  });

  it("allows same-origin localhost when bound to localhost", () => {
    const req = createMockRequest({ origin: "http://localhost:3210" });
    const result = validateOrigin(req, "http", "localhost", BOUND_PORT);
    expect(result.valid).toBe(true);
  });

  // --- IPv6 ---

  it("allows exact IPv6 origin when bound to ::1", () => {
    const req = createMockRequest({ origin: "http://[::1]:3210" });
    const result = validateOrigin(req, "http", "::1", BOUND_PORT);
    expect(result.valid).toBe(true);
  });

  it("rejects IPv6 origin with wrong port", () => {
    const req = createMockRequest({ origin: "http://[::1]:9999" });
    const result = validateOrigin(req, "http", "::1", BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match");
  });

  // --- Origin: null ---

  it("rejects Origin: null", () => {
    const req = createMockRequest({ origin: "null" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("null");
  });

  // --- Non-http scheme ---

  it("rejects https origin", () => {
    const req = createMockRequest({ origin: "https://127.0.0.1:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  it("rejects file:// origin", () => {
    const req = createMockRequest({ origin: "file:///tmp/evil.html" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  // --- Path, query, fragment ---

  it("rejects origin with path", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210/evil" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("path");
  });

  it("rejects origin with query string", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210?foo=bar" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("query");
  });

  it("rejects origin with fragment", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210#frag" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("fragment");
  });

  it("rejects origin with trailing slash", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210/" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  // --- Username/password ---

  it("rejects origin with username and password", () => {
    const req = createMockRequest({ origin: "http://user:password@127.0.0.1:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("username or password");
  });

  it("rejects origin with username only", () => {
    const req = createMockRequest({ origin: "http://user@127.0.0.1:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("username or password");
  });

  // --- Wrong host / port ---

  it("rejects evil origin with correct port", () => {
    const req = createMockRequest({ origin: "http://evil.example:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.1.evil.example", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1.evil.example:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  it("rejects same host but different port", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:8080" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("port");
  });

  // --- Loopback alias mismatch ---

  it("rejects localhost origin when bound to 127.0.0.1", () => {
    const req = createMockRequest({ origin: "http://localhost:3210" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  it("rejects 127.0.0.1 origin when bound to localhost", () => {
    const req = createMockRequest({ origin: "http://127.0.0.1:3210" });
    const result = validateOrigin(req, "http", "localhost", BOUND_PORT);
    expect(result.valid).toBe(false);
  });

  // --- Malformed ---

  it("rejects invalid URL", () => {
    const req = createMockRequest({ origin: "not-a-url" });
    const result = validateOrigin(req, "http", BOUND_HOST, BOUND_PORT);
    expect(result.valid).toBe(false);
  });
});
