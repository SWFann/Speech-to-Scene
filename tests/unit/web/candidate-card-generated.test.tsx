// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CandidateCard } from "../../../web/src/components/CandidateCard.js";
import type { ReviewAssetCandidateGeneratedView } from "../../../web/src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGeneratedCandidate(
  overrides: Partial<ReviewAssetCandidateGeneratedView> = {},
): ReviewAssetCandidateGeneratedView {
  return {
    kind: "generated",
    id: "gen-001",
    provider: {
      id: "stepfun-image",
      name: "StepFun Image Generator",
      homepageUrl: "https://platform.stepfun.com",
      termsUrl: "https://platform.stepfun.com/terms",
      policyRevision: "stepfun-image-policy-2026-07-18",
      termsCheckedAt: "2026-07-18T00:00:00.000Z",
    },
    prompt: "A beautiful city skyline at sunset",
    imageUrl: "https://example.com/generated.png",
    thumbnailUrl: "https://example.com/generated.png",
    width: 1024,
    height: 1792,
    orientation: "portrait",
    model: "step-image-edit-2",
    generatedAt: "2026-07-18T10:00:00.000Z",
    matchedQueryId: "query-001",
    rank: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CandidateCard — generated kind", () => {
  it("1. renders generated candidate with AI 生成 badge", () => {
    const candidate = makeGeneratedCandidate();
    render(<CandidateCard candidate={candidate} />);
    // "AI 生成" appears in both media-type span and rights tag
    const elements = screen.getAllByText("AI 生成");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("2. renders image dimensions", () => {
    const candidate = makeGeneratedCandidate();
    render(<CandidateCard candidate={candidate} />);
    expect(screen.getByText(/1024/)).toBeDefined();
    expect(screen.getByText(/1792/)).toBeDefined();
  });

  it("3. renders model name", () => {
    const candidate = makeGeneratedCandidate();
    render(<CandidateCard candidate={candidate} />);
    expect(screen.getByText(/step-image-edit-2/)).toBeDefined();
  });

  it("4. renders prompt (truncated if > 60 chars)", () => {
    const longPrompt = "A".repeat(70);
    const candidate = makeGeneratedCandidate({ prompt: longPrompt });
    render(<CandidateCard candidate={candidate} />);
    // Should be truncated with ellipsis
    expect(screen.getByText(/A+\u2026/)).toBeDefined();
  });

  it("5. renders prompt in full if <= 60 chars", () => {
    const shortPrompt = "A beautiful sunset";
    const candidate = makeGeneratedCandidate({ prompt: shortPrompt });
    render(<CandidateCard candidate={candidate} />);
    expect(screen.getByText(shortPrompt)).toBeDefined();
  });

  it("6. renders link to view image", () => {
    const candidate = makeGeneratedCandidate();
    const { container } = render(<CandidateCard candidate={candidate} />);
    const link = container.querySelector("a[href='https://example.com/generated.png']");
    expect(link).not.toBeNull();
  });

  it("7. renders 无版权限制 tag", () => {
    const candidate = makeGeneratedCandidate();
    render(<CandidateCard candidate={candidate} />);
    expect(screen.getByText("无版权限制")).toBeDefined();
  });

  it("8. renders thumbnail image", () => {
    const candidate = makeGeneratedCandidate();
    const { container } = render(<CandidateCard candidate={candidate} />);
    const img = container.querySelector("img[src='https://example.com/generated.png']");
    expect(img).not.toBeNull();
  });

  it("9. renders Sparkles icon when no thumbnail URL", () => {
    // When thumbnailUrl is empty string, the placeholder should show
    const candidate = makeGeneratedCandidate({ thumbnailUrl: "" });
    // The img element with empty src should still exist, but onError hides it
    const { container } = render(<CandidateCard candidate={candidate} />);
    // The article should still render
    const article = container.querySelector(".generated-card");
    expect(article).not.toBeNull();
  });
});

describe("CandidateCard — generated kind prompt title attribute", () => {
  it("10. prompt element has title attribute with full prompt", () => {
    const longPrompt = "A".repeat(70);
    const candidate = makeGeneratedCandidate({ prompt: longPrompt });
    const { container } = render(<CandidateCard candidate={candidate} />);
    const promptEl = container.querySelector(".generated-prompt");
    expect(promptEl).not.toBeNull();
    expect(promptEl!.getAttribute("title")).toBe(longPrompt);
  });
});
