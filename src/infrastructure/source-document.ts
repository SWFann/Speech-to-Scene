/**
 * Source document reading and validation.
 *
 * Responsible for reading the user-provided script file, computing its
 * metadata (SHA-256, size, UTF-16 length), and producing the
 * SourceDocument data structure.
 *
 * This module lives in Infrastructure because it performs file I/O and
 * uses Node.js crypto APIs.
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import { SOURCE_ENCODING, MAX_SOURCE_FILE_BYTES } from "../shared/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw metadata computed from the source document bytes.
 */
export interface SourceDocumentMeta {
  /** Original file name (basename only). */
  originalFileName: string;
  /** SHA-256 hex digest of the raw bytes. */
  sha256: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** JS string .length after fatal UTF-8 decode. */
  textLengthUtf16: number;
}

/**
 * Extension to script path mapping.
 */
const EXTENSION_MAP: Record<string, string> = {
  ".md": "script.md",
  ".markdown": "script.md",
  ".txt": "script.txt",
};

/**
 * Supported extensions (lowercase).
 */
const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXTENSION_MAP));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the destination script filename from the source file name.
 */
export function getScriptFileName(sourceFileName: string): string {
  const parts = sourceFileName.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : "";
  return EXTENSION_MAP[`.${ext}`] ?? "script.txt";
}

/**
 * Reads raw bytes from the source file.
 *
 * @throws If the file does not exist, exceeds MAX_SOURCE_FILE_BYTES, or has invalid encoding.
 */
export async function readSourceBytes(sourcePath: string): Promise<Uint8Array> {
  const handle = await fs.open(sourcePath, "r");
  try {
    const stats = await handle.stat();
    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      throw new Error(
        `Source file too large: ${stats.size} bytes (limit: ${MAX_SOURCE_FILE_BYTES} bytes)`,
      );
    }
    const bytes = new Uint8Array(stats.size);
    await handle.read(bytes, 0, stats.size, 0);
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * Decodes source bytes to a JS string using fatal UTF-8.
 *
 * BOM (U+FEFF) is stripped from the output and does NOT contribute to textLengthUtf16.
 */
export function decodeSourceText(bytes: Uint8Array): string {
  const decoder = new TextDecoder(SOURCE_ENCODING, { fatal: true });
  let text = decoder.decode(bytes);
  // Manually strip BOM (Node.js TextDecoder doesn't support ignoreBOM)
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

/**
 * Computes SHA-256 hex digest of bytes.
 */
export function computeSha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Computes all metadata for a source document.
 */
export function computeSourceMeta(sourceFileName: string, bytes: Uint8Array): SourceDocumentMeta {
  const text = decodeSourceText(bytes);
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Source document is empty or whitespace-only");
  }

  return {
    originalFileName: sourceFileName,
    sha256: computeSha256(bytes),
    sizeBytes: bytes.length,
    textLengthUtf16: text.length,
  };
}

/**
 * Validates that a file path is a supported source document.
 */
export function validateSourcePath(sourcePath: string): void {
  const baseName = path.basename(sourcePath);
  const dotIndex = baseName.lastIndexOf(".");
  const ext = dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : "";

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file extension: "${ext}". Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
    );
  }
}
