import { ChevronLeft, ChevronRight, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ReviewSceneView } from "../types.js";
import { ActionError, type ActionErrorInfo } from "./ActionError.js";
import { CandidateGrid } from "./CandidateGrid.js";

export type BusyAction = "search" | "generate" | null;

interface SceneDetailProps {
  scene: ReviewSceneView;
  onSearchScene: () => void;
  onGenerateImage: (prompt: string) => void;
  busyAction: BusyAction;
  actionError: ActionErrorInfo | null;
  onDismissError: () => void;
  scenePosition?: {
    current: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
  };
}

/** Mirrors the backend prompt structure so the user starts from a useful draft. */
function buildDefaultPrompt(scene: ReviewSceneView): string {
  const keywords = scene.visualPlan.visualKeywords.slice(0, 5).join(", ");
  const keywordClause = keywords ? `Key subjects: ${keywords}. ` : "";
  return (
    `Create a polished 9:16 vertical editorial image for a short-form knowledge video. ` +
    `Scene: ${scene.summary}. ${keywordClause}` +
    `Clear single focal subject, natural action, realistic environment, strong foreground-background separation, ` +
    `cinematic natural light, credible details, mobile-safe composition. ` +
    `No text, subtitles, logos, watermarks, UI, collage, distorted hands, or duplicated objects.`
  ).slice(0, 512);
}

export function SceneDetail({
  scene,
  onSearchScene,
  onGenerateImage,
  busyAction,
  actionError,
  onDismissError,
  scenePosition,
}: SceneDetailProps): React.ReactElement {
  const actionsDisabled = busyAction !== null;
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptText, setPromptText] = useState("");

  useEffect(() => {
    setPromptText(buildDefaultPrompt(scene));
  }, [scene.id, scene.summary, scene.visualPlan.visualKeywords]);

  const handleOpenEditor = (): void => {
    setPromptText(buildDefaultPrompt(scene));
    setShowPromptEditor(true);
  };

  const handleConfirmGenerate = (): void => {
    const trimmed = promptText.trim();
    if (trimmed.length === 0 || trimmed.length > 512) return;
    setShowPromptEditor(false);
    onGenerateImage(trimmed);
  };

  return (
    <section className="column workspace">
      <div className="column-header scene-heading">
        <div>
          <span className="eyebrow">当前场景</span>
          <h2>{scene.summary}</h2>
        </div>
        {scenePosition && (
          <div className="scene-navigation">
            <button
              className="btn-icon"
              type="button"
              onClick={scenePosition.onPrevious}
              disabled={scenePosition.current <= 1}
              aria-label="上一个场景"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {scenePosition.current} / {scenePosition.total}
            </span>
            <button
              className="btn-icon"
              type="button"
              onClick={scenePosition.onNext}
              disabled={scenePosition.current >= scenePosition.total}
              aria-label="下一个场景"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="workspace-body">
        {actionError && <ActionError error={actionError} onDismiss={onDismissError} />}

        <section className="script-strip">
          <div className="eyebrow">这段口播需要配画面</div>
          <blockquote>{scene.text}</blockquote>
        </section>

        <section className="scene-actions">
          <div>
            <h3>选择下一步</h3>
            <p>先看推荐素材；不满意就重新搜索，或让 AI 生成一张更贴合的图。</p>
          </div>
          <div className="action-buttons">
            <button
              className="btn primary"
              onClick={onSearchScene}
              disabled={actionsDisabled}
              type="button"
              data-testid="search-scene-btn"
            >
              <Search size={15} />
              {busyAction === "search" ? "检索中…" : "重新找素材"}
            </button>
            <button
              className="btn"
              onClick={handleOpenEditor}
              disabled={actionsDisabled}
              type="button"
              data-testid="generate-image-btn"
            >
              <Sparkles size={15} />
              {busyAction === "generate" ? "生成中…" : "AI 生成图片"}
            </button>
          </div>
        </section>

        <div className="candidate-toolbar">
          <div>
            <h2>优先推荐</h2>
            <span>可直接查看来源或下载</span>
          </div>
          <strong>
            {scene.search.candidateCount > 0
              ? `${scene.search.candidateCount} 个可用素材`
              : "暂无候选"}
          </strong>
        </div>
        <CandidateGrid candidates={scene.search.candidates} />

        <details className="planning-details">
          <summary>查看 AI 的画面分析与搜索词</summary>
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
              {scene.visualPlan.visualKeywords.map((keyword) => (
                <span key={keyword} className="tag">
                  {keyword}
                </span>
              ))}
            </div>
          </section>
          <section className="query-section">
            <h3>搜索词（只读）</h3>
            {scene.search.queries.map((query) => (
              <div key={query.id} className="query-item">
                <input type="text" value={query.query} readOnly aria-label={`搜索词 ${query.id}`} />
                <span className="query-lang">{query.language}</span>
                <span className="tag">{query.enabled ? "启用" : "停用"}</span>
              </div>
            ))}
          </section>
        </details>
      </div>

      {showPromptEditor && (
        <div className="prompt-editor-overlay" data-testid="prompt-editor">
          <div className="prompt-editor" role="dialog" aria-modal="true">
            <div className="prompt-editor-header">
              <div>
                <h3>生成这张画面</h3>
                <p>已经替你写好描述。只有想微调时再修改。</p>
              </div>
              <button
                className="btn-icon"
                onClick={() => setShowPromptEditor(false)}
                type="button"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              className="prompt-textarea"
              value={promptText}
              onChange={(event) => setPromptText(event.target.value.slice(0, 512))}
              rows={7}
              autoFocus
              data-testid="prompt-textarea"
            />
            <div className="prompt-limit">{promptText.length} / 512</div>
            <div className="prompt-editor-actions">
              <button className="btn" onClick={() => setShowPromptEditor(false)} type="button">
                取消
              </button>
              <button
                className="btn primary"
                onClick={handleConfirmGenerate}
                type="button"
                disabled={promptText.trim().length === 0 || promptText.length > 512}
                data-testid="confirm-generate-btn"
              >
                <Sparkles size={15} />
                确认生成
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
