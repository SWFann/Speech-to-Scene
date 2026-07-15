/**
 * DeepSeekScriptPlanner unit tests.
 *
 * Uses a FakeHttpClient to simulate DeepSeek API responses without network calls.
 */

import { describe, expect, it } from "vitest";

import { DeepSeekScriptPlanner } from "../../src/planner/deepseek-script-planner.js";
import type { DeepSeekPlannerOptions } from "../../src/planner/deepseek-script-planner.js";
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

function makeOptions(client: FakeHttpClient): DeepSeekPlannerOptions {
  return {
    apiKey: "test-api-key",
    model: "deepseek-chat",
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
    model: "deepseek-chat",
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

describe("DeepSeekScriptPlanner", () => {
  it("returns valid planner output on successful API response", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());

    const output = result.output as { scenes: Array<{ summary: string }> };
    expect(output.scenes).toHaveLength(1);
    expect(output.scenes[0]!.summary).toBe("Test scene");
    expect(result.apiProtocol).toBe("openai-compatible");
    expect(result.model).toBe("deepseek-chat");
  });

  it("includes usage metrics when API returns them", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: {
        ...makeValidResponse(DEFAULT_SCENES),
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());

    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  });

  it("omits usage metrics when API does not return them", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());

    expect(result.usage).toBeUndefined();
  });

  it("includes requestId when response header provides it", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers({ "x-request-id": "req-123" }),
      requestId: "req-123",
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    const result = await planner.plan(makeInput());

    expect(result.requestId).toBe("req-123");
  });

  it("throws PlannerError on non-2xx response", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: false,
      status: 401,
      data: { error: { message: "Invalid API key" } },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("Invalid API key");
  });

  it("throws PlannerError on non-2xx response without error body", async () => {
    const client = new FakeHttpClient();
    client.setResponse({ ok: false, status: 500, data: {}, headers: new Headers() });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("DeepSeek API error: 500");
  });

  it("throws PlannerOutputError when response has no choices", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [] },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("DeepSeek returned no choices");
  });

  it("throws PlannerOutputError when choice has empty content", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: "" } }] },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("DeepSeek returned empty content");
  });

  it("throws PlannerOutputError on invalid JSON in response", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: { choices: [{ message: { content: "not valid json" } }] },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow(
      "Failed to parse DeepSeek response as JSON",
    );
  });

  it("throws PlannerValidationError on Zod validation failure", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({ scenes: [] }),
            },
          },
        ],
      },
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
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

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await expect(planner.plan(makeInput())).rejects.toThrow("Stock asset query validation failed");
  });

  it("returns providerId and capabilities", () => {
    const client = new FakeHttpClient();
    const planner = new DeepSeekScriptPlanner(makeOptions(client));

    expect(planner.providerId).toBe("deepseek");
    expect(planner.capabilities).toEqual({
      jsonMode: true,
      strictJsonSchema: false,
      toolCalling: false,
      usageMetrics: true,
    });
  });

  it("uses default model when not specified", () => {
    const client = new FakeHttpClient();
    const planner = new DeepSeekScriptPlanner(makeOptions(client));

    // Access private via type assertion for test verification
    expect((planner as unknown as { model: string }).model).toBe("deepseek-chat");
  });

  it("uses provided model name", () => {
    const client = new FakeHttpClient();
    const planner = new DeepSeekScriptPlanner({
      ...makeOptions(client),
      model: "deepseek-reasoner",
    });

    expect((planner as unknown as { model: string }).model).toBe("deepseek-reasoner");
  });

  it("records the request body", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await planner.plan(makeInput());

    expect(client.recordedRequests).toHaveLength(1);
    expect(client.recordedRequests[0]!.path).toBe("/chat/completions");
    expect(client.recordedRequests[0]!.body).toMatchObject({
      model: "deepseek-chat",
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });
  });

  it("includes source blocks and config in user prompt", async () => {
    const client = new FakeHttpClient();
    client.setResponse({
      ok: true,
      status: 200,
      data: makeValidResponse(DEFAULT_SCENES),
      headers: new Headers(),
    });

    const planner = new DeepSeekScriptPlanner(makeOptions(client));
    await planner.plan(
      makeInput({
        sourceBlocks: [
          makeSourceBlock({
            id: "block-0001",
            order: 1,
            kind: "heading",
            sourceRange: { start: 0, end: 11 },
          }),
          makeSourceBlock({
            id: "block-0002",
            order: 2,
            kind: "paragraph",
            sourceRange: { start: 12, end: 23 },
          }),
        ],
        language: "en-US",
        aspectRatio: "16:9",
        style: "story",
        assetUsePolicy: { intendedUse: "personal", willModify: false },
        maxScenes: 10,
      }),
    );

    const body = client.recordedRequests[0]!.body as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((m) => m.role === "user");
    expect(userMessage!.content).toContain("block-0001");
    expect(userMessage!.content).toContain("block-0002");
    expect(userMessage!.content).toContain("en-US");
    expect(userMessage!.content).toContain("16:9");
    expect(userMessage!.content).toContain("story");
    expect(userMessage!.content).toContain("personal");
    expect(userMessage!.content).toContain("Max Scenes: 10");
  });
});
