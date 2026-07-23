import { useCallback, useEffect, useMemo, useState } from "react";

import { type ReviewApiClient, createClientFromEnv, ReviewApiError } from "./api/review-api.js";
import type { ReviewProjectView, ProjectListItem } from "./types.js";
import { TopBar } from "./components/TopBar.js";
import { SceneList } from "./components/SceneList.js";
import { SceneDetail, type BusyAction } from "./components/SceneDetail.js";
import { Settings } from "lucide-react";
import { ErrorView } from "./components/ErrorView.js";
import { LandingView } from "./components/LandingView.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ProjectListView } from "./components/ProjectListView.js";
import type { ActionErrorInfo } from "./components/ActionError.js";

type View = "project-list" | "landing" | "review";

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
  const [view, setView] = useState<View>("review");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [projects, setProjects] = useState<readonly ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectListError, setProjectListError] = useState<ActionErrorInfo | null>(null);

  const client = useMemo<ReviewApiClient>(() => createClientFromEnv(), []);

  // --- Load project list (Phase 3) ---
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectListError(null);
    try {
      const result = await client.listProjects();
      setProjects(result.projects);
      setActiveProject(result.activeProject);
    } catch (err) {
      setProjectListError(toActionError(err));
    } finally {
      setProjectsLoading(false);
    }
  }, [client]);

  // --- Load active project ---
  const loadProject = useCallback(async () => {
    setState({ kind: "loading" });

    try {
      const project = await client.getProject();
      setState({ kind: "success", project });
    } catch (err) {
      if (err instanceof ReviewApiError) {
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

  useEffect(() => {
    if (state.kind !== "success") return;
    const sceneStillExists = state.project.scenes.some((scene) => scene.id === activeSceneId);
    if (!sceneStillExists) {
      setActiveSceneId(state.project.scenes[0]?.id ?? null);
    }
  }, [state, activeSceneId]);

  const handleSelectScene = useCallback((sceneId: string) => {
    setActiveSceneId(sceneId);
    setActionError(null);
  }, []);

  const syncFromProject = useCallback((project: ReviewProjectView) => {
    setState({ kind: "success", project });
  }, []);

  const handleSearchScene = useCallback(async () => {
    if (!activeSceneId) return;
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

  const handleGenerateImage = useCallback(
    async (prompt: string) => {
      if (!activeSceneId) return;
      setActionError(null);
      setBusyAction("generate");
      try {
        const project = await client.generateSceneImage(activeSceneId, { prompt });
        syncFromProject(project);
      } catch (err) {
        setActionError(toActionError(err));
      } finally {
        setBusyAction(null);
      }
    },
    [client, activeSceneId, syncFromProject],
  );

  const handleCreate = useCallback(
    async (input: {
      content: string;
      projectName: string;
      fileName?: string;
      title?: string;
      aspectRatio: "9:16" | "16:9" | "1:1";
      style: "knowledge" | "story" | "commentary";
    }) => {
      setActionError(null);
      setBusyAction("search");
      setFlowStep("创建项目中…");
      try {
        const createInput: {
          content: string;
          projectName: string;
          force: false;
          fileName?: string;
          title?: string;
          aspectRatio: "9:16" | "16:9" | "1:1";
          style: "knowledge" | "story" | "commentary";
        } = {
          content: input.content,
          projectName: input.projectName,
          force: false,
          aspectRatio: input.aspectRatio,
          style: input.style,
        };
        if (input.fileName !== undefined) createInput.fileName = input.fileName;
        if (input.title !== undefined) createInput.title = input.title;
        await client.createProject(createInput);
        const settings = await client.getSettings();
        let plannerProvider: "fixture" | "deepseek" | "stepfun" =
          settings.plannerProvider === "stepfun" || settings.plannerProvider === "deepseek"
            ? settings.plannerProvider
            : "fixture";
        if (plannerProvider === "fixture" && settings.hasStepKey) {
          plannerProvider = "stepfun";
        } else if (plannerProvider === "fixture" && settings.hasDeepseekKey) {
          plannerProvider = "deepseek";
        }
        setFlowStep("正在用 LLM 切片成场景…");
        await client.planProject({ provider: plannerProvider, maxScenes: 12, force: true });
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

  // --- Phase 3: switch to a different project ---
  const handleSwitchProject = useCallback(
    async (projectName: string) => {
      setProjectListError(null);
      try {
        await client.switchProject(projectName);
        await loadProject();
        setView("review");
      } catch (err) {
        setProjectListError(toActionError(err));
      }
    },
    [client, loadProject],
  );

  // --- Phase 3: delete a project ---
  const handleDeleteProject = useCallback(
    async (projectName: string) => {
      setProjectListError(null);
      try {
        await client.deleteProject(projectName);
        await loadProjects();
        // If the deleted project was active, load a fresh project view
        if (projectName === activeProject) {
          await loadProject();
        }
      } catch (err) {
        setProjectListError(toActionError(err));
      }
    },
    [client, loadProjects, loadProject, activeProject],
  );

  const handleDismissError = useCallback(() => {
    setActionError(null);
  }, []);

  const handleDismissProjectListError = useCallback(() => {
    setProjectListError(null);
  }, []);

  // --- Project list view ---
  if (view === "project-list") {
    return (
      <ProjectListView
        projects={projects}
        activeProject={activeProject}
        onSwitch={(name) => void handleSwitchProject(name)}
        onCreate={() => {
          setShowLanding(true);
          setView("landing");
        }}
        onDelete={(name) => void handleDeleteProject(name)}
        loading={projectsLoading}
        error={projectListError}
        onDismissError={handleDismissProjectListError}
      />
    );
  }

  // --- Landing view (upload script) ---
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
                onClick={() => {
                  setShowLanding(false);
                  setView("project-list");
                  void loadProjects();
                }}
                title="返回项目列表"
              >
                项目列表
              </button>
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
        {showSettings && <SettingsPanel client={client} onClose={() => setShowSettings(false)} />}
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
        onRetry={() => void loadProject()}
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
          setShowLanding(true);
        }}
        onProjectList={() => {
          setView("project-list");
          void loadProjects();
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
            onGenerateImage={(prompt) => void handleGenerateImage(prompt)}
            busyAction={busyAction}
            actionError={actionError}
            onDismissError={handleDismissError}
            scenePosition={{
              current: project.scenes.findIndex((scene) => scene.id === activeScene.id) + 1,
              total: project.scenes.length,
              onPrevious: () => {
                const index = project.scenes.findIndex((scene) => scene.id === activeScene.id);
                const previous = project.scenes[index - 1];
                if (previous) handleSelectScene(previous.id);
              },
              onNext: () => {
                const index = project.scenes.findIndex((scene) => scene.id === activeScene.id);
                const next = project.scenes[index + 1];
                if (next) handleSelectScene(next.id);
              },
            }}
          />
        )}
      </section>
      {showSettings && <SettingsPanel client={client} onClose={() => setShowSettings(false)} />}
    </main>
  );
}
