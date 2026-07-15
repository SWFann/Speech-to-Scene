/**
 * Safe filename extraction utility.
 *
 * Extracts a basename from a potentially untrusted filename string,
 * handling both POSIX and Windows path separators. This is used by
 * the Application DTO layer to ensure that `originalFileName` fields
 * never contain absolute paths or directory traversal components.
 *
 * Design rules:
 * - Handles both `/` and `\` (not just the OS-native separator).
 * - Output never contains a directory separator.
 * - Output is never an absolute path.
 * - Handles trailing separators, `.`, `..`, whitespace, control chars.
 * - If no safe name can be extracted, returns `null` (caller decides DTO representation).
 * - Pure function — no I/O, no side effects, no platform dependency.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed fallback name when extraction yields empty or unsafe results. */
const UNSAFE_NAME_FALLBACK: null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts a safe basename from a filename string.
 *
 * Handles:
 * - POSIX absolute paths: `/home/user/secret.md` → `secret.md`
 * - Windows absolute paths: `C:\Users\user\secret.md` → `secret.md`
 * - Mixed separators: `folder/sub\file.mp4` → `file.mp4`
 * - Relative directory paths: `folder/sub/file.mp4` → `file.mp4`
 * - Trailing separators: `folder/` → `null` (no filename)
 * - Traversal-like: `..`, `.` → `null`
 * - Whitespace and control characters
 *
 * @param input - The potentially untrusted filename string.
 * @returns The safe basename, or `null` if no safe name can be extracted.
 */
export function safeFileName(input: string | undefined | null): string | null {
  if (input === undefined || input === null) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Trim leading/trailing whitespace and control characters
  // eslint-disable-next-line no-control-regex -- intentional control char stripping for security
  const trimmed = input.replace(/^[\s\x00-\x1F\x7F]+|[\s\x00-\x1F\x7F]+$/g, "");

  if (trimmed.length === 0) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Normalize all backslashes to forward slashes for uniform splitting
  const normalized = trimmed.replace(/\\/g, "/");

  // Split by `/` and take the last segment (may be empty for trailing separator)
  const segments = normalized.split("/");
  const lastSegment = segments[segments.length - 1] ?? "";

  // If no non-empty segment found (e.g., input was "///")
  if (lastSegment.length === 0) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Reject `.` and `..` (directory traversal)
  if (lastSegment === "." || lastSegment === "..") {
    return UNSAFE_NAME_FALLBACK;
  }

  // Reject Windows drive letters (e.g., "C:" — means input was just a drive)
  if (/^[a-zA-Z]:$/.test(lastSegment)) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Strip any remaining control characters from the result, and trim
  // leading/trailing whitespace that may have survived segment splitting
  // (e.g., "folder/ secret.md " → last segment is " secret.md ")
  // eslint-disable-next-line no-control-regex -- intentional control char stripping for security
  const cleaned = lastSegment.replace(/[\x00-\x1F\x7F]/g, "").trim();

  if (cleaned.length === 0) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Reject any name containing a colon — this prevents Windows drive-relative
  // paths like "C:secret.md" from being treated as a safe filename.
  // On Windows, "C:secret.md" refers to "secret.md" relative to drive C:'s
  // current directory, which is a path traversal risk.
  if (cleaned.includes(":")) {
    return UNSAFE_NAME_FALLBACK;
  }

  // Final check: the result must not contain a path separator
  if (cleaned.includes("/") || cleaned.includes("\\")) {
    return UNSAFE_NAME_FALLBACK;
  }

  return cleaned;
}
