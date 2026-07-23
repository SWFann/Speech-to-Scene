import { useState } from "react";
import { FileText, Sparkles, WandSparkles } from "lucide-react";

interface LandingViewProps {
  onCreate: (input: {
    content: string;
    projectName: string;
    fileName?: string;
    title?: string;
    aspectRatio: "9:16" | "16:9" | "1:1";
    style: "knowledge" | "story" | "commentary";
  }) => void;
  busy: boolean;
  /** Current one-click flow step label, or null when idle. */
  flowStep: string | null;
  error: { message: string; hint?: string } | null;
}

export function deriveProjectName(title: string, fileName: string): string {
  const fileStem = fileName.replace(/\.[^.]+$/, "");
  const source = title.trim() || fileStem.trim() || "project";
  const slug = source
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const safePrefix = Array.from(slug || "project")
    .slice(0, 48)
    .join("");
  const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${safePrefix}-${uniqueSuffix}`;
}

export function LandingView({
  onCreate,
  busy,
  flowStep,
  error,
}: LandingViewProps): React.ReactElement {
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("script.md");
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [style, setStyle] = useState<"knowledge" | "story" | "commentary">("knowledge");

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    void file.text().then((text) => setContent(text));
  };

  const canSubmit = content.trim().length > 0 && !busy;

  return (
    <section className="landing">
      <div className="landing-header">
        <div className="landing-mark">
          <WandSparkles size={22} />
        </div>
        <h1>把口播稿变成可拍、可找、可生成的画面清单</h1>
        <p>不需要理解模型或提示词。放入文稿，系统会自动拆场景并优先返回可用素材。</p>
      </div>
      <ol className="flow-guide" aria-label="制作步骤">
        <li className="active">1. 放入口播稿</li>
        <li>2. 选择成片方向</li>
        <li>3. 自动拆场景并找素材</li>
      </ol>
      {flowStep && (
        <div className="flow-step">
          <span className="spinner" />
          <span>{flowStep}</span>
        </div>
      )}
      {error && (
        <div className="action-error">
          <strong>{error.message}</strong>
          {error.hint && <span>{error.hint}</span>}
        </div>
      )}
      <div className="landing-body">
        <div className="script-compose">
          <div className="compose-heading">
            <div>
              <strong>口播稿</strong>
              <span>{content.trim().length} 字</span>
            </div>
            <label className="file-upload">
              <FileText size={15} />
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                onChange={handleFile}
                disabled={busy}
              />
              <span>读取文件</span>
            </label>
          </div>
          <textarea
            className="script-input"
            placeholder="粘贴你的口播稿，保留原本的段落即可"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            rows={13}
          />
        </div>
        <div className="project-options">
          <label>
            <span>项目标题</span>
            <input
              className="title-input"
              type="text"
              placeholder="例如：主动回忆笔记"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span>成片画幅</span>
            <select
              aria-label="成片画幅"
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value as "9:16" | "16:9" | "1:1")}
              disabled={busy}
            >
              <option value="9:16">竖屏 9:16（短视频）</option>
              <option value="16:9">横屏 16:9</option>
              <option value="1:1">方形 1:1</option>
            </select>
          </label>
          <label>
            <span>内容风格</span>
            <select
              aria-label="内容风格"
              value={style}
              onChange={(event) =>
                setStyle(event.target.value as "knowledge" | "story" | "commentary")
              }
              disabled={busy}
            >
              <option value="knowledge">知识讲解</option>
              <option value="story">故事叙述</option>
              <option value="commentary">观点评论</option>
            </select>
          </label>
        </div>
        <button
          className="btn primary landing-submit"
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            void onCreate({
              content,
              fileName,
              title,
              aspectRatio,
              style,
              projectName: deriveProjectName(title, fileName),
            })
          }
        >
          <Sparkles size={16} />
          {busy ? "正在制作…" : "开始制作"}
        </button>
        <p className="landing-footnote">创建新项目，不会覆盖已有项目。API Key 只保存在这台电脑。</p>
      </div>
    </section>
  );
}
