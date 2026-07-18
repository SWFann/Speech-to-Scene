import type { ReviewAssetCandidateView } from "../types.js";
import { CandidateCard } from "./CandidateCard.js";

interface CandidateGridProps {
  candidates: readonly ReviewAssetCandidateView[];
}

export function CandidateGrid({ candidates }: CandidateGridProps): React.ReactElement {
  if (candidates.length === 0) {
    return (
      <div className="empty-candidates">
        <strong>暂无候选素材</strong>
        <span>点击「搜索素材」按钮重新检索</span>
      </div>
    );
  }

  return (
    <section className="candidate-grid">
      {candidates.map((candidate) => (
        <CandidateCard key={candidate.id} candidate={candidate} />
      ))}
    </section>
  );
}
