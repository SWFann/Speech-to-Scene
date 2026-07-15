import { describe, it, expect, vi } from "vitest";
import {
  PexelsAssetProvider,
  PexelsApiError,
  PexelsAuthError,
} from "../../src/providers/pexels/pexels-asset-provider.js";
import type { HttpGetClient } from "../../src/providers/pexels/pexels-client.js";

// ---------------------------------------------------------------------------
// Fake HTTP client
// ---------------------------------------------------------------------------

function createFakeHttpClient(): {
  client: HttpGetClient;
  getMock: ReturnType<typeof vi.fn>;
  postMock: ReturnType<typeof vi.fn>;
} {
  const getMock = vi.fn();
  const postMock = vi.fn();
  return {
    client: {
      get: getMock,
      post: postMock,
    } as HttpGetClient,
    getMock,
    postMock,
  };
}

// ---------------------------------------------------------------------------
// Sample Pexels API responses
// ---------------------------------------------------------------------------

const samplePhotoResponse = {
  totalResults: 100,
  page: 1,
  perPage: 10,
  photos: [
    {
      id: 12345,
      width: 4000,
      height: 6000,
      url: "https://www.pexels.com/photo/12345",
      photographer: "John Doe",
      photographer_url: "https://www.pexels.com/@johndoe",
      src: {
        portrait: "https://images.pexels.com/photos/12345/portrait.jpg",
        landscape: "https://images.pexels.com/photos/12345/landscape.jpg",
        medium: "https://images.pexels.com/photos/12345/medium.jpg",
      },
      alt: "Mountain landscape",
    },
  ],
};

const sampleVideoResponse = {
  totalResults: 50,
  page: 1,
  perPage: 10,
  videos: [
    {
      id: 67890,
      width: 1920,
      height: 1080,
      duration: 30,
      image: "https://images.pexels.com/videos/67890/preview.jpg",
      url: "https://www.pexels.com/video/67890",
      user: {
        name: "Jane Smith",
        url: "https://www.pexels.com/@janesmith",
      },
      video_files: [
        {
          id: 1,
          quality: "sd",
          file_type: "video/mp4",
          width: 1920,
          height: 1080,
          link: "https://videos.pexels.com/video-files/67890/preview.mp4",
        },
      ],
      video_pictures: [
        { id: 1, picture: "https://images.pexels.com/videos/67890/frame-1.jpg", nr: 1 },
      ],
    },
  ],
};

