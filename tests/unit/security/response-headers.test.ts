/**
 * Unit tests for security response headers.
 */

import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import {
  SECURITY_HEADERS,
  applySecurityHeaders,
  applySecurityHeadersWithAllow,
} from "../../../src/review/security/response-headers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock ServerResponse for testing.
 */
function createMockResponse(): {
  setHeader(name: string, value: string | number): void;
  getHeader(name: string): string | string[] | undefined;
  headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string | number): void {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name: string): string | string[] | undefined {
      return headers.get(name.toLowerCase());
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("response-headers", () => {
  describe("SECURITY_HEADERS", () => {
    it("includes Content-Type", () => {
      expect(SECURITY_HEADERS["Content-Type"]).toBe("application/json; charset=utf-8");
    });

    it("includes Content-Security-Policy", () => {
      expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    });

    it("includes X-Content-Type-Options", () => {
      expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("includes X-Frame-Options", () => {
      expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    });

    it("includes Referrer-Policy", () => {
      expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    });

    it("includes Cache-Control", () => {
      expect(SECURITY_HEADERS["Cache-Control"]).toBe("no-store");
    });
  });

  describe("applySecurityHeaders", () => {
    it("sets all security headers on the response", () => {
      const res = createMockResponse() as unknown as ServerResponse;
      applySecurityHeaders(res);

      expect(res.getHeader("content-type")).toBe("application/json; charset=utf-8");
      expect(res.getHeader("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.getHeader("x-content-type-options")).toBe("nosniff");
      expect(res.getHeader("x-frame-options")).toBe("DENY");
      expect(res.getHeader("referrer-policy")).toBe("no-referrer");
      expect(res.getHeader("cache-control")).toBe("no-store");
    });

    it("overwrites existing Content-Type header", () => {
      const res = createMockResponse() as unknown as ServerResponse;
      res.setHeader("Content-Type", "text/html");
      applySecurityHeaders(res);
      expect(res.getHeader("content-type")).toBe("application/json; charset=utf-8");
    });
  });

  describe("applySecurityHeadersWithAllow", () => {
    it("sets security headers plus Allow header", () => {
      const res = createMockResponse() as unknown as ServerResponse;
      applySecurityHeadersWithAllow(res, ["GET", "POST"]);

      expect(res.getHeader("allow")).toBe("GET, POST");
      expect(res.getHeader("content-type")).toBe("application/json; charset=utf-8");
    });

    it("joins methods with comma-space in Allow header", () => {
      const res = createMockResponse() as unknown as ServerResponse;
      applySecurityHeadersWithAllow(res, ["GET", "POST"]);
      expect(res.getHeader("allow")).toBe("GET, POST");
    });
  });
});
