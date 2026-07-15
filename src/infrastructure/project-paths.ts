/**
 * Project-relative path schema and safety utilities.
 *
 * All paths stored in project.s2s.json use POSIX forward-slash notation.
 * These utilities are shared by the Domain (validation), Infrastructure
 * (file operations), and CLI (argument parsing) layers.
 *
 * Security goals:
 * 1. Prevent directory traversal (../, absolute paths, Windows device names)
 * 2. Prevent symlink/junction escape from the project root
 * 3. Ensure path containment within the project directory
 * 4. Cross-platform: tests must pass on Linux, macOS, and Windows
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

// ---------------------------------------------------------------------------
// POSIX path validation (for stored paths)
// ---------------------------------------------------------------------------

/**
 * Windows reserved device names (case-insensitive).
 * Includes historical DOS devices and their extensions.
 */
const WINDOWS_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Reserved name suffix patterns (e.g., "file.txt::DATA").
 */
const WINDOWS_ALTERNATE_DATA_STREAM_RE = /::[^\\/]+$/;

/**
 * Validates a single path segment for OS-specific reserved names.
 */
function isReservedSegment(segment: string): boolean {
  const upper = segment.toUpperCase();
  // Exact match or prefix match followed by dot/space
  if (WINDOWS_DEVICE_NAMES.has(upper)) return true;
  if (WINDOWS_DEVICE_NAMES.has(upper.split(".")[0] ?? upper)) return true;
  if (WINDOWS_DEVICE_NAMES.has(upper.split(" ")[0] ?? upper)) return true;
  // Alternate data stream syntax: "file.txt::DATA"
  if (WINDOWS_ALTERNATE_DATA_STREAM_RE.test(segment)) return true;
  return false;
}

/**
 * Checks whether a candidate path looks like a Windows drive-relative path.
 * Examples: "C:file.txt", "D:relative.txt", "C:/file.txt"
 */
function isDriveRelative(segment: string): boolean {
  return /^[A-Za-z]:[\\/]?[^\\/]/.test(segment);
}

/**
 * Project-relative path schema.
 *
 * Rules (strict POSIX-style):
 * - No empty string
 * - No "." or ".." segments
 * - No absolute paths (no leading "/" or drive letters)
 * - No backslashes (Windows-style separators not allowed in stored paths)
 * - No NUL bytes
 * - No Windows device names as any segment
 * - No leading/trailing dot in any segment
 * - No leading/trailing whitespace
 * - Normalize duplicate slashes to single
 * - No alternate data stream syntax
 *
 * Unicode characters are allowed in segments.
 */
export const ProjectRelativePathSchema = z
  .string()
  // Normalize early: trim whitespace and remove duplicate slashes
  .transform((s) => s.trim().replace(/\/+/g, "/"))
  .pipe(z.string())
  // Reject NUL bytes and control characters
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f]/.test(s), "路径不能包含控制字符或 NUL")
  // Reject Windows drive letters and backslashes
  .refine((s) => !isDriveRelative(s) && !s.includes("\\"), "路径不能包含盘符或反斜杠")
  // Reject absolute POSIX paths
  .refine((s) => !s.startsWith("/"), "路径不能是绝对路径")
  // Reject empty segments, ".", ".."
  .refine((s) => {
    const segments = s.split("/");
    return (
      segments.length > 0 &&
      !segments.includes("") &&
      !segments.includes(".") &&
      !segments.includes("..")
    );
  }, "路径不能包含空段、'.' 或 '..'")
  // Reject segments starting with dot (hidden files)
  .refine((s) => {
    const segments = s.split("/");
    return segments.every((seg) => !seg.startsWith("."));
  }, "路径段不能以点开头")
  // Reject segments ending with dot or space
  .refine((s) => {
    const segments = s.split("/");
    return segments.every((seg) => !seg.endsWith(" ") && !seg.endsWith("."));
  }, "路径段不能以点或空格结尾")
  // Reject Windows reserved names in any segment
  .refine((s) => {
    const segments = s.split("/");
    return !segments.some((seg) => isReservedSegment(seg));
  }, "路径不能包含 Windows 保留设备名")
  // Reject UNC paths
  .refine((s) => !s.startsWith("//") && !s.startsWith("\\\\"), "路径不能是 UNC 路径")
  // Reject Windows extended-length paths
  .refine(
    (s) => !s.startsWith("\\\\?\\") && !s.startsWith("\\\\.\\"),
    "路径不能是 Windows 扩展路径",
  )
  // Reject Windows named pipes
  .refine((s) => !s.startsWith("\\\\.\\pipe\\"), "路径不能是命名管道")
  // Reject trailing slash
  .refine((s) => !s.endsWith("/"), "路径不能以斜杠结尾")
  // Reject alternate data stream syntax
  .refine((s) => !WINDOWS_ALTERNATE_DATA_STREAM_RE.test(s), "路径不能包含备用数据流语法")
  .pipe(z.string());

