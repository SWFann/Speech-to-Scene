/**
 * System-level adapter implementations for Application ports.
 *
 * These are the production implementations that wrap Node.js built-ins:
 * - `SystemClock`: wraps `Date.now()`
 * - `SystemIdGenerator`: wraps `crypto.randomUUID()`
 */

import crypto from "node:crypto";

import type { Clock } from "../application/ports/clock.js";
import type { IdGenerator } from "../application/ports/id-generator.js";

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Production clock implementation using system time.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

// ---------------------------------------------------------------------------
// ID Generator
// ---------------------------------------------------------------------------

/**
 * Production ID generator using `crypto.randomUUID`.
 *
 * Project IDs: `project-<uuid>`
 * Temporary IDs: `tmp-<uuid>`
 * Scene IDs: `scene-<uuid>`
 */
export class SystemIdGenerator implements IdGenerator {
  projectId(): string {
    return `project-${randomUUID()}`;
  }

  temporaryId(): string {
    return `tmp-${randomUUID()}`;
  }

  sceneId(): string {
    return `scene-${randomUUID()}`;
  }
}

function randomUUID(): string {
  return crypto.randomUUID();
}
