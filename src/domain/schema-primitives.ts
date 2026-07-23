/**
 * Primitive Zod schemas used across the entire project.
 *
 * These schemas form the foundation of the persisted data model.
 * All derived schemas must compose these primitives; never re-define
 * ID, hash, datetime, or URL rules inline.
 *
 * Encoding note: Zod's .regex() uses JavaScript RegExp, which operates on
 * UTF-16 code units. For ASCII-range patterns (hex, lowercase IDs, etc.)
 * this is equivalent to byte-level matching.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Helper schemas
// ---------------------------------------------------------------------------

/**
 * Non-empty string.
 *
 * Rejects pure whitespace: "   " fails .min(1) after length check.
 * Does NOT trim - persisted data must match input exactly.
 */
export const NonEmptyTrimmedStringSchema = z
  .string()
  .refine((s) => s.trim().length > 0, "必须是非空文本")
  .refine((s) => s === s.trim(), "前后不能有空白字符");

// ---------------------------------------------------------------------------
// Bounded numeric schemas
// ---------------------------------------------------------------------------

/**
 * Positive integer: >= 1.
 * Rejects NaN, Infinity, -0, fractions, and zero.
 */
export const PositiveIntegerSchema = z.number().int().positive();

/**
 * Non-negative integer: >= 0.
 * Rejects NaN, Infinity, fractions, and negative values.
 */
export const NonNegativeIntegerSchema = z.number().int().nonnegative();

/**
 * Finite positive number (allows fractions, rejects NaN/Infinity/zero/negative).
 */
export const FinitePositiveNumberSchema = z.number().positive().finite();

// ---------------------------------------------------------------------------
// Identifier
// ---------------------------------------------------------------------------

/**
 * Project-local identifier.
 *
 * Rules:
 * - Must not have leading/trailing whitespace
 * - Start with lowercase letter or digit (no underscore or dash at position 0)
 * - Contain only lowercase letters, digits, dots, underscores, dashes
 * - Length 1-128
 *
 * Rationale:
 * - Lowercase-only avoids case-sensitivity bugs across filesystems and URLs.
 * - No leading dot prevents hidden files on Unix.
 * - No spaces or special characters keeps shell and JSON safe.
 */
export const IdSchema = z
  .string()
  .refine((s) => s === s.trim(), "ID 前后不能有空白字符")
  .refine((s) => s.length > 0 && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(s), {
    message: "ID 必须以小写字母或数字开头，仅包含小写字母、数字、点、下划线、短横线，长度 1-128",
  });

// ---------------------------------------------------------------------------
// SHA-256 hash
// ---------------------------------------------------------------------------

/**
 * 64-character lowercase hexadecimal string (SHA-256).
 */
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "必须是 64 位小写十六进制 (SHA-256)");

// ---------------------------------------------------------------------------
// UTC datetime
// ---------------------------------------------------------------------------

/**
 * ISO 8601 UTC datetime with mandatory trailing 'Z'.
 *
 * Accepts:
 * - "2026-07-13T10:00:00.000Z"
 * - "2026-07-13T10:00:00Z"
 *
 * Rejects:
 * - Timezone offset ("+08:00")
 * - Missing 'Z' ("2026-07-13T10:00:00")
 * - Invalid date strings
 * - Invalid time components (hour 24+, minute 60+, second 60+)
 * - Impossible calendar dates (e.g., 2026-02-31)
 */
export const UtcDateTimeSchema = z
  .string()
  .regex(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/,
    "必须是 ISO 8601 UTC 时间，格式如 2026-07-13T10:00:00.000Z",
  )
  .refine((s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    if (year < 1 || year > 9999) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (hour > 23) return false;
    if (minute > 59) return false;
    if (second > 59) return false;
    // Reject impossible calendar dates by round-tripping through Date.UTC
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const reconstructed = new Date(utcMs);
    return (
      reconstructed.getUTCFullYear() === year &&
      reconstructed.getUTCMonth() === month - 1 &&
      reconstructed.getUTCDate() === day &&
      reconstructed.getUTCHours() === hour &&
      reconstructed.getUTCMinutes() === minute &&
      reconstructed.getUTCSeconds() === second
    );
  }, "日期时间字段超出有效范围");

// ---------------------------------------------------------------------------
// HTTPS URL
// ---------------------------------------------------------------------------

/**
 * Valid HTTPS URL.
 *
 * Rejects:
 * - http: (non-TLS)
 * - file:, javascript:, data: schemes
 * - Relative URLs
 * - URLs without a host
 */
export const HttpsUrlSchema = z
  .string()
  .url("必须是有效 URL")
  .refine((url) => url.startsWith("https://"), "必须使用 HTTPS 协议");

/**
 * URL schema for image URLs.
 * Accepts HTTPS (remote) and HTTP for localhost (locally served images).
 */
export const ImageUrlSchema = z
  .string()
  .url("必须是有效 URL")
  .refine(
    (url) =>
      url.startsWith("https://") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost"),
    "必须使用 HTTPS 或本地 HTTP 协议",
  );

// ---------------------------------------------------------------------------
// Type exports for convenience
// ---------------------------------------------------------------------------

export type Id = z.infer<typeof IdSchema>;
export type Sha256 = z.infer<typeof Sha256Schema>;
export type UtcDateTime = z.infer<typeof UtcDateTimeSchema>;
export type HttpsUrl = z.infer<typeof HttpsUrlSchema>;
