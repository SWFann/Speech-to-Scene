import { ImageIcon, Video, ExternalLink, Sparkles, Download } from "lucide-react";

import type {
  ReviewAssetCandidateView,
  ReviewAssetCandidateAssetView,
  ReviewAssetCandidateLinkView,
  ReviewAssetCandidateGeneratedView,
  CandidateCategory,
  LinkPlatform,
} from "../types.js";

interface CandidateCardProps {
  candidate: ReviewAssetCandidateView;
}

const PLATFORM_LABELS: Record<LinkPlatform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "哔哩哔哩",
  kuaishou: "快手",
  xigua: "西瓜视频",
  youtube: "YouTube",
  baotu: "包图网",
  "588ku": "千图网",
  "699pic": "摄图网",
  mizhi: "觅知网",
  zcool: "站酷",
  huaban: "花瓣网",
  weibo: "微博",
  zhihu: "知乎",
};

/** Brand colors for each platform (used for the icon background). */
const PLATFORM_COLORS: Record<LinkPlatform, string> = {
  xiaohongshu: "#ff2741",
  douyin: "#000000",
  bilibili: "#fb7299",
  kuaishou: "#ff4906",
  xigua: "#ff4040",
  youtube: "#ff0000",
  baotu: "#ff6b00",
  "588ku": "#ff7a00",
  "699pic": "#ff5a5f",
  mizhi: "#3b82f6",
  zcool: "#ffba00",
  huaban: "#e85a5a",
  weibo: "#e6162d",
  zhihu: "#0084ff",
};

/** Short text for the platform icon (1-2 chars). */
const PLATFORM_ICONS: Record<LinkPlatform, string> = {
  xiaohongshu: "红",
  douyin: "抖",
  bilibili: "B",
  kuaishou: "快",
  xigua: "西",
  youtube: "▶",
  baotu: "包",
  "588ku": "千",
  "699pic": "摄",
  mizhi: "觅",
  zcool: "酷",
  huaban: "花",
  weibo: "微博",
  zhihu: "知",
};

function PlatformIcon({ platform }: { platform: LinkPlatform }): React.ReactElement {
  const color = PLATFORM_COLORS[platform] ?? "#606874";
  const text = PLATFORM_ICONS[platform] ?? "?";
  return (
    <div className="platform-icon" style={{ backgroundColor: color }}>
      <span>{text}</span>
    </div>
  );
}

const CATEGORY_LABELS: Record<CandidateCategory, string> = {
  stock_library: "素材库",
  video_platform: "视频平台",
  stock_site: "素材站",
  social_media: "社交媒体",
  ai_generated: "AI 生成",
};

function deriveCategory(candidate: ReviewAssetCandidateView): CandidateCategory {
  if (candidate.category) return candidate.category;
  if (candidate.kind === "generated") return "ai_generated";
  if (candidate.kind === "asset") return "stock_library";
  return "social_media";
}

function CategoryBadge({ category }: { category: CandidateCategory }): React.ReactElement {
  return <span className={`cat-badge cat-${category}`}>{CATEGORY_LABELS[category]}</span>;
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

function rightsStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    public_domain: "公共领域",
    open_license: "开放许可",
    platform_license: "平台许可",
    editorial_only: "仅限编辑用途",
    unknown: "授权待确认",
  };
  return labels[value] ?? "授权待确认";
}

function AssetCandidateCard({
  candidate,
}: {
  candidate: ReviewAssetCandidateAssetView;
}): React.ReactElement {
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
          <CategoryBadge category={deriveCategory(candidate)} />
          <strong>
            {candidate.width}×{candidate.height}
            {candidate.durationSeconds ? ` · ${candidate.durationSeconds}s` : ""}
          </strong>
        </div>
        <p>
          {candidate.provider.name} · {candidate.orientation}
        </p>
        <div className="candidate-creator">
          {candidate.creator.name && <span>作者: {candidate.creator.name}</span>}
          {" · "}
          <a href={candidate.sourcePageUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} />
            查看来源并下载
          </a>
        </div>
        <div className="rights">
          <span className={rights.status === "unknown" ? "warn" : "allow"}>
            {rightsStatusLabel(rights.status)}
          </span>
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

function LinkCandidateCard({
  candidate,
}: {
  candidate: ReviewAssetCandidateLinkView;
}): React.ReactElement {
  const platformLabel = PLATFORM_LABELS[candidate.platform] ?? candidate.platform;
  return (
    <article className="platform-link-row">
      <div className="platform-link-icon">
        <PlatformIcon platform={candidate.platform} />
      </div>
      <div className="candidate-body">
        <strong>{platformLabel}</strong>
        <span>{candidate.keyword}</span>
      </div>
      <a className="btn" href={candidate.searchUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={13} />
        打开搜索
      </a>
    </article>
  );
}

function GeneratedCandidateCard({
  candidate,
}: {
  candidate: ReviewAssetCandidateGeneratedView;
}): React.ReactElement {
  return (
    <article className="candidate generated-card">
      <div className="thumb">
        {candidate.thumbnailUrl ? (
          <img
            src={candidate.thumbnailUrl}
            alt={`AI 生成的图片候选`}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="thumb-placeholder">
            <Sparkles size={32} />
          </div>
        )}
        <span className="media-type">AI 生成</span>
      </div>
      <div className="candidate-body">
        <div className="candidate-title">
          <CategoryBadge category={deriveCategory(candidate)} />
          <strong>
            {candidate.width}×{candidate.height}
          </strong>
        </div>
        <p className="generated-prompt" title={candidate.prompt}>
          {candidate.prompt.length > 60 ? `${candidate.prompt.slice(0, 60)}…` : candidate.prompt}
        </p>
        <div className="candidate-creator">
          <span>模型: {candidate.model}</span>
          {" · "}
          <a href={candidate.imageUrl} download target="_blank" rel="noopener noreferrer">
            <Download size={12} />
            下载图片
          </a>
        </div>
        <div className="rights">
          <span className="tag">AI 生成</span>
          <span className="tag warn">发布前请自行确认使用权</span>
        </div>
      </div>
    </article>
  );
}

export function CandidateCard({ candidate }: CandidateCardProps): React.ReactElement {
  if (candidate.kind === "asset") {
    return <AssetCandidateCard candidate={candidate} />;
  }
  if (candidate.kind === "generated") {
    return <GeneratedCandidateCard candidate={candidate} />;
  }
  return <LinkCandidateCard candidate={candidate} />;
}
