import { CheckCircle, AlertCircle, Settings, Upload, FolderOpen } from "lucide-react";

import type { ReviewProjectView } from "../types.js";

interface TopBarProps {
  project: ReviewProjectView | null;
  error: string | null;
  onSettings?: () => void;
  /** Re-open the upload/landing view to replace the script (force-overwrite). */
  onReset?: () => void;
  /** Phase 3: navigate to project list view. */
  onProjectList?: () => void;
}

/**
 * Detect whether the project was planned or searched using the fixture
 * test stub (fake scenes / gray thumbnails).
 */
function isFixtureProject(project: ReviewProjectView | null): boolean {
  if (!project) return false;
  if (project.generation?.plannerProvider === "fixture") return true;
  return project.scenes.some((s) =>
    s.search.candidates.some((c) => c.kind === "asset" && c.provider.id === "fixture"),
  );
}

export function TopBar({
  project,
  error,
  onSettings,
  onReset,
  onProjectList,
}: TopBarProps): React.ReactElement {
  const title = project?.project.title ?? "Speech-to-Scene";
  const sceneCount = project?.sceneCount ?? 0;
  const searchedCount = project?.searchedSceneCount ?? 0;
  const fixtureMode = isFixtureProject(project);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="mark">S2S</div>
        <strong>Speech-to-Scene</strong>
      </div>
      <div className="project-meta">
        {onProjectList && (
          <button
            className="btn"
            type="button"
            onClick={onProjectList}
            title="查看所有项目"
          >
            <FolderOpen size={14} />
            项目列表
          </button>
        )}
        <span>{title}</span>
        {project && (
          <span className="status-pill ok">
            {searchedCount} / {sceneCount} 场景已搜索
          </span>
        )}
        {error && (
          <span className="status-pill">
            <AlertCircle size={14} />
            连接异常
          </span>
        )}
        {project && (
          <span className="status-pill">
            <CheckCircle size={14} />
            已连接
          </span>
        )}
      </div>
      <div className="actions">
        {onReset && (
          <button
            className="btn"
            type="button"
            onClick={onReset}
            title="重新上传文稿（会覆盖当前项目）"
          >
            <Upload size={14} />
            重新上传
          </button>
        )}
        {onSettings && (
          <button className="btn" type="button" onClick={onSettings} title="配置 API Key">
            <Settings size={14} />
            设置
          </button>
        )}
      </div>
      {fixtureMode && (
        <div className="fixture-banner">
          当前使用 Fixture 测试模式（场景或素材为模拟数据）。请在「设置」中配置 StepFun / DeepSeek 和 Pexels API Key，然后点「重新上传」使用真实数据生成。
        </div>
      )}
    </header>
  );
}
