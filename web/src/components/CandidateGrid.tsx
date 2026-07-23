import { useMemo, useState } from "react";

import type { ReviewAssetCandidateView } from "../types.js";
import { CandidateCard } from "./CandidateCard.js";

interface CandidateGridProps {
  candidates: readonly ReviewAssetCandidateView[];
}

export function CandidateGrid({ candidates }: CandidateGridProps): React.ReactElement {
  const [activeCategory, setActiveCategory] = useState<"all" | "asset" | "generated">("all");
  const usableCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.kind !== "link"),
    [candidates],
  );
  const platformLinks = useMemo(
    () => candidates.filter((candidate) => candidate.kind === "link"),
    [candidates],
  );

  const visibleCandidates = useMemo(() => {
    if (activeCategory === "all") return usableCandidates;
    return usableCandidates.filter((candidate) => candidate.kind === activeCategory);
  }, [usableCandidates, activeCategory]);

  if (usableCandidates.length === 0 && platformLinks.length === 0) {
    return (
      <div className="empty-candidates">
        <strong>还没有找到可直接使用的素材</strong>
        <span>点击「重新找素材」，或让 AI 按这个场景生成一张图</span>
      </div>
    );
  }

  return (
    <section className="candidate-grid-wrapper">
      {usableCandidates.length > 0 && (
        <div className="category-tabs" aria-label="素材类型">
          <button
            type="button"
            className={`cat-tab ${activeCategory === "all" ? "active" : ""}`}
            onClick={() => setActiveCategory("all")}
          >
            推荐 <span className="cat-count">{usableCandidates.length}</span>
          </button>
          {(["asset", "generated"] as const)
            .filter((kind) => usableCandidates.some((candidate) => candidate.kind === kind))
            .map((kind) => (
              <button
                key={kind}
                type="button"
                className={`cat-tab ${activeCategory === kind ? "active" : ""}`}
                onClick={() => setActiveCategory(kind)}
              >
                {kind === "asset" ? "素材库" : "AI 生成"}{" "}
                <span className="cat-count">
                  {usableCandidates.filter((candidate) => candidate.kind === kind).length}
                </span>
              </button>
            ))}
        </div>
      )}
      <div className="candidate-grid">
        {visibleCandidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
      {platformLinks.length > 0 && (
        <details className="platform-links" data-testid="platform-search-links">
          <summary>更多平台搜索（{platformLinks.length}）</summary>
          <p>这些是站外搜索入口，不算作可用素材。打开后请自行确认画质与使用权。</p>
          <div className="platform-link-list">
            {platformLinks.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
