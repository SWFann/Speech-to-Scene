import { describe, it, expect } from "vitest";
import { FixtureAssetProvider } from "../../src/providers/fixture/fixture-asset-provider.js";
import type { Clock } from "../../src/application/ports/clock.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFixedClock(fixedTime: Date): Clock {
  return { now: () => fixedTime };
}

const FIXED_NOW = new Date("2026-07-14T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FixtureAssetProvider", () => {
  const provider = new FixtureAssetProvider(createFixedClock(FIXED_NOW));

  describe("provider metadata", () => {
    it("has provider id 'fixture'", () => {
      expect(provider.providerId).toBe("fixture");
    });

    it("has capabilities with photos and videos enabled", () => {
      expect(provider.capabilities.photos).toBe(true);
      expect(provider.capabilities.videos).toBe(true);
      expect(provider.capabilities.orientationFilter).toBe(true);
    });
  });

  describe("search", () => {
    it("returns candidates for both photos and videos", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test query",
        language: "zh",
        mediaTypes: ["photo", "video"],
        perPage: 5,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]!.mediaType).toBe("photo");
      expect(result.candidates[1]!.mediaType).toBe("video");
    });

    it("returns only photos when mediaTypes is ['photo']", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 3,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.mediaType).toBe("photo");
    });

    it("returns only videos when mediaTypes is ['video']", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["video"],
        perPage: 3,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.mediaType).toBe("video");
    });

    it("returns candidates with sequential ranks", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 3,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates[0]!.rank).toBe(1);
    });

    it("generates deterministic URLs based on queryId, mediaType, and rank", async () => {
      const result = await provider.search({
        queryId: "q42",
        query: "mountains",
        language: "en",
        mediaTypes: ["photo"],
        orientation: "landscape",
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene42",
      });

      const candidate = result.candidates[0]!;
      expect(candidate.thumbnailUrl).toBe("https://example.com/fixture/q42/photo/1/thumb.jpg");
      expect(candidate.sourcePageUrl).toBe("https://example.com/fixture/q42/photo/1");
      expect(candidate.id).toBe("fixture-q42-photo-1");
    });

    it("returns empty warnings array", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.warnings).toEqual([]);
    });

    it("includes provider snapshot in candidate", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates[0]!.provider.id).toBe("fixture");
      expect(result.candidates[0]!.provider.name).toBe("Fixture Asset Provider");
    });

    it("includes rights with platform_license status", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates[0]!.rights.status).toBe("platform_license");
      expect(result.candidates[0]!.rights.commercialUse).toBe("allowed");
    });

    it("uses injected clock for retrievedAt", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates[0]!.retrievedAt).toBe("2026-07-14T12:00:00.000Z");
    });

    it("includes previewUrl for video", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["video"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates[0]!.previewUrl).toBe(
        "https://example.com/fixture/q1/video/1/preview.mp4",
      );
    });

    it("does not include previewUrl for photo", async () => {
      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect((result.candidates[0]! as { previewUrl?: string }).previewUrl).toBeUndefined();
    });
  });
});
