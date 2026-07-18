import { ImageIcon, Video, ExternalLink, Link2 } from "lucide-react";

import type {
  ReviewAssetCandidateView,
  ReviewAssetCandidateAssetView,
  ReviewAssetCandidateLinkView,
} from "../types.js";

interface CandidateCardProps {
  candidate: ReviewAssetCandidateView;
}

const PLATFORM_LABELS: Record<ReviewAssetCandidateLinkView["platform"], string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "哔哩哔哩",
  youtube: "YouTube",
};

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

function AssetCandidateCard({ candidate }: { candidate: ReviewAssetCandidateAssetView }): React.ReactElement {
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
    <article className="candidate">
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

function LinkCandidateCard({ candidate }: { candidate: ReviewAssetCandidateLinkView }): React.ReactElement {
  const platformLabel = PLATFORM_LABELS[candidate.platform] ?? candidate.platform;
  return (
    <article className="candidate link-card">
      <div className="thumb thumb-link">
        <Link2 size={32} />
        <span className="media-type">{platformLabel}</span>
      </div>
      <div className="candidate-body">
        <div className="candidate-title">
          <strong>{platformLabel} 搜索</strong>
        </div>
        <p>关键词：{candidate.keyword}</p>
        <div className="candidate-creator">
          <a
            href={candidate.searchUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={12} />
            在 {platformLabel} 中搜索
          </a>
        </div>
        <div className="rights">
          <span className="tag">平台链接</span>
          <span className="tag">需手动筛选</span>
        </div>
      </div>
    </article>
  );
}

export function CandidateCard({ candidate }: CandidateCardProps): React.ReactElement {
  if (candidate.kind === "asset") {
    return <AssetCandidateCard candidate={candidate} />;
  }
  return <LinkCandidateCard candidate={candidate} />;
}
