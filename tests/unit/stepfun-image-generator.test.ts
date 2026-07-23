/**
 * Unit tests for the StepFunImageGenerator.
 *
 * Phase 2: AI image generation.
 *
 * Coverage:
 *  1. Constructor requires API key
 *  2. Successful generation returns correct result
 *  3. Maps aspect ratio to correct size string
 *  4. Uses default model when none specified
 *  5. Uses provided model when specified
 *  6. API error (non-2xx) throws InvalidArgumentError
 *  7. Missing image data throws InvalidArgumentError
 *  8. Missing image URL throws InvalidArgumentError
 *  9. providerSnapshot has correct provider ID
 * 10. Posts to /images/generations endpoint
 * 11. Prompt is sent in request body
 */

import { describe, it, expect } from "vitest";

import { StepFunImageGenerator } from "../../src/providers/stepfun/stepfun-image-generator.js";
import { FakeHttpClient } from "../helpers/fake-http-client.js";
import { InvalidArgumentError } from "../../src/shared/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(data: unknown): { ok: boolean; status: number; data: unknown; headers: Headers } {
  return {
    ok: true,
    status: 200,
    data,
    headers: new Headers(),
  };
}

function errorResponse(status: number, data: unknown): { ok: boolean; status: number; data: unknown; headers: Headers } {
  return {
    ok: false,
    status,
    data,
    headers: new Headers(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StepFunImageGenerator", () => {
  it("1. constructor requires API key", () => {
    expect(() => new StepFunImageGenerator({ apiKey: "" })).toThrow(InvalidArgumentError);
    expect(() => new StepFunImageGenerator({ apiKey: "  " })).toThrow(InvalidArgumentError);
  });

  it("2. successful generation returns correct result", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/generated.png" }],
        model: "step-image-edit-2",
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    const result = await generator.generate({
      prompt: "A beautiful sunset",
      aspectRatio: "9:16",
    });

    expect(result.imageUrl).toBe("https://example.com/generated.png");
    expect(result.thumbnailUrl).toBe("https://example.com/generated.png");
    expect(result.width).toBe(768);
    expect(result.height).toBe(1360);
    expect(result.model).toBe("step-image-edit-2");
  });

  it("3. maps aspect ratio to correct size string", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/gen.png" }],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    // 9:16 → 768x1360 (step-image-edit-2 supported size)
    await generator.generate({ prompt: "test", aspectRatio: "9:16" });
    expect(client.recordedRequests[0]!.body).toMatchObject({ size: "768x1360", n: 1 });

    // 16:9 → 1360x768
    await generator.generate({ prompt: "test", aspectRatio: "16:9" });
    expect(client.recordedRequests[1]!.body).toMatchObject({ size: "1360x768" });

    // 1:1 → 1024x1024
    await generator.generate({ prompt: "test", aspectRatio: "1:1" });
    expect(client.recordedRequests[2]!.body).toMatchObject({ size: "1024x1024" });
  });

  it("4. uses default model when none specified", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/gen.png" }],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await generator.generate({ prompt: "test", aspectRatio: "1:1" });
    expect(client.recordedRequests[0]!.body).toMatchObject({ model: "step-image-edit-2" });
  });

  it("5. uses provided model when specified", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/gen.png" }],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      model: "custom-model",
      client,
    });

    await generator.generate({ prompt: "test", aspectRatio: "1:1" });
    expect(client.recordedRequests[0]!.body).toMatchObject({ model: "custom-model" });
  });

  it("6. API error (non-2xx) throws InvalidArgumentError", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      errorResponse(401, {
        error: { message: "Invalid API key" },
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await expect(
      generator.generate({ prompt: "test", aspectRatio: "1:1" }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("7. missing image data throws InvalidArgumentError", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await expect(
      generator.generate({ prompt: "test", aspectRatio: "1:1" }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("8. missing image URL throws InvalidArgumentError", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ b64_json: "somebase64data" }], // no url field
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await expect(
      generator.generate({ prompt: "test", aspectRatio: "1:1" }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("9. providerSnapshot has correct provider ID", () => {
    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client: new FakeHttpClient(),
    });

    expect(generator.providerId).toBe("stepfun-image");
    expect(generator.providerSnapshot.id).toBe("stepfun-image");
    expect(generator.providerSnapshot.name).toBe("StepFun Image Generator");
  });

  it("10. posts to /images/generations endpoint", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/gen.png" }],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await generator.generate({ prompt: "test", aspectRatio: "1:1" });
    expect(client.recordedRequests[0]!.path).toBe("/images/generations");
  });

  it("11. prompt is sent in request body", async () => {
    const client = new FakeHttpClient();
    client.setResponse(
      okResponse({
        data: [{ url: "https://example.com/gen.png" }],
      }),
    );

    const generator = new StepFunImageGenerator({
      apiKey: "test-key",
      client,
    });

    await generator.generate({ prompt: "A cat sitting on a chair", aspectRatio: "1:1" });
    expect(client.recordedRequests[0]!.body).toMatchObject({ prompt: "A cat sitting on a chair" });
  });
});
