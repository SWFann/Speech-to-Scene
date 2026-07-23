// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { App } from "../../../web/src/App.js";
import type { ProjectApiResponse } from "../../../web/src/types.js";
import { createMinimalProject } from "../../fixtures/web-test-data.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function createFetchMock(handlers: Array<(url: string, init?: RequestInit) => MockResponse>): void {
  let callIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit): Promise<MockResponse> => {
      const handler = handlers[Math.min(callIndex, handlers.length - 1)]!;
      callIndex++;
      return Promise.resolve(handler(url, init));
    }),
  );
}

function successResponse(project: ProjectApiResponse): MockResponse {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(project),
  };
}

function errorResponse(status: number, body: unknown): MockResponse {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("App — search flow integration", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    store.set("s2s:session-token", "test-token");
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
    });
    vi.stubGlobal("location", {
      origin: "http://127.0.0.1:3210",
      search: "",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. search scene — calls POST /api/scenes/:sceneId/search with refresh/limit", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: POST /api/scenes/scene-001/search
      (url, init) => {
        expect(url).toBe("http://127.0.0.1:3210/api/scenes/scene-001/search");
        const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
        expect(body.refresh).toBe(true);
        expect(body.limit).toBe(12);
        // providers is omitted when not specified
        expect(body.providers).toBeUndefined();
        // No forbidden fields
        expect(body.projectRoot).toBeUndefined();
        expect(body.sceneId).toBeUndefined();
        return successResponse(initialResponse);
      },
    ]);

    render(<App />);

    // Wait for project to load and scene detail to render
    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    // Click search button
    fireEvent.click(screen.getByTestId("search-scene-btn"));

    // Verify fetch was called twice (GET project + POST search)
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  it("2. action error is shown when search mutation fails", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: POST search → 500 error
      () =>
        errorResponse(500, {
          ok: false,
          error: { code: "internal_error", message: "Internal server error" },
        }),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    // Click search
    fireEvent.click(screen.getByTestId("search-scene-btn"));

    // Should show action error
    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeDefined();
    });
  });

  it("3. action error can be dismissed", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      () => successResponse(initialResponse),
      () =>
        errorResponse(500, {
          ok: false,
          error: { code: "internal_error", message: "Internal server error" },
        }),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("search-scene-btn"));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeDefined();
    });

    // Dismiss the error
    fireEvent.click(screen.getByLabelText("关闭错误提示"));

    // Error should be gone
    await waitFor(() => {
      expect(screen.queryByTestId("action-error")).toBeNull();
    });
  });

  it("4. search button shows loading state during search", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    // Use a controllable promise so we can observe the loading state before
    // the search response resolves.
    let resolveSearch!: (value: MockResponse) => void;
    const searchPromise = new Promise<MockResponse>((resolve) => {
      resolveSearch = resolve;
    });

    let callIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((): Promise<MockResponse> => {
        callIndex++;
        if (callIndex === 1) {
          return Promise.resolve(successResponse(initialResponse));
        }
        return searchPromise;
      }),
    );

    render(<App />);

    // Wait for project to load and scene detail (with search button) to render
    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    // Before clicking, button shows default text
    expect(screen.getByText("搜索素材")).toBeDefined();

    // Click search — this triggers the pending search request
    fireEvent.click(screen.getByTestId("search-scene-btn"));

    // While the request is in-flight, the button shows loading text and is disabled
    await waitFor(() => {
      expect(screen.getByText("检索中…")).toBeDefined();
    });
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(true);

    // Now resolve the search request
    resolveSearch(successResponse(initialResponse));

    // After resolution, loading text is gone and button is enabled again
    await waitFor(() => {
      expect(screen.getByText("搜索素材")).toBeDefined();
    });
    expect(screen.getByTestId<HTMLButtonElement>("search-scene-btn").disabled).toBe(false);
  });

  it("5. selecting a different scene clears action error", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      () => successResponse(initialResponse),
      () =>
        errorResponse(500, {
          ok: false,
          error: { code: "internal_error", message: "Internal server error" },
        }),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    // Trigger an error on scene-001
    fireEvent.click(screen.getByTestId("search-scene-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeDefined();
    });

    // Select scene-002 by clicking its summary
    fireEvent.click(screen.getByText("场景二摘要"));

    // The action error should be cleared
    await waitFor(() => {
      expect(screen.queryByTestId("action-error")).toBeNull();
    });
  });

  it("6. creates a named project without force-overwriting an existing directory", async () => {
    const project = createMinimalProject();
    const projectResponse: ProjectApiResponse = { ok: true, project };
    let createBody: Record<string, unknown> | undefined;

    createFetchMock([
      () =>
        errorResponse(404, {
          ok: false,
          error: { code: "not_found", message: "No active project" },
        }),
      (_url, init) => {
        createBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return successResponse(projectResponse);
      },
      () => ({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            settings: { plannerProvider: "fixture" },
          }),
      }),
      () => successResponse(projectResponse),
      () => successResponse(projectResponse),
    ]);

    render(<App />);

    const titleInput = await screen.findByPlaceholderText("项目标题（可选，默认用文件名）");
    fireEvent.change(titleInput, { target: { value: "Active Recall Notes" } });
    fireEvent.change(screen.getByPlaceholderText("或在此粘贴口播文稿…"), {
      target: { value: "A script worth turning into scenes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    await waitFor(() => {
      expect(createBody).toBeDefined();
    });
    expect(createBody).toMatchObject({
      title: "Active Recall Notes",
      force: false,
    });
    expect(createBody?.projectName).toMatch(/^active-recall-notes-[a-z0-9]+$/);
    expect(createBody?.projectName).not.toBe("default");
  });
});
