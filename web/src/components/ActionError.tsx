import { AlertCircle, X } from "lucide-react";

export interface ActionErrorInfo {
  message: string;
  hint?: string;
  code: string;
}

interface ActionErrorProps {
  error: ActionErrorInfo;
  onDismiss: () => void;
}

/** Friendly display for mutation errors. Never shows token or absolute paths. */
export function ActionError({ error, onDismiss }: ActionErrorProps): React.ReactElement {
  return (
    <div className="action-error" role="alert" data-testid="action-error">
      <AlertCircle size={16} />
      <div className="action-error-body">
        <strong>{error.message}</strong>
        {error.hint && <span>{error.hint}</span>}
      </div>
      <button
        className="action-error-dismiss"
        onClick={onDismiss}
        aria-label="关闭错误提示"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
