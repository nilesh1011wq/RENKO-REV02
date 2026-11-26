import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type {
  BrokerPosition,
  EpicSymbol,
  InstrumentConfig,
  OrderSource,
} from '../shared/types.ts';
import {
  formatCurrency,
  formatGstTimestamp,
  formatPrice,
  formatSignedCurrency,
} from '../lib/format.ts';

interface PositionsTableProps {
  positions: BrokerPosition[];
  configs: Record<EpicSymbol, InstrumentConfig>;
  currency: string;
  onClosePosition: (dealId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectEpic: (epic: EpicSymbol) => void;
}

type SourceFilter = 'ALL' | OrderSource;

export function PositionsTable({
  positions,
  configs,
  currency,
  onClosePosition,
  onRefresh,
  onSelectEpic,
}: PositionsTableProps) {
  const [filter, setFilter] = useState<SourceFilter>('ALL');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = positions.filter((p) =>
    filter === 'ALL' ? true : p.source === filter,
  );

  const totalPnl = filtered.reduce((sum, p) => sum + p.pnl, 0);
  const totalMargin = filtered.reduce((sum, p) => sum + p.margin, 0);

  const handleClose = async (dealId: string) => {
    setClosingId(dealId);
    try {
      await onClosePosition(dealId);
    } finally {
      setClosingId(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const formatSource = (source: OrderSource) =>
    source === 'CHART_EXT' ? 'CHART / EXT' : source;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Table Header & Filters */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Open Capital.com Positions ({filtered.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            Total Open P&amp;L:{' '}
            <span
              className={
                totalPnl > 0
                  ? 'text-emerald-700 font-semibold'
                  : totalPnl < 0
                    ? 'text-red-600 font-semibold'
                    : 'text-slate-700 font-semibold'
              }
            >
              {formatSignedCurrency(totalPnl, currency)}
            </span>{' '}
            · Used Margin: {formatCurrency(totalMargin, currency)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
            {(
              [
                ['ALL', 'All'],
                ['AUTO', 'AUTO'],
                ['MANUAL', 'MANUAL'],
                ['CHART_EXT', 'CHART / EXT'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilter(val)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === val
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Table Body */}
      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-800">
            No open positions match this filter.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Filled LEG 1, LEG 2, and manual broker trades will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 pl-5 pr-3">Instrument</th>
                <th className="py-2.5 px-3">Side · Leg</th>
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-3 text-right">Size</th>
                <th className="py-2.5 px-3 text-right">Entry</th>
                <th className="py-2.5 px-3 text-right">Current</th>
                <th className="py-2.5 px-3 text-right">Take Profit</th>
                <th className="py-2.5 px-3 text-right">Margin</th>
                <th className="py-2.5 px-3 text-right">Open P&amp;L</th>
                <th className="py-2.5 pl-3 pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((pos) => {
                const dec = configs[pos.epic]?.decimals ?? 2;
                const isBuy = pos.direction === 'BUY';
                return (
                  <tr
                    key={pos.dealId}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectEpic(pos.epic)}
                        className="font-display font-bold text-slate-900 hover:text-emerald-700 transition-colors text-left"
                      >
                        {pos.epic}
                      </button>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                        {formatGstTimestamp(pos.openedAt)}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          isBuy ? 'text-emerald-700' : 'text-orange-700'
                        }`}
                      >
                        {pos.direction}
                      </span>
                      <span className="text-slate-400 mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-slate-600">{pos.legLabel}</span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                      {formatSource(pos.source)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                      {pos.size}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatPrice(pos.entryLevel, dec)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                      {formatPrice(pos.currentLevel, dec)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {pos.tpLevel !== null
                        ? formatPrice(pos.tpLevel, dec)
                        : 'No TP (Flip Exit)'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrency(pos.margin, currency)}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${
                        pos.pnl > 0
                          ? 'text-emerald-700'
                          : pos.pnl < 0
                            ? 'text-red-600'
                            : 'text-slate-700'
                      }`}
                    >
                      {formatSignedCurrency(pos.pnl, currency)}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={closingId === pos.dealId}
                        onClick={() => void handleClose(pos.dealId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white hover:border-red-300 hover:bg-red-50 hover:text-red-700 text-slate-700 font-medium transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>{closingId === pos.dealId ? 'Closing...' : 'Close'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
