import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";
import type { ReviewServerHandle } from "../../src/review/review-types.js";
import { startReviewServer } from "../../src/review/review-server.js";
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
    workspaceRoot: "/workspace",
    projectRootRef: { current: "/proj" },
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

describe("settings API base URL validation", () => {
  const servers: ReviewServerHandle[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function startSettingsServer(
    saveSettings: NonNullable<ReviewServerDependencies["saveSettings"]>,
  ): Promise<string> {
    const handle = await startReviewServer(
      {
        workspaceRoot: "/workspace",
        projectRoot: "/workspace/active",
        host: "127.0.0.1",
        port: 0,
      },
      fakeDeps({ saveSettings }),
    );
    servers.push(handle);
    return `http://127.0.0.1:${handle.port}`;
  }

  it.each([
    { stepBaseUrl: "https://api.stepfun.com/v1" },
    { stepBaseUrl: "https://api.stepfun.com/v1/" },
    { deepseekBaseUrl: "https://api.deepseek.com" },
    { deepseekBaseUrl: "https://api.deepseek.com/" },
  ])("accepts an official HTTPS base URL: %j", async (settings) => {
    const saveSettings = vi.fn(() => Promise.resolve(SAMPLE_VIEW));
    const url = await startSettingsServer(saveSettings);

    const response = await fetch(`${url}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    expect(response.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledWith(settings);
  });

  it.each([
    { stepBaseUrl: "http://api.stepfun.com/v1" },
    { stepBaseUrl: "https://api.stepfun.com.evil.example/v1" },
    { stepBaseUrl: "https://attacker@api.stepfun.com/v1" },
    { stepBaseUrl: "https://api.stepfun.com:8443/v1" },
    { stepBaseUrl: "https://api.stepfun.com/v2" },
    { deepseekBaseUrl: "http://api.deepseek.com" },
    { deepseekBaseUrl: "https://api.deepseek.com.evil.example" },
    { deepseekBaseUrl: "https://attacker@api.deepseek.com" },
    { deepseekBaseUrl: "https://api.deepseek.com:8443" },
    { deepseekBaseUrl: "https://api.deepseek.com/v1" },
  ])("rejects a non-official or ambiguous base URL: %j", async (settings) => {
    const saveSettings = vi.fn(() => Promise.resolve(SAMPLE_VIEW));
    const url = await startSettingsServer(saveSettings);

    const response = await fetch(`${url}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, stepApiKey: "never-leak-this-key" }),
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(body).not.toContain("never-leak-this-key");
  });
});
