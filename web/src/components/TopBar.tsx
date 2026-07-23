import { AlertCircle, Settings, Plus, FolderOpen } from "lucide-react";

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

  return (
    <header className="topbar">
      <div className="brand">
        <div className="mark">S2S</div>
        <strong>Speech-to-Scene</strong>
      </div>
      <div className="project-meta">
        {onProjectList && (
          <button className="btn" type="button" onClick={onProjectList} title="查看所有项目">
            <FolderOpen size={14} />
            项目列表
          </button>
        )}
        <strong className="project-title">{title}</strong>
        {project && (
          <span className="status-pill ok">
            {searchedCount} / {sceneCount} 已有素材
          </span>
        )}
        {error && (
          <span className="status-pill">
            <AlertCircle size={14} />
            连接异常
          </span>
        )}
      </div>
      <div className="actions">
        {onReset && (
          <button className="btn" type="button" onClick={onReset} title="创建新项目">
            <Plus size={14} />
            新建
          </button>
        )}
        {onSettings && (
          <button className="btn" type="button" onClick={onSettings} title="配置 API Key">
            <Settings size={14} />
            设置
          </button>
        )}
      </div>
    </header>
  );
}
