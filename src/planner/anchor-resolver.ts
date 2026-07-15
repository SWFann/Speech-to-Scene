/**
 * Anchor resolver.
 *
 * Converts planner output (which references source blocks by ID and quotes)
 * into exact UTF-16 source ranges and scene text.
 *
 * The resolver does NOT trust model-provided character offsets. It searches
 * for quotes inside the referenced blocks and computes offsets locally.
 */

import type { SourceBlock, SourceBlockResult } from "./source-blocks.js";
import type { PlannerOutput, PlannedScene } from "./planner-output-schema.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a referenced block ID does not exist.
 */
export class UnknownBlockIdError extends Error {
  constructor(blockId: string) {
    super(`Unknown source block ID: ${blockId}`);
    this.name = "UnknownBlockIdError";
  }
}

/**
 * Thrown when referenced blocks are not consecutive by order.
 */
export class NonConsecutiveBlocksError extends Error {
  constructor(blockIds: string[]) {
    super(`Non-consecutive block IDs: ${blockIds.join(", ")}`);
    this.name = "NonConsecutiveBlocksError";
  }
}

/**
 * Thrown when a quote is ambiguous (multiple occurrences).
 */
export class AmbiguousQuoteError extends Error {
  constructor(quote: string, blockId: string) {
    super(`Ambiguous quote in block ${blockId}: "${quote}" appears multiple times`);
    this.name = "AmbiguousQuoteError";
  }
}

/**
 * Thrown when a required quote is not found.
 */
export class QuoteNotFoundError extends Error {
  constructor(quote: string, blockId: string) {
    super(`Quote not found in block ${blockId}: "${quote}"`);
    this.name = "QuoteNotFoundError";
  }
}

/**
 * Thrown when resolved scene text is empty or whitespace-only.
 */
export class EmptySceneTextError extends Error {
  constructor(sceneIndex: number) {
    super(`Scene ${sceneIndex + 1} resolved to empty or whitespace-only text`);
    this.name = "EmptySceneTextError";
  }
}

/**
 * Thrown when a scene overlaps with a previously resolved scene.
 */
