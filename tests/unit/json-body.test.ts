/**
 * Unit tests for JSON body parser.
 *
 * Uses a real HTTP server to test the parser in an integrated way.
 * This ensures the stream handling works correctly with Node.js's actual
 * HTTP implementation.
 */

import http from "node:http";
import { describe, expect, it, afterEach } from "vitest";

import { parseJsonBody, isJsonContentType } from "../../src/review/json-body.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

/**
 * Makes an HTTP request to a test server that uses parseJsonBody.
 */
async function makeRequest(
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    expectJson?: boolean;
    maxBytes?: number;
    requireJson?: boolean;
  } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- createServer callback needs async for parseJsonBody
    server = http.createServer(async function (req, res) {
      const result = await parseJsonBody(req, res, {
        ...(options.maxBytes !== undefined && { maxBytes: options.maxBytes }),
        ...(options.requireJson !== undefined && { requireJson: options.requireJson }),
      });

      if (!result.success) {
        res.statusCode = result.statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: { code: result.code, message: result.message, hint: result.hint },
          }) + "\n",
        );
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, data: result.data }) + "\n");
    });

    server.listen(0, "127.0.0.1", function () {
      const port = (server!.address() as { port: number }).port;

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/test",
          method: options.method ?? "POST",
          headers: options.headers,
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

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("json-body", () => {
  // ---------------------------------------------------------------------------
  // Content-Type checks
  // ---------------------------------------------------------------------------

  describe("isJsonContentType", () => {
    it("accepts application/json", () => {
      expect(isJsonContentType("application/json")).toBe(true);
    });

    it("accepts application/json with charset", () => {
      expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    });

    it("accepts application/json with charset (no space)", () => {
      expect(isJsonContentType("application/json;charset=utf-8")).toBe(true);
    });

    it("rejects text/plain", () => {
      expect(isJsonContentType("text/plain")).toBe(false);
    });

    it("rejects application/octet-stream", () => {
      expect(isJsonContentType("application/octet-stream")).toBe(false);
    });

    it("rejects undefined content type", () => {
      expect(isJsonContentType(undefined)).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isJsonContentType("")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Body parsing
  // ---------------------------------------------------------------------------

  describe("parseJsonBody", () => {
    // --- Valid JSON ---

    it("parses valid JSON object", async () => {
      const { status, body } = await makeRequest({
        body: '{"key": "value"}',
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(200);
      expect((body as { ok: boolean; data: { key: string } }).data).toEqual({ key: "value" });
    }, 10000);

    it("parses valid JSON array", async () => {
      const { status, body } = await makeRequest({
        body: "[1, 2, 3]",
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(200);
      expect((body as { data: number[] }).data).toEqual([1, 2, 3]);
    }, 10000);

    it("parses valid JSON null", async () => {
      const { status, body } = await makeRequest({
        body: "null",
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(200);
      expect((body as { data: null }).data).toBeNull();
    }, 10000);

    it("parses valid JSON string", async () => {
      const { status, body } = await makeRequest({
        body: '"hello"',
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(200);
      expect((body as { data: string }).data).toBe("hello");
    }, 10000);

    it("returns data as unknown type", async () => {
      const { status, body } = await makeRequest({
        body: '{"x": 1}',
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(200);
      const _check: unknown = (body as { data: unknown }).data;
      expect(_check).toBeDefined();
    }, 10000);

    // --- Malformed JSON ---

    it("returns error for malformed JSON", async () => {
      const { status, body } = await makeRequest({
        body: '{"key": }',
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(400);
      expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
    }, 10000);

    it("returns error for plain text", async () => {
      const { status, body } = await makeRequest({
        body: "hello world",
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(400);
      expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
    }, 10000);

    // --- Empty body ---

    it("returns error for empty body when requireJson is true", async () => {
      const { status, body } = await makeRequest({
        body: "",
        headers: { "content-type": "application/json" },
      });

      expect(status).toBe(400);
      expect((body as { error: { code: string } }).error.code).toBe("invalid_json");
    }, 10000);

    // --- Content-Type ---

    it("returns 415 for wrong Content-Type", async () => {
      const { status, body } = await makeRequest({
        body: '{"key": "value"}',
        headers: { "content-type": "text/plain" },
      });

      expect(status).toBe(415);
      expect((body as { error: { code: string } }).error.code).toBe("unsupported_media_type");
    }, 10000);

    it("returns 415 when Content-Type is missing", async () => {
      const { status } = await makeRequest({
        body: '{"key": "value"}',
        headers: {},
      });

      expect(status).toBe(415);
    }, 10000);

    it("accepts content-type with charset", async () => {
      const { status } = await makeRequest({
        body: '{"key": "value"}',
        headers: { "content-type": "application/json; charset=utf-8" },
      });

      expect(status).toBe(200);
    }, 10000);

    // --- Size limit ---

    it("returns 413 when body exceeds maxBytes", async () => {
      const largeBody = "x".repeat(1024); // 1 KiB
      const { status, body } = await makeRequest({
        body: largeBody,
        headers: { "content-type": "application/json" },
        maxBytes: 500,
      });

      expect(status).toBe(413);
      expect((body as { error: { code: string } }).error.code).toBe("payload_too_large");
    }, 10000);

    // --- requireJson: false ---

    it("allows empty body when requireJson is false", async () => {
      const { status, body } = await makeRequest({
        body: "",
        headers: {},
        requireJson: false,
      });

      expect(status).toBe(200);
      expect((body as { data: null }).data).toBeNull();
    }, 10000);
  });
});
