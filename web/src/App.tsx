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
import { SceneDetail, type BusyAction } from "./components/SceneDetail.js";
import { Inspector } from "./components/Inspector.js";
import { ErrorView } from "./components/ErrorView.js";
import type { ActionErrorInfo } from "./components/ActionError.js";
import type { UploadProvenance } from "./components/LocalAssetUpload.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; hint?: string; code: string }
  | { kind: "success"; project: ReviewProjectView };

function selectedCandidateIdForScene(scene: ReviewProjectView["scenes"][number]): string | null {
  return scene.review.kind === "candidate_selected" ? scene.review.selection.candidate.id : null;
}

function isRightsAcknowledgementConflict(err: ReviewApiError): boolean {
  if (err.code !== "conflict") return false;
  const text = `${err.message} ${err.hint ?? ""}`.toLowerCase();
  return (
    text.includes("rights") ||
    text.includes("acknowledg") ||
    text.includes("权利") ||
    text.includes("许可") ||
    text.includes("确认")
  );
}

/** Map a ReviewApiError to a UI-safe ActionErrorInfo without leaking token/path/stack. */
function toActionError(err: unknown): ActionErrorInfo {
  if (err instanceof ReviewApiError) {
    return {
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
      code: err.code,
    };
  }
  return {
    message: "发生未知错误",
    code: "unknown",
  };
}

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
          ...(err.hint ? { hint: err.hint } : {}),
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
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);
  const [rightsWarning, setRightsWarning] = useState<{
    message: string;
    hint?: string;
    candidateId: string;
    sceneId: string;
  } | null>(null);

  // Set initial active scene when project loads
  useEffect(() => {
    if (state.kind === "success" && !activeSceneId) {
      const firstScene = state.project.scenes[0];
      if (firstScene) {
        setActiveSceneId(firstScene.id);
        // If scene has a selected candidate, set it
        setSelectedCandidateId(selectedCandidateIdForScene(firstScene));
      }
    }
  }, [state, activeSceneId]);

  const handleSelectScene = useCallback(
    (sceneId: string) => {
      setActiveSceneId(sceneId);
      setActionError(null);
      setRightsWarning(null);
      if (state.kind === "success") {
        const scene = state.project.scenes.find((s) => s.id === sceneId);
        setSelectedCandidateId(scene ? selectedCandidateIdForScene(scene) : null);
      } else {
        setSelectedCandidateId(null);
      }
    },
    [state],
  );

  const handleSelectCandidate = useCallback((candidateId: string) => {
    setSelectedCandidateId(candidateId);
  }, []);

  const handleTokenSubmit = useCallback((newToken: string) => {
    saveSessionToken(newToken);
    setToken(newToken);
  }, []);

  // Sync selectedCandidateId from backend project state after mutation
  const syncFromProject = useCallback(
    (project: ReviewProjectView) => {
      setState({ kind: "success", project });
      // Keep active scene selected
      if (activeSceneId) {
        const updatedScene = project.scenes.find((s) => s.id === activeSceneId);
        if (updatedScene) {
          setSelectedCandidateId(selectedCandidateIdForScene(updatedScene));
        }
      }
    },
    [activeSceneId],
  );

  // --- Mutation: select candidate ---
  const handleSelectCandidateAction = useCallback(
    async (candidateId: string) => {
      if (!client || !activeSceneId) return;
      setActionError(null);
      setRightsWarning(null);
      setBusyAction("select");
      try {
        const project = await client.selectCandidate(activeSceneId, {
          candidateId,
          rightsAcknowledged: false,
        });
        syncFromProject(project);
      } catch (err) {
        if (err instanceof ReviewApiError && isRightsAcknowledgementConflict(err)) {
          // Rights acknowledgement conflicts can be retried after explicit confirmation.
          setRightsWarning({
            message: err.message || "当前候选需要确认权利许可",
            ...(err.hint ? { hint: err.hint } : {}),
            candidateId,
            sceneId: activeSceneId,
          });
        } else {
          setActionError(toActionError(err));
        }
      } finally {
        setBusyAction(null);
      }
    },
    [client, activeSceneId, syncFromProject],
  );

  // Retry select candidate with rightsAcknowledged=true after 409
  const handleRightsConfirm = useCallback(async () => {
    if (!client || !rightsWarning) return;
    setBusyAction("select");
    try {
      const project = await client.selectCandidate(rightsWarning.sceneId, {
        candidateId: rightsWarning.candidateId,
        rightsAcknowledged: true,
      });
      setRightsWarning(null);
      syncFromProject(project);
    } catch (err) {
      setRightsWarning(null);
      setActionError(toActionError(err));
    } finally {
      setBusyAction(null);
    }
  }, [client, rightsWarning, syncFromProject]);

  const handleRightsCancel = useCallback(() => {
    setRightsWarning(null);
  }, []);

  // --- Mutation: skip scene ---
  const handleSkipScene = useCallback(async () => {
    if (!client || !activeSceneId) return;
    setActionError(null);
    setRightsWarning(null);
    setBusyAction("skip");
    try {
      const project = await client.skipScene(activeSceneId);
      syncFromProject(project);
    } catch (err) {
      setActionError(toActionError(err));
    } finally {
      setBusyAction(null);
    }
  }, [client, activeSceneId, syncFromProject]);

  // --- Mutation: search scene ---
  const handleSearchScene = useCallback(async () => {
    if (!client || !activeSceneId) return;
    setActionError(null);
    setRightsWarning(null);
    setBusyAction("search");
    try {
      const project = await client.searchScene(activeSceneId, {
        provider: "fixture",
        refresh: true,
        limit: 12,
      });
      syncFromProject(project);
    } catch (err) {
      setActionError(toActionError(err));
    } finally {
      setBusyAction(null);
    }
  }, [client, activeSceneId, syncFromProject]);

  // --- Mutation: upload local asset ---
  const handleUploadLocalAsset = useCallback(
    async (input: { file: File; provenance: UploadProvenance }) => {
      if (!client || !activeSceneId) return;
      setActionError(null);
      setRightsWarning(null);
      setBusyAction("upload");
      try {
        const project = await client.uploadLocalAsset(activeSceneId, input);
        syncFromProject(project);
      } catch (err) {
        setActionError(toActionError(err));
      } finally {
        setBusyAction(null);
      }
    },
    [client, activeSceneId, syncFromProject],
  );

  const handleDismissError = useCallback(() => {
    setActionError(null);
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
        {...(state.hint ? { hint: state.hint } : {})}
        code={state.code}
        onRetry={() => void loadProject()}
        {...(state.code === "session_required" || state.code === "session_rejected"
          ? { onTokenSubmit: handleTokenSubmit }
          : {})}
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
              onSelectCandidateAction={(id) => void handleSelectCandidateAction(id)}
              onSkipScene={() => void handleSkipScene()}
              onSearchScene={() => void handleSearchScene()}
              busyAction={busyAction}
              actionError={actionError}
              rightsWarning={
                rightsWarning
                  ? {
                      message: rightsWarning.message,
                      ...(rightsWarning.hint ? { hint: rightsWarning.hint } : {}),
                    }
                  : null
              }
              onRightsConfirm={() => void handleRightsConfirm()}
              onRightsCancel={handleRightsCancel}
              onDismissError={handleDismissError}
            />
            <Inspector
              scene={activeScene}
              onUploadLocalAsset={(input) => void handleUploadLocalAsset(input)}
              uploadBusy={busyAction === "upload"}
            />
          </>
        )}
      </section>
    </main>
  );
}
