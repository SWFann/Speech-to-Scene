// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TopBar } from "../../../web/src/components/TopBar.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

describe("TopBar", () => {
  it("shows searchedSceneCount as searched scene count", () => {
    const project = createMinimalProject();

    render(<TopBar project={project} error={null} />);

    expect(screen.getByText("1 / 2 场景已搜索")).toBeDefined();
  });

  it("shows all scenes searched when searchedSceneCount equals sceneCount", () => {
    const project = {
      ...createMinimalProject(),
      sceneCount: 2,
      searchedSceneCount: 2,
    };

    render(<TopBar project={project} error={null} />);

    expect(screen.getByText("2 / 2 场景已搜索")).toBeDefined();
  });
});
