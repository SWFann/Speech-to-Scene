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
  onGenerateImage: (prompt: string) => void;
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
    onGenerateImage: overrides.onGenerateImage ?? noop,
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

  // ----- Phase 2: AI image generation button -----

  it("13. generate image button is present", () => {
    render(<SceneDetail {...makeProps()} />);
    expect(screen.getByTestId("generate-image-btn")).toBeDefined();
  });

  it("14. generate button is enabled when busyAction is null", () => {
    render(<SceneDetail {...makeProps({ busyAction: null })} />);
    expect(screen.getByTestId<HTMLButtonElement>("generate-image-btn").disabled).toBe(false);
  });

  it("15. generate button is disabled when busyAction='generate'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "generate" })} />);
    expect(screen.getByTestId<HTMLButtonElement>("generate-image-btn").disabled).toBe(true);
  });

  it("16. generate button shows loading text when busyAction='generate'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "generate" })} />);
    expect(screen.getByText("生成中…")).toBeDefined();
  });

  it("17. generate button shows default text when not busy", () => {
    render(<SceneDetail {...makeProps({ busyAction: null })} />);
    expect(screen.getByText("生成图片")).toBeDefined();
  });

  it("18. clicking generate button opens prompt editor", () => {
    render(<SceneDetail {...makeProps()} />);
    const btn = screen.getByTestId("generate-image-btn");
    fireEvent.click(btn);
    expect(screen.getByTestId("prompt-editor")).toBeDefined();
  });

  it("19. prompt editor has textarea with pre-filled prompt", () => {
    render(<SceneDetail {...makeProps()} />);
    fireEvent.click(screen.getByTestId("generate-image-btn"));
    const textarea = screen.getByTestId<HTMLTextAreaElement>("prompt-textarea");
    // The default prompt should be built from scene summary + keywords
    expect(textarea.value).toContain("场景一摘要");
  });

  it("20. confirming prompt calls onGenerateImage", () => {
    const handler = vi.fn();
    render(<SceneDetail {...makeProps({ onGenerateImage: handler })} />);
    fireEvent.click(screen.getByTestId("generate-image-btn"));
    // Click the confirm button in the prompt editor
    const confirmBtn = screen.getByText("确认生成");
    fireEvent.click(confirmBtn);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.stringContaining("场景一摘要"));
  });

  it("21. closing prompt editor does not call onGenerateImage", () => {
    const handler = vi.fn();
    render(<SceneDetail {...makeProps({ onGenerateImage: handler })} />);
    fireEvent.click(screen.getByTestId("generate-image-btn"));
    // Click the close button (aria-label="关闭")
    const closeBtn = screen.getByLabelText("关闭");
    fireEvent.click(closeBtn);
    expect(handler).not.toHaveBeenCalled();
  });

  it("22. generate button is disabled when busyAction='search'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "search" })} />);
    expect(screen.getByTestId<HTMLButtonElement>("generate-image-btn").disabled).toBe(true);
  });
});
