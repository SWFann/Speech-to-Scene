import { useState, useRef } from "react";
import { Upload } from "lucide-react";

import type { ReviewSceneView } from "../types.js";

export type UploadProvenance =
  { kind: "user_owned" } | { kind: "selected_candidate"; candidateId: string };

interface LocalAssetUploadProps {
  scene: ReviewSceneView;
  onUpload: (input: { file: File; provenance: UploadProvenance }) => void;
  busy: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const ACCEPTED_TYPES = "image/png,image/jpeg";

export function LocalAssetUpload({
  scene,
  onUpload,
  busy,
}: LocalAssetUploadProps): React.ReactElement {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [provenanceKind, setProvenanceKind] = useState<"user_owned" | "selected_candidate">(
    "user_owned",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasSelectedCandidate = scene.review.kind === "candidate_selected";
  const selectedCandidateId =
    scene.review.kind === "candidate_selected" ? scene.review.selection.candidate.id : null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleUpload = (): void => {
    if (!selectedFile) return;
    const provenance: UploadProvenance =
      provenanceKind === "selected_candidate" && selectedCandidateId
        ? { kind: "selected_candidate", candidateId: selectedCandidateId }
        : { kind: "user_owned" };
    onUpload({ file: selectedFile, provenance });
  };

  return (
    <div className="local-asset-upload" data-testid="local-asset-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileChange}
        disabled={busy}
        aria-label="选择本地素材文件"
        data-testid="file-input"
      />
      {selectedFile && (
        <div className="selected-file-info">
          <span>{selectedFile.name}</span>
          <span className="file-size">{formatBytes(selectedFile.size)}</span>
        </div>
      )}
      <div className="provenance-select">
        <label className="provenance-label">来源类型</label>
        <select
          value={provenanceKind}
          onChange={(e) => setProvenanceKind(e.target.value as "user_owned" | "selected_candidate")}
          disabled={busy}
          aria-label="选择来源类型"
          data-testid="provenance-select"
        >
          <option value="user_owned">用户自有素材</option>
          {hasSelectedCandidate && selectedCandidateId && (
            <option value="selected_candidate">关联当前已选候选 ({selectedCandidateId})</option>
          )}
        </select>
      </div>
      <button
        className="btn primary"
        onClick={handleUpload}
        disabled={!selectedFile || busy}
        type="button"
        data-testid="upload-button"
      >
        <Upload size={14} />
        {busy ? "上传中…" : "上传"}
      </button>
    </div>
  );
}
