/**
 * Origin header validation for the Review Server.
 *
 * For mutating requests from browsers, validates that the Origin header
 * matches the EXACT serialized Origin of the Review Server.
 *
 * Strict security rules:
 * - scheme must be exactly "http" (no https, file, etc.)
 * - hostname must match the configured boundHost exactly (not any loopback alias)
 * - port must match the bound port exactly
 * - original Origin string must equal URL-parsed url.origin
 * - Rejects: username, password, path, query, fragment, Origin: null
 * - IPv6: http://[::1]:<port> must pass when bound to ::1
 * - No wildcard CORS
 */

import type { IncomingMessage } from "node:http";

/**
 * Result of Origin header validation.
 */
export interface OriginValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Validates the Origin header from an incoming request.
 *
 * @param req - The incoming HTTP request.
 * @param boundScheme - The URL scheme the server is bound to ("http").
 * @param boundHost - The hostname the server is bound to.
 * @param boundPort - The port the server is bound to.
 * @returns Validation result with optional rejection reason.
 */
export function validateOrigin(
  req: IncomingMessage,
  boundScheme: string,
  boundHost: string,
  boundPort: number,
): OriginValidationResult {
  const originHeader = req.headers.origin;

  // No Origin header: not a browser CORS request.
  // Allowed if the request has a valid session token (checked separately).
  if (!originHeader || typeof originHeader !== "string") {
    return { valid: true };
  }

  // Origin: null is explicitly rejected
  if (originHeader === "null") {
    return {
      valid: false,
      reason: "Origin 'null' is not allowed",
    };
  }

  // Parse the Origin URL
  let url: URL;
  try {
    url = new URL(originHeader);
  } catch {
    return {
      valid: false,
      reason: "Origin header is not a valid URL",
    };
  }

  // Scheme must be exactly "http"
  if (url.protocol.replace(/:$/, "") !== boundScheme) {
    return {
      valid: false,
      reason: `Origin scheme is not allowed`,
    };
  }

  // Reject username/password in Origin
  if (url.username || url.password) {
    return {
      valid: false,
      reason: "Origin must not contain username or password",
    };
  }

  // Reject path in Origin
  if (url.pathname && url.pathname !== "/") {
    return {
      valid: false,
      reason: "Origin must not contain a path",
    };
  }

  // Reject query in Origin
  if (url.search) {
    return {
      valid: false,
      reason: "Origin must not contain a query string",
    };
  }

  // Reject fragment in Origin
  if (url.hash) {
    return {
      valid: false,
      reason: "Origin must not contain a fragment",
    };
  }

  // Compare canonical origin — url.origin handles hostname + port together,
  // including IPv6 bracket normalization. This avoids mismatches between
  // different serialized forms of the same IPv6 address.
  const expectedOrigin = `${boundScheme}://${normalizeHostForOrigin(boundHost)}:${boundPort}`;

  if (url.origin !== expectedOrigin) {
    return {
      valid: false,
      reason: "Origin does not match bound host and port",
    };
  }

  // The original Origin string must equal the canonical serialized origin.
  // This rejects trailing slashes, extra components, and non-canonical forms.
  if (originHeader !== expectedOrigin) {
    return {
      valid: false,
      reason: "Origin does not match canonical serialized form",
    };
  }

  return { valid: true };
}

/**
 * Normalizes a hostname for inclusion in an Origin string.
 *
 * IPv6 addresses are wrapped in square brackets (e.g., "::1" → "[::1]").
 * IPv4 and hostnames are returned as-is.
 */
function normalizeHostForOrigin(hostname: string): string {
  if (hostname.includes(":")) {
    return `[${hostname}]`;
  }
  return hostname;
}
