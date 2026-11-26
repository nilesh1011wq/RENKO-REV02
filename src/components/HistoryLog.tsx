import { useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type {
  EpicSymbol,
  ExecutionEventType,
  ExecutionHistoryItem,
  InstrumentConfig,
  OrderSource,
} from '../shared/types.ts';
import {
  formatCurrency,
  formatGstTimestamp,
  formatPrice,
} from '../lib/format.ts';

interface HistoryLogProps {
  history: ExecutionHistoryItem[];
  configs: Record<EpicSymbol, InstrumentConfig>;
  currency: string;
  onRefresh: () => Promise<void>;
}

type HistoryFilter = 'ALL' | OrderSource;

const EVENT_LABELS: Record<ExecutionEventType, string> = {
  LEG1_LIMIT: 'LEG1 LIMIT',
  LEG1_MARKET: 'LEG1 MARKET',
  LEG2_LIMIT: 'LEG2 LIMIT',
  FLIP_CLOSE: 'AUTO FLIP CLOSE',
  FLIP_CANCEL: 'AUTO FLIP CANCEL',
  USER_CLOSED_AUTO: 'USER CLOSED AUTO',
  TP_HIT: 'TP HIT (5 BRICKS)',
  MANUAL_ORDER: 'MANUAL ORDER',
  MANUAL_CLOSE: 'MANUAL CLOSE',
};

export function HistoryLog({
  history,
  configs,
  currency,
  onRefresh,
}: HistoryLogProps) {
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = history.filter((item) => {
    if (filter !== 'ALL' && item.source !== filter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return (
        item.epic.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q) ||
        EVENT_LABELS[item.eventType].toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header & Search */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Trade Execution History ({filtered.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Chronological log of 2-leg placements, market fallbacks, Supertrend flip exits, and external broker closes.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbol or note..."
              className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-slate-400 outline-none text-xs text-slate-800 w-48"
            />
          </div>

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

      {/* Audit List */}
      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-800">
            No execution records match your filter.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filtered.map((item) => {
            const dec = configs[item.epic]?.decimals ?? 2;
            const isBuy = item.direction === 'BUY';

            const statusColor =
              item.status === 'OPEN'
                ? 'text-emerald-700'
                : item.status === 'WORKING'
                  ? 'text-amber-700'
                  : item.status === 'CANCELLED'
                    ? 'text-slate-500'
                    : 'text-slate-700';

            return (
              <div
                key={item.id}
                className="px-5 py-3.5 hover:bg-slate-50/70 transition-colors flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-display font-bold text-slate-900">
                      {item.epic}
                    </span>
                    <span
                      className={`font-semibold ${
                        isBuy ? 'text-emerald-700' : 'text-orange-700'
                      }`}
                    >
                      {item.direction}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-[11px] text-slate-600">
                      {item.source === 'CHART_EXT' ? 'CHART / EXT' : item.source}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-[11px] font-medium text-slate-700">
                      {EVENT_LABELS[item.eventType]}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-3 text-xs font-mono text-slate-600 tabular-nums flex-wrap">
                    <span>Size: {item.size}</span>
                    <span>Price: {formatPrice(item.price, dec)}</span>
                    {item.margin > 0 && (
                      <span>
                        Margin: {formatCurrency(item.margin, currency)}
                      </span>
                    )}
                    <span>Lev: {item.leverage}x</span>
                    <span className="text-slate-400">
                      {formatGstTimestamp(item.timestamp)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-500">{item.note}</p>
                </div>

                <div
                  className={`font-mono text-xs font-semibold tracking-wide shrink-0 ${statusColor}`}
                >
                  {item.status}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
