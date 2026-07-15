/**
 * Source block builder.
 *
 * Extracts deterministic source blocks from raw source text using Markdown
 * structure. Blocks are ordered from 1, have deterministic IDs
 * (`block-0001`, `block-0002`, ...), and carry UTF-16 code unit ranges.
 *
 * This module is pure: it has no filesystem or network dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source block kind.
 */
export type SourceBlockKind =
  "heading" | "paragraph" | "list_item" | "blockquote" | "code_block" | "other";

/**
 * Source range in UTF-16 code units (half-open interval).
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A single source block.
 */
export interface SourceBlock {
  readonly id: string;
  readonly order: number;
  readonly kind: SourceBlockKind;
  readonly sourceRange: SourceRange;
  readonly text: string;
}

/**
 * Result of source block extraction.
 */
export interface SourceBlockResult {
  readonly blocks: readonly SourceBlock[];
  readonly rawText: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the line starts with a Markdown heading marker.
 */
function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/**
 * Returns true if the line starts/ends a fenced code block.
 */
function isFence(line: string): boolean {
  return /^`{3,}|~{3,}/.test(line);
}

/**
 * Returns true if the line is a blockquote (starts with >).
 */
function isBlockquote(line: string): boolean {
  return /^\s*>\s?/.test(line);
}

/**
 * Returns true if the line is a list item (-, *, +, or numbered).
 */
function isListItem(line: string): boolean {
  return /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
}

/**
 * Returns true if the line is blank (empty or whitespace-only).
 */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Classifies a non-blank line into a block kind.
 */
function classifyLine(line: string, inCodeBlock: boolean): SourceBlockKind {
  if (inCodeBlock) {
    return "code_block";
  }
  if (isHeading(line)) {
    return "heading";
  }
  if (isBlockquote(line)) {
    return "blockquote";
  }
  if (isListItem(line)) {
    return "list_item";
  }
  return "paragraph";
}

/**
 * Generates a deterministic block ID from order (1-indexed).
 */
function blockId(order: number): string {
  return `block-${String(order).padStart(4, "0")}`;
}

/**
 * Splits text into lines preserving the newline character count for each line.
 *
 * Returns an array of { text, newlineLength } where newlineLength is 0 for the
 * last line (no trailing newline), 1 for LF, or 2 for CRLF.
 */
function splitLinesWithNewlineLengths(
  text: string,
): Array<{ text: string; newlineLength: number }> {
  const result: Array<{ text: string; newlineLength: number }> = [];
  let pos = 0;

  while (pos < text.length) {
    const lfIndex = text.indexOf("\n", pos);
    if (lfIndex === -1) {
      // No more newlines - remaining text is the last line
      result.push({ text: text.slice(pos), newlineLength: 0 });
      break;
    }

    // Check for CRLF: if char before LF is \r, newlineLength = 2, else 1
    const hasCR = lfIndex > pos && text[lfIndex - 1] === "\r";
    const newlineLength = hasCR ? 2 : 1;
    // Line text is everything from pos up to (but not including) the \r if present
    const lineEnd = hasCR ? lfIndex - 1 : lfIndex;
    result.push({ text: text.slice(pos, lineEnd), newlineLength });
    pos = lfIndex + 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts source blocks from source document bytes.
 *
 * Rules:
 * - Decodes bytes using fatal UTF-8 with BOM stripping.
 * - Groups consecutive non-blank lines into blocks by kind.
 * - Blank lines separate blocks (except inside code blocks).
 * - Different kinds of consecutive non-blank lines become separate blocks.
 * - Offsets are UTF-16 code units.
 * - IDs are deterministic: `block-0001`, `block-0002`, ...
 *
 * @param sourceBytes - Raw bytes of the source document.
 * @returns Source blocks and the decoded raw text.
 * @throws If the source is empty or whitespace-only after decoding.
 */
export function buildSourceBlocks(sourceBytes: Uint8Array): SourceBlockResult {
  // Decode bytes to string (BOM stripping included)
  const rawText = decodeSourceText(sourceBytes);

  if (rawText.trim().length === 0) {
    throw new Error("Source document is empty or whitespace-only");
  }

  const lines = splitLinesWithNewlineLengths(rawText);
  const blocks: SourceBlock[] = [];
  let order = 0;
  let inCodeBlock = false;

  // Track the current block being accumulated
  let currentBlockLines: string[] = [];
  let currentBlockKind: SourceBlockKind = "paragraph";
  let blockStartLineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const { text: line } = lines[i]!;
    const isLineFence = isFence(line);

    // Fence lines are always code_block
    const lineKind = isLineFence ? "code_block" : classifyLine(line, inCodeBlock);
    const isLineBlank = isBlank(line);

    // Toggle code block state on fence lines
    if (isLineFence) {
      inCodeBlock = !inCodeBlock;
    }

    if (isLineBlank) {
      // Blank line flushes the current block
      if (currentBlockLines.length > 0) {
        order++;
        const text = currentBlockLines.join("\n");
        // Calculate start offset: sum of line lengths + newline lengths up to blockStartLineIndex
        let startOffset = 0;
        for (let j = 0; j < blockStartLineIndex; j++) {
          startOffset += lines[j]!.text.length + lines[j]!.newlineLength;
        }
        const endOffset = startOffset + text.length;

        blocks.push({
          id: blockId(order),
          order,
          kind: currentBlockKind,
          sourceRange: { start: startOffset, end: endOffset },
          text,
        });

        currentBlockLines = [];
        currentBlockKind = "paragraph";
      }
    } else if (currentBlockLines.length > 0 && (isHeading(line) || lineKind !== currentBlockKind)) {
      // Headings always start a new block; other kinds break on kind change
      order++;
      const text = currentBlockLines.join("\n");
      let startOffset = 0;
      for (let j = 0; j < blockStartLineIndex; j++) {
        startOffset += lines[j]!.text.length + lines[j]!.newlineLength;
      }
      const endOffset = startOffset + text.length;

      blocks.push({
        id: blockId(order),
        order,
        kind: currentBlockKind,
        sourceRange: { start: startOffset, end: endOffset },
        text,
      });

      // Start new block with this line
      currentBlockLines = [line];
      currentBlockKind = lineKind;
      blockStartLineIndex = i;
    } else {
      // Same kind or first line - add to current block
      if (currentBlockLines.length === 0) {
        currentBlockKind = lineKind;
        blockStartLineIndex = i;
      }
      currentBlockLines.push(line);
    }
  }

  // Flush remaining block
  if (currentBlockLines.length > 0) {
    order++;
    const text = currentBlockLines.join("\n");
    let startOffset = 0;
    for (let j = 0; j < blockStartLineIndex; j++) {
      startOffset += lines[j]!.text.length + lines[j]!.newlineLength;
    }
    const endOffset = startOffset + text.length;

    blocks.push({
      id: blockId(order),
      order,
      kind: currentBlockKind,
      sourceRange: { start: startOffset, end: endOffset },
      text,
    });
  }

  return { blocks, rawText };
}

/**
 * Decodes source bytes to a JS string using fatal UTF-8 with BOM stripping.
 *
 * This is kept here to avoid the infrastructure layer dependency in the
 * pure source-block builder. The implementation mirrors
 * `infrastructure/source-document.ts#decodeSourceText`.
 */
function decodeSourceText(bytes: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = decoder.decode(bytes);
  // Manually strip BOM (Node.js TextDecoder doesn't support ignoreBOM)
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}
