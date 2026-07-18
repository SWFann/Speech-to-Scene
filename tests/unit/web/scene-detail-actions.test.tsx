// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SceneDetail, type BusyAction } from "../../../web/src/components/SceneDetail.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";
import type { ActionErrorInfo } from "../../../web/src/components/ActionError.js";
import type { ReviewSceneView } from "../../../web/src/types.js";

const noop = (): void => {};

interface SceneDetailTestProps {
  scene: ReviewSceneView;
  onSearchScene: () => void;
  busyAction: BusyAction;
  actionError: ActionErrorInfo | null;
  onDismissError: () => void;
}

function makeProps(overrides: Partial<SceneDetailTestProps> = {}): SceneDetailTestProps {
  const project = createMinimalProject();
  const scene = overrides.scene ?? project.scenes[0]!;
  return {
    scene,
    onSearchScene: overrides.onSearchScene ?? noop,
    busyAction: overrides.busyAction ?? null,
    actionError: overrides.actionError ?? null,
    onDismissError: overrides.onDismissError ?? noop,
  };
}

describe("SceneDetail — action buttons", () => {
  it("1. search button is enabled when busyAction is null", () => {
    render(<SceneDetail {...makeProps({ busyAction: null })} />);
    const btn = screen.getByTestId<HTMLButtonElement>("search-scene-btn");
    expect(btn.disabled).toBe(false);
  });

  it("2. clicking search scene calls onSearchScene", () => {
    const handler = vi.fn();
    render(<SceneDetail {...makeProps({ onSearchScene: handler })} />);
    const btn = screen.getByTestId("search-scene-btn");
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("3. search button is disabled when busyAction='search'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "search" })} />);
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(true);
  });

  it("4. search button shows loading text when busyAction='search'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "search" })} />);
    expect(screen.getByText("检索中…")).toBeDefined();
  });

  it("5. search button shows default text when not busy", () => {
    render(<SceneDetail {...makeProps({ busyAction: null })} />);
    expect(screen.getByText("搜索素材")).toBeDefined();
  });

  it("6. action error is displayed when actionError is provided", () => {
    render(
      <SceneDetail
        {...makeProps({
          actionError: { message: "操作失败", hint: "请重试", code: "conflict" },
        })}
      />,
    );
    expect(screen.getByTestId("action-error")).toBeDefined();
    expect(screen.getByText("操作失败")).toBeDefined();
    expect(screen.getByText("请重试")).toBeDefined();
  });

  it("7. dismissing action error calls onDismissError", () => {
    const handler = vi.fn();
    render(
      <SceneDetail
        {...makeProps({
          actionError: { message: "操作失败", code: "conflict" },
          onDismissError: handler,
        })}
      />,
    );
    const dismissBtn = screen.getByLabelText("关闭错误提示");
    fireEvent.click(dismissBtn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("8. renders visual plan section", () => {
    render(<SceneDetail {...makeProps()} />);
    expect(screen.getByText("视觉规划")).toBeDefined();
    expect(screen.getByText("stock_asset")).toBeDefined();
    expect(screen.getByText("explanation")).toBeDefined();
  });

  it("9. renders source excerpt", () => {
    render(<SceneDetail {...makeProps()} />);
    expect(screen.getByText(/原文片段/)).toBeDefined();
  });

  it("10. renders search queries as read-only inputs", () => {
    render(<SceneDetail {...makeProps()} />);
    const input = screen.getByLabelText<HTMLInputElement>("搜索词 query-001");
    expect(input.value).toBe("测试搜索词");
    expect(input.readOnly).toBe(true);
  });

  it("11. renders candidate count when candidates exist", () => {
    render(<SceneDetail {...makeProps()} />);
    expect(screen.getByText(/共 1 个候选/)).toBeDefined();
  });

  it("12. renders no candidate message when empty", () => {
    const project = createMinimalProject();
    const scene = project.scenes[1]!; // scene-002 has no candidates
    render(<SceneDetail {...makeProps({ scene })} />);
    expect(screen.getByText("暂无候选")).toBeDefined();
  });
});
