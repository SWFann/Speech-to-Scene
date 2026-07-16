import { ShieldAlert } from "lucide-react";

interface RightsWarningDialogProps {
  message: string;
  hint?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * Inline confirmation dialog shown when the backend returns 409 conflict
 * for a candidate selection that requires rights acknowledgement.
 * The user must explicitly confirm before retrying with rightsAcknowledged=true.
 */
export function RightsWarningDialog({
  message,
  hint,
  onConfirm,
  onCancel,
  busy = false,
}: RightsWarningDialogProps): React.ReactElement {
  return (
    <div className="rights-dialog" role="dialog" aria-label="权利确认" data-testid="rights-dialog">
      <div className="rights-dialog-icon">
        <ShieldAlert size={20} />
      </div>
      <div className="rights-dialog-body">
        <strong>{message}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="rights-dialog-actions">
        <button className="btn" onClick={onCancel} disabled={busy} type="button">
          取消
        </button>
        <button className="btn primary" onClick={onConfirm} disabled={busy} type="button">
          {busy ? "确认中…" : "确认并重试"}
        </button>
      </div>
    </div>
  );
}
