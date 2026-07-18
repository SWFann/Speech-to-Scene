import type { ReviewSceneView, SceneStatusValue } from "../types.js";

interface SceneListProps {
  scenes: readonly ReviewSceneView[];
  activeSceneId: string | null;
  onSelect: (sceneId: string) => void;
}

function statusLabel(status: SceneStatusValue): string {
  switch (status) {
    case "pending":
      return "待搜索";
    case "candidates_ready":
      return "已搜索";
    default:
      return status;
  }
}

function statusTagClass(status: SceneStatusValue): string {
  switch (status) {
    case "candidates_ready":
      return "tag blue";
    default:
      return "tag";
  }
}

export function SceneList({ scenes, activeSceneId, onSelect }: SceneListProps): React.ReactElement {
  return (
    <aside className="column scenes">
      <div className="column-header">
        <div>
          <h2>语义场景</h2>
          <p>按表达功能分段，不按句子机械切分</p>
        </div>
        <span className="status-pill">{scenes.length}</span>
      </div>
      <div className="scene-list">
        {scenes.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const isDone = scene.status === "candidates_ready";
          return (
            <article
              key={scene.id}
              className={`scene-row ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
              onClick={() => onSelect(scene.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(scene.id);
                }
              }}
            >
              <div className="scene-number">{String(scene.order).padStart(2, "0")}</div>
              <div>
                <h3>{scene.summary}</h3>
                <p>{scene.text}</p>
                <div className="scene-tags">
                  <span className={statusTagClass(scene.status)}>{statusLabel(scene.status)}</span>
                  {scene.visualPlan.decision !== "speaker_only" && (
                    <span className="tag">{scene.visualPlan.decision}</span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