// ---------------------------------------------------------------------------
// Path safety helpers (runtime checks beyond Schema validation)
// ---------------------------------------------------------------------------

/**
 * Result of a path safety check.
 */
export type PathCheckResult = { safe: true } | { safe: false; reason: string };

/**
 * Checks whether a candidate path is strictly contained within the project root.
 *
 * Uses `path.relative()` to detect both:
 * - Lexical traversal: "../../etc/passwd"
 * - Symlink escape: symlink inside project pointing outside
 *
 * @param candidatePath Absolute path to check (resolved, no symlinks)
 * @param projectRoot Absolute path of the project root (resolved, no symlinks)
 */
export function isPathContained(candidatePath: string, projectRoot: string): PathCheckResult {
  try {
    // path.relative returns a non-".." prefix when candidate is inside root
    const relative = path.relative(projectRoot, candidatePath);
    const isInside = !relative.startsWith("..") && !path.isAbsolute(relative);

    if (isInside) {
      return { safe: true };
    }

    // Prefix trap: ensure "/tmp/project-evil" is not treated as inside "/tmp/project"
    const resolvedCandidate = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(projectRoot);
    if (
      !resolvedCandidate.startsWith(resolvedRoot + path.sep) &&
      resolvedCandidate !== resolvedRoot
    ) {
      return {
        safe: false,
        reason: `路径 ${candidatePath} 不在项目根 ${projectRoot} 内`,
      };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "路径解析失败" };
  }
}

/**
 * Checks whether a path contains any path-traversal patterns.
 * Handles both forward slashes (POSIX) and backslashes (Windows).
 */
export function hasPathTraversal(p: string): boolean {
  return /(?:\/|^|\\|\\)\.\.(?:\/|$|\\)/.test(p);
}

/**
 * Returns the canonical POSIX representation of a path (forward slashes, no trailing slash).
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Cross-platform test helpers
// ---------------------------------------------------------------------------

/**
 * Runs a path validation check using both POSIX and Windows semantics.
 * Useful for test suites that must pass on all three platforms.
 */
export function validatePathCrossPlatform(candidate: string): {
  posix: PathCheckResult;
  win32: PathCheckResult;
} {
  // Use path.posix for POSIX semantics
  const posixResult: PathCheckResult = (() => {
    try {
      if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) {
        return { safe: false, reason: "POSIX: 绝对路径" };
      }
      const segments = candidate.split("/");
      if (segments.some((s) => s === "." || s === ".." || s === "")) {
        return { safe: false, reason: "POSIX: 包含 traversal" };
      }
      return { safe: true };
    } catch {
      return { safe: false, reason: "POSIX: 解析失败" };
    }
  })();

  // Use path.win32 for Windows semantics
  const win32Result: PathCheckResult = (() => {
    try {
      const parsed = path.win32.parse(candidate);
      if (parsed.root) {
        return { safe: false, reason: "Win32: 绝对路径" };
      }
      const segments = candidate.split(/[\\/]/);
      if (
        segments.some((s) => s === "." || s === ".." || WINDOWS_DEVICE_NAMES.has(s.toUpperCase()))
      ) {
        return { safe: false, reason: "Win32: 保留名或 traversal" };
      }
      return { safe: true };
    } catch {
      return { safe: false, reason: "Win32: 解析失败" };
    }
  })();

  return { posix: posixResult, win32: win32Result };
}

// Re-export path module for convenience
export { path, fs };