describe("PexelsAssetProvider", () => {
  describe("search", () => {
    it("searches photos and videos when both mediaTypes requested", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(samplePhotoResponse).mockResolvedValueOnce(sampleVideoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",

        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "mountains",
        language: "zh",
        mediaTypes: ["photo", "video"],
        orientation: "portrait",
        perPage: 10,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]!.mediaType).toBe("photo");
      expect(result.candidates[1]!.mediaType).toBe("video");
      expect(result.warnings).toHaveLength(0);
    });

    it("returns only photos when mediaTypes is ['photo']", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(samplePhotoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo"],

        perPage: 5,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.mediaType).toBe("photo");
      expect(getMock).toHaveBeenCalledTimes(1);
    });

    it("returns only videos when mediaTypes is ['video']", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(sampleVideoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["video"],

        perPage: 5,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.mediaType).toBe("video");
    });

    it("generates candidate IDs with correct format", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(samplePhotoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

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

      expect(result.candidates[0]!.id).toBe("pexels-photo-12345-1");
    });

    it("maps photo data correctly", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(samplePhotoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "mountains",
        language: "zh",
        mediaTypes: ["photo"],
        orientation: "portrait",
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      const candidate = result.candidates[0]!;
      expect(candidate.providerAssetId).toBe("12345");
      expect(candidate.width).toBe(4000);
      expect(candidate.height).toBe(6000);
      expect(candidate.orientation).toBe("portrait");
      expect(candidate.creator.name).toBe("John Doe");
      expect(candidate.creator.profileUrl).toBe("https://www.pexels.com/@johndoe");
      expect(candidate.sourcePageUrl).toBe("https://www.pexels.com/photo/12345");
    });

    it("maps video data correctly", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(sampleVideoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "sunset",
        language: "zh",
        mediaTypes: ["video"],
        orientation: "landscape",
        perPage: 1,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      const candidate = result.candidates[0]!;
      expect(candidate.providerAssetId).toBe("67890");
      expect(candidate.width).toBe(1920);
      expect(candidate.height).toBe(1080);
      expect(candidate.durationSeconds).toBe(30);
      expect(candidate.orientation).toBe("landscape");
      expect(candidate.creator.name).toBe("Jane Smith");
      expect(candidate.previewUrl).toBe("https://videos.pexels.com/video-files/67890/preview.mp4");
    });

    it("infers portrait orientation from dimensions", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce({
        ...samplePhotoResponse,
        photos: [
          {
            ...samplePhotoResponse.photos[0],
            width: 4000,
            height: 6000,
          },
        ],
      });

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

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

      expect(result.candidates[0]!.orientation).toBe("portrait");
    });

    it("infers landscape orientation from dimensions", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce({
        ...samplePhotoResponse,
        photos: [
          {
            ...samplePhotoResponse.photos[0],
            width: 6000,
            height: 4000,
          },
        ],
      });

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

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

      expect(result.candidates[0]!.orientation).toBe("landscape");
    });

    it("infers square orientation from dimensions", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce({
        ...samplePhotoResponse,
        photos: [
          {
            ...samplePhotoResponse.photos[0],
            width: 4000,
            height: 4000,
          },
        ],
      });

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

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

      expect(result.candidates[0]!.orientation).toBe("square");
    });

    it("includes Pexels terms URL in rights", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock.mockResolvedValueOnce(samplePhotoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

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

      expect(result.candidates[0]!.rights.licenseUrl).toContain("pexels.com");
      expect(result.candidates[0]!.provider.termsUrl).toContain("pexels.com");
    });
  });

  describe("partial failures", () => {
    it("returns warning for photo search failure but continues with video", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock
        .mockRejectedValueOnce(new Error("Photo API error"))
        .mockResolvedValueOnce(sampleVideoResponse);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo", "video"],

        perPage: 5,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.mediaType).toBe("video");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.code).toBe("photo_search_failed");
      expect(result.warnings[0]!.queryId).toBe("q1");
    });

    it("re-throws PexelsAuthError instead of converting to warning", async () => {
      const { client, getMock } = createFakeHttpClient();
      const authError = new PexelsAuthError("Invalid API key");
      getMock.mockRejectedValueOnce(authError);

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      await expect(
        provider.search({
          queryId: "q1",
          query: "test",
          language: "zh",
          mediaTypes: ["photo"],

          perPage: 5,
          page: 1,
          projectPolicy: { intendedUse: "commercial_capable", willModify: true },
          sceneId: "scene1",
        }),
      ).rejects.toThrow(PexelsAuthError);
    });

    it("returns warnings for both photo and video failures", async () => {
      const { client, getMock } = createFakeHttpClient();
      getMock
        .mockRejectedValueOnce(new Error("Photo error"))
        .mockRejectedValueOnce(new Error("Video error"));

      const provider = new PexelsAssetProvider({
        apiKey: "test-api-key",
        httpClient: client,
      });

      const result = await provider.search({
        queryId: "q1",
        query: "test",
        language: "zh",
        mediaTypes: ["photo", "video"],

        perPage: 5,
        page: 1,
        projectPolicy: { intendedUse: "commercial_capable", willModify: true },
        sceneId: "scene1",
      });

      expect(result.candidates).toHaveLength(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]!.code).toBe("photo_search_failed");
      expect(result.warnings[1]!.code).toBe("video_search_failed");
    });
  });

  describe("error classes", () => {
    it("PexelsApiError has correct code and exitCode", () => {
      const error = new PexelsApiError("API failed", new Error("cause"));
      expect(error.code).toBe("pexels_api_error");
      expect(error.exitCode).toBe(1);
      expect(error.userHint).toBe("检查 Pexels API 配置和网络连接");
    });

    it("PexelsApiError includes cause when provided", () => {
      const cause = new Error("root cause");
      const error = new PexelsApiError("API failed", cause);
      expect(error.cause).toBe(cause);
    });

    it("PexelsApiError works without cause", () => {
      const error = new PexelsApiError("API failed");
      expect(error.code).toBe("pexels_api_error");
      expect(error.cause).toBeUndefined();
    });

    it("PexelsAuthError has correct code and exitCode", () => {
      const error = new PexelsAuthError("Auth failed");
      expect(error.code).toBe("pexels_auth_error");
      expect(error.exitCode).toBe(2);
      expect(error.userHint).toBe("检查 PEXELS_API_KEY 环境变量");
    });
  });
});
