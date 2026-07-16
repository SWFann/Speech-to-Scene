import { CheckCircle, AlertCircle, Settings } from "lucide-react";

import type { ReviewProjectView } from "../types.js";

interface TopBarProps {
  project: ReviewProjectView | null;
  error: string | null;
}

export function TopBar({ project, error }: TopBarProps): React.ReactElement {
  const title = project?.project.title ?? "Speech-to-Scene";
  const sceneCount = project?.sceneCount ?? 0;
  const producingCount = project?.producingSceneCount ?? 0;
  const processedCount = producingCount;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="mark">S2S</div>
        <strong>Speech-to-Scene</strong>
      </div>
      <div className="project-meta">
        <span>{title}</span>
        {project && (
          <span className="status-pill ok">
            {processedCount} / {sceneCount} 场景已处理
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
        <button className="btn" disabled title="下一任务接入">
          <Settings size={14} />
          验证项目
        </button>
        <button className="btn primary" disabled title="下一任务接入">
          保存决策
        </button>
      </div>
    </header>
  );
}
