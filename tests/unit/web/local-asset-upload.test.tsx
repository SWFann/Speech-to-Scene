// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LocalAssetUpload } from "../../../web/src/components/LocalAssetUpload.js";
import { Inspector } from "../../../web/src/components/Inspector.js";
import {
  createMinimalProject,
  createProjectWithLocalAsset,
  createProjectWithSelectedCandidate,
} from "../../fixtures/web-test-data.js";
import type { UploadProvenance } from "../../../web/src/components/LocalAssetUpload.js";

const noopUpload = (): void => {};

describe("LocalAssetUpload", () => {
  it("1. pending scene shows upload control", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!; // pending review
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    expect(screen.getByTestId("local-asset-upload")).toBeDefined();
    expect(screen.getByTestId("file-input")).toBeDefined();
  });

  it("2. file input accept is image/png,image/jpeg", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const input = screen.getByTestId<HTMLInputElement>("file-input");
    expect(input.accept).toBe("image/png,image/jpeg");
  });

  it("3. selecting a PNG file shows the filename", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const input = screen.getByTestId<HTMLInputElement>("file-input");
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("photo.png")).toBeDefined();
  });

  it("4. selecting a JPEG file shows the filename", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const input = screen.getByTestId<HTMLInputElement>("file-input");
    const file = new File(["jpeg-bytes"], "image.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("image.jpg")).toBeDefined();
  });

  it("5. clicking upload calls onUpload with default user_owned provenance", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    const handler = vi.fn<(input: { file: File; provenance: UploadProvenance }) => void>();
    render(<LocalAssetUpload scene={scene} onUpload={handler} busy={false} />);

    const input = screen.getByTestId<HTMLInputElement>("file-input");
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadBtn = screen.getByTestId("upload-button");
    fireEvent.click(uploadBtn);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0];
    expect(callArg.file).toBe(file);
    expect(callArg.provenance).toEqual({ kind: "user_owned" });
  });

  it("6. candidate_selected scene can select selected_candidate provenance", () => {
    const project = createProjectWithSelectedCandidate();
    const scene = project.scenes[0]!;
    const handler = vi.fn<(input: { file: File; provenance: UploadProvenance }) => void>();
    render(<LocalAssetUpload scene={scene} onUpload={handler} busy={false} />);

    // The provenance dropdown should have the selected_candidate option
    const select = screen.getByTestId<HTMLSelectElement>("provenance-select");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("selected_candidate");

    // Select the selected_candidate provenance
    fireEvent.change(select, { target: { value: "selected_candidate" } });

    // Upload a file
    const input = screen.getByTestId<HTMLInputElement>("file-input");
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    const uploadBtn = screen.getByTestId("upload-button");
    fireEvent.click(uploadBtn);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0];
    expect(callArg.provenance).toEqual({
      kind: "selected_candidate",
      candidateId: "candidate-001",
    });
  });

  it("7. upload button is disabled when no file is selected", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const btn = screen.getByTestId<HTMLButtonElement>("upload-button");
    expect(btn.disabled).toBe(true);
  });

  it("8. upload button is disabled when busy is true", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={true} />);
    const btn = screen.getByTestId<HTMLButtonElement>("upload-button");
    expect(btn.disabled).toBe(true);
    const input = screen.getByTestId<HTMLInputElement>("file-input");
    expect(input.disabled).toBe(true);
  });

  it("9. provenance dropdown defaults to user_owned", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const select = screen.getByTestId<HTMLSelectElement>("provenance-select");
    expect(select.value).toBe("user_owned");
  });

  it("10. pending scene without selected_candidate does not show selected_candidate option", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!; // pending review
    render(<LocalAssetUpload scene={scene} onUpload={noopUpload} busy={false} />);
    const select = screen.getByTestId<HTMLSelectElement>("provenance-select");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain("selected_candidate");
  });
});

describe("Inspector — upload integration", () => {
  it("11. existing localAsset shows info instead of upload control", () => {
    const project = createProjectWithLocalAsset();
    const scene = project.scenes[0]!;
    render(<Inspector scene={scene} onUploadLocalAsset={noopUpload} uploadBusy={false} />);
    // Should show local asset path
    expect(screen.getByText("assets/scene-001/abc123.png")).toBeDefined();
    // Should NOT show the upload control
    expect(screen.queryByTestId("local-asset-upload")).toBeNull();
  });

  it("12. pending scene shows upload control in Inspector", () => {
    const project = createMinimalProject();
    const scene = project.scenes[0]!;
    render(<Inspector scene={scene} onUploadLocalAsset={noopUpload} uploadBusy={false} />);
    expect(screen.getByTestId("local-asset-upload")).toBeDefined();
    // Should NOT show local asset info
    expect(screen.queryByText("assets/")).toBeNull();
  });
});
