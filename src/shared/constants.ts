/**
 * Shared constants for Speech-to-Scene.
 *
 * These values form part of the persisted project protocol and must not
 * change without a schema version bump.
 */

/**
 * Fixed filename for the persisted project file.
 * @internal Do not construct paths dynamically; always use this constant.
 */
export const PROJECT_FILE_NAME = "project.s2s.json" as const;

/**
 * Current schema version.
 * Format: "major.minor" (not strict SemVer).
 * Increment when breaking changes are introduced to the persisted format.
 */
export const CURRENT_SCHEMA_VERSION = "0.1" as const;

/**
 * Encoding used for source documents (Markdown/TXT).
 */
export const SOURCE_ENCODING = "utf-8" as const;

/**
 * Unit used for all text offset and range calculations.
 * JavaScript string length and slicing operate on UTF-16 code units.
 */
export const SOURCE_OFFSET_UNIT = "utf16_code_unit" as const;

/**
 * Maximum allowed size for the project file (10 MiB).
 * Rejects malformed or suspiciously large files before parsing.
 */
export const MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum allowed size for a source document (5 MiB).
 * Enforced at init time when reading the user-provided script.
 */
export const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
