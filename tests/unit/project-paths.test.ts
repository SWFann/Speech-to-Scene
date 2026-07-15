import { describe, expect, it, beforeEach } from "vitest";

import {
  ProjectRelativePathSchema,
  isPathContained,
  hasPathTraversal,
  validatePathCrossPlatform,
} from "../../src/infrastructure/project-paths.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

// ---------------------------------------------------------------------------
// PathSchema
// ---------------------------------------------------------------------------

describe("ProjectRelativePathSchema", () => {
  // --- POSIX valid paths ---
  const validPaths = [
    "script.md",
    "script.txt",
    "assets/scene-001/image.jpg",
    "cache/search/scene-001.json",
    "素材/场景-001/图片.jpg", // Unicode allowed
    "a/b/c/d/e.txt",
    "my-document_v2.1.md",
    " spaces and dots ", // trimmed by schema
  ];

  it.each(validPaths)("accepts valid path: %s", (p) => {
    // Schema trims and normalizes, so parse may differ slightly
    const result = ProjectRelativePathSchema.safeParse(p);
    expect(result.success).toBe(true);
  });

  // --- POSIX invalid paths ---
  const invalidPaths = [
    "", // empty
    ".", // dot
    "..", // parent
    "../secret", // traversal
    "a/../../secret", // traversal through intermediate
    "/etc/passwd", // absolute POSIX
    "./script.md", // leading dot
    "assets\\file.jpg", // backslash
    "C:\\secret", // Windows drive absolute
    "C:/secret", // Windows drive with forward slash
    "C:secret", // Windows drive-relative
    "\\\\server\\share\\file", // UNC
    "//server/share/file", // POSIX-like UNC
    "\\\\?\\C:\\file", // Windows extended path
    "\\\\.\\pipe\\name", // named pipe
    "CON", // Windows device name
    "NUL",
    "AUX",
    "PRN",
    "COM1",
    "LPT1",
  ];

  it.each(invalidPaths)("rejects invalid path: %s", (p) => {
    const result = ProjectRelativePathSchema.safeParse(p);
    expect(result.success).toBe(false);
  });

  it("rejects Windows reserved names with extensions", () => {
    expect(ProjectRelativePathSchema.safeParse("CON.txt").success).toBe(false);
    expect(ProjectRelativePathSchema.safeParse("NUL.log").success).toBe(false);
  });

  it("rejects trailing slash", () => {
    expect(ProjectRelativePathSchema.safeParse("assets/").success).toBe(false);
    expect(ProjectRelativePathSchema.safeParse("a/b/").success).toBe(false);
  });

  it("rejects NUL byte", () => {
    expect(ProjectRelativePathSchema.safeParse("a\x00b").success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(ProjectRelativePathSchema.safeParse("a\tb").success).toBe(false);
    expect(ProjectRelativePathSchema.safeParse("a\nb").success).toBe(false);
  });

  it("rejects trailing dot or space in segment", () => {
    // Per M1 spec: any segment ending with dot or space is rejected
    expect(ProjectRelativePathSchema.safeParse("file. ").success).toBe(false); // "file." ends with dot
    expect(ProjectRelativePathSchema.safeParse("file . ").success).toBe(false); // "file ." ends with dot, trailing space trimmed
  });

  it("rejects alternate data stream syntax", () => {
    expect(ProjectRelativePathSchema.safeParse("file.txt::$DATA").success).toBe(false);
  });

  it("rejects Windows pipe paths", () => {
    expect(ProjectRelativePathSchema.safeParse("\\\\.\\pipe\\test").success).toBe(false);
  });

  it("normalizes duplicate slashes", () => {
    const result = ProjectRelativePathSchema.safeParse("a//b///c");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("a/b/c");
    }
  });

  it("preserves Unicode characters", () => {
    const result = ProjectRelativePathSchema.safeParse("素材/场景-001/图片.jpg");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("素材/场景-001/图片.jpg");
    }
  });
});

// ---------------------------------------------------------------------------
// isPathContained
// ---------------------------------------------------------------------------

describe("isPathContained", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-path-test-"));
  });

  it("returns safe for path inside root", () => {
    const result = isPathContained(path.join(tmpDir, "sub", "file.txt"), tmpDir);
    expect(result.safe).toBe(true);
  });

  it("returns safe for root itself", () => {
    const result = isPathContained(tmpDir, tmpDir);
    expect(result.safe).toBe(true);
  });

  it("returns unsafe for path outside root", () => {
    const outside = path.join(os.tmpdir(), "evil.txt");
    const result = isPathContained(outside, tmpDir);
    expect(result.safe).toBe(false);
    if (result.safe === false) {
      expect(result.reason).toBeDefined();
    }
  });

  it("handles prefix trap: /tmp/project-evil not inside /tmp/project", () => {
    // On Linux, /tmp/project-evil is a sibling, not a child of /tmp/project
    const projectDir = "/tmp/project";
    const evilDir = "/tmp/project-evil";
    const result = isPathContained(path.join(evilDir, "file.txt"), projectDir);
    // Should be outside since /tmp/project-evil doesn't start with /tmp/project/
    expect(result.safe).toBe(false);
  });

  it("rejects traversal sequences", () => {
    const traversalPath = path.join(tmpDir, "..", "etc", "passwd");
    const result = isPathContained(traversalPath, tmpDir);
    expect(result.safe).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasPathTraversal
// ---------------------------------------------------------------------------

describe("hasPathTraversal", () => {
  it("detects ../ patterns", () => {
    expect(hasPathTraversal("../secret")).toBe(true);
    expect(hasPathTraversal("a/../../b")).toBe(true);
    expect(hasPathTraversal("..\\secret")).toBe(true);
  });

  it("returns false for safe paths", () => {
    expect(hasPathTraversal("a/b/c")).toBe(false);
    expect(hasPathTraversal("script.md")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validatePathCrossPlatform
// ---------------------------------------------------------------------------

describe("validatePathCrossPlatform", () => {
  it("POSIX rejects absolute paths", () => {
    const result = validatePathCrossPlatform("/etc/passwd");
    expect(result.posix.safe).toBe(false);
  });

  it("Win32 rejects Windows reserved names", () => {
    const result = validatePathCrossPlatform("CON");
    expect(result.win32.safe).toBe(false);
  });

  it("both reject traversal", () => {
    const result = validatePathCrossPlatform("../secret");
    expect(result.posix.safe).toBe(false);
    expect(result.win32.safe).toBe(false);
  });

  it("both accept simple relative paths", () => {
    const result = validatePathCrossPlatform("script.md");
    expect(result.posix.safe).toBe(true);
    expect(result.win32.safe).toBe(true);
  });
});