export class OverlappingSceneError extends Error {
  constructor(sceneIndex: number, previousEnd: number, currentStart: number) {
    super(
      `Scene ${sceneIndex + 1} overlaps with previous scene: ` +
        `previous ends at ${previousEnd}, current starts at ${currentStart}`,
    );
    this.name = "OverlappingSceneError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved scene with exact source range and text.
 */
export interface ResolvedScene {
  readonly scene: PlannedScene;
  readonly sourceRange: {
    readonly start: number;
    readonly end: number;
  };
  readonly text: string;
}

/**
 * Result of anchor resolution.
 */
export interface ResolvedScenes {
  readonly scenes: readonly ResolvedScene[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a lookup map from block ID to SourceBlock.
 */
function buildBlockMap(blocks: readonly SourceBlock[]): Map<string, SourceBlock> {
  const map = new Map<string, SourceBlock>();
  for (const block of blocks) {
    map.set(block.id, block);
  }
  return map;
}

/**
 * Validates that block IDs exist in the block map and are consecutive by order.
 */
function validateBlockSequence(
  blockIds: readonly string[],
  blockMap: Map<string, SourceBlock>,
): void {
  if (blockIds.length === 0) {
    throw new Error("sourceBlockIds must not be empty");
  }

  // Check all IDs exist
  for (const id of blockIds) {
    if (!blockMap.has(id)) {
      throw new UnknownBlockIdError(id);
    }
  }

  // Check blocks are consecutive by order
  const firstBlock = blockMap.get(blockIds[0]!)!;
  const lastBlock = blockMap.get(blockIds[blockIds.length - 1]!)!;

  const expectedCount = lastBlock.order - firstBlock.order + 1;
  if (expectedCount !== blockIds.length) {
    throw new NonConsecutiveBlocksError(Array.from(blockIds));
  }
}

/**
 * Finds the exact offset of a quote within a block's text.
 * Returns { start, end } in the block's text, or null if not found.
 * Throws AmbiguousQuoteError if the quote appears multiple times.
 */
function findQuoteInBlock(quote: string, block: SourceBlock): { start: number; end: number } {
  const blockText = block.text;
  let firstIndex = -1;
  let count = 0;

  for (let i = 0; i <= blockText.length - quote.length; i++) {
    if (blockText.slice(i, i + quote.length) === quote) {
      count++;
      if (firstIndex === -1) {
        firstIndex = i;
      }
    }
  }

  if (count === 0) {
    return { start: -1, end: -1 }; // not found (will be detected by caller)
  }
  if (count > 1) {
    throw new AmbiguousQuoteError(quote, block.id);
  }

  return { start: firstIndex, end: firstIndex + quote.length };
}

/**
 * Resolves a quote to a global source offset within the full raw text.
 * Returns null if the quote is not found.
 */
function resolveQuoteToGlobalOffset(
  quote: string,
  block: SourceBlock,
): { start: number; end: number } | null {
  const local = findQuoteInBlock(quote, block);
  if (local.start === -1 && local.end === -1) {
    return null; // not found
  }

  // Global offset = block sourceRange start + local offset
  return {
    start: block.sourceRange.start + local.start,
    end: block.sourceRange.start + local.end,
  };
}

/**
 * Checks for overlap with previously resolved scenes.
 */
function checkOverlap(start: number, end: number, previousEnd: number, sceneIndex: number): void {
  if (start < previousEnd) {
    throw new OverlappingSceneError(sceneIndex, previousEnd, start);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves planner output scenes to exact source ranges and text.
 *
 * This is the critical step that prevents the model from lying about
 * character offsets. All offsets are computed locally from the source blocks.
 *
 * @param output - Planner output to resolve.
 * @param sourceBlocks - Extracted source blocks.
 * @returns Resolved scenes with exact ranges and text.
 * @throws On unknown block IDs, non-consecutive blocks, ambiguous/missing quotes,
 *         empty scene text, or overlapping ranges.
 */
export function resolveAnchors(
  output: PlannerOutput,
  sourceBlocks: SourceBlockResult,
): ResolvedScenes {
  const blockMap = buildBlockMap(sourceBlocks.blocks);
  const resolved: ResolvedScene[] = [];
  let previousEnd = 0;

  for (let i = 0; i < output.scenes.length; i++) {
    const scene = output.scenes[i]!;
    const anchor = scene.sourceAnchor;

    // Validate block IDs
    validateBlockSequence(anchor.sourceBlockIds, blockMap);

    const firstBlockId = anchor.sourceBlockIds[0]!;
    const lastBlockId = anchor.sourceBlockIds[anchor.sourceBlockIds.length - 1]!;
    const firstBlock = blockMap.get(firstBlockId)!;
    const lastBlock = blockMap.get(lastBlockId)!;

    // Resolve start quote in first block
    const startGlobal = resolveQuoteToGlobalOffset(anchor.startQuote, firstBlock);
    if (startGlobal === null) {
      throw new QuoteNotFoundError(anchor.startQuote, firstBlockId);
    }

    // Resolve end quote in last block
    const endGlobal = resolveQuoteToGlobalOffset(anchor.endQuote, lastBlock);
    if (endGlobal === null) {
      throw new QuoteNotFoundError(anchor.endQuote, lastBlockId);
    }

    // Ensure start quote comes before end quote
    if (startGlobal.start > endGlobal.start) {
      throw new Error(
        `Reversed anchor quotes: startQuote "${anchor.startQuote}" appears after endQuote "${anchor.endQuote}"`,
      );
    }

    // Ensure start <= end
    const rangeStart = startGlobal.start;
    const rangeEnd = Math.max(startGlobal.end, endGlobal.end);

    // Check for overlap with previous scene
    checkOverlap(rangeStart, rangeEnd, previousEnd, i);

    // Extract scene text
    const text = sourceBlocks.rawText.slice(rangeStart, rangeEnd);

    // Reject empty or whitespace-only text
    if (text.trim().length === 0) {
      throw new EmptySceneTextError(i);
    }

    previousEnd = rangeEnd;

    resolved.push({
      scene,
      sourceRange: { start: rangeStart, end: rangeEnd },
      text,
    });
  }

  return { scenes: resolved };
}
