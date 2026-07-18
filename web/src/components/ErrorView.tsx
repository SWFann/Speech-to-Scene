import { AlertCircle } from "lucide-react";

interface ErrorViewProps {
  message: string;
  hint?: string;
  onRetry: () => void;
}

export function ErrorView({ message, hint, onRetry }: ErrorViewProps): React.ReactElement {
  return (
    <div className="error-view">
      <div className="error-card">
        <div className="error-icon">
          <AlertCircle size={24} />
        </div>
        <h2>{message}</h2>
        {hint && <p>{hint}</p>}
        <button className="btn primary" style={{ marginTop: "16px" }} onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}
