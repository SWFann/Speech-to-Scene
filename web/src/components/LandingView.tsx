import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";

interface LandingViewProps {
  onCreate: (input: { content: string; fileName?: string; title?: string }) => void;
  busy: boolean;
  error: { message: string; hint?: string } | null;
}

export function LandingView({ onCreate, busy, error }: LandingViewProps): React.ReactElement {
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("script.md");
  const [title, setTitle] = useState("");

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
        <Sparkles size={24} />
        <h1>Speech-to-Scene</h1>
        <p>上传或粘贴口播文稿，一键生成视觉场景与素材候选</p>
      </div>
      {error && (
        <div className="action-error">
          <strong>{error.message}</strong>
          {error.hint && <span>{error.hint}</span>}
        </div>
      )}
      <div className="landing-body">
        <label className="file-upload">
          <FileText size={16} />
          <input
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            onChange={handleFile}
            disabled={busy}
          />
          <span>{fileName || "选择 .md/.txt 文件"}</span>
        </label>
        <textarea
          className="script-input"
          placeholder="或在此粘贴口播文稿…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={busy}
          rows={12}
        />
        <input
          className="title-input"
          type="text"
          placeholder="项目标题（可选，默认用文件名）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
        <button
          className="btn primary"
          type="button"
          disabled={!canSubmit}
          onClick={() => void onCreate({ content, fileName, title })}
        >
          {busy ? "生成中…" : "一键生成"}
        </button>
      </div>
    </section>
  );
}
