// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingView } from "../../../web/src/components/LandingView.js";

describe("LandingView", () => {
  it("guides a beginner and submits useful production preferences", () => {
    const onCreate = vi.fn();
    render(<LandingView onCreate={onCreate} busy={false} flowStep={null} error={null} />);

    expect(screen.getByText("1. 放入口播稿")).toBeDefined();
    expect(screen.getByText("2. 选择成片方向")).toBeDefined();
    expect(screen.getByText("3. 自动拆场景并找素材")).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("粘贴你的口播稿，保留原本的段落即可"), {
      target: { value: "这是一段需要制作的口播稿。" },
    });
    fireEvent.change(screen.getByLabelText("成片画幅"), { target: { value: "16:9" } });
    fireEvent.change(screen.getByLabelText("内容风格"), { target: { value: "story" } });
    fireEvent.click(screen.getByRole("button", { name: /开始制作/ }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "这是一段需要制作的口播稿。",
        aspectRatio: "16:9",
        style: "story",
      }),
    );
  });
});
