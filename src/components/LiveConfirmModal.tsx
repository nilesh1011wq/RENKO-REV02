import { AlertTriangle } from 'lucide-react';

interface LiveConfirmModalProps {
  open: boolean;
  liveConfigured: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LiveConfirmModal({
  open,
  liveConfigured,
  onConfirm,
  onCancel,
}: LiveConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-confirm-title"
    >
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3
              id="live-confirm-title"
              className="font-display text-base font-bold text-slate-900"
            >
              Switch to Capital.com LIVE Environment?
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              {liveConfigured
                ? 'Live server credentials are active. Automated Renko + Supertrend (1, 2.1) two-leg orders, flip exits, and manual trades will execute on your real Capital.com Live account with real capital.'
                : 'CAPITAL_LIVE_* server secrets are not currently set, so the dashboard will switch to the LIVE configuration view in safe Preview mode until you add your Live secrets.'}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
          >
            Stay on Demo
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
          >
            Confirm Switch to Live
          </button>
        </div>
      </div>
    </div>
  );
}
