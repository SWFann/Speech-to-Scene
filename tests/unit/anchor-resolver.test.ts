/**
 * Anchor resolver tests.
 */

import { describe, expect, it } from "vitest";
import { resolveAnchors } from "../../src/planner/anchor-resolver.js";
import type { SourceBlock, SourceBlockResult } from "../../src/planner/source-blocks.js";
import type { PlannerOutput } from "../../src/planner/planner-output-schema.js";
import {
  UnknownBlockIdError,
  NonConsecutiveBlocksError,
  AmbiguousQuoteError,
  QuoteNotFoundError,
  EmptySceneTextError,
  OverlappingSceneError,
} from "../../src/planner/anchor-resolver.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBlock(
  id: string,
  order: number,
  kind: SourceBlock["kind"],
  text: string,
  start = 0,
): SourceBlock {
  return {
    id,
    order,
    kind,
    sourceRange: { start, end: start + text.length },
    text,
  };
}

function makeSourceBlocks(blocks: SourceBlock[]): SourceBlockResult {
  // Compute rawText by positioning each block at its sourceRange.start
  let rawText = "";
  for (const block of blocks) {
    rawText = rawText.padEnd(block.sourceRange.start, " ") + block.text;
  }
  return { blocks, rawText };
}

function makePlannerOutput(scenes: PlannerOutput["scenes"]): PlannerOutput {
  return { scenes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveAnchors", () => {
  const sourceBlocks = makeSourceBlocks([
    makeBlock("block-0001", 1, "paragraph", "Hello world this is a test", 0),
    makeBlock("block-0002", 2, "paragraph", "Second paragraph here", 27),
    makeBlock("block-0003", 3, "paragraph", "Third paragraph content", 49),
  ]);

  it("resolves single scene", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "Hello",
          endQuote: "test",
        },
        summary: "Test scene",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    const result = resolveAnchors(output, sourceBlocks);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.text).toBe("Hello world this is a test");
    expect(result.scenes[0]!.sourceRange).toEqual({ start: 0, end: 26 });
  });

  it("resolves scene spanning multiple blocks", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001", "block-0002"],
          startQuote: "Hello",
          endQuote: "here",
        },
        summary: "Multi-block scene",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    const result = resolveAnchors(output, sourceBlocks);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.text).toBe("Hello world this is a test Second paragraph here");
    expect(result.scenes[0]!.sourceRange).toEqual({ start: 0, end: 48 });
  });

  it("throws on unknown block ID", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-9999"],
          startQuote: "Hello",
          endQuote: "test",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow(UnknownBlockIdError);
  });

  it("throws on non-consecutive blocks", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001", "block-0003"],
          startQuote: "Hello",
          endQuote: "content",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow(NonConsecutiveBlocksError);
  });

  it("throws on ambiguous start quote", () => {
    const blocks = makeSourceBlocks([makeBlock("block-0001", 1, "paragraph", "test test test")]);
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "test",
          endQuote: "test",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, blocks)).toThrow(AmbiguousQuoteError);
  });

  it("throws on missing start quote", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "NotFound",
          endQuote: "test",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow(QuoteNotFoundError);
  });

  it("throws on missing end quote", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "Hello",
          endQuote: "NotFound",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow(QuoteNotFoundError);
  });

  it("throws on reversed quote order", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "world",
          endQuote: "Hello",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow("Reversed anchor quotes");
  });

  it("throws on empty scene text", () => {
    const blocks = makeSourceBlocks([
      makeBlock("block-0001", 1, "paragraph", "   "),
      makeBlock("block-0002", 2, "paragraph", "Second here"),
    ]);
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "   ",
          endQuote: "   ",
        },
        summary: "Test",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, blocks)).toThrow(EmptySceneTextError);
  });

  it("throws on overlapping scenes", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001", "block-0002"],
          startQuote: "Hello",
          endQuote: "here",
        },
        summary: "Scene 1",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0002", "block-0003"],
          startQuote: "Second",
          endQuote: "content",
        },
        summary: "Scene 2",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    expect(() => resolveAnchors(output, sourceBlocks)).toThrow(OverlappingSceneError);
  });

  it("resolves multiple non-overlapping scenes", () => {
    const output = makePlannerOutput([
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0001"],
          startQuote: "Hello",
          endQuote: "test",
        },
        summary: "Scene 1",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
      {
        sourceAnchor: {
          strategy: "source-blocks-v1",
          sourceBlockIds: ["block-0002"],
          startQuote: "Second",
          endQuote: "here",
        },
        summary: "Scene 2",
        narrativeRole: "explanation",
        visualPlan: {
          decision: "speaker_only",
          rationale: "Test",
          preferredMedia: ["photo"],
          visualKeywords: ["test"],
        },
        queries: [],
      },
    ]);

    const result = resolveAnchors(output, sourceBlocks);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.sourceRange).toEqual({ start: 0, end: 26 });
    expect(result.scenes[1]!.sourceRange).toEqual({ start: 27, end: 48 });
  });
});
