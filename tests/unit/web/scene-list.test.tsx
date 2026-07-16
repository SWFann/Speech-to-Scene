// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SceneList } from "../../../web/src/components/SceneList.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

describe("SceneList", () => {
  it("1. renders scene list with all scenes", () => {
    const project = createMinimalProject();
    render(<SceneList scenes={project.scenes} activeSceneId={null} onSelect={() => {}} />);

    expect(screen.getByText("场景一摘要")).toBeDefined();
    expect(screen.getByText("场景二摘要")).toBeDefined();
    expect(screen.getByText("候选就绪")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined(); // scene count pill
  });

  it("2. clicking a scene triggers onSelect", () => {
    const project = createMinimalProject();
    let selectedId: string | null = null;

    render(
      <SceneList
        scenes={project.scenes}
        activeSceneId={null}
        onSelect={(id) => {
          selectedId = id;
        }}
      />,
    );

    const firstScene = screen.getByText("场景一摘要");
    fireEvent.click(firstScene);

    expect(selectedId).toBe("scene-001");
  });

  it("3. active scene is visually marked", () => {
    const project = createMinimalProject();
    const { container } = render(
      <SceneList scenes={project.scenes} activeSceneId="scene-001" onSelect={() => {}} />,
    );

    const activeRow = container.querySelector(".scene-row.active");
    expect(activeRow).not.toBeNull();
    expect(activeRow).toBeInstanceOf(HTMLElement);
  });

  it("4. scene with done status shows done class", () => {
    const project = createMinimalProject();
    // scene-001 has status "candidates_ready" — not done
    // Modify scene-002 to have status "skipped"
    const scenes = [
      ...project.scenes.slice(0, 1),
      { ...project.scenes[1]!, status: "skipped" as const },
    ];

    const { container } = render(
      <SceneList scenes={scenes} activeSceneId={null} onSelect={() => {}} />,
    );

    const doneRows = container.querySelectorAll(".scene-row.done");
    expect(doneRows).toHaveLength(1);
    expect(doneRows[0]).toBeInstanceOf(HTMLElement);
  });
});
