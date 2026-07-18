// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ProjectListView } from "../../../web/src/components/ProjectListView.js";
import type { ProjectListItem } from "../../../web/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(
  overrides: Partial<ProjectListItem> = {},
): ProjectListItem {
  return {
    name: "default",
    path: "default",
    hasProject: true,
    title: "我的项目",
    sceneCount: 5,
    updatedAt: "2026-07-18T10:00:00Z",
    isActive: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectListView", () => {
  it("renders project cards with title, scene count, and name", () => {
    const projects = [
      makeProject({ name: "demo1", title: "第一个项目", sceneCount: 3 }),
      makeProject({ name: "demo2", title: "第二个项目", sceneCount: 8 }),
    ];

    render(
      <ProjectListView
        projects={projects}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("第一个项目")).toBeDefined();
    expect(screen.getByText("第二个项目")).toBeDefined();
    expect(screen.getByText("3 个场景")).toBeDefined();
    expect(screen.getByText("8 个场景")).toBeDefined();
  });

  it("shows empty state when no projects", () => {
    render(
      <ProjectListView
        projects={[]}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("暂无项目")).toBeDefined();
  });

  it("shows loading state", () => {
    render(
      <ProjectListView
        projects={[]}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
        loading
      />,
    );

    expect(screen.getByText("正在加载项目列表…")).toBeDefined();
  });

  it("calls onSwitch when clicking a project card", () => {
    let switched: string | null = null;
    const projects = [makeProject({ name: "demo1", title: "Demo" })];

    render(
      <ProjectListView
        projects={projects}
        activeProject={null}
        onSwitch={(name) => {
          switched = name;
        }}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Demo"));

    expect(switched).toBe("demo1");
  });

  it("calls onCreate when clicking the new project button", () => {
    let created = false;

    render(
      <ProjectListView
        projects={[]}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {
          created = true;
        }}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByTitle("创建新项目"));

    expect(created).toBe(true);
  });

  it("opens delete confirmation modal when delete button clicked", () => {
    const projects = [makeProject({ name: "demo1", title: "Demo" })];

    render(
      <ProjectListView
        projects={projects}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("删除"));

    expect(screen.getByText("删除项目确认")).toBeDefined();
    expect(screen.getByText("确认删除")).toBeDefined();
  });

  it("disables confirm delete button until project name is typed", () => {
    const projects = [makeProject({ name: "demo1", title: "Demo" })];

    render(
      <ProjectListView
        projects={projects}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("删除"));

    const confirmButton = screen.getByText("确认删除");
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    const input = screen.getByPlaceholderText("demo1");
    fireEvent.change(input, { target: { value: "demo1" } });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
  });

  it("calls onDelete when confirmation matches project name", () => {
    let deleted: string | null = null;
    const projects = [makeProject({ name: "demo1", title: "Demo" })];

    render(
      <ProjectListView
        projects={projects}
        activeProject={null}
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={(name) => {
          deleted = name;
        }}
      />,
    );

    fireEvent.click(screen.getByText("删除"));
    const input = screen.getByPlaceholderText("demo1");
    fireEvent.change(input, { target: { value: "demo1" } });
    fireEvent.click(screen.getByText("确认删除"));

    expect(deleted).toBe("demo1");
  });

  it("marks the active project with a current badge", () => {
    const projects = [
      makeProject({ name: "demo1", title: "Active", isActive: true }),
      makeProject({ name: "demo2", title: "Inactive", isActive: false }),
    ];

    render(
      <ProjectListView
        projects={projects}
        activeProject="demo1"
        onSwitch={() => {}}
        onCreate={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText("当前")).toBeDefined();
  });
});
