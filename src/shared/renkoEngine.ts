import type {
  OhlcCandle,
  RenkoBrick,
  SupertrendPoint,
  TradeDirection,
  TrendDirection,
} from './types.ts';

export function roundPrice(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Groups chronologically ordered 1-hour OHLC candles backwards from the latest
 * candle into contiguous 23-hour synthetic OHLC blocks (oldest -> newest).
 * With 160 hourly candles, yields 6 complete 23-hour blocks -> 5 True Ranges for ATR(5).
 */
export function aggregate23hBlocks(
  hourlyCandles: OhlcCandle[],
  blockHours = 23,
): OhlcCandle[] {
  if (hourlyCandles.length < blockHours) {
    return [];
  }

  const sorted = [...hourlyCandles].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  const blocksReversed: OhlcCandle[] = [];
  for (let end = sorted.length; end >= blockHours; end -= blockHours) {
    const slice = sorted.slice(end - blockHours, end);
    const open = slice[0].open;
    const close = slice[slice.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    blocksReversed.push({
      timestamp: slice[slice.length - 1].timestamp,
      open,
      high,
      low,
      close,
    });
  }

  return blocksReversed.reverse();
}

/**
 * Computes both 23h ATR(5) and dynamic brick size (ATR(5) / 5) from 23h or daily OHLC bars.
 */
export function calculate23hAtr5WithBrick(
  bars: OhlcCandle[],
  decimals: number,
  fallbackBrickSize: number,
  fallbackAtr5?: number,
): { atr5: number; brickSize: number } {
  const safeFallbackAtr5 = roundPrice(
    fallbackAtr5 ?? fallbackBrickSize * 5,
    decimals,
  );

  if (bars.length < 2) {
    return { atr5: safeFallbackAtr5, brickSize: fallbackBrickSize };
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const curr = bars[i];
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose),
    );
    if (Number.isFinite(tr) && tr > 0) {
      trueRanges.push(tr);
    }
  }

  if (trueRanges.length === 0) {
    return { atr5: safeFallbackAtr5, brickSize: fallbackBrickSize };
  }

  const window = trueRanges.slice(-5);
  const rawAtr5 = window.reduce((sum, val) => sum + val, 0) / window.length;
  const rawBrick = rawAtr5 / 5;

  if (!Number.isFinite(rawBrick) || rawBrick <= 0) {
    return { atr5: safeFallbackAtr5, brickSize: fallbackBrickSize };
  }

  const atr5 = roundPrice(rawAtr5, decimals);
  const brickSize = roundPrice(rawBrick, decimals);
  return brickSize > 0
    ? { atr5, brickSize }
    : { atr5: safeFallbackAtr5, brickSize: fallbackBrickSize };
}

/**
 * Computes dynamic brick size from 23h/daily OHLC candles using ATR(5) / 5.
 * Matches the observed Renko (23h ATR5/5) specification across all five assets.
 */
export function calculate23hAtr5Div5(
  dailyCandles: OhlcCandle[],
  decimals: number,
  fallbackBrickSize: number,
): number {
  return calculate23hAtr5WithBrick(dailyCandles, decimals, fallbackBrickSize)
    .brickSize;
}

/**
 * Zero-aligned standard 2-brick reversal Renko builder (no wicks, uniform brick height).
 * Every brick open & close sits strictly on an exact integer multiple of brickSize (k * B):
 * - Initial grid anchor: floor(candles[0].close / B) * B
 * - Continuation: opens at prior brick close (k * B), moves +/- 1 * B.
 * - Reversal: requires +/- 2 * B from prior brick close; opens at prior brick open.
 */
