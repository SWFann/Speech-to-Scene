/**
 * Conservative multipart/form-data parser for local asset uploads.
 *
 * Design constraints:
 * - Only supports `multipart/form-data` with a boundary.
 * - Enforces a maximum total body size (default 10 MiB).
 * - Only extracts a single `file` field (required) and optional text fields
 *   `provenance` (JSON string) and `note` (plain string).
 * - Rejects any multipart field other than file/provenance/note with 400.
 * - Does NOT decode base64, quoted-printable, or transfer encodings.
 * - Does NOT support nested multipart.
 * - Does NOT trust client-provided filenames for filesystem operations.
 * - Returns raw Buffer for the file field (caller validates magic bytes).
 *
 * Security notes:
 * - The boundary is extracted from Content-Type and validated.
 * - Each part is parsed by splitting on the boundary delimiter.
 * - The parser never writes to the filesystem.
 * - The original filename is sanitized by the caller (safeFileName).
 * - The Content-Type of the part is NOT trusted; the caller must validate
 *   magic bytes independently.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { sendError } from "./json-response.js";
import {
  ERROR_INVALID_REQUEST,
  ERROR_PAYLOAD_TOO_LARGE,
  ERROR_UNSUPPORTED_MEDIA_TYPE,
} from "./http-errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum upload body size: 10 MiB. */
export const MAX_UPLOAD_BODY_BYTES = 10 * 1024 * 1024;

/** Maximum text field length (provenance JSON, note): 64 KiB. */
const MAX_TEXT_FIELD_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a successful multipart parse. */
export interface MultipartParseSuccess {
  readonly success: true;
  readonly file: {
    readonly buffer: Buffer;
    readonly originalFileName: string;
    readonly contentType: string;
  };
  readonly provenance: string | null;
  readonly note: string | null;
}

/** Result of a failed multipart parse. */
export interface MultipartParseFailure {
  readonly success: false;
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly hint: string | null;
}

export type MultipartParseResult = MultipartParseSuccess | MultipartParseFailure;

// ---------------------------------------------------------------------------
// Content-Type boundary extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the boundary from a `multipart/form-data` Content-Type header.
 *
 * Returns `null` if the Content-Type is not multipart/form-data or if the
 * boundary is missing/invalid.
 */
export function extractBoundary(contentType: string | undefined): string | null {
  if (!contentType) return null;

  const lower = contentType.toLowerCase();
  if (!lower.startsWith("multipart/form-data")) return null;

  // Find boundary= or boundary="
  const boundaryMatch = contentType.match(/boundary=("([^"]+)"|([^;,\s]+))/i);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[2] ?? boundaryMatch[3];
  if (!boundary || boundary.length === 0) return null;

  // Boundary must not contain illegal characters
  // RFC 2046: boundary = 0*69<bchars> bcharsnospace
  if (boundary.length > 70) return null;
  // eslint-disable-next-line no-control-regex -- intentional control char check for boundary safety
  if (/[\x00-\x1F\x7F]/.test(boundary)) return null;

  return boundary;
}

// ---------------------------------------------------------------------------
// Multipart body parser
// ---------------------------------------------------------------------------

/**
 * Parses a raw multipart/form-data body buffer.
 *
 * @param body - The complete raw body buffer.
 * @param boundary - The boundary string (without the leading `--`).
 * @returns Parsed fields or an error.
 */
