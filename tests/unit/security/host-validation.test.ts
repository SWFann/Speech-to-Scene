/**
 * Unit tests for Host header validation.
 */

import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  validateConfiguredBindHost,
  validateHostHeader,
} from "../../../src/review/security/host-validation.js";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("host-validation", () => {
  // ---------------------------------------------------------------------------
  // Configured bind host validation
  // ---------------------------------------------------------------------------

  describe("validateConfiguredBindHost", () => {
    it("accepts 127.0.0.1", () => {
      expect(() => validateConfiguredBindHost("127.0.0.1")).not.toThrow();
    });

    it("accepts localhost", () => {
      expect(() => validateConfiguredBindHost("localhost")).not.toThrow();
    });

    it("accepts ::1", () => {
      expect(() => validateConfiguredBindHost("::1")).not.toThrow();
    });

    it("accepts uppercase LOCALHOST", () => {
      expect(() => validateConfiguredBindHost("LOCALHOST")).not.toThrow();
    });

    it("rejects 0.0.0.0", () => {
      expect(() => validateConfiguredBindHost("0.0.0.0")).toThrow(
        /Host must be a loopback address/,
      );
    });

    it("rejects attacker.example", () => {
      expect(() => validateConfiguredBindHost("attacker.example")).toThrow(
        /Host must be a loopback address/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Host header validation
  // ---------------------------------------------------------------------------

  describe("validateHostHeader", () => {
    const boundHost = "127.0.0.1";
    const boundPort = 3210;

    // --- Happy path (with port) ---

    it("accepts correct 127.0.0.1 with matching port", () => {
      const req = createMockRequest({ host: "127.0.0.1:3210" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(true);
    });

    it("accepts localhost with matching port", () => {
      const req = createMockRequest({ host: "localhost:3210" });
      const result = validateHostHeader(req, "localhost", boundPort);
      expect(result.valid).toBe(true);
    });

    it("accepts [::1] with matching port when bound to IPv6", () => {
      const req = createMockRequest({ host: "[::1]:3210" });
      const result = validateHostHeader(req, "::1", boundPort);
      expect(result.valid).toBe(true);
    });

    // --- Missing port (MUST be rejected) ---

    it("rejects 127.0.0.1 without port", () => {
      const req = createMockRequest({ host: "127.0.0.1" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("port");
    });

    it("rejects localhost without port", () => {
      const req = createMockRequest({ host: "localhost" });
      const result = validateHostHeader(req, "localhost", boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("port");
    });

    it("rejects [::1] without port", () => {
      const req = createMockRequest({ host: "[::1]" });
      const result = validateHostHeader(req, "::1", boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("port");
    });

    // --- Missing Host ---

    it("rejects missing Host header", () => {
      const req = createMockRequest({});
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("missing");
    });

    // --- Non-local host ---

    it("rejects attacker.example", () => {
      const req = createMockRequest({ host: "attacker.example:3210" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not a loopback");
    });

    it("rejects attacker.example without port", () => {
      const req = createMockRequest({ host: "attacker.example" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects 127.0.0.1.evil.example", () => {
      const req = createMockRequest({ host: "127.0.0.1.evil.example:3210" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects 0.0.0.0", () => {
      const req = createMockRequest({ host: "0.0.0.0:3210" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    // --- Port mismatch ---

    it("rejects wrong port", () => {
      const req = createMockRequest({ host: "127.0.0.1:9999" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("does not match");
    });

    it("rejects port 8080 for localhost", () => {
      const req = createMockRequest({ host: "localhost:8080" });
      const result = validateHostHeader(req, "localhost", 3210);
      expect(result.valid).toBe(false);
    });

    // --- Out-of-range port ---

    it("rejects port above 65535", () => {
      const req = createMockRequest({ host: "127.0.0.1:99999" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("out of range");
    });

    it("rejects port 0", () => {
      const req = createMockRequest({ host: "127.0.0.1:0" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    // --- Control characters ---

    it("rejects Host with control characters", () => {
      const req = createMockRequest({ host: "127.0.0.1:3210\r\n" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects Host with null byte", () => {
      const req = createMockRequest({ host: "127.0.0.1:3210\0" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    // --- Malformed ---

    it("rejects malformed port (non-numeric)", () => {
      const req = createMockRequest({ host: "127.0.0.1:abc" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects empty port", () => {
      const req = createMockRequest({ host: "127.0.0.1:" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects IPv6 with trailing garbage", () => {
      const req = createMockRequest({ host: "[::1]:3210extra" });
      const result = validateHostHeader(req, "::1", boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects empty Host value", () => {
      const req = createMockRequest({ host: "" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    // --- Port with leading/trailing garbage ---

    it("rejects port with leading space", () => {
      const req = createMockRequest({ host: "127.0.0.1: 3210" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });

    it("rejects port with trailing garbage", () => {
      const req = createMockRequest({ host: "127.0.0.1:3210abc" });
      const result = validateHostHeader(req, boundHost, boundPort);
      expect(result.valid).toBe(false);
    });
  });
});