export function buildRenkoBricks(
  candles: OhlcCandle[],
  brickSize: number,
  decimals: number,
): RenkoBrick[] {
  if (candles.length === 0 || !Number.isFinite(brickSize) || brickSize <= 0) {
    return [];
  }

  const levelAt = (gridIdx: number): number =>
    roundPrice(gridIdx * brickSize, decimals);
  const eps = 1e-9;

  const bricks: RenkoBrick[] = [];
  let anchorIdx = Math.floor(candles[0].close / brickSize + eps);
  let lastDir: 'UP' | 'DOWN' | null = null;
  let lastOpenIdx = anchorIdx;
  let lastCloseIdx = anchorIdx;

  for (let i = 1; i < candles.length; i += 1) {
    const price = candles[i].close;
    const ts = candles[i].timestamp;

    if (lastDir === null) {
      const upTarget = levelAt(anchorIdx + 1);
      const downTarget = levelAt(anchorIdx - 1);

      if (price >= upTarget - eps) {
        while (price >= levelAt(anchorIdx + 1) - eps) {
          const open = levelAt(anchorIdx);
          const close = levelAt(anchorIdx + 1);
          bricks.push({
            index: bricks.length,
            open,
            close,
            high: close,
            low: open,
            direction: 'UP',
            timestamp: ts,
          });
          lastOpenIdx = anchorIdx;
          lastCloseIdx = anchorIdx + 1;
          anchorIdx += 1;
          lastDir = 'UP';
        }
      } else if (price <= downTarget + eps) {
        while (price <= levelAt(anchorIdx - 1) + eps) {
          const open = levelAt(anchorIdx);
          const close = levelAt(anchorIdx - 1);
          bricks.push({
            index: bricks.length,
            open,
            close,
            high: open,
            low: close,
            direction: 'DOWN',
            timestamp: ts,
          });
          lastOpenIdx = anchorIdx;
          lastCloseIdx = anchorIdx - 1;
          anchorIdx -= 1;
          lastDir = 'DOWN';
        }
      }
      continue;
    }

    if (lastDir === 'UP') {
      // Continuation UP (+1 brick from lastCloseIdx)
      while (price >= levelAt(lastCloseIdx + 1) - eps) {
        const open = levelAt(lastCloseIdx);
        const close = levelAt(lastCloseIdx + 1);
        bricks.push({
          index: bricks.length,
          open,
          close,
          high: close,
          low: open,
          direction: 'UP',
          timestamp: ts,
        });
        lastOpenIdx = lastCloseIdx;
        lastCloseIdx += 1;
      }

      // Reversal DOWN (-2 bricks from lastCloseIdx, opens at lastOpenIdx)
      if (price <= levelAt(lastOpenIdx - 1) + eps) {
        let revOpenIdx = lastOpenIdx;
        while (price <= levelAt(revOpenIdx - 1) + eps) {
          const open = levelAt(revOpenIdx);
          const close = levelAt(revOpenIdx - 1);
          bricks.push({
            index: bricks.length,
            open,
            close,
            high: open,
            low: close,
            direction: 'DOWN',
            timestamp: ts,
          });
          lastOpenIdx = revOpenIdx;
          lastCloseIdx = revOpenIdx - 1;
          lastDir = 'DOWN';
          revOpenIdx = lastCloseIdx;
        }
      }
    } else {
      // Continuation DOWN (-1 brick from lastCloseIdx)
      while (price <= levelAt(lastCloseIdx - 1) + eps) {
        const open = levelAt(lastCloseIdx);
        const close = levelAt(lastCloseIdx - 1);
        bricks.push({
          index: bricks.length,
          open,
          close,
          high: open,
          low: close,
          direction: 'DOWN',
          timestamp: ts,
        });
        lastOpenIdx = lastCloseIdx;
        lastCloseIdx -= 1;
      }

      // Reversal UP (+2 bricks from lastCloseIdx, opens at lastOpenIdx)
      if (price >= levelAt(lastOpenIdx + 1) - eps) {
        let revOpenIdx = lastOpenIdx;
        while (price >= levelAt(revOpenIdx + 1) - eps) {
          const open = levelAt(revOpenIdx);
          const close = levelAt(revOpenIdx + 1);
          bricks.push({
            index: bricks.length,
            open,
            close,
            high: close,
            low: open,
            direction: 'UP',
            timestamp: ts,
          });
          lastOpenIdx = revOpenIdx;
          lastCloseIdx = revOpenIdx + 1;
          lastDir = 'UP';
          revOpenIdx = lastCloseIdx;
        }
      }
    }
  }

  return bricks;
}

/**
 * Exact Supertrend(period, multiplier) over Renko bricks.
 * With default (1, 2.1):
 * - On continuation bricks, ATR(1) = TR = BrickSize, so active ST = hl2 +/- 2.1 * BrickSize.
 * - A 1-brick counter-move closes 1.0 * BrickSize past peak open (< 1.6 * BrickSize), holding ST flat.
 * - A 2nd consecutive opposite brick closes 2.0 * BrickSize past peak open (> 1.6 * BrickSize), flipping trend.
 */
