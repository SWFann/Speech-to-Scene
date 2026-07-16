import { Search, SkipForward } from "lucide-react";

import type { ReviewSceneView } from "../types.js";
import { CandidateGrid } from "./CandidateGrid.js";

interface SceneDetailProps {
  scene: ReviewSceneView;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}

export function SceneDetail({
  scene,
  selectedCandidateId,
  onSelectCandidate,
}: SceneDetailProps): React.ReactElement {
  return (
    <section className="column workspace">
      <div className="column-header">
        <div>
          <h2>场景 {String(scene.order).padStart(2, "0")} / 候选素材</h2>
          <p>当前为只读预览；写操作将在下一任务接入</p>
        </div>
        {scene.search.lastSearchedAt && (
          <span className="status-pill">检索于 {scene.search.lastSearchedAt.slice(0, 10)}</span>
        )}
      </div>
      <div className="workspace-body">
        {/* Source excerpt */}
        <section className="script-strip">
          <div className="eyebrow">原文片段 {scene.sourceAnchor.sourceBlockIds.join(", ")}</div>
          <blockquote>{scene.text}</blockquote>
        </section>

        {/* Visual plan */}
        <section className="visual-plan">
          <h3>视觉规划</h3>
          <div className="visual-plan-grid">
            <span className="label">视觉决策</span>
            <span className="value">{scene.visualPlan.decision}</span>
            <span className="label">叙事角色</span>
            <span className="value">{scene.narrativeRole}</span>
            <span className="label">推荐媒体</span>
            <span className="value">{scene.visualPlan.preferredMedia.join(", ")}</span>
            <span className="label">理由</span>
            <span className="value">{scene.visualPlan.rationale}</span>
          </div>
          <div className="visual-keywords">
            {scene.visualPlan.visualKeywords.map((kw, i) => (
              <span key={i} className="tag">
                {kw}
              </span>
            ))}
          </div>
        </section>

        {/* Search queries (read-only) */}
        <section className="query-section">
          <h3>搜索词（只读）</h3>
          {scene.search.queries.map((q) => (
            <div key={q.id} className="query-item">
              <input type="text" value={q.query} readOnly aria-label={`搜索词 ${q.id}`} />
              <span className="query-lang">{q.language}</span>
              <span className="tag">{q.enabled ? "启用" : "停用"}</span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
            }}
          >
            <button className="btn" disabled title="下一任务接入">
              <Search size={14} />
              重新检索
            </button>
            <button className="btn" disabled title="下一任务接入">
              <SkipForward size={14} />
              跳过场景
            </button>
          </div>
        </section>

        {/* Candidate grid */}
        <div className="candidate-toolbar">
          <h2>推荐候选</h2>
          <span>
            {scene.search.candidateCount > 0
              ? `共 ${scene.search.candidateCount} 个候选`
              : "暂无候选"}
          </span>
        </div>
        <CandidateGrid
          candidates={scene.search.candidates}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={onSelectCandidate}
        />
      </div>
    </section>
  );
}
