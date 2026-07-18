import { Search, Sparkles, X } from "lucide-react";
import { useState, useEffect } from "react";

import type { ReviewSceneView } from "../types.js";
import { CandidateGrid } from "./CandidateGrid.js";
import { ActionError, type ActionErrorInfo } from "./ActionError.js";

export type BusyAction = "search" | "generate" | null;

interface SceneDetailProps {
  scene: ReviewSceneView;
  onSearchScene: () => void;
  onGenerateImage: (prompt: string) => void;
  busyAction: BusyAction;
  actionError: ActionErrorInfo | null;
  onDismissError: () => void;
}

/** Build a default generation prompt from the scene's summary and keywords. */
function buildDefaultPrompt(scene: ReviewSceneView): string {
  const parts: string[] = [scene.summary];
  const keywords = scene.visualPlan.visualKeywords.slice(0, 3);
  parts.push(...keywords);
  return parts.join("，");
}

export function SceneDetail({
  scene,
  onSearchScene,
  onGenerateImage,
  busyAction,
  actionError,
  onDismissError,
}: SceneDetailProps): React.ReactElement {
  const searchDisabled = busyAction !== null;
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptText, setPromptText] = useState("");

  // Reset prompt text when scene changes
  useEffect(() => {
    setPromptText(buildDefaultPrompt(scene));
  }, [scene.id, scene.summary, scene.visualPlan.visualKeywords]);

  const handleOpenEditor = (): void => {
    setPromptText(buildDefaultPrompt(scene));
    setShowPromptEditor(true);
  };

  const handleConfirmGenerate = (): void => {
    const trimmed = promptText.trim();
    if (trimmed.length === 0) return;
    setShowPromptEditor(false);
    onGenerateImage(trimmed);
  };

  return (
    <section className="column workspace">
      <div className="column-header">
        <div>
          <h2>场景 {String(scene.order).padStart(2, "0")} / 素材候选</h2>
          <p>多源聚合搜索，结果仅供浏览参考</p>
        </div>
        {scene.search.lastSearchedAt && (
          <span className="status-pill">检索于 {scene.search.lastSearchedAt.slice(0, 10)}</span>
        )}
      </div>
      <div className="workspace-body">
        {/* Action error banner */}
        {actionError && <ActionError error={actionError} onDismiss={onDismissError} />}

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
              onClick={onSearchScene}
              disabled={searchDisabled}
              type="button"
              data-testid="search-scene-btn"
            >
              <Search size={14} />
              {busyAction === "search" ? "检索中…" : "搜索素材"}
            </button>
            <button
              className="btn"
              onClick={handleOpenEditor}
              disabled={searchDisabled}
              type="button"
              data-testid="generate-image-btn"
            >
              <Sparkles size={14} />
              {busyAction === "generate" ? "生成中…" : "生成图片"}
            </button>
          </div>
        </section>

        {/* Prompt editor modal */}
        {showPromptEditor && (
          <div className="prompt-editor-overlay" data-testid="prompt-editor">
            <div className="prompt-editor">
              <div className="prompt-editor-header">
                <h3>编辑生成 Prompt</h3>
                <button
                  className="btn-icon"
                  onClick={() => setShowPromptEditor(false)}
                  type="button"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <textarea
                className="prompt-textarea"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={4}
                autoFocus
                data-testid="prompt-textarea"
              />
              <div className="prompt-editor-actions">
                <button
                  className="btn"
                  onClick={() => setShowPromptEditor(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="btn primary"
                  onClick={handleConfirmGenerate}
                  type="button"
                  disabled={promptText.trim().length === 0}
                  data-testid="confirm-generate-btn"
                >
                  <Sparkles size={14} />
                  确认生成
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Candidate grid */}
        <div className="candidate-toolbar">
          <h2>推荐候选</h2>
          <span>
            {scene.search.candidateCount > 0
              ? `共 ${scene.search.candidateCount} 个候选`
              : "暂无候选"}
          </span>
        </div>
        <CandidateGrid candidates={scene.search.candidates} />
      </div>
    </section>
  );
}