export function calculateSupertrend(
  bricks: RenkoBrick[],
  period = 1,
  multiplier = 2.1,
  decimals = 2,
): SupertrendPoint[] {
  if (bricks.length === 0) {
    return [];
  }

  const safePeriod = Math.max(1, Math.round(period));
  const trValues: number[] = [];
  const atrValues: number[] = [];

  for (let i = 0; i < bricks.length; i += 1) {
    const b = bricks[i];
    if (i === 0) {
      trValues.push(b.high - b.low);
    } else {
      const prevClose = bricks[i - 1].close;
      const tr = Math.max(
        b.high - b.low,
        Math.abs(b.high - prevClose),
        Math.abs(b.low - prevClose),
      );
      trValues.push(tr);
    }

    if (safePeriod === 1) {
      atrValues.push(trValues[i]);
    } else if (i < safePeriod) {
      const slice = trValues.slice(0, i + 1);
      atrValues.push(slice.reduce((a, c) => a + c, 0) / slice.length);
    } else {
      // Wilder RMA
      const prevAtr = atrValues[i - 1];
      atrValues.push((prevAtr * (safePeriod - 1) + trValues[i]) / safePeriod);
    }
  }

  const points: SupertrendPoint[] = [];

  for (let i = 0; i < bricks.length; i += 1) {
    const b = bricks[i];
    const hl2 = (b.high + b.low) / 2;
    const atr = atrValues[i];
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    if (i === 0) {
      const initialTrend: TrendDirection =
        b.direction === 'UP' ? 'BULLISH' : 'BEARISH';
      points.push({
        brickIndex: b.index,
        upperBand: roundPrice(basicUpper, decimals),
        lowerBand: roundPrice(basicLower, decimals),
        value: roundPrice(
          initialTrend === 'BULLISH' ? basicLower : basicUpper,
          decimals,
        ),
        trend: initialTrend,
      });
      continue;
    }

    const prev = points[i - 1];
    const prevClose = bricks[i - 1].close;

    const finalUpper =
      basicUpper < prev.upperBand || prevClose > prev.upperBand
        ? basicUpper
        : prev.upperBand;

    const finalLower =
      basicLower > prev.lowerBand || prevClose < prev.lowerBand
        ? basicLower
        : prev.lowerBand;

    let trend: TrendDirection = prev.trend;
    if (prev.trend === 'BULLISH' && b.close < finalLower) {
      trend = 'BEARISH';
    } else if (prev.trend === 'BEARISH' && b.close > finalUpper) {
      trend = 'BULLISH';
    }

    const value = trend === 'BULLISH' ? finalLower : finalUpper;

    points.push({
      brickIndex: b.index,
      upperBand: roundPrice(finalUpper, decimals),
      lowerBand: roundPrice(finalLower, decimals),
      value: roundPrice(value, decimals),
      trend,
    });
  }

  return points;
}

export function countConsecutiveBricks(bricks: RenkoBrick[]): number {
  if (bricks.length === 0) return 0;
  const lastDir = bricks[bricks.length - 1].direction;
  let count = 0;
  for (let i = bricks.length - 1; i >= 0; i -= 1) {
    if (bricks[i].direction === lastDir) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Exact mirrored 2-leg order calculation:
 * - BUY:  LEG1 LIMIT @ close (TP = close + 5*B, No SL); LEG2 LIMIT @ close - 0.5*B (No TP, No SL)
 * - SELL: LEG1 LIMIT @ close (TP = close - 5*B, No SL); LEG2 LIMIT @ close + 0.5*B (No TP, No SL)
 */
export function calculateTwoLegOrders(
  direction: TradeDirection,
  signalBrickClose: number,
  brickSize: number,
  decimals: number,
): {
  leg1Level: number;
  leg1Tp: number;
  leg2Level: number;
} {
  if (direction === 'BUY') {
    return {
      leg1Level: roundPrice(signalBrickClose, decimals),
      leg1Tp: roundPrice(signalBrickClose + 5 * brickSize, decimals),
      leg2Level: roundPrice(signalBrickClose - 0.5 * brickSize, decimals),
    };
  }

  return {
    leg1Level: roundPrice(signalBrickClose, decimals),
    leg1Tp: roundPrice(signalBrickClose - 5 * brickSize, decimals),
    leg2Level: roundPrice(signalBrickClose + 0.5 * brickSize, decimals),
  };
}
