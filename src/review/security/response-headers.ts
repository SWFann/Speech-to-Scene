/**
 * Security response headers for the Review Server.
 *
 * All API responses (success and error) must include these headers.
 * Apply them as early as possible in the response lifecycle.
 */

import type { ServerResponse } from "node:http";

/**
 * Security headers applied to every API response.
 *
 * Rationale:
 * - Content-Security-Policy: Prevents inline script execution and framing.
 * - X-Content-Type-Options: Prevents MIME-sniffing attacks.
 * - Referrer-Policy: Prevents leaking the full URL via Referer.
 * - Cache-Control: Ensures API responses are never cached by browsers or proxies.
 * - X-Frame-Options: Defense-in-depth against clickjacking (aligned with CSP).
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/**
 * Applies all security headers to the response.
 *
 * Call this at the beginning of every request handler, before writing the body.
 */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * Applies security headers plus an Allow header for 405 responses.
 */
export function applySecurityHeadersWithAllow(res: ServerResponse, allowedMethods: string[]): void {
  applySecurityHeaders(res);
  res.setHeader("Allow", allowedMethods.join(", "));
}
