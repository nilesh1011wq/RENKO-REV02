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
 * Computes dynamic brick size from 23h/daily OHLC candles using ATR(5) / 5.
 * Matches the observed Renko (23h ATR5/5) specification across all five assets.
 */
export function calculate23hAtr5Div5(
  dailyCandles: OhlcCandle[],
  decimals: number,
  fallbackBrickSize: number,
): number {
  if (dailyCandles.length < 2) {
    return fallbackBrickSize;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < dailyCandles.length; i += 1) {
    const curr = dailyCandles[i];
    const prevClose = dailyCandles[i - 1].close;
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
    return fallbackBrickSize;
  }

  const window = trueRanges.slice(-5);
  const atr5 = window.reduce((sum, val) => sum + val, 0) / window.length;
  const rawBrick = atr5 / 5;

  if (!Number.isFinite(rawBrick) || rawBrick <= 0) {
    return fallbackBrickSize;
  }

  const rounded = roundPrice(rawBrick, decimals);
  return rounded > 0 ? rounded : fallbackBrickSize;
}

/**
 * Standard 2-brick reversal Renko builder (no wicks, uniform brick height).
 * - Continuation: opens at prior brick close, moves +/- 1 * brickSize.
 * - Reversal: requires +/- 2 * brickSize from prior brick close; opens at prior brick open.
 */
export function buildRenkoBricks(
  candles: OhlcCandle[],
  brickSize: number,
  decimals: number,
): RenkoBrick[] {
  if (candles.length === 0 || !Number.isFinite(brickSize) || brickSize <= 0) {
    return [];
  }

  const bricks: RenkoBrick[] = [];
  let anchor = roundPrice(candles[0].close, decimals);
  let lastDir: 'UP' | 'DOWN' | null = null;
  let lastOpen = anchor;
  let lastClose = anchor;

  for (let i = 1; i < candles.length; i += 1) {
    const price = candles[i].close;
    const ts = candles[i].timestamp;

    if (lastDir === null) {
      const diff = price - anchor;
      if (Math.abs(diff) >= brickSize) {
        const count = Math.floor(Math.abs(diff) / brickSize);
        const dir: 'UP' | 'DOWN' = diff > 0 ? 'UP' : 'DOWN';
        for (let k = 0; k < count; k += 1) {
          const open = roundPrice(anchor, decimals);
          const close = roundPrice(
            dir === 'UP' ? open + brickSize : open - brickSize,
            decimals,
          );
          bricks.push({
            index: bricks.length,
            open,
            close,
            high: Math.max(open, close),
            low: Math.min(open, close),
            direction: dir,
            timestamp: ts,
          });
          anchor = close;
          lastOpen = open;
          lastClose = close;
          lastDir = dir;
        }
      }
      continue;
    }

    if (lastDir === 'UP') {
      // Continuation UP (+1 brick from lastClose)
      while (price >= lastClose + brickSize - 1e-9) {
        const open = roundPrice(lastClose, decimals);
        const close = roundPrice(open + brickSize, decimals);
        bricks.push({
          index: bricks.length,
          open,
          close,
          high: close,
          low: open,
          direction: 'UP',
          timestamp: ts,
        });
        lastOpen = open;
        lastClose = close;
      }

      // Reversal DOWN (-2 bricks from lastClose, opens at lastOpen)
      if (price <= lastOpen - brickSize + 1e-9) {
        let revOpen = roundPrice(lastOpen, decimals);
        while (price <= revOpen - brickSize + 1e-9) {
          const close = roundPrice(revOpen - brickSize, decimals);
          bricks.push({
            index: bricks.length,
            open: revOpen,
            close,
            high: revOpen,
            low: close,
            direction: 'DOWN',
            timestamp: ts,
          });
          lastOpen = revOpen;
          lastClose = close;
          lastDir = 'DOWN';
          revOpen = close;
        }
      }
    } else {
      // Continuation DOWN (-1 brick from lastClose)
      while (price <= lastClose - brickSize + 1e-9) {
        const open = roundPrice(lastClose, decimals);
        const close = roundPrice(open - brickSize, decimals);
        bricks.push({
          index: bricks.length,
          open,
          close,
          high: open,
          low: close,
          direction: 'DOWN',
          timestamp: ts,
        });
        lastOpen = open;
        lastClose = close;
      }

      // Reversal UP (+2 bricks from lastClose, opens at lastOpen)
      if (price >= lastOpen + brickSize - 1e-9) {
        let revOpen = roundPrice(lastOpen, decimals);
        while (price >= revOpen + brickSize - 1e-9) {
          const close = roundPrice(revOpen + brickSize, decimals);
          bricks.push({
            index: bricks.length,
            open: revOpen,
            close,
            high: close,
            low: revOpen,
            direction: 'UP',
            timestamp: ts,
          });
          lastOpen = revOpen;
          lastClose = close;
          lastDir = 'UP';
          revOpen = close;
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
