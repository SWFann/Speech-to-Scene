/**
 * JSON body parser for the Review Server.
 *
 * Reads and parses JSON request bodies with configurable size limits.
 *
 * Security measures:
 * - Enforces maximum body size to prevent memory exhaustion
 * - Validates Content-Type
 * - Handles stream errors gracefully
 * - Returns structured error responses
 *
 * All parsed bodies are returned as `unknown`. Route handlers must use
 * Zod or equivalent to validate the structure.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ERROR_INVALID_JSON,
  ERROR_INVALID_REQUEST,
  ERROR_PAYLOAD_TOO_LARGE,
  ERROR_UNSUPPORTED_MEDIA_TYPE,
  MAX_JSON_BODY_BYTES,
} from "./http-errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of parsing a JSON body.
 */
export interface JsonBodyResult {
  readonly success: true;
  readonly data: unknown;
}

export interface JsonBodyError {
  readonly success: false;
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly hint: string | null;
}

export type JsonBodyParseResult = JsonBodyResult | JsonBodyError;

// ---------------------------------------------------------------------------
// Content-Type helpers
// ---------------------------------------------------------------------------

/**
 * Checks if a Content-Type header value represents JSON.
 *
 * Accepts:
 * - application/json
 * - application/json; charset=utf-8
 * - application/json;charset=utf-8 (no space)
 *
 * Rejects everything else (text/plain, application/octet-stream, etc.).
 */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;

  // Extract the MIME type part before any semicolon
  const mimeType = contentType.split(";")[0]?.trim().toLowerCase();
  return mimeType === "application/json";
}

// ---------------------------------------------------------------------------
// Body parser
// ---------------------------------------------------------------------------

/**
 * Parses the request body as JSON.
 *
 * @param req - The incoming HTTP request.
 * @param res - The server response (for sending error responses).
 * @param options - Parser options.
 * @returns A parse result. If `success` is false, the caller should
 *   return the statusCode and send the response.
 */
export async function parseJsonBody(
  req: IncomingMessage,
  _res: ServerResponse,
  options: {
    readonly maxBytes?: number;
    readonly requireJson?: boolean;
  } = {},
): Promise<JsonBodyParseResult> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;
  const requireJson = options.requireJson ?? true;

  // Validate Content-Type
  if (requireJson && !isJsonContentType(req.headers["content-type"])) {
    return {
      success: false,
      statusCode: 415,
      code: ERROR_UNSUPPORTED_MEDIA_TYPE,
      message: "Content-Type must be application/json",
      hint: "Set Content-Type: application/json",
    };
  }

  // Collect body chunks with size limit
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for await (const chunk of req) {
      // Check size limit before accumulating
      if (chunk instanceof Buffer) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          return {
            success: false,
            statusCode: 413,
            code: ERROR_PAYLOAD_TOO_LARGE,
            message: `Request body exceeds ${maxBytes} bytes`,
            hint: "Reduce the request body size",
          };
        }
        chunks.push(chunk);
      }
    }
  } catch {
    // Stream error (client disconnected, etc.)
    // Return a result that signals the caller to not send a response
    // since the stream is already broken
    return {
      success: false,
      statusCode: 499,
      code: ERROR_INVALID_REQUEST,
      message: "Request stream error",
      hint: null,
    };
  }

  const rawBody = Buffer.concat(chunks).toString("utf-8");

  // Empty body handling
  if (rawBody.length === 0) {
    if (requireJson) {
      return {
        success: false,
        statusCode: 400,
        code: ERROR_INVALID_JSON,
        message: "Request body is empty",
        hint: "Provide a JSON request body",
      };
    }
    return { success: true, data: null };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_JSON,
      message: "Request body is not valid JSON",
      hint: "Ensure the request body is valid JSON",
    };
  }

  return { success: true, data: parsed };
}
