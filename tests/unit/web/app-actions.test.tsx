// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { App } from "../../../web/src/App.js";
import type { ProjectApiResponse } from "../../../web/src/types.js";
import {
  createMinimalProject,
  createProjectWithSelectedCandidate,
} from "../../fixtures/web-test-data.js";

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

describe("App — mutation integration", () => {
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

  it("1. skip scene — GET project, then PUT skip, page shows updated state", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    // After skip, the scene should be skipped
    const skippedProject: ProjectApiResponse = {
      ok: true,
      project: {
        ...initialProject,
        scenes: [
          {
            ...initialProject.scenes[0]!,
            review: {
              kind: "skipped",
              decidedAt: "2026-07-16T13:00:00.000Z",
            },
            status: "skipped",
          },
          ...initialProject.scenes.slice(1),
        ],
        sceneStatuses: [
          { sceneId: "scene-001", sceneOrder: 1, status: "skipped" },
          ...initialProject.sceneStatuses.slice(1),
        ],
        producingSceneCount: 1,
      },
    };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: PUT /api/scenes/scene-001/skip
      (url) => {
        expect(url).toContain("/api/scenes/scene-001/skip");
        return successResponse(skippedProject);
      },
    ]);

    render(<App />);

    // Wait for project to load and scene detail to render
    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByTestId("skip-scene-btn")).toBeDefined();
    });

    // Click skip button
    const skipBtn = screen.getByTestId("skip-scene-btn");
    fireEvent.click(skipBtn);

    // After skip, the scene should show "skipped" status
    await waitFor(() => {
      expect(screen.getByText("已跳过")).toBeDefined();
    });

    // Verify fetch was called twice
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("2. select candidate — success shows selected candidate in Inspector", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    // After selection, the scene should have candidate_selected
    const selectedProject: ProjectApiResponse = {
      ok: true,
      project: createProjectWithSelectedCandidate(),
    };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: PUT /api/scenes/scene-001/selection
      (url, init) => {
        expect(url).toContain("/api/scenes/scene-001/selection");
        const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
        expect(body.candidateId).toBe("candidate-001");
        expect(body.rightsAcknowledged).toBe(false);
        return successResponse(selectedProject);
      },
    ]);

    render(<App />);

    // Wait for project to load and candidates to render
    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByText(/1920/)).toBeDefined();
    });

    // Click a candidate card to select it locally
    const candidateCard = screen.getByText(/1920/).closest("article");
    expect(candidateCard).not.toBeNull();
    if (candidateCard) {
      fireEvent.click(candidateCard);
    }

    // Click the select candidate button
    const selectBtn = screen.getByTestId<HTMLButtonElement>("select-candidate-btn");
    expect(selectBtn.disabled).toBe(false);
    fireEvent.click(selectBtn);

    // After selection, Inspector should show the selected candidate
    await waitFor(() => {
      expect(screen.getByText("当前选择")).toBeDefined();
    });

    // Verify fetch was called twice
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("3. select candidate 409 conflict — shows rights warning dialog", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: PUT /api/scenes/scene-001/selection → 409 conflict
      () =>
        errorResponse(409, {
          ok: false,
          error: {
            code: "conflict",
            message: "Candidate requires rights acknowledgement",
            hint: "Confirm and retry",
          },
        }),
    ]);

    render(<App />);

    // Wait for project to load and candidates to render
    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByText(/1920/)).toBeDefined();
    });

    // Select a candidate locally
    const candidateCard = screen.getByText(/1920/).closest("article");
    if (candidateCard) {
      fireEvent.click(candidateCard);
    }

    // Click select candidate
    const selectBtn = screen.getByTestId("select-candidate-btn");
    fireEvent.click(selectBtn);

    // Should show rights warning dialog
    await waitFor(() => {
      expect(screen.getByTestId("rights-dialog")).toBeDefined();
      expect(screen.getByText("Candidate requires rights acknowledgement")).toBeDefined();
    });
  });

  it("3b. select candidate non-rights 409 conflict — shows action error, not rights dialog", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      () => successResponse(initialResponse),
      () =>
        errorResponse(409, {
          ok: false,
          error: {
            code: "conflict",
            message: "Candidate not found: candidate-001 in scene scene-001",
            hint: "候选素材不存在于当前场景的搜索结果中",
          },
        }),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByText(/1920/)).toBeDefined();
    });

    const candidateCard = screen.getByText(/1920/).closest("article");
    if (candidateCard) {
      fireEvent.click(candidateCard);
    }

    fireEvent.click(screen.getByTestId("select-candidate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeDefined();
    });
    expect(screen.queryByTestId("rights-dialog")).toBeNull();
  });

  it("3c. selecting a scene with existing selection syncs candidate highlight", async () => {
    const baseProject = createMinimalProject();
    const candidate = baseProject.scenes[0]!.search.candidates[0]!;
    const projectWithSecondSceneSelected: ProjectApiResponse = {
      ok: true,
      project: {
        ...baseProject,
        scenes: [
          baseProject.scenes[0]!,
          {
            ...baseProject.scenes[0]!,
            id: "scene-002",
            order: 2,
            summary: "场景二摘要",
            text: "这是第二个场景的原文。",
            review: {
              kind: "candidate_selected",
              selection: {
                selectedAt: "2026-07-16T12:00:00.000Z",
                candidate,
              },
            },
            status: "selected",
          },
        ],
      },
    };

    createFetchMock([() => successResponse(projectWithSecondSceneSelected)]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("场景二摘要")).toBeDefined();
    });

    fireEvent.click(screen.getByText("场景二摘要"));

    await waitFor(() => {
      const selectedCard = document.querySelector(".candidate.selected");
      expect(selectedCard).not.toBeNull();
    });
    expect(screen.getByTestId<HTMLButtonElement>("select-candidate-btn").disabled).toBe(false);
  });

  it("4. search scene — calls POST /api/scenes/:sceneId/search", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: POST /api/scenes/scene-001/search
      (url, init) => {
        expect(url).toContain("/api/scenes/scene-001/search");
        const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
        expect(body.provider).toBe("fixture");
        return successResponse(initialResponse);
      },
    ]);

    render(<App />);

    // Wait for project to load and scene detail to render
    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByTestId("search-scene-btn")).toBeDefined();
    });

    // Click search button
    const searchBtn = screen.getByTestId("search-scene-btn");
    fireEvent.click(searchBtn);

    // Verify fetch was called twice
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  it("5. action error is shown when mutation fails with non-conflict error", async () => {
    const initialProject = createMinimalProject();
    const initialResponse: ProjectApiResponse = { ok: true, project: initialProject };

    createFetchMock([
      // 1st call: GET /api/project
      () => successResponse(initialResponse),
      // 2nd call: PUT skip → 500 error
      () =>
        errorResponse(500, {
          ok: false,
          error: { code: "internal_error", message: "Internal server error" },
        }),
    ]);

    render(<App />);

    // Wait for project to load and scene detail to render
    await waitFor(() => {
      expect(screen.getByText("场景一摘要")).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByTestId("skip-scene-btn")).toBeDefined();
    });

    // Click skip
    const skipBtn = screen.getByTestId("skip-scene-btn");
    fireEvent.click(skipBtn);

    // Should show action error
    await waitFor(() => {
      expect(screen.getByTestId("action-error")).toBeDefined();
    });
  });
});
