/**
 * Session token validation for the Review Server.
 *
 * Validates the X-S2S-Session header for mutating requests.
 *
 * Security measures:
 * - Rejects empty/whitespace tokens at configuration time
 * - Rejects tokens exceeding MAX_TOKEN_LENGTH at configuration time
 * - Rejects tokens with leading/trailing whitespace at configuration time
 * - Always computes a fixed-length SHA-256 digest for timing-safe comparison
 * - Rejects multi-value token headers
 * - Token never appears in logs, error responses, or health responses
 */

import { randomUUID, createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

/** Name of the session token header. */
export const SESSION_TOKEN_HEADER = "X-S2S-Session" as const;

/**
 * Maximum length of a valid token string.
 * UUID v4 is 36 characters; allow a bit more for future formats.
 */
export const MAX_TOKEN_LENGTH = 128;

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

/**
 * Validates that a configured token is safe to use as a session token.
 *
 * Rejection rules:
 * - Empty string
 * - Pure whitespace (spaces, tabs, newlines)
 * - Exceeds MAX_TOKEN_LENGTH
 * - Leading or trailing whitespace (ambiguous token)
 *
 * Error messages never include the token itself.
 *
 * @param token - The token to validate.
 * @throws Error if the token fails validation.
 */
export function validateConfiguredToken(token: string): void {
  if (!token || token.length === 0) {
    throw new Error("Session token must not be empty");
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    throw new Error(`Session token must not exceed ${MAX_TOKEN_LENGTH} characters`);
  }

  if (token.trim().length === 0) {
    throw new Error("Session token must not be whitespace-only");
  }

  if (token !== token.trim()) {
    throw new Error("Session token must not have leading or trailing whitespace");
  }
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generates a random session token using UUID v4.
 */
export function generateSessionToken(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Request token validation
// ---------------------------------------------------------------------------

/**
 * Validates the session token from an incoming request against the expected token.
 *
 * Security measures:
 * - Always computes a fixed-length SHA-256 digest for both expected and
 *   provided tokens, regardless of whether their lengths match.
 * - Uses timingSafeEqual on the digests to prevent timing side-channel attacks.
 * - Rejects multi-value token headers (does NOT silently use the first value).
 * - Rejects tokens exceeding MAX_TOKEN_LENGTH.
 * - Token is never logged or included in error responses.
 *
 * @param req - The incoming HTTP request.
 * @param expectedToken - The server's configured session token.
 * @returns Validation result with reason.
 */
export function validateSessionToken(
  req: unknown,
  expectedToken: string,
): { valid: boolean; reason?: string } {
  const request = req as { headers?: Record<string, string | string[] | undefined> };
  const rawHeader =
    request.headers?.[SESSION_TOKEN_HEADER] ??
    request.headers?.[SESSION_TOKEN_HEADER.toLowerCase()];

  // Token is missing entirely
  if (rawHeader === undefined || rawHeader === null) {
    return { valid: false, reason: "session_required" };
  }

  // Reject multi-value headers — never silently use the first value
  if (Array.isArray(rawHeader)) {
    return { valid: false, reason: "session_rejected" };
  }

  if (typeof rawHeader !== "string") {
    return { valid: false, reason: "session_required" };
  }

  const providedToken = rawHeader;

  // Empty or whitespace-only token → session_required
  if (!providedToken || providedToken.trim().length === 0) {
    return { valid: false, reason: "session_required" };
  }

  // Reject tokens exceeding MAX_TOKEN_LENGTH before digest computation
  if (providedToken.length > MAX_TOKEN_LENGTH) {
    return { valid: false, reason: "session_rejected" };
  }

  // Always compute fixed-length SHA-256 digests for both tokens.
  // This ensures timingSafeEqual operates on equal-length buffers
  // and prevents length-based timing leaks.
  const expectedHash = createHash("sha256").update(expectedToken, "utf-8").digest();
  const providedHash = createHash("sha256").update(providedToken, "utf-8").digest();

  let hashesMatch: boolean;
  try {
    hashesMatch = timingSafeEqual(expectedHash, providedHash);
  } catch {
    hashesMatch = false;
  }

  if (!hashesMatch) {
    return { valid: false, reason: "session_rejected" };
  }

  return { valid: true };
}
