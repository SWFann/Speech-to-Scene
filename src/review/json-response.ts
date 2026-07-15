/**
 * Unified JSON response writer for the Review Server.
 *
 * All API responses (success and error) go through these helpers to ensure:
 * - Consistent Content-Type: application/json; charset=utf-8
 * - Consistent JSON shape
 * - Security headers applied to every response
 */

import type { ServerResponse } from "node:http";

import { applySecurityHeaders } from "./security/response-headers.js";
import { ERROR_INTERNAL_ERROR } from "./http-errors.js";

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * Success response body for API endpoints.
 */
export interface ApiSuccessResponse {
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Error response body following the unified error model.
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    hint?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Sends a successful JSON response with security headers.
 *
 * @param res - The Node.js ServerResponse object.
 * @param statusCode - HTTP status code (2xx/3xx).
 * @param body - Response body object.
 */
export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  applySecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body) + "\n");
}

/**
 * Sends a successful API response with `ok: true` and additional data.
 *
 * @param res - The Node.js ServerResponse object.
 * @param statusCode - HTTP status code (typically 200).
 * @param data - Additional response data merged with `{ ok: true }`.
 */
export function sendSuccess(
  res: ServerResponse,
  statusCode: number,
  data: Record<string, unknown> = {},
): void {
  const body: ApiSuccessResponse = { ok: true, ...data };
  sendJson(res, statusCode, body);
}

/**
 * Sends a structured error response with security headers.
 *
 * @param res - The Node.js ServerResponse object.
 * @param statusCode - HTTP status code (4xx/5xx).
 * @param code - Stable machine-readable error code.
 * @param message - Safe user-facing message.
 * @param hint - Optional safe hint for the user.
 */
export function sendError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  hint?: string,
): void {
  const body: ApiErrorResponse = {
    error: { code, message, hint: hint ?? null },
  };
  sendJson(res, statusCode, body);
}

/**
 * Sends a 500 error response without leaking sensitive information.
 *
 * Never includes: stack traces, absolute paths, tokens, API keys, or
 * raw exception messages that may contain sensitive data.
 *
 * @param res - The Node.js ServerResponse object.
 */
export function sendInternalError(res: ServerResponse): void {
  sendError(res, 500, ERROR_INTERNAL_ERROR, "Internal server error", "Try again later");
}
