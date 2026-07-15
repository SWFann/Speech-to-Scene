/**
 * Unit tests for unified JSON response helpers.
 */

import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import {
  sendJson,
  sendSuccess,
  sendError,
  sendInternalError,
} from "../../src/review/json-response.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock ServerResponse that captures writes.
 */
function createMockResponse(): {
  res: ServerResponse;
  chunks: Buffer[];
  headers: Map<string, string>;
} {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string | number): void {
      headers.set(name.toLowerCase(), String(value));
    },
    getHeader(name: string): string | string[] | undefined {
      return headers.get(name.toLowerCase());
    },
    write(chunk: string | Buffer | Uint8Array): boolean {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk, "utf-8"));
      } else {
        chunks.push(Buffer.from(chunk));
      }
      return true;
    },
    end(chunk?: string | Buffer | Uint8Array): void {
      if (chunk !== undefined) {
        if (typeof chunk === "string") {
          chunks.push(Buffer.from(chunk, "utf-8"));
        } else {
          chunks.push(Buffer.from(chunk));
        }
      }
    },
  } as ServerResponse;
  return { res, chunks, headers };
}

function getBody(chunks: Buffer[]): unknown {
  const raw = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("json-response", () => {
  // ---------------------------------------------------------------------------
  // sendJson
  // ---------------------------------------------------------------------------

  describe("sendJson", () => {
    it("sends JSON with correct Content-Type", () => {
      const { res, headers } = createMockResponse();
      sendJson(res, 200, { hello: "world" });

      expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    });

    it("sets security headers", () => {
      const { res, headers } = createMockResponse();
      sendJson(res, 200, { hello: "world" });

      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(headers.get("cache-control")).toBe("no-store");
    });

    it("serializes the body as JSON", () => {
      const { res, chunks } = createMockResponse();
      sendJson(res, 200, { count: 42 });

      const body = getBody(chunks);
      expect(body).toEqual({ count: 42 });
    });

    it("uses the specified status code", () => {
      const { res } = createMockResponse();
      sendJson(res, 201, { created: true });
      expect(res.statusCode).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  // sendSuccess
  // ---------------------------------------------------------------------------

  describe("sendSuccess", () => {
    it("wraps data with ok: true", () => {
      const { res, chunks } = createMockResponse();
      sendSuccess(res, 200, { id: "123" });

      const body = getBody(chunks) as { ok: boolean; id: string };
      expect(body.ok).toBe(true);
      expect(body.id).toBe("123");
    });

    it("returns ok: true with no additional data", () => {
      const { res, chunks } = createMockResponse();
      sendSuccess(res, 200);

      const body = getBody(chunks) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // sendError
  // ---------------------------------------------------------------------------

  describe("sendError", () => {
    it("sends error with correct shape", () => {
      const { res, chunks } = createMockResponse();
      sendError(res, 400, "invalid_request", "Bad request", "Check your input");

      const body = getBody(chunks) as {
        error: { code: string; message: string; hint: string | null };
      };
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.message).toBe("Bad request");
      expect(body.error.hint).toBe("Check your input");
    });

    it("sets hint to null when not provided", () => {
      const { res, chunks } = createMockResponse();
      sendError(res, 403, "host_rejected", "Host not allowed");

      const body = getBody(chunks) as { error: { hint: string | null } };
      expect(body.error.hint).toBeNull();
    });

    it("sets the correct status code", () => {
      const { res } = createMockResponse();
      sendError(res, 404, "not_found", "Not found");
      expect(res.statusCode).toBe(404);
    });

    it("sets security headers on error responses", () => {
      const { res, headers } = createMockResponse();
      sendError(res, 500, "internal_error", "Something went wrong");

      expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("cache-control")).toBe("no-store");
    });
  });

  // ---------------------------------------------------------------------------
  // sendInternalError
  // ---------------------------------------------------------------------------

  describe("sendInternalError", () => {
    it("returns 500 status", () => {
      const { res } = createMockResponse();
      sendInternalError(res);
      expect(res.statusCode).toBe(500);
    });

    it("returns generic error without sensitive info", () => {
      const { res, chunks } = createMockResponse();
      sendInternalError(res);

      const body = getBody(chunks) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("Internal server error");
    });

    it("does not include stack trace", () => {
      const { res, chunks } = createMockResponse();
      sendInternalError(res);

      const body = getBody(chunks) as { error: { message: string } };
      expect(body.error.message).not.toContain("Error:");
      expect(body.error.message).not.toContain("at ");
    });
  });
});
