import { describe, expect, it } from "vitest";

import { isValidProjectName } from "../../src/application/project-name.js";

describe("isValidProjectName", () => {
  it.each([
    "CON",
    "nul",
    "COM1",
    "LPT9",
    "name.",
    "name ",
    "bad:name",
    "bad*name",
    "bad?name",
    'bad"name',
    "bad<name",
    "bad>name",
    "bad|name",
  ])("rejects cross-platform unsafe name %j", (name) => {
    expect(isValidProjectName(name)).toBe(false);
  });

  it.each(["active-recall-123", "中文项目-1", "demo_project"])(
    "accepts safe project name %j",
    (name) => {
      expect(isValidProjectName(name)).toBe(true);
    },
  );
});
