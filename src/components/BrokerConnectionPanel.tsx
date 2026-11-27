import { CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import type { BrokerEnvironment, BrokerStatus } from '../shared/types.ts';
import { formatGstTimestamp } from '../lib/format.ts';

interface BrokerConnectionPanelProps {
  status: BrokerStatus;
  canUseLive: boolean;
  isAdmin: boolean;
  onRequestEnvironment: (env: BrokerEnvironment) => void;
  onSync: () => Promise<void>;
}

export function BrokerConnectionPanel({
  status,
  canUseLive,
  isAdmin,
  onRequestEnvironment,
  onSync,
}: BrokerConnectionPanelProps) {
  return (
    <div className="space-y-6">
      {/* Environment & Connection Status */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Capital.com Open API Connection
            </h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              {isAdmin
                ? 'Supports both Capital.com Demo and Live broker accounts through server-side session proxy routes. API keys and session tokens stay strictly on the server and are never exposed to the browser.'
                : 'Your workspace operates in complete isolation from other users. Server-side Capital.com Live credentials are governed by the dashboard administrator.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void onSync()}
            className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Test &amp; Sync Session
          </button>
        </div>

        {/* Demo & Live Endpoint Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          {(
            [
              {
                env: 'DEMO' as BrokerEnvironment,
                title: 'Capital.com Demo',
                host: 'https://demo-api-capital.backend-capital.com',
                configured: status.demoConfigured,
                vars: [
                  'CAPITAL_DEMO_API_KEY',
                  'CAPITAL_DEMO_IDENTIFIER',
                  'CAPITAL_DEMO_PASSWORD',
                ],
              },
              {
                env: 'LIVE' as BrokerEnvironment,
                title: 'Capital.com Live',
                host: 'https://api-capital.backend-capital.com',
                configured: status.liveConfigured,
                vars: [
                  'CAPITAL_LIVE_API_KEY',
                  'CAPITAL_LIVE_IDENTIFIER',
                  'CAPITAL_LIVE_PASSWORD',
                ],
              },
            ] as const
          ).map((item) => {
            const isActive = status.environment === item.env;
            const liveBlocked = item.env === 'LIVE' && !canUseLive;
            return (
              <div
                key={item.env}
                className={`rounded-xl border p-5 flex flex-col justify-between gap-4 ${
                  isActive
                    ? 'border-slate-900 bg-slate-50/60'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      {item.title}
                    </h3>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        liveBlocked
                          ? 'text-slate-500'
                          : item.configured
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {liveBlocked
                        ? 'Admin Restricted'
                        : item.configured
                          ? 'Secrets Configured'
                          : 'Isolated Sandbox'}
                    </span>
                  </div>

                  <p className="mt-1.5 font-mono text-xs text-slate-500 break-all">
                    {item.host}
                  </p>

                  {isAdmin && (
                    <div className="mt-4 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Required Server Secrets (.env / Secrets Panel)</span>
                      </div>
                      <ul className="space-y-1 font-mono text-xs text-slate-700">
                        {item.vars.map((v) => (
                          <li key={v} className="flex items-center gap-2">
                            <CheckCircle2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                item.configured
                                  ? 'text-emerald-600'
                                  : 'text-slate-300'
                              }`}
                            />
                            <span>{v}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-200/80">
                  <span className="text-xs text-slate-500">
                    {isActive
                      ? 'Currently active environment'
                      : liveBlocked
                        ? 'Requires admin approval'
                        : 'Inactive'}
                  </span>
                  <button
                    type="button"
                    disabled={isActive || liveBlocked}
                    onClick={() => onRequestEnvironment(item.env)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      isActive || liveBlocked
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : item.env === 'LIVE'
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {isActive
                      ? 'Active'
                      : liveBlocked
                        ? 'Admin Locked'
                        : `Switch to ${item.env}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Security Note */}
        <div className="mt-5 p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-900">
              Server-Side Authentication Architecture:
            </span>{' '}
            Generate an API key inside Capital.com under{' '}
            <span className="font-medium text-slate-800">
              Settings → API Integrations
            </span>
            , then add the three environment variables above in AI Studio&apos;s Secrets panel. The backend handles{' '}
            <span className="font-mono">POST /api/v1/session</span>, caches{' '}
            <span className="font-mono">CST</span> and{' '}
            <span className="font-mono">X-SECURITY-TOKEN</span> in server memory, and refreshes sessions automatically before the 10-minute inactivity timeout. Last sync:{' '}
            <span className="font-mono">{formatGstTimestamp(status.lastSyncAt)}</span>.
          </div>
        </div>
      </div>

      {/* Verified Renko + Supertrend Strategy Specification */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-display text-base font-bold text-slate-900 mb-4">
          Active Automated Strategy Specification
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs leading-relaxed">
          <div>
            <h3 className="font-display font-semibold text-slate-900 mb-1.5">
              01. Zero-Aligned Renko (23h ATR5/5)
            </h3>
            <p className="text-slate-600">
              Live 1-hour candles are grouped into rolling 23-hour OHLC blocks to compute 23h ATR(5) ÷ 5. Every Renko brick locks onto an exact integer multiple of Brick Size (k × Brick) with standard 2-brick reversal logic and zero drift.
            </p>
          </div>

          <div>
            <h3 className="font-display font-semibold text-slate-900 mb-1.5">
              02. Supertrend (1, 2.1) &amp; Flip Cleanup
            </h3>
            <p className="text-slate-600">
              Trails at brick midpoint ± 2.1× ATR(1), filtering 1-brick counter-moves while flipping reliably on the 2nd consecutive opposite brick. On flip, all resting pending limits are cancelled and open Leg 2 positions are automatically closed.
            </p>
          </div>

          <div>
            <h3 className="font-display font-semibold text-slate-900 mb-1.5">
              03. Mirrored 2-Leg Orders &amp; Anti-Stacking Lock
            </h3>
            <p className="text-slate-600">
              Leg 1 places a LIMIT at signal brick close (5-brick TP, no SL, MARKET fallback on rejection); Leg 2 places a LIMIT at brick midpoint (Close ∓ 0.5× Brick, no TP/SL). Filled broker positions reconcile back to their signal lock once per trend to prevent duplicate stacking.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
