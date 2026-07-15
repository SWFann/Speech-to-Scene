/**
 * Request security middleware composition.
 *
 * Composes Host validation, Origin validation, and Session token validation
 * into a two-phase per-request security check for the Review Server.
 *
 * Security flow for each request:
 *
 * Phase 1 — Pre-routing (before route matching):
 *   1. Validate Host header (all requests, even unknown paths)
 *
 * Phase 2 — Post-routing (after route matching, only for matched routes):
 *   2. Validate method allowlist (route-specific, defense-in-depth)
 *   3. For mutating requests:
 *      a. Validate Origin header (if present)
 *      b. Validate session token (required)
 *
 * This split ensures that an attacker cannot probe which routes exist
 * by sending requests with an evil Host header — the Host Gate runs
 * first on every request, regardless of the path or method.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  applySecurityHeaders,
  applySecurityHeadersWithAllow,
} from "./security/response-headers.js";
import { validateHostHeader, type HostValidationResult } from "./security/host-validation.js";
import { validateOrigin, type OriginValidationResult } from "./security/origin-validation.js";
import { validateSessionToken } from "./security/session-token.js";
import { sendError } from "./json-response.js";
import {
  MUTATING_METHODS,
  ERROR_HOST_REJECTED,
  ERROR_ORIGIN_REJECTED,
  ERROR_SESSION_REQUIRED,
  ERROR_SESSION_REJECTED,
  ERROR_METHOD_NOT_ALLOWED,
} from "./http-errors.js";

// ---------------------------------------------------------------------------
// Security config
// ---------------------------------------------------------------------------

/**
 * Configuration for the request security layer.
 */
export interface RequestSecurityConfig {
  readonly boundHost: string;
  readonly boundPort: number;
  readonly boundToken: string;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Result of security checks.
 */
export interface SecurityCheckResult {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly hint?: string | null;
  readonly headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Individual validators (exposed for testing)
// ---------------------------------------------------------------------------

/**
 * Validates the Host header against the bound address.
 */
export function checkHost(
  req: IncomingMessage,
  config: RequestSecurityConfig,
): SecurityCheckResult | null {
  const result: HostValidationResult = validateHostHeader(req, config.boundHost, config.boundPort);

  if (!result.valid) {
    return {
      allowed: false,
      statusCode: 403,
      code: ERROR_HOST_REJECTED,
      message: "Request Host is not allowed",
      hint: null,
    };
  }

  return null;
}

/**
 * Validates the Origin header for mutating requests.
 */
export function checkOrigin(
  req: IncomingMessage,
  config: RequestSecurityConfig,
): SecurityCheckResult | null {
  const result: OriginValidationResult = validateOrigin(
    req,
    "http",
    config.boundHost,
    config.boundPort,
  );

  if (!result.valid) {
    return {
      allowed: false,
      statusCode: 403,
      code: ERROR_ORIGIN_REJECTED,
      message: "Request Origin is not allowed",
      hint: null,
    };
  }

  return null;
}

/**
 * Validates the session token for mutating requests.
 */
export function checkToken(
  req: IncomingMessage,
  config: RequestSecurityConfig,
): SecurityCheckResult | null {
  const result = validateSessionToken(req, config.boundToken);

  if (!result.valid) {
    if (result.reason === "session_required") {
      return {
        allowed: false,
        statusCode: 401,
        code: ERROR_SESSION_REQUIRED,
        message: "Session token is required",
        hint: "Provide X-S2S-Session header",
      };
    }
    return {
      allowed: false,
      statusCode: 403,
      code: ERROR_SESSION_REJECTED,
      message: "Session token is invalid",
      hint: "Restart the review server to get a new token",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Composed security gates
// ---------------------------------------------------------------------------

/**
 * Result type for a composed security gate check.
 */
export interface SecurityGateResult {
  readonly passed: boolean;
  readonly rejection?: {
    statusCode: number;
    apply(res: ServerResponse): void;
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Pre-routing Host Gate
// ---------------------------------------------------------------------------

/**
 * Runs the pre-routing Host Gate.
 *
 * This must be called BEFORE route matching. It validates the Host header
 * on every incoming request, regardless of whether the path or method is
 * valid. This prevents attackers from probing which routes exist by
 * sending requests with an evil Host header.
 *
 * @param req - The incoming HTTP request.
 * @param config - Security configuration.
 * @returns Security gate result. If `passed` is false, the caller should
 *   call `rejection.apply(res)` and return immediately.
 */
export function checkHostGate(
  req: IncomingMessage,
  config: RequestSecurityConfig,
): SecurityGateResult {
  const hostResult = checkHost(req, config);
  if (hostResult !== null) {
    return {
      passed: false,
      rejection: {
        statusCode: hostResult.statusCode,
        apply: (res: ServerResponse) => {
          applySecurityHeaders(res);
          sendError(
            res,
            hostResult.statusCode,
            hostResult.code,
            hostResult.message,
            hostResult.hint ?? undefined,
          );
        },
      },
    };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Phase 2: Post-routing Method/Origin/Token Gate
// ---------------------------------------------------------------------------

/**
 * Runs the post-routing security gate.
 *
 * This is called AFTER a route has been matched. It performs:
 * 1. Method allowlist check (defense-in-depth; should already pass since
 *    the route matched on path+method).
 * 2. For mutating methods: Origin validation and session token validation.
 *
 * @param req - The incoming HTTP request.
 * @param method - The HTTP method.
 * @param allowedMethods - The methods allowed for this route.
 * @param config - Security configuration.
 * @returns Security gate result. If `passed` is false, the caller should
 *   call `rejection.apply(res)` and return.
 */
export function runPostRoutingGate(
  req: IncomingMessage,
  method: string,
  allowedMethods: readonly string[],
  config: RequestSecurityConfig,
): SecurityGateResult {
  // 1. Method check (defense-in-depth)
  if (!allowedMethods.includes(method)) {
    return {
      passed: false,
      rejection: {
        statusCode: 405,
        apply: (res: ServerResponse) => {
          applySecurityHeadersWithAllow(res, [...allowedMethods]);
          sendError(res, 405, ERROR_METHOD_NOT_ALLOWED, "Method not allowed");
        },
      },
    };
  }

  // 2. For mutating methods, validate Origin and token
  if (MUTATING_METHODS.has(method)) {
    const originResult = checkOrigin(req, config);
    if (originResult !== null) {
      return {
        passed: false,
        rejection: {
          statusCode: originResult.statusCode,
          apply: (res: ServerResponse) => {
            applySecurityHeaders(res);
            sendError(
              res,
              originResult.statusCode,
              originResult.code,
              originResult.message,
              originResult.hint ?? undefined,
            );
          },
        },
      };
    }

    const tokenResult = checkToken(req, config);
    if (tokenResult !== null) {
      return {
        passed: false,
        rejection: {
          statusCode: tokenResult.statusCode,
          apply: (res: ServerResponse) => {
            applySecurityHeaders(res);
            sendError(
              res,
              tokenResult.statusCode,
              tokenResult.code,
              tokenResult.message,
              tokenResult.hint ?? undefined,
            );
          },
        },
      };
    }
  }

  return { passed: true };
}
