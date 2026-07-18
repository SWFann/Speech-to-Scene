/**
 * Unit tests for the FixtureImageGenerator.
 *
 * Phase 2: AI image generation.
 *
 * Coverage:
 *  1. Returns correct dimensions for 9:16 aspect ratio
 *  2. Returns correct dimensions for 16:9 aspect ratio
 *  3. Returns correct dimensions for 1:1 aspect ratio
 *  4. Returns a placehold.co URL
 *  5. thumbnailUrl matches imageUrl
 *  6. Uses default model when none specified
 *  7. Uses provided model when specified
 *  8. providerSnapshot has correct provider ID
 */

import { describe, it, expect } from "vitest";

import { FixtureImageGenerator } from "../../src/providers/fixture/fixture-image-generator.js";

describe("FixtureImageGenerator", () => {
  const generator = new FixtureImageGenerator();

  it("1. returns correct dimensions for 9:16 aspect ratio", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "9:16",
    });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1792);
  });

  it("2. returns correct dimensions for 16:9 aspect ratio", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "16:9",
    });
    expect(result.width).toBe(1792);
    expect(result.height).toBe(1024);
  });

  it("3. returns correct dimensions for 1:1 aspect ratio", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "1:1",
    });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it("4. returns a placehold.co URL", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "1:1",
    });
    expect(result.imageUrl).toContain("https://placehold.co/");
    expect(result.imageUrl).toContain("1024x1024");
  });

  it("5. thumbnailUrl matches imageUrl", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "9:16",
    });
    expect(result.thumbnailUrl).toBe(result.imageUrl);
  });

  it("6. uses default model when none specified", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "1:1",
    });
    expect(result.model).toBe("fixture-image-v1");
  });

  it("7. uses provided model when specified", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "1:1",
      model: "custom-model",
    });
    expect(result.model).toBe("custom-model");
  });

  it("8. providerSnapshot has correct provider ID", async () => {
    const result = await generator.generate({
      prompt: "test prompt",
      aspectRatio: "1:1",
    });
    expect(result.providerSnapshot.id).toBe("fixture-image");
    expect(generator.providerId).toBe("fixture-image");
  });

  it("9. providerSnapshot has required fields", () => {
    const snapshot = generator.providerSnapshot;
    expect(snapshot.name).toBe("Fixture Image Generator");
    expect(snapshot.homepageUrl).toMatch(/^https:\/\//);
    expect(snapshot.termsUrl).toMatch(/^https:\/\//);
    expect(snapshot.policyRevision).toBeTruthy();
    expect(snapshot.termsCheckedAt).toBeTruthy();
  });
});
