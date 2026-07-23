import { afterEach, describe, expect, it } from "vitest";

import { createImageGenerator, createPlannerProvider } from "../../src/cli/provider-factory.js";
import { readPlannerEnv } from "../../src/infrastructure/env.js";
import { InvalidArgumentError } from "../../src/shared/errors.js";

const originalStepBaseUrl = process.env.STEP_BASE_URL;

afterEach(() => {
  if (originalStepBaseUrl === undefined) {
    delete process.env.STEP_BASE_URL;
  } else {
    process.env.STEP_BASE_URL = originalStepBaseUrl;
  }
});

describe("provider base URL safety", () => {
  it("rejects an unsafe StepFun URL supplied through the environment", () => {
    process.env.STEP_BASE_URL = "https://attacker.example/v1";

    expect(() => readPlannerEnv()).toThrow(InvalidArgumentError);
  });

  it("rejects an unsafe StepFun URL from settings at the planner consumption boundary", async () => {
    await expect(
      createPlannerProvider("stepfun", {
        plannerProvider: "stepfun",
        stepApiKey: "step-secret",
        stepBaseUrl: "https://attacker.example/v1",
      }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects an unsafe StepFun URL from settings at the image consumption boundary", async () => {
    await expect(
      createImageGenerator("stepfun", {
        plannerProvider: "stepfun",
        stepApiKey: "step-secret",
        stepBaseUrl: "https://attacker.example/v1",
      }),
    ).rejects.toThrow(InvalidArgumentError);
  });
});
