import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  BrokerPosition,
  InstrumentConfig,
  InstrumentMarketState,
  WorkingLimitOrder,
} from '../shared/types.ts';
import { formatGstTimestamp, formatPrice } from '../lib/format.ts';

interface RenkoChartProps {
  config: InstrumentConfig;
  market: InstrumentMarketState;
  positions: BrokerPosition[];
  orders: WorkingLimitOrder[];
}

export function RenkoChart({
  config,
  market,
  positions,
  orders,
}: RenkoChartProps) {
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);

  const [selectedBrickIdx, setSelectedBrickIdx] = useState<number | null>(null);
  const [hoveredBrickIdx, setHoveredBrickIdx] = useState<number | null>(null);
  const [showSupertrend, setShowSupertrend] = useState(true);
  const [showOrderLines, setShowOrderLines] = useState(true);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Reset inspection and pan when switching instruments
  useEffect(() => {
    setSelectedBrickIdx(null);
    setHoveredBrickIdx(null);
    setPanOffset(0);
    setZoom(1);
  }, [market.epic]);

  const bricks = market.bricks;
  const supertrend = market.supertrend;
  const decimals = config.decimals;

  const activePositions = useMemo(
    () => positions.filter((p) => p.epic === market.epic),
    [positions, market.epic],
  );
  const activeOrders = useMemo(
    () => orders.filter((o) => o.epic === market.epic),
    [orders, market.epic],
  );

  // Compute visible slice based on zoom and pan
  const totalBricks = bricks.length;
  const visibleCount = Math.max(
    8,
    Math.min(totalBricks, Math.round(totalBricks / zoom)),
  );
  const maxPan = Math.max(0, totalBricks - visibleCount);
  const clampedPan = Math.max(0, Math.min(maxPan, panOffset));
  const endIdx = totalBricks - clampedPan;
  const startIdx = Math.max(0, endIdx - visibleCount);

  const visibleBricks = bricks.slice(startIdx, endIdx);
  const visibleSt = supertrend.slice(startIdx, endIdx);

  // Price bounds for Y-axis scaling
  const { minPrice, maxPrice, gridLevels } = useMemo(() => {
    const prices: number[] = [market.mid, market.lastStValue];
    for (const b of visibleBricks) {
      prices.push(b.high, b.low);
    }
    if (showSupertrend) {
      for (const s of visibleSt) {
        prices.push(s.value);
      }
    }
    if (showOrderLines) {
      for (const o of activeOrders) prices.push(o.level);
      for (const p of activePositions) {
        prices.push(p.entryLevel);
        if (p.tpLevel !== null) prices.push(p.tpLevel);
      }
    }

    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    const pad = Math.max(market.brickSize * 1.15, (rawMax - rawMin) * 0.12);
    const lo = rawMin - pad;
    const hi = rawMax + pad;

    const steps = 5;
    const levels: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      levels.push(lo + ((hi - lo) * i) / (steps - 1));
    }

    return { minPrice: lo, maxPrice: hi, gridLevels: levels };
  }, [
    visibleBricks,
    visibleSt,
    market.mid,
    market.lastStValue,
    market.brickSize,
    showSupertrend,
    showOrderLines,
    activeOrders,
    activePositions,
  ]);

  const svgWidth = 1040;
  const svgHeight = isFullScreen ? 560 : 410;
  const padLeft = 28;
  const padRight = 106;
  const padTop = 26;
  const padBottom = 26;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const priceToY = (price: number): number => {
    if (maxPrice <= minPrice) return padTop + plotH / 2;
    const ratio = (maxPrice - price) / (maxPrice - minPrice);
    return padTop + ratio * plotH;
  };

  const count = Math.max(1, visibleBricks.length);
  const slotW = plotW / count;
  const brickW = Math.max(6, Math.min(34, slotW * 0.72));

  const indexToCenterX = (localIdx: number): number =>
    padLeft + localIdx * slotW + slotW / 2;

  // Build segmented Supertrend paths (green for BULLISH, red for BEARISH)
  const stSegments = useMemo(() => {
    if (!showSupertrend || visibleSt.length < 2) return [];
    const segs: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      trend: 'BULLISH' | 'BEARISH';
    }> = [];
    for (let i = 1; i < visibleSt.length; i += 1) {
      const prev = visibleSt[i - 1];
      const curr = visibleSt[i];
      segs.push({
        x1: indexToCenterX(i - 1),
        y1: priceToY(prev.value),
        x2: indexToCenterX(i),
        y2: priceToY(curr.value),
        trend: curr.trend,
      });
    }
    return segs;
  }, [showSupertrend, visibleSt, slotW, minPrice, maxPrice, plotH]);

  const inspectedBrick =
    hoveredBrickIdx !== null
      ? bricks[hoveredBrickIdx]
      : selectedBrickIdx !== null
        ? bricks[selectedBrickIdx]
        : bricks[bricks.length - 1] || null;

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartOffset.current = clampedPan;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const deltaPx = e.clientX - dragStartX.current;
    const deltaBricks = Math.round(deltaPx / Math.max(12, slotW));
    setPanOffset(Math.max(0, Math.min(maxPan, dragStartOffset.current + deltaBricks)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.max(1, Math.min(3.5, Number((prev * factor).toFixed(2)))));
  };

  const activeIndicatorCount =
    (showSupertrend ? 1 : 0) + (showOrderLines ? 1 : 0);

  const signalLabel = market.currentTrend === 'BULLISH' ? 'BUY' : 'SELL';
  const liveY = priceToY(market.mid);
  const stY = priceToY(market.lastStValue);

  const chartBody = (
    <div
      className={`bg-[#0B1120] text-slate-100 rounded-xl border border-slate-800 overflow-hidden flex flex-col ${
        isFullScreen ? 'w-full h-full' : ''
      }`}
    >
      {/* Chart Header Bar */}
      <div className="px-5 py-3.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-display text-lg font-bold tracking-tight text-white">
              {config.displayName}
            </h2>
            <span className="text-xs text-slate-400 font-medium">
              {config.subtitle}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-base font-semibold text-white tabular-nums">
              {formatPrice(market.mid, decimals)}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span
              className={`text-xs font-semibold tracking-wide ${
                config.mode === 'AUTO' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {config.mode === 'AUTO' ? 'AUTO Chart Active' : 'MANUAL Mode'}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums flex-wrap">
            <span>Renko (23h ATR5/5)</span>
            <span aria-hidden="true">·</span>
            <span
              title={`23h ATR(5): ${formatPrice(market.atr5, decimals)} ÷ 5 = ${formatPrice(market.brickSize, decimals)}`}
            >
              Brick: {formatPrice(market.brickSize, decimals)}{' '}
              <span className="text-slate-500">
                (23h ATR(5): {formatPrice(market.atr5, decimals)} ÷ 5)
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                signalLabel === 'BUY' ? 'text-emerald-400' : 'text-orange-400'
              }`}
            >
              {signalLabel} ({market.consecutiveBricks}{' '}
              {market.bricks[market.bricks.length - 1]?.direction === 'DOWN'
                ? 'down'
                : 'up'}{' '}
              bricks)
            </span>
          </div>
        </div>

        {/* Chart Controls */}
        <div className="flex items-center gap-2 shrink-0 relative">
          <div className="flex items-center rounded-lg border border-slate-700/90 bg-slate-900/90 overflow-hidden">
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.min(3.5, Number((z + 0.35).toFixed(2))))
              }
              title="Zoom in"
              aria-label="Zoom in"
              className="px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.max(1, Number((z - 0.35).toFixed(2))))
              }
              title="Zoom out"
              aria-label="Zoom out"
              className="px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white border-l border-slate-700/90 transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            {(zoom > 1 || clampedPan > 0) && (
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPanOffset(0);
                }}
                title="Reset chart zoom"
                aria-label="Reset chart zoom"
                className="px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white border-l border-slate-700/90 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Indicators dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIndicatorsOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Indicators ({activeIndicatorCount})</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {indicatorsOpen && (
              <div className="absolute right-0 mt-1.5 w-60 rounded-lg bg-slate-900 border border-slate-700 shadow-xl p-2 z-20 text-xs">
                <label className="flex items-center justify-between px-2.5 py-2 rounded hover:bg-slate-800 cursor-pointer">
                  <span className="text-slate-200 font-medium">
                    Supertrend ({config.stPeriod}, {config.stMultiplier})
                  </span>
                  <input
                    type="checkbox"
                    checked={showSupertrend}
                    onChange={(e) => setShowSupertrend(e.target.checked)}
                    className="accent-emerald-500 w-3.5 h-3.5"
                  />
                </label>
                <label className="flex items-center justify-between px-2.5 py-2 rounded hover:bg-slate-800 cursor-pointer">
                  <span className="text-slate-200 font-medium">
                    Order &amp; TP Price Lines
                  </span>
                  <input
                    type="checkbox"
                    checked={showOrderLines}
                    onChange={(e) => setShowOrderLines(e.target.checked)}
                    className="accent-emerald-500 w-3.5 h-3.5"
                  />
                </label>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsFullScreen((f) => !f)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
          >
            {isFullScreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Full Screen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Full Screen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main SVG Renko Plot */}
      <div className="relative flex-1 bg-[#0B1120] select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className={`w-full ${isFullScreen ? 'h-[560px]' : 'h-[410px]'} ${
            isDragging ? 'cursor-grabbing' : 'cursor-crosshair'
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setIsDragging(false);
            setHoveredBrickIdx(null);
          }}
          onWheel={handleWheel}
        >
          {/* Horizontal gridlines & right-side Y-axis price ticks */}
          {gridLevels.map((lvl, idx) => {
            const y = priceToY(lvl);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeWidth={1}
                />
                <text
                  x={svgWidth - padRight + 10}
                  y={y + 4}
                  fill="#94A3B8"
                  fontSize={11}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatPrice(lvl, decimals)}
                </text>
              </g>
            );
          })}

          {/* Order & Take-Profit Reference Lines */}
          {showOrderLines &&
            activeOrders.map((ord) => {
              const y = priceToY(ord.level);
              return (
                <g key={ord.dealId}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={svgWidth - padRight}
                    y2={y}
                    stroke="#F59E0B"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    opacity={0.75}
                  />
                  <rect
                    x={svgWidth - padRight + 6}
                    y={y - 9}
                    width={94}
                    height={18}
                    rx={3}
                    fill="#451A03"
                    stroke="#F59E0B"
                    strokeWidth={0.8}
                  />
                  <text
                    x={svgWidth - padRight + 11}
                    y={y + 3.5}
                    fill="#FCD34D"
                    fontSize={10}
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                  >
                    L2 {formatPrice(ord.level, decimals)}
                  </text>
                </g>
              );
            })}

          {showOrderLines &&
            activePositions
              .filter((p) => p.tpLevel !== null)
              .slice(0, 1)
              .map((pos) => {
                const y = priceToY(pos.tpLevel!);
                return (
                  <g key={`tp-${pos.dealId}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="#38BDF8"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      opacity={0.7}
                    />
                    <rect
                      x={svgWidth - padRight + 6}
                      y={y - 9}
                      width={94}
                      height={18}
                      rx={3}
                      fill="#0C4A6E"
                      stroke="#38BDF8"
                      strokeWidth={0.8}
                    />
                    <text
                      x={svgWidth - padRight + 11}
                      y={y + 3.5}
                      fill="#E0F2FE"
                      fontSize={10}
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={600}
                    >
                      TP {formatPrice(pos.tpLevel!, decimals)}
                    </text>
                  </g>
                );
              })}

          {/* Renko Bricks */}
          {visibleBricks.map((brick, localIdx) => {
            const cx = indexToCenterX(localIdx);
            const topY = priceToY(brick.high);
            const bottomY = priceToY(brick.low);
            const rectH = Math.max(4, bottomY - topY);
            const isUp = brick.direction === 'UP';
            const isSelected =
              selectedBrickIdx === brick.index || hoveredBrickIdx === brick.index;

            return (
              <rect
                key={brick.index}
                x={cx - brickW / 2}
                y={topY}
                width={brickW}
                height={rectH}
                rx={2}
                fill={isUp ? '#10B981' : '#F97316'}
                fillOpacity={isSelected ? 1 : 0.92}
                stroke={isSelected ? '#FFFFFF' : isUp ? '#059669' : '#EA580C'}
                strokeWidth={isSelected ? 1.8 : 0.75}
                onMouseEnter={() => setHoveredBrickIdx(brick.index)}
                onClick={() => setSelectedBrickIdx(brick.index)}
                className="cursor-pointer transition-opacity duration-100"
              />
            );
          })}

          {/* Supertrend (1, 2.1) Overlay Line */}
          {stSegments.map((seg, i) => (
            <line
              key={i}
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={seg.trend === 'BULLISH' ? '#10B981' : '#EF4444'}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
          ))}

          {/* Current Supertrend dashed horizontal line + right tag */}
          {showSupertrend && (
            <g>
              <line
                x1={padLeft}
                y1={stY}
                x2={svgWidth - padRight}
                y2={stY}
                stroke={
                  market.currentTrend === 'BULLISH' ? '#10B981' : '#EF4444'
                }
                strokeWidth={1.1}
                strokeDasharray="4 4"
                opacity={0.75}
              />
              <rect
                x={svgWidth - padRight + 6}
                y={stY - 10}
                width={94}
                height={20}
                rx={4}
                fill={market.currentTrend === 'BULLISH' ? '#10B981' : '#EF4444'}
              />
              <text
                x={svgWidth - padRight + 11}
                y={stY + 4}
                fill="#FFFFFF"
                fontSize={10.5}
                fontFamily="JetBrains Mono, monospace"
                fontWeight={700}
              >
                ST {formatPrice(market.lastStValue, decimals)}
              </text>
            </g>
          )}

          {/* Live market price dashed line + crisp white price marker */}
          <g>
            <line
              x1={padLeft}
              y1={liveY}
              x2={svgWidth - padRight}
              y2={liveY}
              stroke="#E2E8F0"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.65}
            />
            <rect
              x={svgWidth - padRight + 6}
              y={liveY - 10}
              width={94}
              height={20}
              rx={4}
              fill="#F8FAFC"
            />
            <text
              x={svgWidth - padRight + 11}
              y={liveY + 4}
              fill="#0F172A"
              fontSize={11}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={700}
            >
              {formatPrice(market.mid, decimals)}
            </text>
          </g>
        </svg>
      </div>

      {/* Chart Inspector Footer */}
      <div className="px-5 py-2.5 border-t border-slate-800/90 bg-[#080D18] flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums">
        {inspectedBrick ? (
          <div className="flex items-center gap-3 text-slate-300 flex-wrap">
            <span className="font-semibold text-white">
              Brick #{inspectedBrick.index} ({inspectedBrick.direction})
            </span>
            <span className="text-slate-400">
              O: {formatPrice(inspectedBrick.open, decimals)}
            </span>
            <span className="text-slate-400">
              C: {formatPrice(inspectedBrick.close, decimals)}
            </span>
            <span className="text-slate-500">
              {formatGstTimestamp(inspectedBrick.timestamp)}
            </span>
          </div>
        ) : (
          <span className="text-slate-400">
            Hover or click any brick to inspect open, close, and timestamp
          </span>
        )}

        <div className="text-slate-400">
          Margin {config.marginPct}% ({config.leverage}x Real)
        </div>
      </div>
    </div>
  );

  if (isFullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/90 p-5 flex items-center justify-center">
        {chartBody}
      </div>
    );
  }

  return chartBody;
}
