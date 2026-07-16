import { Upload, ExternalLink, ShieldAlert } from "lucide-react";

import type { ReviewSceneView, ReviewLocalAssetView } from "../types.js";

interface InspectorProps {
  scene: ReviewSceneView;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function provenanceLabel(asset: ReviewLocalAssetView): string {
  const provenance = asset.provenance;
  if (provenance.kind === "selected_candidate") {
    return `关联候选 ${provenance.candidateId}`;
  }
  if (provenance.kind === "user_owned") {
    return "用户自有素材";
  }
  if (provenance.kind === "external") {
    return "外部导入素材";
  }
  return "未知来源";
}

export function Inspector({ scene }: InspectorProps): React.ReactElement {
  const review = scene.review;
  const localAsset =
    review.kind === "candidate_selected"
      ? review.localAsset
      : review.kind === "local_asset_attached"
        ? review.localAsset
        : undefined;

  const selectedCandidate =
    review.kind === "candidate_selected" ? review.selection.candidate : null;

  return (
    <aside className="column inspector">
      <div className="column-header">
        <div>
          <h2>决策与证据</h2>
          <p>发布前仍需回到原始页面复核</p>
        </div>
      </div>
      <div className="inspector-body">
        {/* Review decision status */}
        <section className="decision-box">
          <h3>当前状态</h3>
          <div className="decision-row">
            <span className="label">审核状态</span>
            <span className="value">{review.kind}</span>
          </div>
          {review.kind === "skipped" && (
            <div className="decision-row">
              <span className="label">跳过时间</span>
              <span className="value">{review.decidedAt.slice(0, 19)}</span>
            </div>
          )}
          {review.kind === "candidate_selected" && (
            <div className="decision-row">
              <span className="label">选择时间</span>
              <span className="value">{review.selection.selectedAt.slice(0, 19)}</span>
            </div>
          )}
          {"note" in review && review.note && (
            <div className="decision-row">
              <span className="label">备注</span>
              <span className="value">{review.note}</span>
            </div>
          )}
        </section>

        {/* Selected candidate evidence */}
        {selectedCandidate && (
          <section className="decision-box">
            <h3>当前选择</h3>
            <div className="decision-row">
              <span className="label">候选 ID</span>
              <span className="value">{selectedCandidate.id}</span>
            </div>
            <div className="decision-row">
              <span className="label">提供方</span>
              <span className="value">{selectedCandidate.provider.name}</span>
            </div>
            <div className="decision-row">
              <span className="label">作者</span>
              <span className="value">{selectedCandidate.creator.name ?? "未知"}</span>
            </div>
            <div className="decision-row">
              <span className="label">来源</span>
              <span className="value">
                <a href={selectedCandidate.sourcePageUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} />
                  原始页面
                </a>
              </span>
            </div>
          </section>
        )}

        {/* Rights snapshot */}
        {selectedCandidate && (
          <section className="decision-box">
            <h3>许可快照</h3>
            <div className="decision-row">
              <span className="label">状态</span>
              <span className="value">{selectedCandidate.rights.status}</span>
            </div>
            {selectedCandidate.rights.licenseCode && (
              <div className="decision-row">
                <span className="label">许可证</span>
                <span className="value">{selectedCandidate.rights.licenseCode}</span>
              </div>
            )}
            <div className="decision-row">
              <span className="label">商用</span>
              <span className="value">{selectedCandidate.rights.commercialUse}</span>
            </div>
            <div className="decision-row">
              <span className="label">修改</span>
              <span className="value">{selectedCandidate.rights.derivatives}</span>
            </div>
            <div className="decision-row">
              <span className="label">署名</span>
              <span className="value">
                {selectedCandidate.rights.attributionRequired ? "需要" : "不需要"}
              </span>
            </div>
            <div className="notice">
              <ShieldAlert size={14} style={{ verticalAlign: "-2px" }} />{" "}
              工具只记录检索时证据；最终发布前应打开原始页面确认条款与素材状态。
            </div>
          </section>
        )}

        {/* Local asset */}
        <section className="decision-box">
          <h3>本地素材关联</h3>
          {localAsset ? (
            <div className="local-asset-info">
              <div className="decision-row">
                <span className="label">路径</span>
                <span className="value">{localAsset.relativePath}</span>
              </div>
              <div className="decision-row">
                <span className="label">类型</span>
                <span className="value">{localAsset.mimeType}</span>
              </div>
              <div className="decision-row">
                <span className="label">大小</span>
                <span className="value">{formatBytes(localAsset.sizeBytes)}</span>
              </div>
              <div className="decision-row">
                <span className="label">SHA-256</span>
                <span className="value">{shortHash(localAsset.sha256)}…</span>
              </div>
              <div className="decision-row">
                <span className="label">来源</span>
                <span className="value">{provenanceLabel(localAsset)}</span>
              </div>
              <div className="decision-row">
                <span className="label">导入时间</span>
                <span className="value">{localAsset.importedAt.slice(0, 19)}</span>
              </div>
            </div>
          ) : (
            <div className="attach-zone">
              <div>
                <strong>
                  <Upload size={16} style={{ verticalAlign: "-2px" }} /> 导入已手动下载的文件
                </strong>
                <span>下一任务接入</span>
              </div>
            </div>
          )}
          <div className="footer-note">
            工具记录来源证据，不替用户作法律保证。发布前请复核原始页面。
          </div>
        </section>
      </div>
    </aside>
  );
}
