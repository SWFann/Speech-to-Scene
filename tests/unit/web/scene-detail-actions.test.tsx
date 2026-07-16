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
  selectedCandidateId: string | null;
  onSelectCandidate: (id: string) => void;
  onSelectCandidateAction: (candidateId: string) => void;
  onSkipScene: () => void;
  onSearchScene: () => void;
  busyAction: BusyAction;
  actionError: ActionErrorInfo | null;
  rightsWarning: { message: string; hint?: string } | null;
  onRightsConfirm: () => void;
  onRightsCancel: () => void;
  onDismissError: () => void;
}

function makeProps(overrides: Partial<SceneDetailTestProps> = {}): SceneDetailTestProps {
  const project = createMinimalProject();
  const scene = overrides.scene ?? project.scenes[0]!;
  return {
    scene,
    selectedCandidateId: overrides.selectedCandidateId ?? null,
    onSelectCandidate: overrides.onSelectCandidate ?? noop,
    onSelectCandidateAction: overrides.onSelectCandidateAction ?? noop,
    onSkipScene: overrides.onSkipScene ?? noop,
    onSearchScene: overrides.onSearchScene ?? noop,
    busyAction: overrides.busyAction ?? null,
    actionError: overrides.actionError ?? null,
    rightsWarning: overrides.rightsWarning ?? null,
    onRightsConfirm: overrides.onRightsConfirm ?? noop,
    onRightsCancel: overrides.onRightsCancel ?? noop,
    onDismissError: overrides.onDismissError ?? noop,
  };
}

describe("SceneDetail — action buttons", () => {
  it("1. select candidate button is disabled when no candidate is selected", () => {
    render(<SceneDetail {...makeProps({ selectedCandidateId: null })} />);
    const btn = screen.getByTestId<HTMLButtonElement>("select-candidate-btn");
    expect(btn.disabled).toBe(true);
  });

  it("2. select candidate button is enabled when a candidate is selected", () => {
    render(<SceneDetail {...makeProps({ selectedCandidateId: "candidate-001" })} />);
    const btn = screen.getByTestId<HTMLButtonElement>("select-candidate-btn");
    expect(btn.disabled).toBe(false);
  });

  it("3. clicking select candidate calls onSelectCandidateAction with candidateId", () => {
    const handler = vi.fn();
    render(
      <SceneDetail
        {...makeProps({
          selectedCandidateId: "candidate-001",
          onSelectCandidateAction: handler,
        })}
      />,
    );
    const btn = screen.getByTestId("select-candidate-btn");
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("candidate-001");
  });

  it("4. clicking skip scene calls onSkipScene", () => {
    const handler = vi.fn();
    render(<SceneDetail {...makeProps({ onSkipScene: handler })} />);
    const btn = screen.getByTestId("skip-scene-btn");
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("5. clicking search scene calls onSearchScene", () => {
    const handler = vi.fn();
    render(<SceneDetail {...makeProps({ onSearchScene: handler })} />);
    const btn = screen.getByTestId("search-scene-btn");
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("6. all action buttons are disabled when busyAction is set", () => {
    render(
      <SceneDetail
        {...makeProps({ busyAction: "select", selectedCandidateId: "candidate-001" })}
      />,
    );
    expect(screen.getByTestId<HTMLButtonElement>("select-candidate-btn").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("skip-scene-btn").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(true);
  });

  it("7. skip button is disabled when busyAction='skip'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "skip" })} />);
    expect(screen.getByTestId<HTMLButtonElement>("skip-scene-btn").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(true);
  });

  it("8. search button is disabled when busyAction='search'", () => {
    render(<SceneDetail {...makeProps({ busyAction: "search" })} />);
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(true);
  });

  it("9. action error is displayed when actionError is provided", () => {
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

  it("10. rights warning dialog is displayed when rightsWarning is provided", () => {
    render(
      <SceneDetail
        {...makeProps({
          rightsWarning: { message: "需要确认权利", hint: "请确认后重试" },
        })}
      />,
    );
    expect(screen.getByTestId("rights-dialog")).toBeDefined();
    expect(screen.getByText("需要确认权利")).toBeDefined();
  });

  it("11. dismissing action error calls onDismissError", () => {
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

  it("12. rights confirm calls onRightsConfirm", () => {
    const handler = vi.fn();
    render(
      <SceneDetail
        {...makeProps({
          rightsWarning: { message: "需要确认权利" },
          onRightsConfirm: handler,
        })}
      />,
    );
    const confirmBtn = screen.getByText("确认并重试");
    fireEvent.click(confirmBtn);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("13. rights cancel calls onRightsCancel", () => {
    const handler = vi.fn();
    render(
      <SceneDetail
        {...makeProps({
          rightsWarning: { message: "需要确认权利" },
          onRightsCancel: handler,
        })}
      />,
    );
    const cancelBtn = screen.getByText("取消");
    fireEvent.click(cancelBtn);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