export function parseMultipartBody(body: Buffer, boundary: string): MultipartParseResult {
  const boundaryMarker = Buffer.from(`--${boundary}`);

  // Quick sanity: body must start with the boundary
  if (body.length < boundaryMarker.length) {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_REQUEST,
      message: "Malformed multipart body",
      hint: null,
    };
  }

  // Check if body starts with the boundary
  if (!body.subarray(0, boundaryMarker.length).equals(boundaryMarker)) {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_REQUEST,
      message: "Malformed multipart body",
      hint: null,
    };
  }

  // Find all boundary marker positions in the body
  const positions: number[] = [];
  let searchFrom = 0;
  let nextPos: number;
  while ((nextPos = body.indexOf(boundaryMarker, searchFrom)) !== -1) {
    positions.push(nextPos);
    searchFrom = nextPos + boundaryMarker.length;
  }

  // Need at least 2 markers: opening and closing
  if (positions.length < 2) {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_REQUEST,
      message: "Malformed multipart body: missing closing boundary",
      hint: null,
    };
  }

  // Parse each part between consecutive boundary markers
  const parts: Buffer[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const markerStart = positions[i]!;
    let contentStart = markerStart + boundaryMarker.length;

    // Check if this is the closing boundary (followed by --)
    if (
      contentStart + 1 < body.length &&
      body[contentStart] === 0x2d &&
      body[contentStart + 1] === 0x2d
    ) {
      // This is the closing boundary — stop
      break;
    }

    // Skip \r\n after the boundary marker
    if (
      contentStart + 1 < body.length &&
      body[contentStart] === 0x0d &&
      body[contentStart + 1] === 0x0a
    ) {
      contentStart += 2;
    }

    // The part content ends at the next boundary marker,
    // but we need to strip the trailing \r\n that precedes it
    let contentEnd = positions[i + 1]!;
    if (contentEnd >= 2 && body[contentEnd - 2] === 0x0d && body[contentEnd - 1] === 0x0a) {
      contentEnd -= 2;
    }

    if (contentEnd > contentStart) {
      parts.push(body.subarray(contentStart, contentEnd));
    }
  }

  // Parse each part (headers + body)
  let fileBuffer: Buffer | null = null;
  let fileOriginalName = "";
  let fileContentType = "application/octet-stream";
  let provenance: string | null = null;
  let note: string | null = null;

  for (const part of parts) {
    if (part.length === 0) continue;

    // Find the header/body separator: \r\n\r\n
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }

    const headerBytes = part.subarray(0, headerEnd);
    const bodyBytes = part.subarray(headerEnd + 4);

    const headerStr = headerBytes.toString("utf-8");

    // Parse Content-Disposition
    const dispositionMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*([^\r\n]+)/i);
    if (!dispositionMatch) continue;

    const disposition = dispositionMatch[1] ?? "";

    // Extract name
    const nameMatch = disposition.match(/name="([^"]*)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1] ?? "";

    // Extract filename (if present)
    const filenameMatch = disposition.match(/filename="([^"]*)"/);
    const filename = filenameMatch?.[1] ?? undefined;

    // Parse Content-Type for this part
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    const partContentType = ctMatch?.[1]?.trim() ?? "application/octet-stream";

    if (fieldName === "file") {
      if (fileBuffer !== null) {
        return {
          success: false,
          statusCode: 400,
          code: ERROR_INVALID_REQUEST,
          message: "Only one file field is allowed",
          hint: null,
        };
      }
      fileBuffer = bodyBytes;
      fileOriginalName = filename ?? "upload";
      fileContentType = partContentType;
    } else if (fieldName === "provenance") {
      if (bodyBytes.length > MAX_TEXT_FIELD_BYTES) {
        return {
          success: false,
          statusCode: 400,
          code: ERROR_INVALID_REQUEST,
          message: "provenance field is too large",
          hint: null,
        };
      }
      provenance = bodyBytes.toString("utf-8");
    } else if (fieldName === "note") {
      if (bodyBytes.length > MAX_TEXT_FIELD_BYTES) {
        return {
          success: false,
          statusCode: 400,
          code: ERROR_INVALID_REQUEST,
          message: "note field is too large",
          hint: null,
        };
      }
      note = bodyBytes.toString("utf-8");
    } else {
      // Unknown multipart fields are rejected — only file, provenance, and note
      // are allowed. This prevents injection of server-controlled fields like
      // projectRoot, sceneId, or relativePath via multipart form data.
      return {
        success: false,
        statusCode: 400,
        code: ERROR_INVALID_REQUEST,
        message: `Unexpected multipart field: ${fieldName}`,
        hint: "Only file, provenance, and note fields are allowed",
      };
    }
  }

  if (fileBuffer === null) {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_REQUEST,
      message: "Missing required file field",
      hint: "Include a file field in the multipart form data",
    };
  }

  return {
    success: true,
    file: {
      buffer: fileBuffer,
      originalFileName: fileOriginalName,
      contentType: fileContentType,
    },
    provenance,
    note,
  };
}

