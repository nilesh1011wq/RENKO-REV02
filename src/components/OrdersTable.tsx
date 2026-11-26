import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  EpicSymbol,
  InstrumentConfig,
  InstrumentMarketState,
  OrderSource,
  WorkingLimitOrder,
} from '../shared/types.ts';
import { formatGstTimestamp, formatPrice } from '../lib/format.ts';

interface OrdersTableProps {
  orders: WorkingLimitOrder[];
  configs: Record<EpicSymbol, InstrumentConfig>;
  markets: Record<EpicSymbol, InstrumentMarketState>;
  onCancelOrder: (dealId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectEpic: (epic: EpicSymbol) => void;
}

type OrderFilter = 'ALL' | OrderSource;

export function OrdersTable({
  orders,
  configs,
  markets,
  onCancelOrder,
  onRefresh,
  onSelectEpic,
}: OrdersTableProps) {
  const [filter, setFilter] = useState<OrderFilter>('ALL');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = orders.filter((o) =>
    filter === 'ALL' ? true : o.source === filter,
  );

  const handleCancel = async (dealId: string) => {
    setCancellingId(dealId);
    try {
      await onCancelOrder(dealId);
    } finally {
      setCancellingId(null);
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

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Working LIMIT Orders ({filtered.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Resting pullback limits (LEG 1 @ close / LEG 2 @ brick midpoint). Auto-cancelled on Supertrend flip.
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

      {/* Rows */}
      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-800">
            No active working limit orders.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            New AUTO BUY LIMIT and SELL LIMIT orders will populate here upon the next Supertrend signal.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 pl-5 pr-3">Instrument</th>
                <th className="py-2.5 px-3">Order Type · Leg</th>
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-3 text-right">Limit Level</th>
                <th className="py-2.5 px-3 text-right">Live Price</th>
                <th className="py-2.5 px-3 text-right">Distance</th>
                <th className="py-2.5 px-3 text-right">Size</th>
                <th className="py-2.5 px-3 text-right">Take Profit</th>
                <th className="py-2.5 pl-3 pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((ord) => {
                const cfg = configs[ord.epic];
                const mkt = markets[ord.epic];
                const dec = cfg?.decimals ?? 2;
                const isBuy = ord.direction === 'BUY';
                const distBricks =
                  mkt && mkt.brickSize > 0
                    ? Math.abs(mkt.mid - ord.level) / mkt.brickSize
                    : 0;

                return (
                  <tr
                    key={ord.dealId}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectEpic(ord.epic)}
                        className="font-display font-bold text-slate-900 hover:text-emerald-700 transition-colors text-left"
                      >
                        {ord.epic}
                      </button>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                        {formatGstTimestamp(ord.createdAt)}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          isBuy ? 'text-emerald-700' : 'text-orange-700'
                        }`}
                      >
                        {ord.direction} LIMIT
                      </span>
                      <span className="text-slate-400 mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-slate-600">{ord.legLabel}</span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                      {ord.source === 'CHART_EXT' ? 'CHART / EXT' : ord.source}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatPrice(ord.level, dec)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {mkt ? formatPrice(mkt.mid, dec) : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                      {distBricks.toFixed(2)} bricks
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                      {ord.size}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {ord.tpLevel !== null
                        ? formatPrice(ord.tpLevel, dec)
                        : 'No TP'}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={cancellingId === ord.dealId}
                        onClick={() => void handleCancel(ord.dealId)}
                        className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:border-red-300 hover:bg-red-50 hover:text-red-700 text-slate-700 font-medium transition-colors"
                      >
                        {cancellingId === ord.dealId
                          ? 'Cancelling...'
                          : 'Cancel Order'}
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
