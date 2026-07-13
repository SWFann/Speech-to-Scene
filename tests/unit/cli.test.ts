import { describe, expect, it } from "vitest";

import { createProgram } from "../../src/cli/index.js";

describe("CLI", () => {
  it("uses the public s2s command name", () => {
    expect(createProgram().name()).toBe("s2s");
  });
});
