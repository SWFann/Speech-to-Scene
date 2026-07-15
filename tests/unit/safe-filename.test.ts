/**
 * Unit tests for safeFileName utility.
 *
 * Tests verify:
 * - POSIX absolute path → basename only
 * - Windows absolute path → basename only
 * - Mixed separators → basename only
 * - Relative directory paths → basename only
 * - Traversal-like input (`.`, `..`) → null
 * - Trailing separators → null
 * - Whitespace/control chars → cleaned
 * - Output never contains separators or absolute paths
 * - null/undefined input → null
 */

import { describe, expect, it } from "vitest";
import { safeFileName } from "../../src/application/safe-filename.js";

describe("safeFileName", () => {
  // --- Happy path ---

  it("returns basename for simple filename", () => {
    expect(safeFileName("script.md")).toBe("script.md");
  });

  it("returns basename for POSIX absolute path", () => {
    expect(safeFileName("/home/user/secret.md")).toBe("secret.md");
  });

  it("returns basename for Windows absolute path", () => {
    expect(safeFileName("C:\\Users\\user\\secret.md")).toBe("secret.md");
  });

  it("returns basename for mixed separators", () => {
    expect(safeFileName("folder/sub\\file.mp4")).toBe("file.mp4");
    expect(safeFileName("folder\\sub/file.mp4")).toBe("file.mp4");
  });

  it("returns basename for relative directory path", () => {
    expect(safeFileName("folder/sub/file.mp4")).toBe("file.mp4");
  });

  it("returns basename for backslash-only path", () => {
    expect(safeFileName("folder\\sub\\file.mp4")).toBe("file.mp4");
  });

  // --- Edge cases ---

  it("returns null for trailing separator", () => {
    expect(safeFileName("folder/")).toBeNull();
    expect(safeFileName("folder\\")).toBeNull();
  });

  it("returns null for dot", () => {
    expect(safeFileName(".")).toBeNull();
  });

  it("returns null for dot-dot", () => {
    expect(safeFileName("..")).toBeNull();
  });

  it("returns null for dot in path", () => {
    expect(safeFileName("folder/.")).toBeNull();
  });

  it("returns null for dot-dot in path", () => {
    expect(safeFileName("folder/..")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(safeFileName("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(safeFileName("   ")).toBeNull();
    expect(safeFileName("\t\t")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(safeFileName(null)).toBeNull();
    expect(safeFileName(undefined)).toBeNull();
  });

  it("strips leading/trailing whitespace and control characters", () => {
    expect(safeFileName("  script.md  ")).toBe("script.md");
    expect(safeFileName("\x00script.md\x00")).toBe("script.md");
  });

  // --- FR-4: tightened boundary cases ---

  it("strips whitespace around basename from path with spaces", () => {
    expect(safeFileName("folder/ secret.md ")).toBe("secret.md");
    expect(safeFileName("folder\\ secret.md ")).toBe("secret.md");
  });

  it("strips tab characters around basename", () => {
    expect(safeFileName("folder/\tsecret.md\t")).toBe("secret.md");
    expect(safeFileName("folder\\\tsecret.md\t")).toBe("secret.md");
  });

  it("rejects Windows drive-relative names with colon (C:secret.md)", () => {
    expect(safeFileName("C:secret.md")).toBeNull();
    expect(safeFileName("folder/C:secret.md")).toBeNull();
    expect(safeFileName("D:file.mp4")).toBeNull();
  });

  it("rejects any filename containing a colon", () => {
    expect(safeFileName("file:name.md")).toBeNull();
    expect(safeFileName("a:b:c")).toBeNull();
  });

  it("returns null for drive letter only", () => {
    expect(safeFileName("C:")).toBeNull();
  });

  it("returns null for only separators", () => {
    expect(safeFileName("///")).toBeNull();
    expect(safeFileName("\\\\\\")).toBeNull();
  });

  // --- Security ---

  it("output never contains path separators", () => {
    const inputs = [
      "/home/user/secret.md",
      "C:\\Users\\user\\secret.md",
      "folder/sub/file.mp4",
      "..",
      ".",
    ];
    for (const input of inputs) {
      const result = safeFileName(input);
      if (result !== null) {
        expect(result).not.toContain("/");
        expect(result).not.toContain("\\");
      }
    }
  });

  it("output is never an absolute path", () => {
    const inputs = ["/home/user/secret.md", "C:\\Users\\user\\secret.md"];
    for (const input of inputs) {
      const result = safeFileName(input);
      if (result !== null) {
        expect(result).not.toMatch(/^\//);
        expect(result).not.toMatch(/^[a-zA-Z]:/);
      }
    }
  });
});
