/**
 * Source block builder tests.
 */

import { describe, expect, it } from "vitest";
import { buildSourceBlocks } from "../../src/planner/source-blocks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUint8Array(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSourceBlocks", () => {
  it("rejects empty source", () => {
    expect(() => buildSourceBlocks(toUint8Array(""))).toThrow("empty or whitespace-only");
    expect(() => buildSourceBlocks(toUint8Array("   \n\t\n"))).toThrow("empty or whitespace-only");
  });

  it("extracts a single paragraph", () => {
    const text = "Hello world";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!).toMatchObject({
      id: "block-0001",
      order: 1,
      kind: "paragraph",
      text,
    });
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: text.length });
  });

  it("extracts headings", () => {
    const text = "# Title\n\nParagraph";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!).toMatchObject({
      id: "block-0001",
      order: 1,
      kind: "heading",
      text: "# Title",
    });
    expect(result.blocks[1]!).toMatchObject({
      id: "block-0002",
      order: 2,
      kind: "paragraph",
      text: "Paragraph",
    });
  });

  it("extracts list items", () => {
    const text = "- Item 1\n- Item 2";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!).toMatchObject({
      id: "block-0001",
      order: 1,
      kind: "list_item",
      text: "- Item 1\n- Item 2",
    });
  });

  it("extracts blockquotes", () => {
    const text = "> Quote\n> More";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!).toMatchObject({
      id: "block-0001",
      order: 1,
      kind: "blockquote",
      text: "> Quote\n> More",
    });
  });

  it("extracts fenced code blocks", () => {
    const text = "```js\nconst x = 1;\n```";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!).toMatchObject({
      id: "block-0001",
      order: 1,
      kind: "code_block",
      text: "```js\nconst x = 1;\n```",
    });
  });

  it("handles Chinese text", () => {
    const text = "深度学习是机器学习的一个分支。";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.text).toBe(text);
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: text.length });
  });

  it("handles emoji", () => {
    const text = "Hello 😀 World";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.text).toBe(text);
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: text.length });
  });

  it("handles CRLF line endings", () => {
    // "Line 1\r\n\r\nLine 2"
    // Block 1: "Line 1" at offset 0, length 6
    // \r\n = 2 chars
    // \r\n = 2 chars (blank line)
    // Block 2: "Line 2" at offset 10, length 6
    const text = "Line 1\r\n\r\nLine 2";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.text).toBe("Line 1");
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: 6 });
    expect(result.blocks[1]!.text).toBe("Line 2");
    expect(result.blocks[1]!.sourceRange).toEqual({ start: 10, end: 16 });
  });

  it("handles emoji with CRLF line endings", () => {
    // "Hello 😀\r\n\r\nWorld 🌍"
    // Block 1: "Hello 😀" = 8 chars at offset 0
    // \r\n = 2 chars (blank line newline)
    // \r\n = 2 chars (paragraph separator)
    // Block 2: "World 🌍" = 8 chars at offset 12
    const text = "Hello 😀\r\n\r\nWorld 🌍";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]!.text).toBe("Hello 😀");
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: 8 });
    expect(result.blocks[1]!.text).toBe("World 🌍");
    expect(result.blocks[1]!.sourceRange).toEqual({ start: 12, end: 20 });
  });

  it("handles UTF-8 BOM", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const textBytes = new TextEncoder().encode("Hello");
    const combined = new Uint8Array(bom.length + textBytes.length);
    combined.set(bom);
    combined.set(textBytes, bom.length);

    const result = buildSourceBlocks(combined);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.text).toBe("Hello");
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: 5 });
  });

  it("handles trailing newline", () => {
    const text = "Hello\n";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.text).toBe("Hello");
  });

  it("splits different kinds into separate blocks", () => {
    const text = "# Heading\n\nParagraph\n\n- List item";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list_item"]);
  });

  it("generates sequential block IDs", () => {
    const text = "# H1\n# H2\n# H3";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks.map((b) => b.id)).toEqual(["block-0001", "block-0002", "block-0003"]);
  });

  it("computes correct source ranges", () => {
    const text = "Hello world";
    const result = buildSourceBlocks(toUint8Array(text));
    expect(result.blocks[0]!.sourceRange).toEqual({ start: 0, end: 11 });
  });
});
