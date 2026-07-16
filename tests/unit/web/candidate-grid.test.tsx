// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CandidateGrid } from "../../../web/src/components/CandidateGrid.js";
import { Inspector } from "../../../web/src/components/Inspector.js";
import {
  createMinimalProject,
  createProjectWithLocalAsset,
  createProjectWithSelectedCandidate,
} from "../../fixtures/web-test-data.js";

describe("CandidateGrid", () => {
  it("1. renders candidate cards when candidates exist", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;

    render(
      <CandidateGrid
        candidates={scene.search.candidates}
        selectedCandidateId={null}
        onSelectCandidate={() => {}}
      />,
    );

    // Should show candidate dimensions
    expect(screen.getByText(/1920/)).toBeDefined();
    // Should show creator name
    expect(screen.getByText(/Test Creator/)).toBeDefined();
  });

  it("2. shows empty state when no candidates", () => {
    const project = createMinimalProject();
    const scene = project.scenes[1]!; // scene-002 has no candidates

    render(
      <CandidateGrid
        candidates={scene.search.candidates}
        selectedCandidateId={null}
        onSelectCandidate={() => {}}
      />,
    );

    expect(screen.getByText("暂无候选素材")).toBeDefined();
    expect(screen.getByText("可在后续任务中触发重新搜索")).toBeDefined();
  });

  it("3. clicking a candidate triggers onSelectCandidate", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    let selectedId: string | null = null;

    render(
      <CandidateGrid
        candidates={scene.search.candidates}
        selectedCandidateId={null}
        onSelectCandidate={(id) => {
          selectedId = id;
        }}
      />,
    );

    const card = screen.getByText(/1920/).closest("article");
    expect(card).not.toBeNull();
    if (card) {
      fireEvent.click(card);
    }

    expect(selectedId).toBe("candidate-001");
  });

  it("4. selected candidate shows selected class", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    const candidateId = scene.search.candidates[0]!.id;

    const { container } = render(
      <CandidateGrid
        candidates={scene.search.candidates}
        selectedCandidateId={candidateId}
        onSelectCandidate={() => {}}
      />,
    );

    const selectedCard = container.querySelector(".candidate.selected");
    expect(selectedCard).not.toBeNull();
    expect(selectedCard).toBeInstanceOf(HTMLElement);
  });
});

describe("Inspector — local asset", () => {
  it("5. shows local asset info when localAsset exists", () => {
    const project = createProjectWithLocalAsset();
    const scene = project.scenes[0]!;

    render(<Inspector scene={scene} />);

    expect(screen.getByText("assets/scene-001/abc123.png")).toBeDefined();
    expect(screen.getByText("image/png")).toBeDefined();
    // Should show short hash (first 12 chars)
    expect(screen.getByText(/abcdef012345…/)).toBeDefined();
    expect(screen.getByText("用户自有素材")).toBeDefined();
  });

  it("6. shows import placeholder when no localAsset", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!; // pending review

    render(<Inspector scene={scene} />);

    expect(screen.getByText("导入已手动下载的文件")).toBeDefined();
    expect(screen.getByText("下一任务接入")).toBeDefined();
  });

  it("7. shows selected candidate evidence when candidate_selected", () => {
    const project = createProjectWithSelectedCandidate();
    const scene = project.scenes[0]!;

    render(<Inspector scene={scene} />);

    expect(screen.getByText("当前选择")).toBeDefined();
    expect(screen.getByText("candidate-001")).toBeDefined();
    expect(screen.getByText("Fixture")).toBeDefined();
    expect(screen.getByText("Test Creator")).toBeDefined();
  });

  it("8. shows rights snapshot when candidate is selected", () => {
    const project = createProjectWithSelectedCandidate();
    const scene = project.scenes[0]!;

    render(<Inspector scene={scene} />);

    expect(screen.getByText("许可快照")).toBeDefined();
    expect(screen.getByText("platform_license")).toBeDefined();
    // 'allowed' appears for both commercialUse and derivatives
    expect(screen.getAllByText("allowed")).toHaveLength(2);
  });
});
