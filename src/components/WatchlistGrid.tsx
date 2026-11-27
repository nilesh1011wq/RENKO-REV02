import { useState } from 'react';
import { Lock, SlidersHorizontal } from 'lucide-react';
import {
  EPIC_LIST,
  type EpicSymbol,
  type InstrumentConfig,
  type InstrumentMarketState,
  type TradeDirection,
} from '../shared/types.ts';
import { formatPrice } from '../lib/format.ts';

interface WatchlistGridProps {
  configs: Record<EpicSymbol, InstrumentConfig>;
  markets: Record<EpicSymbol, InstrumentMarketState>;
  selectedEpic: EpicSymbol;
  onSelectEpic: (epic: EpicSymbol) => void;
  onUpdateConfig: (
    epic: EpicSymbol,
    patch: Partial<InstrumentConfig>,
  ) => Promise<void>;
  onManualTrade: (epic: EpicSymbol, direction: TradeDirection) => Promise<void>;
}

function MiniRenkoSparkline({ market }: { market: InstrumentMarketState }) {
  const recent = market.bricks.slice(-14);
  if (recent.length === 0) return null;

  const prices = recent.flatMap((b) => [b.high, b.low]);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const range = Math.max(hi - lo, market.brickSize);
  const w = 152;
  const h = 38;
  const step = w / recent.length;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[152px] h-[38px] shrink-0">
      {recent.map((b, i) => {
        const topY = ((hi - b.high) / range) * (h - 6) + 3;
        const botY = ((hi - b.low) / range) * (h - 6) + 3;
        return (
          <rect
            key={b.index}
            x={i * step + 1}
            y={topY}
            width={Math.max(4, step - 2.5)}
            height={Math.max(3, botY - topY)}
            rx={1}
            fill={b.direction === 'UP' ? '#10B981' : '#F97316'}
          />
        );
      })}
    </svg>
  );
}

