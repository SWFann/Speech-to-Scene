import { useMemo, useState } from "react";

import type { ReviewAssetCandidateView, CandidateCategory } from "../types.js";
import { CandidateCard } from "./CandidateCard.js";

interface CandidateGridProps {
  candidates: readonly ReviewAssetCandidateView[];
}

const CATEGORY_ORDER: CandidateCategory[] = [
  "stock_library",
  "video_platform",
  "stock_site",
  "social_media",
  "ai_generated",
];

const CATEGORY_TAB_LABELS: Record<CandidateCategory, string> = {
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

export function CandidateGrid({ candidates }: CandidateGridProps): React.ReactElement {
  const [activeCategory, setActiveCategory] = useState<CandidateCategory | "all">("all");

  const categoryCounts = useMemo(() => {
    const counts = new Map<CandidateCategory, number>();
    for (const c of candidates) {
      const cat = deriveCategory(c);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return counts;
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    if (activeCategory === "all") return candidates;
    return candidates.filter((c) => deriveCategory(c) === activeCategory);
  }, [candidates, activeCategory]);

  if (candidates.length === 0) {
    return (
      <div className="empty-candidates">
        <strong>暂无候选素材</strong>
        <span>点击「搜索素材」按钮重新检索</span>
      </div>
    );
  }

  return (
    <section className="candidate-grid-wrapper">
      <div className="category-tabs">
        <button
          type="button"
          className={`cat-tab ${activeCategory === "all" ? "active" : ""}`}
          onClick={() => setActiveCategory("all")}
        >
          全部 <span className="cat-count">{candidates.length}</span>
        </button>
        {CATEGORY_ORDER.filter((cat) => categoryCounts.has(cat)).map((cat) => (
          <button
            key={cat}
            type="button"
            className={`cat-tab cat-tab-${cat} ${activeCategory === cat ? "active" : ""}`}
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_TAB_LABELS[cat]} <span className="cat-count">{categoryCounts.get(cat)}</span>
          </button>
        ))}
      </div>
      <div className="candidate-grid">
        {visibleCandidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
    </section>
  );
}
