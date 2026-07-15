/**
 * Fixture planner.
 *
 * A deterministic planner implementation that produces fixed output for
 * known fixture scripts. No network calls are made.
 *
 * This is the first planner to implement because:
 * - It enables testing the full planning pipeline without network
 * - It serves as a reference for the expected planner output format
 */

import type {
  ScriptPlanner,
  PlanScriptInput,
  PlannerRawResult,
  PlannerCapabilities,
} from "../application/ports/script-planner.js";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Fixture planner capabilities.
 */
const FIXTURE_CAPABILITIES: PlannerCapabilities = {
  jsonMode: true,
  strictJsonSchema: true,
  toolCalling: false,
  usageMetrics: false,
};

/**
 * Extracts a short quote from block text.
 * Returns the first 20 characters or the first sentence, whichever is shorter.
 */
function extractQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "text";
  }
  // Use first 20 chars or up to first sentence boundary
  const sentenceEnd = trimmed.search(/[。！？.!?\n]/);
  if (sentenceEnd > 0 && sentenceEnd <= 20) {
    return trimmed.slice(0, sentenceEnd);
  }
  return trimmed.slice(0, Math.min(20, trimmed.length));
}

/**
 * FixtureScriptPlanner provides deterministic output for testing.
 *
 * Generates a single scene from the first source block. All output goes
 * through the same validation pipeline as real planners.
 */
export class FixtureScriptPlanner implements ScriptPlanner {
  readonly providerId = "fixture";
  readonly capabilities = FIXTURE_CAPABILITIES;

  /**
   * Plans a script using fixture data.
   *
   * Generates a single scene from the first source block.
   */
  async plan(input: PlanScriptInput): Promise<PlannerRawResult> {
    // Simulate async operation
    await Promise.resolve();

    const firstBlock = input.sourceBlocks[0];
    if (!firstBlock) {
      return {
        output: { scenes: [] },
        apiProtocol: "fixture",
      };
    }

    const rawTextTrimmed = input.rawText.trim();
    const quote = extractQuote(
      rawTextTrimmed.slice(firstBlock.sourceRange.start, firstBlock.sourceRange.end),
    );

    const output = {
      scenes: [
        {
          sourceAnchor: {
            strategy: "source-blocks-v1" as const,
            sourceBlockIds: [firstBlock.id],
            startQuote: quote,
            endQuote: quote,
          },
          summary: `Scene from ${firstBlock.kind}`,
          narrativeRole: "explanation" as const,
          visualPlan: {
            decision: "stock_asset" as const,
            rationale: "This scene needs visual assets",
            preferredMedia: ["photo"] as const,
            visualKeywords: ["test"],
          },
          queries: [
            {
              language: "zh" as const,
              query: `visual search ${rawTextTrimmed.slice(0, 10)}`.trim(),
              purpose: "Find visual assets",
              enabled: true,
            },
            {
              language: "en" as const,
              query: `visual search ${rawTextTrimmed.slice(0, 10)}`.trim(),
              purpose: "Find visual assets",
              enabled: true,
            },
          ],
        },
      ],
    };

    return {
      output,
      apiProtocol: "fixture",
    };
  }
}
