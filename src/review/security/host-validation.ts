/**
 * Host header validation for the Review Server.
 *
 * Validates that the incoming Host header matches the actual bound
 * loopback address and port. This prevents DNS rebinding attacks
 * where a malicious domain resolves to 127.0.0.1.
 *
 * Security rules:
 * - Only loopback addresses are accepted: 127.0.0.1, localhost, ::1
 * - The port MUST match the actual bound port exactly
 * - Subdomain attacks (e.g., 127.0.0.1.evil.example) are rejected
 * - Control characters and malformed Host values are rejected
 * - No wildcard or prefix-based matching
 */

import type { IncomingMessage } from "node:http";

/**
 * Allowed loopback host values (case-insensitive).
 *
 * These are the only hostnames that will be accepted in the Host header.
 * The actual host binding is configured at server startup and validated
 * separately in startReviewServer.
 */
const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Parsed Host header result.
 */
interface ParsedHost {
  readonly hostname: string;
  readonly port: number | null;
}

/**
 * Result of Host header validation.
 */
export interface HostValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Validates that the configured bind host is a safe loopback address.
 *
 * This is called at server startup, not per-request.
 *
 * @throws Error if the host is not a recognized loopback address.
 */
export function validateConfiguredBindHost(host: string): void {
  if (!ALLOWED_LOOPBACK_HOSTS.has(host.toLowerCase())) {
    throw new Error(`Host must be a loopback address (127.0.0.1, localhost, or ::1); got: ${host}`);
  }
}

/**
 * Parses the Host header value into hostname and port components.
 *
 * Handles:
 * - `hostname:port`
 * - `[ipv6]:port`
 * - `hostname` (no port)
 *
 * Rejects control characters and empty values.
 */
function parseHostHeader(hostHeader: string): ParsedHost | null {
  if (!hostHeader || hostHeader.length === 0) {
    return null;
  }

  // Reject control characters
  for (let i = 0; i < hostHeader.length; i++) {
    const code = hostHeader.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return null;
    }
  }

  // IPv6 bracket format: [::1]:port
  if (hostHeader.startsWith("[") && hostHeader.includes("]")) {
    const closeBracket = hostHeader.indexOf("]");
    const ipv6Host = hostHeader.slice(1, closeBracket);

    if (closeBracket + 1 < hostHeader.length) {
      const afterBracket = hostHeader.slice(closeBracket + 1);
      if (afterBracket.startsWith(":")) {
        const portStr = afterBracket.slice(1);
        const port = Number.parseInt(portStr, 10);
        if (Number.isNaN(port) || portStr !== String(port)) {
          return null;
        }
        return { hostname: ipv6Host, port };
      }
      // Trailing garbage after ]
      return null;
    }

    return { hostname: ipv6Host, port: null };
  }

  // hostname or hostname:port
  const lastColon = hostHeader.lastIndexOf(":");
  if (lastColon === -1) {
    return { hostname: hostHeader, port: null };
  }

  const hostname = hostHeader.slice(0, lastColon);
  const portStr = hostHeader.slice(lastColon + 1);

  if (!portStr) {
    return null;
  }

  const port = Number.parseInt(portStr, 10);
  if (Number.isNaN(port) || portStr !== String(port)) {
    return null;
  }

  return { hostname, port };
}

/**
 * Validates the Host header from an incoming request.
 *
 * @param req - The incoming HTTP request.
 * @param boundHost - The host the server is bound to.
 * @param boundPort - The port the server is bound to.
 * @returns Validation result with optional rejection reason.
 */
export function validateHostHeader(
  req: IncomingMessage,
  boundHost: string,
  boundPort: number,
): HostValidationResult {
  const hostHeader = req.headers.host;

  if (!hostHeader || typeof hostHeader !== "string") {
    return { valid: false, reason: "Host header is missing" };
  }

  const parsed = parseHostHeader(hostHeader);
  if (parsed === null) {
    return { valid: false, reason: "Host header format is invalid" };
  }

  // Hostname must be one of the allowed loopback addresses
  const normalizedHostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(normalizedHostname)) {
    return {
      valid: false,
      reason: `Host "${parsed.hostname}" is not a loopback address`,
    };
  }

  // Port MUST be present — Host without port is rejected
  if (parsed.port === null) {
    return {
      valid: false,
      reason: "Host header must include the port",
    };
  }

  // Port must be in valid range
  if (parsed.port < 0 || parsed.port > 65535) {
    return {
      valid: false,
      reason: `Host port ${parsed.port} is out of range`,
    };
  }

  // Port must match the bound port exactly
  if (parsed.port !== boundPort) {
    return {
      valid: false,
      reason: `Host port ${parsed.port} does not match bound port ${boundPort}`,
    };
  }

  return { valid: true };
}
