/**
 * StepFunScriptPlanner unit tests.
 *
 * Uses FakeHttpClient to simulate StepFun API responses without network calls.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_STEPFUN_MAX_TOKENS,
  DEFAULT_STEPFUN_MODEL,
  StepFunScriptPlanner,
  type StepFunPlannerOptions,
} from "../../src/planner/stepfun-script-planner.js";
import { FakeHttpClient } from "../helpers/fake-http-client.js";
import type {
  PlanScriptInput,
  SourceBlockForPlanner,
} from "../../src/application/ports/script-planner.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSourceBlock(overrides: Partial<SourceBlockForPlanner> = {}): SourceBlockForPlanner {
  return {
    id: "block-0001",
    order: 1,
    kind: "paragraph",
    sourceRange: { start: 0, end: 11 },
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanScriptInput> = {}): PlanScriptInput {
  return {
    rawText: "Hello world",
    sourceBlocks: [makeSourceBlock()],
    language: "zh-CN",
    aspectRatio: "9:16",
    style: "knowledge",
    assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    maxScenes: 20,
    promptVersion: "plan-script-v1",
    ...overrides,
  };
}

function makeOptions(client: FakeHttpClient): StepFunPlannerOptions {
  return {
    apiKey: "test-step-key",
    client,
  };
}

function makeValidResponse(
  scenes: Array<Record<string, unknown>>,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ scenes }),
        },
      },
    ],
    model: DEFAULT_STEPFUN_MODEL,
    ...(usage ? { usage } : {}),
  };
}

const DEFAULT_SCENES = [
  {
    sourceAnchor: {
      strategy: "source-blocks-v1",
      sourceBlockIds: ["block-0001"],
      startQuote: "Hello",
      endQuote: "world",
    },
    summary: "Test scene",
    narrativeRole: "explanation",
    visualPlan: {
      decision: "speaker_only",
      rationale: "Test",
      preferredMedia: ["photo"],
      visualKeywords: ["test"],
    },
    queries: [],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StepFunScriptPlanner", () => {
  it("calls the OpenAI-compatible chat completions endpoint with JSON mode", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES, {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      }),
      headers: new Headers({ "x-request-id": "req-step" }),
      requestId: "req-step",
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());

    expect(result.model).toBe(DEFAULT_STEPFUN_MODEL);
    expect(result.apiProtocol).toBe("openai-compatible");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    expect(result.requestId).toBe("req-step");
    expect(client.recordedRequests).toHaveLength(1);
    expect(client.recordedRequests[0]!.path).toBe("/chat/completions");
    expect(client.recordedRequests[0]!.body).toMatchObject({
      model: DEFAULT_STEPFUN_MODEL,
      temperature: 0.3,
      max_tokens: DEFAULT_STEPFUN_MAX_TOKENS,
      response_format: { type: "json_object" },
    });
    expect(client.recordedRequests[0]!.body).not.toHaveProperty("reasoning_effort");

    const requestBody = client.recordedRequests[0]!.body as Record<string, unknown>;
    const messages = requestBody.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]!.content).toContain("untrusted source material");
    expect(messages[1]!.content).toContain("Hello world");
    expect(messages[0]!.content).toContain("subject + action + environment + shot");
    expect(messages[0]!.content).toContain("2-4 supporting visual scenes");
    expect(messages[0]!.content).toContain(
      "named person, creator, brand, film, or exact original clip",
    );
  });

  it("returns providerId and capabilities", () => {
    const client = new FakeHttpClient();
    const planner = new StepFunScriptPlanner(makeOptions(client));

    expect(planner.providerId).toBe("stepfun");
    expect(planner.capabilities).toEqual({
      jsonMode: true,
      strictJsonSchema: false,
      toolCalling: false,
      usageMetrics: true,
    });
  });

  it("uses a provided model name", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { ...makeValidResponse(DEFAULT_SCENES), model: "step-custom" },
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner({
      ...makeOptions(client),
      model: "step-custom",
    });
    const result = await planner.plan(makeInput());

    expect(result.model).toBe("step-custom");
    expect(client.recordedRequests[0]!.body).toMatchObject({ model: "step-custom" });
  });

  it("instructs the model not to output empty visual arrays", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    await planner.plan(makeInput());

    const body = client.recordedRequests[0]!.body as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = body.messages.find((message) => message.role === "system")?.content;
    expect(systemPrompt).toContain("Never output empty arrays");
    expect(systemPrompt).toContain("visualPlan.preferredMedia must contain at least one item");
    expect(systemPrompt).toContain("visualPlan.visualKeywords must contain at least one item");
  });

  it("normalizes common StepFun output variants before schema validation", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse([
        {
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-0001"],
            startQuote: "Hello",
            endQuote: "world",
          },
          summary: " Test scene ",
          narrativeRole: "explanation",
          visualPlan: {
            decision: "stock_asset",
            rationale: " Test ",
            preferredMedia: ["image"],
            visualKeywords: [" paper notes "],
          },
          queries: [{ language: "zh-CN", query: " 主动回忆 ", purpose: " visual ", enabled: true }],
        },
      ]),
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());
    const output = result.output as {
      scenes: Array<{
        summary: string;
        visualPlan: { preferredMedia: string[]; visualKeywords: string[] };
        queries: Array<{ language: string; query: string }>;
      }>;
    };
    const scene = output.scenes[0]!;

    expect(scene.summary).toBe("Test scene");
    expect(scene.visualPlan.preferredMedia).toEqual(["photo"]);
    expect(scene.visualPlan.visualKeywords).toEqual(["paper notes"]);
    expect(scene.queries[0]!.language).toBe("zh");
    expect(scene.queries[0]!.query).toBe("主动回忆");
  });

  it("throws PlannerOutputError when response has no choices", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [] },
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("StepFun returned no choices");
  });

  it("throws PlannerOutputError on invalid JSON", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: "not json" } }] },
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow(
      "Failed to parse StepFun response as JSON",
    );
  });

  it("throws PlannerValidationError on schema invalid output", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: JSON.stringify({ scenes: [] }) } }] },
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("Planner output validation failed");
  });

  it("throws PlannerValidationError on stock_asset without enabled query", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse([
        {
          sourceAnchor: {
            strategy: "source-blocks-v1",
            sourceBlockIds: ["block-0001"],
            startQuote: "Hello",
            endQuote: "world",
          },
          summary: "Stock scene",
          narrativeRole: "explanation",
          visualPlan: {
            decision: "stock_asset",
            rationale: "Test",
            preferredMedia: ["photo"],
            visualKeywords: ["test"],
          },
          queries: [{ language: "zh", query: "test", purpose: "test", enabled: false }],
        },
      ]),
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("Stock asset query validation failed");
  });

  it("throws PlannerError on non-2xx response without leaking the API key", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: false,
      status: 401,
      data: { error: { message: "Unauthorized" } },
      headers: new Headers(),
    });

    const planner = new StepFunScriptPlanner({
      apiKey: "secret-step-key",
      client,
    });

    await expect(planner.plan(makeInput())).rejects.toThrow("Unauthorized");
    await expect(planner.plan(makeInput())).rejects.not.toThrow("secret-step-key");
  });
});