// ---------------------------------------------------------------------------
// HTTP body reader + parser
// ---------------------------------------------------------------------------

/**
 * Reads the entire request body into a buffer with size limit, then parses
 * it as multipart/form-data.
 *
 * @param req - The incoming HTTP request.
 * @param res - The server response (for sending error responses).
 * @param options - Parser options.
 * @returns A parse result. If `success` is false, the caller should send the
 *   response using the statusCode, code, and message.
 */
export async function parseMultipartUpload(
  req: IncomingMessage,
  _res: ServerResponse,
  options: {
    readonly maxBytes?: number;
  } = {},
): Promise<MultipartParseResult> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BODY_BYTES;

  // Validate Content-Type
  const contentType = req.headers["content-type"];
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    return {
      success: false,
      statusCode: 415,
      code: ERROR_UNSUPPORTED_MEDIA_TYPE,
      message: "Content-Type must be multipart/form-data with a valid boundary",
      hint: "Set Content-Type: multipart/form-data; boundary=...",
    };
  }

  // Collect body chunks with size limit
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for await (const chunk of req) {
      if (chunk instanceof Buffer) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          return {
            success: false,
            statusCode: 413,
            code: ERROR_PAYLOAD_TOO_LARGE,
            message: `Upload body exceeds ${maxBytes} bytes`,
            hint: "Reduce the file size",
          };
        }
        chunks.push(chunk);
      }
    }
  } catch {
    return {
      success: false,
      statusCode: 400,
      code: ERROR_INVALID_REQUEST,
      message: "Request stream error",
      hint: null,
    };
  }

  const body = Buffer.concat(chunks);

  // Parse the multipart body
  return parseMultipartBody(body, boundary);
}

// ---------------------------------------------------------------------------
// Magic byte validation
// ---------------------------------------------------------------------------

/**
 * Supported MIME types and their magic byte signatures.
 *
 * Only types with reliable magic byte validation are included.
 * SVG is intentionally excluded due to XSS risk.
 */
interface MagicByteRule {
  readonly mimeType: string;
  readonly extensions: readonly string[];
  readonly check: (buf: Buffer) => boolean;
}

const MAGIC_BYTE_RULES: readonly MagicByteRule[] = [
  {
    mimeType: "image/png",
    extensions: [".png"],
    check: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    check: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
];

/**
 * Allowed MIME types set for quick lookup.
 */
const ALLOWED_MIME_TYPES = new Set(MAGIC_BYTE_RULES.map((r) => r.mimeType));

/**
 * Allowed extensions set for quick lookup.
 */
const ALLOWED_EXTENSIONS = new Set(MAGIC_BYTE_RULES.flatMap((r) => r.extensions));

/**
 * Result of magic byte validation.
 */
export interface MagicByteResult {
  readonly valid: boolean;
  readonly mimeType: string | null;
  readonly extension: string | null;
}

/**
 * Validates a file buffer against the magic byte allowlist.
 *
 * Returns the detected MIME type and extension if valid.
 * If no rule matches, returns `{ valid: false, mimeType: null, extension: null }`.
 */
export function validateMagicBytes(buffer: Buffer): MagicByteResult {
  for (const rule of MAGIC_BYTE_RULES) {
    if (rule.check(buffer)) {
      return {
        valid: true,
        mimeType: rule.mimeType,
        extension: rule.extensions[0]!,
      };
    }
  }
  return { valid: false, mimeType: null, extension: null };
}

/**
 * Checks if a MIME type is in the allowed list.
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Checks if a file extension is in the allowed list.
 */
export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Returns the canonical extension for a given MIME type.
 */
export function getExtensionForMimeType(mimeType: string): string | null {
  const rule = MAGIC_BYTE_RULES.find((r) => r.mimeType === mimeType.toLowerCase());
  return rule?.extensions[0] ?? null;
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

/**
 * Sends a multipart parse error response.
 */
export function sendMultipartError(res: ServerResponse, result: MultipartParseFailure): void {
  sendError(res, result.statusCode, result.code, result.message, result.hint ?? undefined);
}
