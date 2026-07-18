import { describe, expect, it } from "vitest";

import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";

function fakeDeps(): ReviewServerDependencies {
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
    getSettings: () => ({
      plannerProvider: "fixture",
      hasDeepseekKey: false,
      hasStepKey: false,
      hasPexelsKey: false,
      deepseekBaseUrl: "",
      deepseekModel: "",
      stepBaseUrl: "",
      stepModel: "",
      pexelsBaseUrl: "",
      pexelsVideoBaseUrl: "",
    }),
    saveSettings: () => ({
      plannerProvider: "fixture",
      hasDeepseekKey: false,
      hasStepKey: false,
      hasPexelsKey: false,
      deepseekBaseUrl: "",
      deepseekModel: "",
      stepBaseUrl: "",
      stepModel: "",
      pexelsBaseUrl: "",
      pexelsVideoBaseUrl: "",
    }),
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
    // Phase 3: multi-project deps
    listProjects: () => ({ projects: [] }),
    switchProject: () => ({ projectRoot: "/workspace/demo", project: "demo" }),
    deleteProject: () => ({ ok: true, deleted: "demo" }),
  };
  return base as unknown as ReviewServerDependencies;
}

describe("project lifecycle routes", () => {
  const cfg = {
    workspaceRoot: "/workspace", projectRootRef: { current: "/proj" },
    host: "127.0.0.1",
    getBoundPort: () => 3210,
    version: "v",
  };

  it("registers POST /api/project/create when deps wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/create")).toBeDefined();
  });

  it("registers POST /api/project/plan when deps wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/plan")).toBeDefined();
  });

  it("registers POST /api/project/search when deps wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/search")).toBeDefined();
  });

  it("does NOT register lifecycle routes when deps absent", () => {
    const routes = createRoutes(cfg);
    expect(matchRoute(routes, "POST", "/api/project/create")).toBeUndefined();
    expect(matchRoute(routes, "POST", "/api/project/plan")).toBeUndefined();
    expect(matchRoute(routes, "POST", "/api/project/search")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Phase 3: multi-project routes
  // -----------------------------------------------------------------------

  it("registers GET /api/projects when listProjects dep is wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "GET", "/api/projects")).toBeDefined();
  });

  it("registers POST /api/project/switch when switchProject dep is wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "POST", "/api/project/switch")).toBeDefined();
  });

  it("registers DELETE /api/project when deleteProject dep is wired", () => {
    const routes = createRoutes({ ...cfg, deps: fakeDeps() });
    expect(matchRoute(routes, "DELETE", "/api/project")).toBeDefined();
  });

  it("does NOT register Phase 3 routes when deps absent", () => {
    const routes = createRoutes(cfg);
    expect(matchRoute(routes, "GET", "/api/projects")).toBeUndefined();
    expect(matchRoute(routes, "POST", "/api/project/switch")).toBeUndefined();
    expect(matchRoute(routes, "DELETE", "/api/project")).toBeUndefined();
  });
});
