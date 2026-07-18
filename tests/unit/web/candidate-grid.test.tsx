// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CandidateGrid } from "../../../web/src/components/CandidateGrid.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

describe("CandidateGrid", () => {
  it("1. renders candidate cards when candidates exist", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;

    render(<CandidateGrid candidates={scene.search.candidates} />);

    // Should show candidate dimensions (1920×1080)
    expect(screen.getByText(/1920/)).toBeDefined();
    // Should show creator name
    expect(screen.getByText(/Test Creator/)).toBeDefined();
  });

  it("2. shows empty state when no candidates", () => {
    const project = createMinimalProject();
    const scene = project.scenes[1]!; // scene-002 has no candidates

    render(<CandidateGrid candidates={scene.search.candidates} />);

    expect(screen.getByText("暂无候选素材")).toBeDefined();
    expect(screen.getByText("点击「搜索素材」按钮重新检索")).toBeDefined();
  });

  it("3. renders multiple candidate cards", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    // Duplicate the candidate with a different id to test multi-render
    const candidates = [
      scene.search.candidates[0]!,
      {
        ...scene.search.candidates[0]!,
        id: "candidate-002",
        rank: 2,
        providerAssetId: "fixture-002",
      },
    ];

    const { container } = render(<CandidateGrid candidates={candidates} />);

    const cards = container.querySelectorAll(".candidate");
    expect(cards).toHaveLength(2);
  });
});
