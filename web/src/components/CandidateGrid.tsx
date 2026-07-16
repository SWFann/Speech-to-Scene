import type { ReviewAssetCandidateView } from "../types.js";
import { CandidateCard } from "./CandidateCard.js";

interface CandidateGridProps {
  candidates: readonly ReviewAssetCandidateView[];
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
}

export function CandidateGrid({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
}: CandidateGridProps): React.ReactElement {
  if (candidates.length === 0) {
    return (
      <div className="empty-candidates">
        <strong>暂无候选素材</strong>
        <span>可在后续任务中触发重新搜索</span>
      </div>
    );
  }

  return (
    <section className="candidate-grid">
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          isSelected={candidate.id === selectedCandidateId}
          onSelect={() => onSelectCandidate(candidate.id)}
        />
      ))}
    </section>
  );
}
