/**
 * HTTP error codes and constants for the Review Server API.
 *
 * All API errors return a unified JSON shape:
 *
 *   {
 *     "error": {
 *       "code": "<stable_machine_code>",
 *       "message": "<safe_user_facing_message>",
 *       "hint": "<optional_safe_hint>"
 *     }
 *   }
 *
 * Status code mapping:
 *   400 → invalid_request / invalid_json
 *   401 → session_required
 *   403 → session_rejected / host_rejected / origin_rejected
 *   404 → not_found
 *   405 → method_not_allowed
 *   413 → payload_too_large
 *   415 → unsupported_media_type
 *   500 → internal_error
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Request body is not valid JSON or violates schema constraints. */
export const ERROR_INVALID_JSON = "invalid_json" as const;

/** Generic malformed request (missing required fields, etc.). */
export const ERROR_INVALID_REQUEST = "invalid_request" as const;

/** Session token is required but was not provided. */
export const ERROR_SESSION_REQUIRED = "session_required" as const;

/** Session token was provided but is incorrect. */
export const ERROR_SESSION_REJECTED = "session_rejected" as const;

/** Request Host header does not match the bound local address. */
export const ERROR_HOST_REJECTED = "host_rejected" as const;

/** Request Origin is not allowed for mutating requests. */
export const ERROR_ORIGIN_REJECTED = "origin_rejected" as const;

/** No route matched the request path. */
export const ERROR_NOT_FOUND = "not_found" as const;

/** Route exists but the HTTP method is not allowed. */
export const ERROR_METHOD_NOT_ALLOWED = "method_not_allowed" as const;

/** Request body exceeds the allowed size limit. */
export const ERROR_PAYLOAD_TOO_LARGE = "payload_too_large" as const;

/** Content-Type is not supported for this endpoint. */
export const ERROR_UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type" as const;

/** Unexpected server error. */
export const ERROR_INTERNAL_ERROR = "internal_error" as const;

// ---------------------------------------------------------------------------
// HTTP methods
// ---------------------------------------------------------------------------

/** Mutating HTTP methods that require session token validation. */
export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

/** Accepted request content type for JSON endpoints. */
export const JSON_CONTENT_TYPE = "application/json" as const;

/** Full JSON content type header value with charset. */
export const JSON_CONTENT_TYPE_HEADER = "application/json; charset=utf-8" as const;

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

/** Default maximum JSON request body size: 1 MiB. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Timeouts (milliseconds)
// ---------------------------------------------------------------------------

/** Default request timeout: 30 seconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Default headers timeout: 15 seconds. */
export const DEFAULT_HEADERS_TIMEOUT_MS = 15_000;

/** Default keep-alive timeout: 5 seconds. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Safe messages (no sensitive data)
// ---------------------------------------------------------------------------

export const SAFE_MESSAGES = {
  [ERROR_INVALID_JSON]: {
    message: "Request body is not valid JSON",
    hint: "Ensure the request body is valid JSON",
  },
  [ERROR_INVALID_REQUEST]: {
    message: "Invalid request",
    hint: "Check the request parameters",
  },
  [ERROR_SESSION_REQUIRED]: {
    message: "Session token is required",
    hint: "Provide X-S2S-Session header",
  },
  [ERROR_SESSION_REJECTED]: {
    message: "Session token is invalid",
    hint: "Restart the review server to get a new token",
  },
  [ERROR_HOST_REJECTED]: {
    message: "Request Host is not allowed",
    hint: null,
  },
  [ERROR_ORIGIN_REJECTED]: {
    message: "Request Origin is not allowed",
    hint: null,
  },
  [ERROR_NOT_FOUND]: {
    message: "Not found",
    hint: null,
  },
  [ERROR_METHOD_NOT_ALLOWED]: {
    message: "Method not allowed",
    hint: null,
  },
  [ERROR_PAYLOAD_TOO_LARGE]: {
    message: "Request body is too large",
    hint: "Reduce the request body size",
  },
  [ERROR_UNSUPPORTED_MEDIA_TYPE]: {
    message: "Content-Type is not supported",
    hint: "Use application/json",
  },
  [ERROR_INTERNAL_ERROR]: {
    message: "Internal server error",
    hint: "Try again later",
  },
} as const;
