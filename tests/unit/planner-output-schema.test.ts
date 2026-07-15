/**
 * Planner output schema tests.
 */

import { describe, expect, it } from "vitest";
import {
  PlannerOutputSchema,
  validateStockAssetQueries,
} from "../../src/planner/planner-output-schema.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerOutputSchema", () => {
  const validScene = {
    sourceAnchor: {
      strategy: "source-blocks-v1" as const,
      sourceBlockIds: ["block-0001"],
      startQuote: "Hello",
      endQuote: "world",
    },
    summary: "Test scene",
    narrativeRole: "explanation" as const,
    visualPlan: {
      decision: "speaker_only" as const,
      rationale: "Test rationale",
      preferredMedia: ["photo"] as const,
      visualKeywords: ["keyword"],
    },
    queries: [],
  };

  it("accepts valid output", () => {
    const output = { scenes: [validScene] };
    expect(() => PlannerOutputSchema.parse(output)).not.toThrow();
  });

  it("rejects empty scenes", () => {
    expect(() => PlannerOutputSchema.parse({ scenes: [] })).toThrow();
  });

  it("rejects more than 100 scenes", () => {
    const scenes = Array.from({ length: 101 }, (_, i) => ({
      ...validScene,
      sourceAnchor: {
        ...validScene.sourceAnchor,
        sourceBlockIds: [`block-${String(i + 1).padStart(4, "0")}`],
      },
    }));
    expect(() => PlannerOutputSchema.parse({ scenes })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => PlannerOutputSchema.parse({ scenes: [{}] })).toThrow();
  });

  it("rejects stock_asset without enabled query", () => {
    const output = {
      scenes: [
        {
          ...validScene,
          visualPlan: { ...validScene.visualPlan, decision: "stock_asset" },
          queries: [{ language: "zh", query: "test", purpose: "test", enabled: false }],
        },
      ],
    };
    expect(() => PlannerOutputSchema.parse(output)).not.toThrow();
    expect(() =>
      validateStockAssetQueries(
        output as unknown as Parameters<typeof validateStockAssetQueries>[0],
      ),
    ).toThrow();
  });

  it("accepts stock_asset with enabled query", () => {
    const output = {
      scenes: [
        {
          ...validScene,
          visualPlan: { ...validScene.visualPlan, decision: "stock_asset" },
          queries: [{ language: "zh", query: "test", purpose: "test", enabled: true }],
        },
      ],
    };
    expect(() =>
      validateStockAssetQueries(
        output as unknown as Parameters<typeof validateStockAssetQueries>[0],
      ),
    ).not.toThrow();
  });
});
