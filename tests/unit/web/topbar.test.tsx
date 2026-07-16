// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TopBar } from "../../../web/src/components/TopBar.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

describe("TopBar", () => {
  it("shows producingSceneCount as processed scene count", () => {
    const project = createMinimalProject();

    render(<TopBar project={project} error={null} />);

    expect(screen.getByText("1 / 2 场景已处理")).toBeDefined();
  });

  it("shows all scenes processed when producingSceneCount equals sceneCount", () => {
    const project = {
      ...createMinimalProject(),
      sceneCount: 2,
      producingSceneCount: 2,
    };

    render(<TopBar project={project} error={null} />);

    expect(screen.getByText("2 / 2 场景已处理")).toBeDefined();
  });
});
