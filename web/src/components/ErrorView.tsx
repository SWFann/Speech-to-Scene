import { useState } from "react";
import { AlertCircle } from "lucide-react";

interface ErrorViewProps {
  message: string;
  hint?: string;
  code: string;
  onRetry: () => void;
  onTokenSubmit?: (token: string) => void;
}

export function ErrorView({
  message,
  hint,
  code,
  onRetry,
  onTokenSubmit,
}: ErrorViewProps): React.ReactElement {
  const [tokenInput, setTokenInput] = useState("");
  const showTokenInput =
    onTokenSubmit && (code === "session_required" || code === "session_rejected");

  return (
    <div className="error-view">
      <div className="error-card">
        <div className="error-icon">
          <AlertCircle size={24} />
        </div>
        <h2>{message}</h2>
        {hint && <p>{hint}</p>}
        {showTokenInput && onTokenSubmit && (
          <div className="token-input">
            <input
              type="text"
              placeholder="输入 session token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tokenInput.trim()) {
                  onTokenSubmit(tokenInput.trim());
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (tokenInput.trim()) {
                  onTokenSubmit(tokenInput.trim());
                }
              }}
            >
              连接
            </button>
          </div>
        )}
        <button className="btn primary" style={{ marginTop: "16px" }} onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}
