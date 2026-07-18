import { describe, expect, it } from "vitest";

import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";
import type { SettingsView } from "../../src/application/ports/settings-store.js";

const SAMPLE_VIEW: SettingsView = {
  plannerProvider: "fixture",
  hasDeepseekKey: false,
  hasStepKey: false,
  hasPexelsKey: true,
  hasPixabayKey: false,
  hasUnsplashKey: false,
  hasOpenverseKey: false,
  deepseekBaseUrl: "",
  deepseekModel: "",
  stepBaseUrl: "",
  stepModel: "",
  stepImageModel: "",
  pexelsBaseUrl: "",
  pexelsVideoBaseUrl: "",
};

function fakeDeps(overrides: Partial<ReviewServerDependencies> = {}): ReviewServerDependencies {
  // Stubs are non-async; `await` on a non-Promise returns the value directly.
  const base: Record<string, unknown> = {
    repository: { load: () => ({}), save: () => {}, exists: () => true },
    getReviewProject: () => ({ project: { id: "p", scenes: [] } }),
    updateScene: () => ({}),
    updateSceneQueries: () => ({}),
    searchSceneAssets: () => ({
      projectId: "p",
      status: "searched",
      sceneCount: 0,
      totalCandidates: 0,
      cacheHits: 0,
      cacheMisses: 0,
      warnings: [],
    }),
    getSettings: () => SAMPLE_VIEW,
    saveSettings: () => SAMPLE_VIEW,
    createProjectFromContent: () => ({
      projectId: "p",
      title: "t",
      status: "created",
      projectRoot: "/",
      scriptPath: "/s",
      createdAt: "",
    }),
    planProject: () => ({
      projectId: "p",
      title: "t",
      status: "planned",
      sceneCount: 0,
      provider: "fixture",
      promptVersion: "v",
      projectRoot: "/",
    }),
    searchProjectAssets: () => ({
      projectId: "p",
      status: "searched",
      sceneCount: 0,
      totalCandidates: 0,
      cacheHits: 0,
      cacheMisses: 0,
      warnings: [],
    }),
  };
  return { ...base, ...overrides } as unknown as ReviewServerDependencies;
}

describe("settings routes", () => {
  const cfg = {
    projectRoot: "/proj",
    host: "127.0.0.1",
    getBoundPort: () => 3210,
    version: "v",
  };

  it("registers GET /api/settings when deps wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "GET", "/api/settings")).toBeDefined();
  });

  it("registers PUT /api/settings when deps wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "PUT", "/api/settings")).toBeDefined();
  });

  it("does NOT register settings routes when deps absent", () => {
    const routes = createRoutes(cfg);
    expect(matchRoute(routes, "GET", "/api/settings")).toBeUndefined();
    expect(matchRoute(routes, "PUT", "/api/settings")).toBeUndefined();
  });
});
