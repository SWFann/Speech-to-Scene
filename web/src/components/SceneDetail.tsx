import { Search, SkipForward, CheckCircle } from "lucide-react";

import type { ReviewSceneView } from "../types.js";
import { CandidateGrid } from "./CandidateGrid.js";
import { ActionError, type ActionErrorInfo } from "./ActionError.js";
import { RightsWarningDialog } from "./RightsWarningDialog.js";

export type BusyAction = "select" | "skip" | "search" | "upload" | null;

interface SceneDetailProps {
  scene: ReviewSceneView;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onSelectCandidateAction: (candidateId: string) => void;
  onSkipScene: () => void;
  onSearchScene: () => void;
  busyAction: BusyAction;
  actionError: ActionErrorInfo | null;
  rightsWarning: { message: string; hint?: string } | null;
  onRightsConfirm: () => void;
  onRightsCancel: () => void;
  onDismissError: () => void;
}

export function SceneDetail({
  scene,
  selectedCandidateId,
  onSelectCandidate,
  onSelectCandidateAction,
  onSkipScene,
  onSearchScene,
  busyAction,
  actionError,
  rightsWarning,
  onRightsConfirm,
  onRightsCancel,
  onDismissError,
}: SceneDetailProps): React.ReactElement {
  const selectDisabled = !selectedCandidateId || busyAction !== null;
  const searchDisabled = busyAction !== null;
  const skipDisabled = busyAction !== null;

  return (
    <section className="column workspace">
      <div className="column-header">
        <div>
          <h2>场景 {String(scene.order).padStart(2, "0")} / 候选素材</h2>
          <p>选择候选、跳过场景或重新检索</p>
        </div>
        {scene.search.lastSearchedAt && (
          <span className="status-pill">检索于 {scene.search.lastSearchedAt.slice(0, 10)}</span>
        )}
      </div>
      <div className="workspace-body">
        {/* Action error banner */}
        {actionError && <ActionError error={actionError} onDismiss={onDismissError} />}

        {/* Rights warning dialog (409 conflict) */}
        {rightsWarning && (
          <RightsWarningDialog
            message={rightsWarning.message}
            {...(rightsWarning.hint ? { hint: rightsWarning.hint } : {})}
            onConfirm={onRightsConfirm}
            onCancel={onRightsCancel}
            busy={busyAction === "select"}
          />
        )}

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
          <div className="action-buttons">
            <button
              className="btn primary"
              onClick={() => {
                if (selectedCandidateId) onSelectCandidateAction(selectedCandidateId);
              }}
              disabled={selectDisabled}
              title={selectedCandidateId ? "确认选择当前候选" : "请先点击一个候选素材"}
              type="button"
              data-testid="select-candidate-btn"
            >
              <CheckCircle size={14} />
              {busyAction === "select" ? "选择中…" : "选择候选"}
            </button>
            <button
              className="btn"
              onClick={onSearchScene}
              disabled={searchDisabled}
              type="button"
              data-testid="search-scene-btn"
            >
              <Search size={14} />
              {busyAction === "search" ? "检索中…" : "重新检索"}
            </button>
            <button
              className="btn"
              onClick={onSkipScene}
              disabled={skipDisabled}
              type="button"
              data-testid="skip-scene-btn"
            >
              <SkipForward size={14} />
              {busyAction === "skip" ? "跳过中…" : "跳过场景"}
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
