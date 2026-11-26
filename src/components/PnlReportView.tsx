import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Download,
  RefreshCw,
} from 'lucide-react';
import {
  EPIC_LIST,
  type ClosedTradeExitReason,
  type EpicSymbol,
  type InstrumentConfig,
  type PnlReportResponse,
} from '../shared/types.ts';
import { fetchPnlReport } from '../lib/api.ts';
import {
  formatGstTimestamp,
  formatPrice,
  formatSignedCurrency,
} from '../lib/format.ts';

interface PnlReportViewProps {
  configs: Record<EpicSymbol, InstrumentConfig>;
  environment: string;
  onSelectEpic: (epic: EpicSymbol) => void;
}

type DatePreset = 'TODAY' | '7D' | '14D' | '30D' | 'MTD' | 'CUSTOM';

const EXIT_REASON_LABELS: Record<ClosedTradeExitReason, string> = {
  TP_5_BRICKS: '5-Brick TP',
  FLIP_EXIT: 'Supertrend Flip',
  MANUAL_CLOSE: 'Manual Close',
  BROKER_SETTLED: 'Broker Settled',
};

function toDateInputString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPresetRange(preset: Exclude<DatePreset, 'CUSTOM'>): {
  from: string;
  to: string;
} {
  const now = new Date();
  const to = toDateInputString(now);

  if (preset === 'TODAY') {
    return { from: to, to };
  }
  if (preset === 'MTD') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: toDateInputString(start), to };
  }
  const days = preset === '7D' ? 6 : preset === '14D' ? 13 : 29;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: toDateInputString(start), to };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  // Neutralize spreadsheet formula injection characters
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function PnlReportView({
  configs,
  environment,
  onSelectEpic,
}: PnlReportViewProps) {
  const initialRange = useMemo(() => getPresetRange('30D'), []);
  const [preset, setPreset] = useState<DatePreset>('30D');
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [epicFilter, setEpicFilter] = useState<EpicSymbol | 'ALL'>('ALL');
  const [report, setReport] = useState<PnlReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);

  const loadReport = useCallback(
    async (f: string, t: string, ep: EpicSymbol | 'ALL') => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPnlReport({ from: f, to: t, epic: ep });
        setReport(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load Profit & Loss report.',
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Reload whenever environment or preset/epic changes
  useEffect(() => {
    void loadReport(fromDate, toDate, epicFilter);
  }, [environment, loadReport]);

  const handlePresetClick = (nextPreset: Exclude<DatePreset, 'CUSTOM'>) => {
    const range = getPresetRange(nextPreset);
    setPreset(nextPreset);
    setFromDate(range.from);
    setToDate(range.to);
    void loadReport(range.from, range.to, epicFilter);
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromDate || !toDate) return;
    if (fromDate > toDate) {
      setError('Start date must be on or before end date.');
      return;
    }
    setPreset('CUSTOM');
    void loadReport(fromDate, toDate, epicFilter);
  };

  const handleEpicChange = (nextEpic: EpicSymbol | 'ALL') => {
    setEpicFilter(nextEpic);
    void loadReport(fromDate, toDate, nextEpic);
  };

  const handleExportCsv = () => {
    if (!report || report.trades.length === 0) return;
    const headers = [
      'Closed At (UTC)',
      'Opened At (UTC)',
      'Instrument',
      'Direction',
      'Leg',
      'Source',
      'Exit Reason',
      'Size',
      'Entry Price',
      'Exit Price',
      'Gross P&L',
      'Fee/Swap',
      'Net P&L',
    ];
    const rows = report.trades.map((t) => [
      t.closedAt,
      t.openedAt,
      t.epic,
      t.direction,
      t.legLabel,
      t.source,
      EXIT_REASON_LABELS[t.exitReason],
      t.size,
      t.entryPrice,
      t.exitPrice,
      t.grossPnl.toFixed(2),
      t.feeOrSwap.toFixed(2),
      t.netPnl.toFixed(2),
    ]);

    const csv = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.map(escapeCsvCell).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `renkodesk-pnl-${report.environment.toLowerCase()}-${report.from}-to-${report.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Chart calculations for Daily Realized P&L bars + Cumulative Equity Curve
  const chartData = useMemo(() => {
    const series = report?.dailySeries || [];
    if (series.length === 0) return null;

    const barValues = series.map((d) => d.realizedPnl);
    const cumValues = series.map((d) => d.cumulativePnl);
    const allValues = [0, ...barValues, ...cumValues];

    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const span = Math.max(25, rawMax - rawMin);
    const minVal = rawMin - span * 0.14;
    const maxVal = rawMax + span * 0.14;

    const svgW = 1040;
    const svgH = 290;
    const padL = 24;
    const padR = 96;
    const padT = 22;
    const padB = 34;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;

    const valToY = (v: number) =>
      padT + ((maxVal - v) / (maxVal - minVal)) * plotH;
    const zeroY = valToY(0);
    const slotW = plotW / Math.max(1, series.length);
    const barW = Math.max(4, Math.min(24, slotW * 0.62));

    const yTicks = [0, 1, 2, 3, 4].map(
      (i) => minVal + ((maxVal - minVal) * i) / 4,
    );

    const cumPoints = series
      .map((d, i) => {
        const x = padL + i * slotW + slotW / 2;
        const y = valToY(d.cumulativePnl);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return {
      series,
      svgW,
      svgH,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      zeroY,
      slotW,
      barW,
      yTicks,
      valToY,
      cumPoints,
    };
  }, [report]);

  const hoveredDay =
    hoveredDayIdx !== null && report?.dailySeries[hoveredDayIdx]
      ? report.dailySeries[hoveredDayIdx]
      : null;

  const currency = report?.currency || 'USD';

  return (
    <div className="space-y-6">
      {/* Custom Date Range & Instrument Filter Bar */}
      <form
        onSubmit={handleApplyCustom}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Custom Date Profit &amp; Loss Report
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Filter settled trades, 5-brick Leg 1 take profits, and Leg 2 Supertrend flip exits across any custom date window.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadReport(fromDate, toDate, epicFilter)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!report || report.trades.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Presets + Date Inputs + Instrument Selector */}
        <div className="flex flex-wrap items-end justify-between gap-4 pt-3 border-t border-slate-100">
          {/* Quick Date Presets */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Quick Range
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              {(
                [
                  ['TODAY', 'Today'],
                  ['7D', '7D'],
                  ['14D', '14D'],
                  ['30D', '30D'],
                  ['MTD', 'Month to Date'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePresetClick(key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    preset === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Pickers + Instrument Select + Apply */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" />
                <span>From Date</span>
              </span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPreset('CUSTOM');
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:border-slate-500 outline-none tabular-nums"
              />
            </label>

            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" />
                <span>To Date</span>
              </span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPreset('CUSTOM');
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:border-slate-500 outline-none tabular-nums"
              />
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Instrument
              </span>
              <select
                value={epicFilter}
                onChange={(e) =>
                  handleEpicChange(e.target.value as EpicSymbol | 'ALL')
                }
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900 focus:border-slate-500 outline-none"
              >
                <option value="ALL">All Instruments (5)</option>
                {EPIC_LIST.map((ep) => (
                  <option key={ep} value={ep}>
                    {ep} ({configs[ep].subtitle})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap h-[34px]"
            >
              Apply Filter
            </button>
          </div>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2.5 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !report ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 bg-white rounded-xl border border-slate-200 p-4 animate-pulse"
              />
            ))}
          </div>
          <div className="h-72 bg-slate-900/90 rounded-xl animate-pulse" />
        </div>
      ) : report ? (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                Net Realized P&amp;L
              </div>
              <div
                className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
                  report.summary.netRealizedPnl > 0
                    ? 'text-emerald-700'
                    : report.summary.netRealizedPnl < 0
                      ? 'text-red-600'
                      : 'text-slate-900'
                }`}
              >
                {formatSignedCurrency(report.summary.netRealizedPnl, currency)}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                Fees/Swaps: {formatSignedCurrency(report.summary.feesAndSwaps, currency)}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                Total P&amp;L (Realized + Open)
              </div>
              <div
                className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
                  report.summary.totalPnl > 0
                    ? 'text-emerald-700'
                    : report.summary.totalPnl < 0
                      ? 'text-red-600'
                      : 'text-slate-900'
                }`}
              >
                {formatSignedCurrency(report.summary.totalPnl, currency)}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                Open UPL: {formatSignedCurrency(report.summary.unrealizedPnl, currency)}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                Win Rate &amp; Trade Count
              </div>
              <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {report.summary.winRate.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                {report.summary.winningTrades}W · {report.summary.losingTrades}L ({report.summary.totalTrades} total)
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                Profit Factor
              </div>
              <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {report.summary.profitFactor === null
                  ? '∞'
                  : report.summary.profitFactor.toFixed(2)}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                Avg W {formatSignedCurrency(report.summary.averageWin, currency)} · Avg L{' '}
                {formatSignedCurrency(report.summary.averageLoss, currency)}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-medium text-slate-500">
                Leg 1 vs. Leg 2 Net P&amp;L
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 font-mono text-sm font-bold tabular-nums">
                <span className="text-emerald-700">
                  L1 {formatSignedCurrency(report.summary.leg1NetPnl, currency)}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs tabular-nums text-slate-600">
                L2 (Flip Runner):{' '}
                <span
                  className={
                    report.summary.leg2NetPnl >= 0
                      ? 'text-emerald-700 font-semibold'
                      : 'text-red-600 font-semibold'
                  }
                >
                  {formatSignedCurrency(report.summary.leg2NetPnl, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Dark Obsidian Daily P&L Bars & Cumulative Equity Curve */}
          <div className="bg-[#0B1120] text-slate-100 rounded-xl border border-slate-800 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  Daily Realized P&amp;L &amp; Cumulative Equity Curve
                </h3>
                <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                  Range: {report.from} → {report.to} · Scope:{' '}
                  {report.epicFilter === 'ALL' ? 'All 5 Assets' : report.epicFilter} ·{' '}
                  {report.isSimulated
                    ? 'Preview Ledger'
                    : `Capital.com ${report.environment}`}
                </p>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono text-slate-300">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                  <span>Profit Day</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-xs bg-orange-500" />
                  <span>Loss Day</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 bg-sky-400" />
                  <span>Cumulative P&amp;L</span>
                </span>
              </div>
            </div>

            {chartData && report.dailySeries.length > 0 ? (
              <>
                <div className="p-2">
                  <svg
                    viewBox={`0 0 ${chartData.svgW} ${chartData.svgH}`}
                    className="w-full h-[290px]"
                    onMouseLeave={() => setHoveredDayIdx(null)}
                  >
                    {/* Y-Axis gridlines */}
                    {chartData.yTicks.map((val, idx) => {
                      const y = chartData.valToY(val);
                      return (
                        <g key={idx}>
                          <line
                            x1={chartData.padL}
                            y1={y}
                            x2={chartData.svgW - chartData.padR}
                            y2={y}
                            stroke="#1E293B"
                            strokeWidth={1}
                          />
                          <text
                            x={chartData.svgW - chartData.padR + 10}
                            y={y + 4}
                            fill="#94A3B8"
                            fontSize={10.5}
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {formatSignedCurrency(val, currency)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Zero Baseline */}
                    <line
                      x1={chartData.padL}
                      y1={chartData.zeroY}
                      x2={chartData.svgW - chartData.padR}
                      y2={chartData.zeroY}
                      stroke="#475569"
                      strokeWidth={1.2}
                      strokeDasharray="3 3"
                    />

                    {/* Daily Realized P&L Bars */}
                    {chartData.series.map((d, i) => {
                      const cx =
                        chartData.padL + i * chartData.slotW + chartData.slotW / 2;
                      const barTop =
                        d.realizedPnl >= 0
                          ? chartData.valToY(d.realizedPnl)
                          : chartData.zeroY;
                      const barBot =
                        d.realizedPnl >= 0
                          ? chartData.zeroY
                          : chartData.valToY(d.realizedPnl);
                      const barH = Math.max(
                        d.realizedPnl === 0 ? 1.5 : 3,
                        barBot - barTop,
                      );
                      const isHovered = hoveredDayIdx === i;

                      const labelStep = Math.max(
                        1,
                        Math.ceil(chartData.series.length / 8),
                      );
                      const showXLabel =
                        i === 0 ||
                        i === chartData.series.length - 1 ||
                        i % labelStep === 0;

                      return (
                        <g
                          key={d.date}
                          onMouseEnter={() => setHoveredDayIdx(i)}
                          className="cursor-pointer"
                        >
                          <rect
                            x={cx - chartData.slotW / 2}
                            y={chartData.padT}
                            width={chartData.slotW}
                            height={chartData.plotH}
                            fill={isHovered ? '#1E293B' : 'transparent'}
                            fillOpacity={0.45}
                          />
                          <rect
                            x={cx - chartData.barW / 2}
                            y={barTop}
                            width={chartData.barW}
                            height={barH}
                            rx={2}
                            fill={
                              d.realizedPnl > 0
                                ? '#10B981'
                                : d.realizedPnl < 0
                                  ? '#F97316'
                                  : '#334155'
                            }
                            fillOpacity={isHovered ? 1 : 0.85}
                          />
                          {showXLabel && (
                            <text
                              x={cx}
                              y={chartData.svgH - 10}
                              textAnchor="middle"
                              fill="#94A3B8"
                              fontSize={10}
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {d.date.slice(5)}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* Cumulative P&L Line */}
                    {chartData.series.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#38BDF8"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={chartData.cumPoints}
                      />
                    )}
                    {chartData.series.map((d, i) => {
                      const cx =
                        chartData.padL + i * chartData.slotW + chartData.slotW / 2;
                      const cy = chartData.valToY(d.cumulativePnl);
                      const isHovered = hoveredDayIdx === i;
                      if (!isHovered && d.tradesCount === 0) return null;
                      return (
                        <circle
                          key={`dot-${d.date}`}
                          cx={cx}
                          cy={cy}
                          r={isHovered ? 4.5 : 2.5}
                          fill="#38BDF8"
                          stroke="#0B1120"
                          strokeWidth={1.5}
                        />
                      );
                    })}
                  </svg>
                </div>

                {/* Dark Chart Inspector Footer */}
                <div className="px-5 py-2.5 border-t border-slate-800/90 bg-[#080D18] flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums">
                  {hoveredDay ? (
                    <div className="flex items-center gap-4 text-slate-300 flex-wrap">
                      <span className="font-semibold text-white">
                        {hoveredDay.date}
                      </span>
                      <span>
                        Day P&amp;L:{' '}
                        <strong
                          className={
                            hoveredDay.realizedPnl >= 0
                              ? 'text-emerald-400'
                              : 'text-orange-400'
                          }
                        >
                          {formatSignedCurrency(hoveredDay.realizedPnl, currency)}
                        </strong>
                      </span>
                      <span>
                        Cumulative:{' '}
                        <strong className="text-sky-400">
                          {formatSignedCurrency(hoveredDay.cumulativePnl, currency)}
                        </strong>
                      </span>
                      <span className="text-slate-400">
                        {hoveredDay.tradesCount} trades ({hoveredDay.wins}W /{' '}
                        {hoveredDay.losses}L)
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-400">
                      Hover any day bar to inspect daily realized P&amp;L, cumulative equity, and win/loss counts
                    </span>
                  )}

                  <span className="text-slate-400">
                    Best: {formatSignedCurrency(report.summary.largestWin, currency)} · Worst:{' '}
                    {formatSignedCurrency(report.summary.largestLoss, currency)}
                  </span>
                </div>
              </>
            ) : (
              <div className="px-6 py-12 text-center text-xs text-slate-400">
                No daily P&amp;L data points in this window.
              </div>
            )}
          </div>

          {/* Per-Instrument P&L Attribution Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Profit &amp; Loss Breakdown by Instrument
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5 pl-5 pr-3">Instrument</th>
                    <th className="py-2.5 px-3 text-right">Trades</th>
                    <th className="py-2.5 px-3 text-right">Win Rate</th>
                    <th className="py-2.5 px-3 text-right">Gross Profit</th>
                    <th className="py-2.5 px-3 text-right">Gross Loss</th>
                    <th className="py-2.5 px-3 text-right">Leg 1 (5B TP)</th>
                    <th className="py-2.5 px-3 text-right">Leg 2 (Flip)</th>
                    <th className="py-2.5 pl-3 pr-5 text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {report.byInstrument.map((row) => (
                    <tr
                      key={row.epic}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectEpic(row.epic)}
                          className="font-display font-bold text-slate-900 hover:text-emerald-700 transition-colors"
                        >
                          {row.epic}
                        </button>
                        <span className="ml-2 text-slate-400 text-[11px]">
                          {configs[row.epic].subtitle}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {row.tradesCount} ({row.wins}W/{row.losses}L)
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                        {row.winRate.toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatSignedCurrency(row.grossProfit, currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-red-600">
                        {formatSignedCurrency(row.grossLoss, currency)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums ${
                          row.leg1Pnl >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatSignedCurrency(row.leg1Pnl, currency)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums ${
                          row.leg2Pnl >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatSignedCurrency(row.leg2Pnl, currency)}
                      </td>
                      <td
                        className={`py-3 pl-3 pr-5 text-right font-mono tabular-nums font-bold ${
                          row.netPnl > 0
                            ? 'text-emerald-700'
                            : row.netPnl < 0
                              ? 'text-red-600'
                              : 'text-slate-700'
                        }`}
                      >
                        {formatSignedCurrency(row.netPnl, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Closed Trades Ledger */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Closed Trades Ledger ({report.trades.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every realized position settled between {report.from} and {report.to}.
                </p>
              </div>
            </div>

            {report.trades.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-medium text-slate-800">
                  No closed trades found between {report.from} and {report.to}.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Expand your custom date filter or select &quot;All Instruments&quot; to inspect realized P&amp;L history.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 pl-5 pr-3">Closed Time</th>
                      <th className="py-2.5 px-3">Instrument</th>
                      <th className="py-2.5 px-3">Side · Leg</th>
                      <th className="py-2.5 px-3">Exit Reason</th>
                      <th className="py-2.5 px-3 text-right">Size</th>
                      <th className="py-2.5 px-3 text-right">Entry</th>
                      <th className="py-2.5 px-3 text-right">Exit</th>
                      <th className="py-2.5 px-3 text-right">Fee / Swap</th>
                      <th className="py-2.5 pl-3 pr-5 text-right">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {report.trades.map((t) => {
                      const dec = configs[t.epic]?.decimals ?? 2;
                      return (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3 pl-5 pr-3 whitespace-nowrap font-mono text-[11px] text-slate-500 tabular-nums">
                            {formatGstTimestamp(t.closedAt)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onSelectEpic(t.epic)}
                              className="font-display font-bold text-slate-900 hover:text-emerald-700 transition-colors"
                            >
                              {t.epic}
                            </button>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`font-semibold ${
                                t.direction === 'BUY'
                                  ? 'text-emerald-700'
                                  : 'text-orange-700'
                              }`}
                            >
                              {t.direction}
                            </span>
                            <span
                              className="text-slate-300 mx-1.5"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className="font-mono text-slate-600">
                              {t.legLabel}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-slate-600">
                            {EXIT_REASON_LABELS[t.exitReason]}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                            {t.size > 0 ? t.size : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                            {t.entryPrice > 0
                              ? formatPrice(t.entryPrice, dec)
                              : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                            {t.exitPrice > 0
                              ? formatPrice(t.exitPrice, dec)
                              : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                            {formatSignedCurrency(t.feeOrSwap, currency)}
                          </td>
                          <td
                            className={`py-3 pl-3 pr-5 text-right font-mono tabular-nums font-semibold ${
                              t.netPnl > 0
                                ? 'text-emerald-700'
                                : t.netPnl < 0
                                  ? 'text-red-600'
                                  : 'text-slate-700'
                            }`}
                          >
                            {formatSignedCurrency(t.netPnl, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