export function WatchlistGrid({
  configs,
  markets,
  selectedEpic,
  onSelectEpic,
  onUpdateConfig,
  onManualTrade,
}: WatchlistGridProps) {
  const [editingStEpic, setEditingStEpic] = useState<EpicSymbol | null>(null);
  const [busyEpic, setBusyEpic] = useState<EpicSymbol | null>(null);

  const runConfigUpdate = async (
    epic: EpicSymbol,
    patch: Partial<InstrumentConfig>,
  ) => {
    setBusyEpic(epic);
    try {
      await onUpdateConfig(epic, patch);
    } finally {
      setBusyEpic(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {EPIC_LIST.map((epic) => {
        const cfg = configs[epic];
        const mkt = markets[epic];
        if (!cfg || !mkt) return null;
        const decimals = cfg.decimals;
        const isBullish = mkt.currentTrend === 'BULLISH';
        const isAuto = cfg.mode === 'AUTO';
        const isSelected = selectedEpic === epic;
        const lastBrickDir = mkt.bricks[mkt.bricks.length - 1]?.direction || 'UP';

        return (
          <section
            key={epic}
            className={`bg-white rounded-xl border transition-colors p-5 flex flex-col gap-4 ${
              isSelected
                ? 'border-slate-400'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            {/* Card Header: Symbol + 24h Quote Strip + Bid/Ask Buttons */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectEpic(epic)}
                  className="text-left group"
                >
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-display text-base font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                      {cfg.displayName}
                    </h3>
                    <span className="text-xs text-slate-500">{cfg.subtitle}</span>
                  </div>
                </button>

                <div className="mt-1 font-mono text-xs tabular-nums flex items-center gap-2">
                  <span
                    className={
                      mkt.change >= 0
                        ? 'text-emerald-700 font-medium'
                        : 'text-red-600 font-medium'
                    }
                  >
                    {mkt.change >= 0 ? '+' : ''}
                    {formatPrice(mkt.change, decimals)} (
                    {mkt.changePct >= 0 ? '+' : ''}
                    {mkt.changePct.toFixed(2)}%)
                  </span>
                </div>

                <div className="mt-2.5">
                  <MiniRenkoSparkline market={mkt} />
                </div>
              </div>

              {/* Right quote block */}
              <div className="flex flex-col items-end shrink-0">
                <div className="flex items-center gap-2.5 text-[11px] font-mono text-slate-500 tabular-nums mb-1.5">
                  <span title="24h High">H: {formatPrice(mkt.high24h, decimals)}</span>
                  <span title="Live Spread (BUY − SELL)">S: {formatPrice(mkt.spread, decimals)}</span>
                  <span title="24h Low">L: {formatPrice(mkt.low24h, decimals)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isAuto || busyEpic === epic}
                    onClick={() => void onManualTrade(epic, 'SELL')}
                    title={
                      isAuto
                        ? 'Switch mode to MANUAL to execute manual Sell'
                        : `Sell ${epic} at market`
                    }
                    className={`px-3.5 py-2 rounded-lg border text-center transition-colors min-w-[104px] ${
                      isAuto
                        ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                        : 'border-orange-300 bg-orange-50/70 hover:bg-orange-100 text-orange-800 cursor-pointer'
                    }`}
                  >
                    <div className="text-[10px] font-semibold tracking-wider uppercase">
                      SELL
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      {formatPrice(mkt.bid, decimals)}
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isAuto || busyEpic === epic}
                    onClick={() => void onManualTrade(epic, 'BUY')}
                    title={
                      isAuto
                        ? 'Switch mode to MANUAL to execute manual Buy'
                        : `Buy ${epic} at market`
                    }
                    className={`px-3.5 py-2 rounded-lg border text-center transition-colors min-w-[104px] ${
                      isAuto
                        ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                        : 'border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 cursor-pointer'
                    }`}
                  >
                    <div className="text-[10px] font-semibold tracking-wider uppercase">
                      BUY
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      {formatPrice(mkt.ask, decimals)}
                    </div>
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-3 text-[11px] font-mono text-slate-500 tabular-nums">
                  <span
                    tabIndex={0}
                    className="group relative inline-flex items-center cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 rounded-xs"
                  >
                    <span>Brick (23h): {formatPrice(mkt.brickSize, decimals)}</span>
                    <span
                      role="tooltip"
                      className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 absolute bottom-full right-0 mb-2 z-30 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-mono font-medium text-white shadow-lg border border-slate-700"
                    >
                      23h ATR(5): {formatPrice(mkt.atr5, decimals)} ÷ 5
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{cfg.leverage}x Real</span>
                </div>
              </div>
            </div>

            {/* Mode & Sizing Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-slate-500">Mode</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => void runConfigUpdate(epic, { mode: 'MANUAL' })}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      !isAuto
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    MANUAL
                  </button>
                  <button
                    type="button"
                    onClick={() => void runConfigUpdate(epic, { mode: 'AUTO' })}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      isAuto
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    AUTO
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-slate-500">Sizing</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() =>
                      void runConfigUpdate(epic, { sizingMode: 'MARGIN' })
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      cfg.sizingMode === 'MARGIN'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Margin
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runConfigUpdate(epic, { sizingMode: 'LOT' })
                    }
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      cfg.sizingMode === 'LOT'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Lot Size
                  </button>
                </div>
              </div>
            </div>

            {/* Dual Order Leg Inputs (Order Lot 1 & Order Lot 2) */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/60 focus-within:border-slate-400 focus-within:bg-white transition-colors">
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {cfg.sizingMode === 'LOT' ? 'Order Lot 1' : 'Margin 1 ($)'}
                </span>
                <input
                  type="number"
                  step={cfg.sizingMode === 'LOT' ? cfg.sizeStep : 1}
                  min={cfg.sizingMode === 'LOT' ? cfg.minSize : 1}
                  value={cfg.sizingMode === 'LOT' ? cfg.lot1 : cfg.margin1}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val) && val > 0) {
                      void runConfigUpdate(
                        epic,
                        cfg.sizingMode === 'LOT'
                          ? { lot1: val }
                          : { margin1: val },
                      );
                    }
                  }}
                  className="w-20 text-right font-mono text-xs font-semibold text-slate-900 bg-transparent outline-none tabular-nums"
                />
              </label>

              <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/60 focus-within:border-slate-400 focus-within:bg-white transition-colors">
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {cfg.sizingMode === 'LOT' ? 'Order Lot 2' : 'Margin 2 ($)'}
                </span>
                <input
                  type="number"
                  step={cfg.sizingMode === 'LOT' ? cfg.sizeStep : 1}
                  min={cfg.sizingMode === 'LOT' ? cfg.minSize : 1}
                  value={cfg.sizingMode === 'LOT' ? cfg.lot2 : cfg.margin2}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val) && val > 0) {
                      void runConfigUpdate(
                        epic,
                        cfg.sizingMode === 'LOT'
                          ? { lot2: val }
                          : { margin2: val },
                      );
                    }
                  }}
                  className="w-20 text-right font-mono text-xs font-semibold text-slate-900 bg-transparent outline-none tabular-nums"
                />
              </label>
            </div>

            {/* Supertrend (AUTO) Strip */}
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                  Supertrend (AUTO)
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cfg.stEnabled}
                  aria-label={`Toggle Supertrend automation for ${epic}`}
                  onClick={() =>
                    void runConfigUpdate(epic, { stEnabled: !cfg.stEnabled })
                  }
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    cfg.stEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform transform ${
                      cfg.stEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <span
                  className={`text-xs font-semibold tracking-wide ${
                    isBullish ? 'text-emerald-700' : 'text-orange-700'
                  }`}
                >
                  {mkt.currentTrend}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEditingStEpic((prev) => (prev === epic ? null : epic))
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-mono text-slate-700 tabular-nums transition-colors whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  ({cfg.stPeriod}, {cfg.stMultiplier})
                </span>
              </button>
            </div>

            {/* Inline Supertrend Parameter Editor */}
            {editingStEpic === epic && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">ATR Period</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    value={cfg.stPeriod}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1 && val <= 20) {
                        void runConfigUpdate(epic, { stPeriod: val });
                      }
                    }}
                    className="w-16 px-2 py-1 rounded border border-slate-300 bg-white text-right font-mono tabular-nums"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Multiplier</span>
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.1}
                    value={cfg.stMultiplier}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0.5 && val <= 10) {
                        void runConfigUpdate(epic, { stMultiplier: val });
                      }
                    }}
                    className="w-16 px-2 py-1 rounded border border-slate-300 bg-white text-right font-mono tabular-nums"
                  />
                </label>
              </div>
            )}

            {/* Footer Signal Formula & Lock State */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="min-w-0 text-[11px] leading-relaxed">
                <div
                  className={`font-medium truncate font-mono tabular-nums ${
                    isBullish ? 'text-emerald-700' : 'text-orange-700'
                  }`}
                >
                  {mkt.consecutiveBricks}{' '}
                  {lastBrickDir === 'UP' ? 'green' : 'orange'} Renko bricks · Close (
                  {formatPrice(mkt.lastBrickClose, decimals)}){' '}
                  {isBullish ? '>' : '<'} ST ({formatPrice(mkt.lastStValue, decimals)})
                </div>
                <div className="text-slate-500 truncate">
                  AUTO: L1 LIMIT @ close (5-brick TP, No SL) · L2 @ midpoint (close on flip)
                </div>
              </div>

              {isAuto ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                  <span>AUTO Active · Manual Locked</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectEpic(epic)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 transition-colors"
                >
                  Inspect Chart
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
