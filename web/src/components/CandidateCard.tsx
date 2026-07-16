import { ImageIcon, Video, ExternalLink } from "lucide-react";

import type { ReviewAssetCandidateView } from "../types.js";

interface CandidateCardProps {
  candidate: ReviewAssetCandidateView;
  isSelected: boolean;
  onSelect: () => void;
}

function rightsBadge(label: string, value: string): { text: string; cls: string } | null {
  const v = value.toLowerCase();
  if (v === "allowed" || v === "yes" || v === "permitted") {
    return { text: label, cls: "allow" };
  }
  if (v === "restricted" || v === "unknown" || v === "unclear") {
    return { text: `${label}受限`, cls: "warn" };
  }
  if (v === "forbidden" || v === "no" || v === "denied") {
    return { text: `${label}禁止`, cls: "warn" };
  }
  return null;
}

export function CandidateCard({
  candidate,
  isSelected,
  onSelect,
}: CandidateCardProps): React.ReactElement {
  const rights = candidate.rights;
  const badges: { text: string; cls: string }[] = [];

  if (rights.attributionRequired) {
    badges.push({ text: "需署名", cls: "warn" });
  } else {
    badges.push({ text: "无需署名", cls: "allow" });
  }

  const commercial = rightsBadge("可商用", rights.commercialUse);
  if (commercial) badges.push(commercial);

  const derivatives = rightsBadge("可修改", rights.derivatives);
  if (derivatives) badges.push(derivatives);

  return (
    <article
      className={`candidate ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="thumb">
        {candidate.thumbnailUrl ? (
          <img
            src={candidate.thumbnailUrl}
            alt={`来自 ${candidate.provider.name} 的${candidate.mediaType === "video" ? "视频" : "图片"}候选`}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="thumb-placeholder">
            {candidate.mediaType === "video" ? <Video size={32} /> : <ImageIcon size={32} />}
          </div>
        )}
        <span className="media-type">{candidate.mediaType === "video" ? "Video" : "Photo"}</span>
      </div>
      <div className="candidate-body">
        <div className="candidate-title">
          <strong>
            {candidate.width}×{candidate.height}
            {candidate.durationSeconds ? ` · ${candidate.durationSeconds}s` : ""}
          </strong>
          {isSelected && <span className="tag blue">已选择</span>}
        </div>
        <p>
          {candidate.orientation} · 排名 #{candidate.rank}
        </p>
        <div className="candidate-creator">
          {candidate.creator.name && <span>作者: {candidate.creator.name}</span>}
          {" · "}
          <a
            href={candidate.sourcePageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
            原始页面
          </a>
        </div>
        <div className="rights">
          <span className="allow">{rights.status}</span>
          {badges.map((b, i) => (
            <span key={i} className={b.cls}>
              {b.text}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
