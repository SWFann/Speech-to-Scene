import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoutes, matchRoute } from "../../src/review/router.js";
import type { ReviewServerDependencies } from "../../src/review/review-types.js";
import type { ReviewServerHandle } from "../../src/review/review-types.js";
import { startReviewServer } from "../../src/review/review-server.js";
import { ProjectAlreadyExistsError } from "../../src/shared/errors.js";

function fakeDeps(overrides: Partial<ReviewServerDependencies> = {}): ReviewServerDependencies {
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
  return { ...base, ...overrides } as unknown as ReviewServerDependencies;
}

describe("project lifecycle routes", () => {
  const cfg = {
    workspaceRoot: "/workspace",
    projectRootRef: { current: "/proj" },
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

describe("project lifecycle API safety", () => {
  const servers: ReviewServerHandle[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function startLifecycleServer(
    overrides: Partial<ReviewServerDependencies> = {},
  ): Promise<{ url: string }> {
    const deps = fakeDeps({
      listProjects: () =>
        Promise.resolve({
          projects: [
            {
              name: "active",
              path: "active",
              hasProject: true,
              title: "Active",
              sceneCount: 0,
              updatedAt: "2026-07-23T00:00:00.000Z",
            },
            {
              name: "other",
              path: "other",
              hasProject: true,
              title: "Other",
              sceneCount: 0,
              updatedAt: "2026-07-22T00:00:00.000Z",
            },
          ],
        }),
      ...overrides,
    });
    const handle = await startReviewServer(
      {
        workspaceRoot: "/workspace",
        projectRoot: "/workspace/active",
        host: "127.0.0.1",
        port: 0,
      },
      deps,
    );
    servers.push(handle);
    return { url: `http://127.0.0.1:${handle.port}` };
  }

  it("returns 409 and never requests overwrite when a named project already exists", async () => {
    let createInput: Record<string, unknown> | undefined;
    const { url } = await startLifecycleServer({
      createProjectFromContent: (input) => {
        createInput = input as Record<string, unknown>;
        throw new ProjectAlreadyExistsError("/workspace/existing");
      },
    });

    const response = await fetch(`${url}/api/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "script",
        title: "Existing",
        projectName: "existing",
        force: false,
      }),
    });

    expect(response.status).toBe(409);
    expect(createInput).toMatchObject({
      projectDirectory: "/workspace/existing",
      force: false,
    });
  });

  it("rejects force=true on the create API before invoking the use case", async () => {
    const createProjectFromContent = vi.fn();
    const { url } = await startLifecycleServer({ createProjectFromContent });

    const response = await fetch(`${url}/api/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "script",
        projectName: "existing",
        force: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(createProjectFromContent).not.toHaveBeenCalled();
  });

  it("deletes a named non-active project without changing the active project", async () => {
    const deleteProject = vi.fn(() => Promise.resolve({ ok: true as const, deleted: "other" }));
    const { url } = await startLifecycleServer({ deleteProject });

    const response = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: "other", confirm: "other" }),
    });
    const listResponse = await fetch(`${url}/api/projects`);
    const listBody = (await listResponse.json()) as { activeProject: string | null };

    expect(response.status).toBe(200);
    expect(deleteProject).toHaveBeenCalledWith({
      workspaceRoot: "/workspace",
      projectName: "other",
      confirm: "other",
    });
    expect(listBody.activeProject).toBe("active");
  });

  it("clears the active project only when that named project is deleted", async () => {
    const deleteProject = vi.fn(() => Promise.resolve({ ok: true as const, deleted: "active" }));
    const { url } = await startLifecycleServer({ deleteProject });

    const response = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: "active", confirm: "active" }),
    });
    const listResponse = await fetch(`${url}/api/projects`);
    const listBody = (await listResponse.json()) as { activeProject: string | null };

    expect(response.status).toBe(200);
    expect(listBody.activeProject).toBeNull();
  });

  it("requires projectName in a delete request", async () => {
    const deleteProject = vi.fn();
    const { url } = await startLifecycleServer({ deleteProject });

    const response = await fetch(`${url}/api/project`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "active" }),
    });

    expect(response.status).toBe(400);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("keeps the active project when loading a switched project fails", async () => {
    const { url } = await startLifecycleServer({
      switchProject: () => Promise.resolve({ projectRoot: "/workspace/broken", project: "broken" }),
      getReviewProject: (projectRoot) => {
        if (projectRoot === "/workspace/broken") {
          return Promise.reject(new Error("corrupt project"));
        }
        return Promise.resolve({ project: { id: "p", scenes: [] } } as never);
      },
    });

    const response = await fetch(`${url}/api/project/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "broken" }),
    });
    const listResponse = await fetch(`${url}/api/projects`);
    const listBody = (await listResponse.json()) as { activeProject: string | null };

    expect(response.status).toBe(500);
    expect(listBody.activeProject).toBe("active");
  });

  it("keeps the active project when loading a newly created project fails", async () => {
    const { url } = await startLifecycleServer({
      createProjectFromContent: () =>
        Promise.resolve({
          projectId: "new",
          title: "Broken",
          status: "created",
          projectRoot: "/workspace/broken",
          scriptPath: "/workspace/broken/script.md",
          createdAt: "2026-07-23T00:00:00.000Z",
        }),
      getReviewProject: (projectRoot) => {
        if (projectRoot === "/workspace/broken") {
          return Promise.reject(new Error("corrupt project"));
        }
        return Promise.resolve({ project: { id: "p", scenes: [] } } as never);
      },
    });

    const response = await fetch(`${url}/api/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "script",
        projectName: "broken",
        force: false,
      }),
    });
    const listResponse = await fetch(`${url}/api/projects`);
    const listBody = (await listResponse.json()) as { activeProject: string | null };

    expect(response.status).toBe(500);
    expect(listBody.activeProject).toBe("active");
  });
});
