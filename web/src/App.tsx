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
import { Settings } from "lucide-react";
import { ErrorView } from "./components/ErrorView.js";
import { LandingView } from "./components/LandingView.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import type { ActionErrorInfo } from "./components/ActionError.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; hint?: string; code: string }
  | { kind: "success"; project: ReviewProjectView };

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
        // No project yet → show LandingView so the user can upload a script.
        if (err.code === "not_found") {
          setShowLanding(true);
          return;
        }
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
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLanding, setShowLanding] = useState(false);
  const [flowStep, setFlowStep] = useState<string | null>(null);

  // Set initial active scene when project loads
  useEffect(() => {
    if (state.kind === "success" && !activeSceneId) {
      const firstScene = state.project.scenes[0];
      if (firstScene) {
        setActiveSceneId(firstScene.id);
      }
    }
  }, [state, activeSceneId]);

  const handleSelectScene = useCallback(
    (sceneId: string) => {
      setActiveSceneId(sceneId);
      setActionError(null);
    },
    [],
  );

  const handleTokenSubmit = useCallback((newToken: string) => {
    saveSessionToken(newToken);
    setToken(newToken);
  }, []);

  // Sync project state after mutation
  const syncFromProject = useCallback(
    (project: ReviewProjectView) => {
      setState({ kind: "success", project });
    },
    [],
  );

  // --- Mutation: search scene (multi-source, server auto-selects providers) ---
  const handleSearchScene = useCallback(async () => {
    if (!client || !activeSceneId) return;
    setActionError(null);
    setBusyAction("search");
    try {
      const project = await client.searchScene(activeSceneId, {
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

  // --- F4: one-click create → plan → search ---
  const handleCreate = useCallback(
    async (input: { content: string; fileName?: string; title?: string }) => {
      if (!client) return;
      setActionError(null);
      setBusyAction("search");
      setFlowStep("创建项目中…");
      try {
        const createInput: {
          content: string;
          force: boolean;
          fileName?: string;
          title?: string;
        } = { content: input.content, force: true };
        if (input.fileName !== undefined) createInput.fileName = input.fileName;
        if (input.title !== undefined) createInput.title = input.title;
        await client.createProject(createInput);
        // Planner: prefer settings, default fixture (no key needed).
        let plannerProvider: "fixture" | "deepseek" | "stepfun" = "fixture";
        try {
          const settings = await client.getSettings();
          if (
            settings.plannerProvider === "deepseek" ||
            settings.plannerProvider === "stepfun"
          ) {
            plannerProvider = settings.plannerProvider;
          }
        } catch {
          /* fall back to fixture */
        }
        setFlowStep("正在用 LLM 切片成场景…");
        await client.planProject({ provider: plannerProvider, maxScenes: 12, force: true });
        // Search: multi-source aggregation (server auto-selects all configured providers).
        setFlowStep("正在搜索素材候选…");
        const project = await client.searchProject({ limit: 12 });
        syncFromProject(project);
        setShowLanding(false);
      } catch (err) {
        setActionError(toActionError(err));
      } finally {
        setBusyAction(null);
        setFlowStep(null);
      }
    },
    [client, syncFromProject],
  );

  const handleDismissError = useCallback(() => {
    setActionError(null);
  }, []);

  if (showLanding) {
    return (
      <>
        <main className="app">
          <header className="topbar">
            <div className="brand">
              <div className="mark">S2S</div>
              <strong>Speech-to-Scene</strong>
            </div>
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() => setShowSettings(true)}
                title="配置 API Key"
              >
                <Settings size={14} />
                设置
              </button>
            </div>
          </header>
          <LandingView
            onCreate={(input) => void handleCreate(input)}
            busy={busyAction !== null}
            flowStep={flowStep}
            error={actionError}
          />
        </main>
        {client && showSettings && (
          <SettingsPanel client={client} onClose={() => setShowSettings(false)} />
        )}
      </>
    );
  }

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
      <TopBar
        project={project}
        error={null}
        onSettings={() => setShowSettings(true)}
        onReset={() => {
          if (
            window.confirm("重新上传文稿会覆盖当前项目，确定继续？")
          ) {
            setShowLanding(true);
          }
        }}
      />
      <section className="layout">
        <SceneList
          scenes={project.scenes}
          activeSceneId={activeSceneId}
          onSelect={handleSelectScene}
        />
        {activeScene && (
          <SceneDetail
            scene={activeScene}
            onSearchScene={() => void handleSearchScene()}
            busyAction={busyAction}
            actionError={actionError}
            onDismissError={handleDismissError}
          />
        )}
      </section>
      {client && showSettings && (
        <SettingsPanel client={client} onClose={() => setShowSettings(false)} />
      )}
    </main>
  );
}
