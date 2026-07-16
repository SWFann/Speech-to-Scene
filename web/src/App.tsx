import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ReviewApiClient,
  ReviewApiError,
  resolveSessionToken,
  saveSessionToken,
  resolveBaseUrl,
} from "./api/review-api.js";
import type { ReviewProjectView } from "./types.js";
import { TopBar } from "./components/TopBar.js";
import { SceneList } from "./components/SceneList.js";
import { SceneDetail } from "./components/SceneDetail.js";
import { Inspector } from "./components/Inspector.js";
import { ErrorView } from "./components/ErrorView.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; hint?: string; code: string }
  | { kind: "success"; project: ReviewProjectView };

export function App(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [token, setToken] = useState<string | null>(() => resolveSessionToken());

  const client = useMemo<ReviewApiClient | null>(() => {
    if (!token) return null;
    return new ReviewApiClient({
      baseUrl: resolveBaseUrl(),
      token,
    });
  }, [token]);

  const loadProject = useCallback(async () => {
    if (!client) {
      setState({
        kind: "error",
        message: "未提供 session token",
        hint: "请从 CLI 输出中复制 token，或在 URL 中添加 ?token=<your-token>",
        code: "session_required",
      });
      return;
    }

    setState({ kind: "loading" });

    try {
      const project = await client.getProject();
      setState({ kind: "success", project });
    } catch (err) {
      if (err instanceof ReviewApiError) {
        setState({
          kind: "error",
          message: err.message,
          hint: err.hint,
          code: err.code,
        });
      } else {
        setState({
          kind: "error",
          message: "发生未知错误",
          hint: "请检查本地 Review Server 是否正常运行",
          code: "unknown",
        });
      }
    }
  }, [client]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // Set initial active scene when project loads
  useEffect(() => {
    if (state.kind === "success" && !activeSceneId) {
      const firstScene = state.project.scenes[0];
      if (firstScene) {
        setActiveSceneId(firstScene.id);
        // If scene has a selected candidate, set it
        if (firstScene.review.kind === "candidate_selected") {
          setSelectedCandidateId(firstScene.review.selection.candidate.id);
        } else {
          setSelectedCandidateId(null);
        }
      }
    }
  }, [state, activeSceneId]);

  const handleSelectScene = useCallback((sceneId: string) => {
    setActiveSceneId(sceneId);
    setSelectedCandidateId(null);
  }, []);

  const handleSelectCandidate = useCallback((candidateId: string) => {
    setSelectedCandidateId(candidateId);
  }, []);

  const handleTokenSubmit = useCallback((newToken: string) => {
    saveSessionToken(newToken);
    setToken(newToken);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="loading-view">
        <p>正在加载项目数据…</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <ErrorView
        message={state.message}
        hint={state.hint}
        code={state.code}
        onRetry={() => void loadProject()}
        onTokenSubmit={
          state.code === "session_required" || state.code === "session_rejected"
            ? handleTokenSubmit
            : undefined
        }
      />
    );
  }

  const project = state.project;
  const activeScene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  return (
    <main className="app">
      <TopBar project={project} error={null} />
      <section className="layout">
        <SceneList
          scenes={project.scenes}
          activeSceneId={activeSceneId}
          onSelect={handleSelectScene}
        />
        {activeScene && (
          <>
            <SceneDetail
              scene={activeScene}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={handleSelectCandidate}
            />
            <Inspector scene={activeScene} />
          </>
        )}
      </section>
    </main>
  );
}
