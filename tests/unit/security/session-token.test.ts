/**
 * Unit tests for session token validation.
 */

import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  validateConfiguredToken,
  generateSessionToken,
  validateSessionToken,
  SESSION_TOKEN_HEADER,
  MAX_TOKEN_LENGTH,
} from "../../../src/review/security/session-token.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock IncomingMessage with the given headers.
 */
function createMockRequest(headers: Record<string, string | string[]>): http.IncomingMessage {
  // @ts-expect-error IncomingMessage requires a real Socket; we construct a lightweight mock for testing
  const req = new http.IncomingMessage(new http.ServerResponse({ method: "POST" }));
  req.headers = headers;
  return req;
}

const FIXED_TOKEN = "test-token-abc-123";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-token", () => {
  // ---------------------------------------------------------------------------
  // Configuration validation
  // ---------------------------------------------------------------------------

  describe("validateConfiguredToken", () => {
    it("accepts a valid token", () => {
      expect(() => validateConfiguredToken("my-token-123")).not.toThrow();
    });

    it("accepts a UUID token", () => {
      expect(() => validateConfiguredToken("550e8400-e29b-41d4-a716-446655440000")).not.toThrow();
    });

    it("rejects empty string", () => {
      expect(() => validateConfiguredToken("")).toThrow(/empty/);
    });

    it("rejects whitespace-only token", () => {
      expect(() => validateConfiguredToken("   ")).toThrow(/whitespace/);
    });

    it("rejects tab-only token", () => {
      expect(() => validateConfiguredToken("\t\t")).toThrow(/whitespace/);
    });

    it("rejects newline-only token", () => {
      expect(() => validateConfiguredToken("\n\n")).toThrow(/whitespace/);
    });

    it("rejects mixed whitespace token", () => {
      expect(() => validateConfiguredToken(" \t\n ")).toThrow(/whitespace/);
    });

    it("rejects token exceeding MAX_TOKEN_LENGTH", () => {
      const longToken = "x".repeat(MAX_TOKEN_LENGTH + 1);
      expect(() => validateConfiguredToken(longToken)).toThrow(/exceed/);
    });

    it("accepts token at exactly MAX_TOKEN_LENGTH", () => {
      const maxToken = "x".repeat(MAX_TOKEN_LENGTH);
      expect(() => validateConfiguredToken(maxToken)).not.toThrow();
    });

    it("rejects token with leading whitespace", () => {
      expect(() => validateConfiguredToken(" valid-token")).toThrow(/leading or trailing/);
    });

    it("rejects token with trailing whitespace", () => {
      expect(() => validateConfiguredToken("valid-token ")).toThrow(/leading or trailing/);
    });

    it("error message does not include the token itself", () => {
      const token = "secret-do-not-leak";
      try {
        validateConfiguredToken(`  ${token}  `);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(token);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Token generation
  // ---------------------------------------------------------------------------

  describe("generateSessionToken", () => {
    it("generates a non-empty string", () => {
      const token = generateSessionToken();
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("generates UUID v4 format", () => {
      const token = generateSessionToken();
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("generates unique tokens", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(token1).not.toBe(token2);
    });
  });

  // ---------------------------------------------------------------------------
  // Request token validation
  // ---------------------------------------------------------------------------

  describe("validateSessionToken", () => {
    it("returns valid for correct token", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: FIXED_TOKEN });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(true);
    });

    it("returns invalid for wrong token", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: "wrong-token" });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });

    it("returns invalid for empty token", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: "" });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_required");
    });

    it("returns invalid for missing token", () => {
      const req = createMockRequest({});
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_required");
    });

    it("returns invalid for whitespace-only token", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: "   " });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_required");
    });

    it("rejects multi-value header (array with correct token)", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: [FIXED_TOKEN, "other"] });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });

    it("rejects multi-value header (array with wrong tokens)", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: ["wrong", "also-wrong"] });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });

    it("rejects token exceeding MAX_TOKEN_LENGTH", () => {
      const longToken = "x".repeat(MAX_TOKEN_LENGTH + 1);
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: longToken });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });

    it("always computes digest regardless of length difference", () => {
      // Different length tokens should still go through digest comparison
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: "short" });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });

    it("error reason does not include token or length details", () => {
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: "wrong-token" });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).not.toContain(FIXED_TOKEN);
      expect(result.reason).not.toContain("length");
    });

    it("validates token with matching length but different content", () => {
      const sameLengthWrong = FIXED_TOKEN.slice(0, -1) + "X";
      const req = createMockRequest({ [SESSION_TOKEN_HEADER]: sameLengthWrong });
      const result = validateSessionToken(req, FIXED_TOKEN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("session_rejected");
    });
  });
});
