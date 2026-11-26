import {
  buildRenkoBricks,
  calculate23hAtr5Div5,
  calculateSupertrend,
  calculateTwoLegOrders,
  countConsecutiveBricks,
  roundPrice,
} from '../src/shared/renkoEngine.ts';
import {
  EPIC_LIST,
  type BrokerEnvironment,
  type BrokerPosition,
  type BrokerStatus,
  type ClosedTradeRecord,
  type DailyPnlBucket,
  type DashboardSnapshot,
  type EpicSymbol,
  type ExecutionHistoryItem,
  type InstrumentConfig,
  type InstrumentMarketState,
  type InstrumentPnlBreakdown,
  type OhlcCandle,
  type PnlReportResponse,
  type SignalLockState,
  type TradeDirection,
  type TrendDirection,
  type WorkingLimitOrder,
} from '../src/shared/types.ts';
import { CapitalApiClient } from './capitalClient.ts';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_CONFIGS: Record<EpicSymbol, InstrumentConfig> = {
  GOLD: {
    epic: 'GOLD',
    displayName: 'GOLD',
    subtitle: 'XAUUSD',
    decimals: 2,
    leverage: 500,
    marginPct: 0.2,
    mode: 'AUTO',
    sizingMode: 'LOT',
    lot1: 0.1,
    lot2: 0.1,
    margin1: 1,
    margin2: 1,
    stEnabled: true,
    stPeriod: 1,
    stMultiplier: 2.1,
    minSize: 0.01,
    sizeStep: 0.01,
  },
  US100: {
    epic: 'US100',
    displayName: 'US100',
    subtitle: 'NASDAQ 100',
    decimals: 1,
    leverage: 500,
    marginPct: 0.2,
    mode: 'AUTO',
    sizingMode: 'LOT',
    lot1: 0.1,
    lot2: 0.1,
    margin1: 5,
    margin2: 5,
    stEnabled: true,
    stPeriod: 1,
    stMultiplier: 2.1,
    minSize: 0.1,
    sizeStep: 0.1,
  },
  OIL_CRUDE: {
    epic: 'OIL_CRUDE',
    displayName: 'OIL_CRUDE',
    subtitle: 'USOIL',
    decimals: 2,
    leverage: 500,
    marginPct: 0.2,
    mode: 'AUTO',
    sizingMode: 'LOT',
    lot1: 10,
    lot2: 10,
    margin1: 2,
    margin2: 2,
    stEnabled: true,
    stPeriod: 1,
    stMultiplier: 2.1,
    minSize: 1,
    sizeStep: 1,
  },
  BTCUSD: {
    epic: 'BTCUSD',
    displayName: 'BTCUSD',
    subtitle: 'BTC/USD',
    decimals: 2,
    leverage: 20,
    marginPct: 5,
    mode: 'AUTO',
    sizingMode: 'LOT',
    lot1: 0.01,
    lot2: 0.01,
    margin1: 30,
    margin2: 30,
    stEnabled: true,
    stPeriod: 1,
    stMultiplier: 2.1,
    minSize: 0.01,
    sizeStep: 0.01,
  },
  ETHUSD: {
    epic: 'ETHUSD',
    displayName: 'ETHUSD',
    subtitle: 'ETH/USD',
    decimals: 2,
    leverage: 20,
    marginPct: 5,
    mode: 'AUTO',
    sizingMode: 'LOT',
    lot1: 0.1,
    lot2: 0.1,
    margin1: 10,
    margin2: 10,
    stEnabled: true,
    stPeriod: 1,
    stMultiplier: 2.1,
    minSize: 0.1,
    sizeStep: 0.1,
  },
};

interface SimAssetSeed {
  baseBrick: number;
  startPrice: number;
  spread: number;
  // Sequence of brick steps (+1 = UP, -1 = DOWN) to construct faithful starting charts
  brickPattern: number[];
  liveOffset: number;
}

const SIM_SEEDS: Record<EpicSymbol, SimAssetSeed> = {
  GOLD: {
    baseBrick: 29.99,
    startPrice: 3718.76,
    spread: 0.5,
    // 1 UP, 7 DOWN, 5 UP, 7 DOWN, 4 UP (exact structure from reference charts)
    brickPattern: [
      1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
      1, 1, 1, 1,
    ],
    liveOffset: -26.0,
  },
  US100: {
    baseBrick: 274.5,
    startPrice: 27450.0,
    spread: 1.8,
    // 1 UP, 8 DOWN, 5 UP, 5 DOWN, 2 UP
    brickPattern: [
      1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, 1,
      1,
    ],
    liveOffset: 84.5,
  },
  OIL_CRUDE: {
    baseBrick: 0.72,
    startPrice: 82.08,
    spread: 0.04,
    // 2 UP, 2 DOWN, 2 UP, 5 DOWN, 6 UP
    brickPattern: [1, 1, -1, -1, 1, 1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1],
    liveOffset: -0.39,
  },
  BTCUSD: {
    baseBrick: 649.11,
    startPrice: 59069.01,
    spread: 50.0,
    // 4 DOWN, 6 UP, 1 DOWN pullback (ST stays green!), 6 UP, 8 DOWN, 3 UP
    brickPattern: [
      -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1,
      -1, -1, -1, -1, 1, 1, 1,
    ],
    liveOffset: 59.34,
  },
  ETHUSD: {
    baseBrick: 19.84,
    startPrice: 1626.88,
    spread: 1.75,
    // 3 DOWN, 6 UP, 1 DOWN pullback (ST stays green!), 7 UP, 9 DOWN, 2 UP
    brickPattern: [
      -1, -1, -1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1,
      -1, -1, -1, -1, 1, 1,
    ],
    liveOffset: -0.35,
  },
};

function generateSeedCandles(
  seed: SimAssetSeed,
  decimals: number,
): OhlcCandle[] {
  const candles: OhlcCandle[] = [];
  const now = Date.now();
  const totalSteps = seed.brickPattern.length;
  const stepMs = 45 * 60 * 1000; // 45m spacing aligned to 15m clock marks
  const startTime =
    Math.floor((now - (totalSteps + 2) * stepMs) / (15 * 60 * 1000)) *
    (15 * 60 * 1000);

  let currentOpen = seed.startPrice;
  let currentClose = seed.startPrice;
  let prevDir: number | null = null;

  candles.push({
    timestamp: new Date(startTime).toISOString(),
    open: roundPrice(seed.startPrice, decimals),
    high: roundPrice(seed.startPrice + seed.baseBrick * 0.2, decimals),
    low: roundPrice(seed.startPrice - seed.baseBrick * 0.2, decimals),
    close: roundPrice(seed.startPrice, decimals),
  });

  for (let i = 0; i < seed.brickPattern.length; i += 1) {
    const dir = seed.brickPattern[i];
    const ts = new Date(startTime + (i + 1) * stepMs).toISOString();

    let nextClose: number;
    if (prevDir === null || prevDir === dir) {
      currentOpen = currentClose;
      nextClose = currentClose + dir * seed.baseBrick;
    } else {
      // 2-brick reversal
      currentOpen = currentOpen;
      nextClose = currentOpen + dir * seed.baseBrick;
    }

    const closeRounded = roundPrice(nextClose + dir * seed.baseBrick * 0.02, decimals);
    candles.push({
      timestamp: ts,
      open: roundPrice(currentClose, decimals),
      high: roundPrice(Math.max(currentClose, closeRounded) + seed.baseBrick * 0.1, decimals),
      low: roundPrice(Math.min(currentClose, closeRounded) - seed.baseBrick * 0.1, decimals),
      close: closeRounded,
    });

    currentClose = roundPrice(nextClose, decimals);
    prevDir = dir;
  }

  // Final live tick offset
  const livePrice = roundPrice(currentClose + seed.liveOffset, decimals);
  candles.push({
    timestamp: new Date(now).toISOString(),
    open: currentClose,
    high: Math.max(currentClose, livePrice),
    low: Math.min(currentClose, livePrice),
    close: livePrice,
  });

  return candles;
}

export class TradingEngine {
  private capital = new CapitalApiClient();
  private environment: BrokerEnvironment;
  private configs: Record<EpicSymbol, InstrumentConfig>;
  private simCandles: Record<EpicSymbol, OhlcCandle[]>;
  private markets: Record<EpicSymbol, InstrumentMarketState>;
  private positions: BrokerPosition[] = [];
  private orders: WorkingLimitOrder[] = [];
  private history: ExecutionHistoryItem[] = [];
  private closedTrades: ClosedTradeRecord[] = [];
  private signalLocks: Record<EpicSymbol, SignalLockState | null>;
  private previousTrends: Record<EpicSymbol, TrendDirection>;
  private simBalance = 12500.0;
  private lastSyncAt = new Date().toISOString();
  private errorMessage: string | null = null;
  private ownerUid: string;
  private isAdminWorkspace: boolean;
  private allowBrokerSecrets: boolean;
  private globalAutoEnabled: boolean;
  private maxLotCap: number;
  private cachedLiveAccount: {
    accountName: string;
    accountId: string;
    currency: string;
    balance: number;
    equity: number;
    available: number;
    profitLoss: number;
  } | null = null;

  constructor(options?: {
    ownerUid?: string;
    isAdminWorkspace?: boolean;
    allowBrokerSecrets?: boolean;
    globalAutoEnabled?: boolean;
    maxLotCap?: number;
  }) {
    this.ownerUid = options?.ownerUid || 'anonymous';
    this.isAdminWorkspace = options?.isAdminWorkspace ?? false;
    this.allowBrokerSecrets = options?.allowBrokerSecrets ?? false;
    this.globalAutoEnabled = options?.globalAutoEnabled ?? true;
    this.maxLotCap = options?.maxLotCap ?? 100;

    const defaultEnv =
      this.allowBrokerSecrets &&
      process.env.CAPITAL_DEFAULT_ENV?.toUpperCase() === 'LIVE'
        ? 'LIVE'
        : 'DEMO';
    this.environment = defaultEnv;

    this.configs = structuredClone(DEFAULT_CONFIGS);
    this.simCandles = {} as Record<EpicSymbol, OhlcCandle[]>;
    this.markets = {} as Record<EpicSymbol, InstrumentMarketState>;
    this.signalLocks = {
      GOLD: null,
      US100: null,
      OIL_CRUDE: null,
      BTCUSD: null,
      ETHUSD: null,
    };
    this.previousTrends = {
      GOLD: 'BULLISH',
      US100: 'BULLISH',
      OIL_CRUDE: 'BULLISH',
      BTCUSD: 'BULLISH',
      ETHUSD: 'BULLISH',
    };

    for (const epic of EPIC_LIST) {
      this.simCandles[epic] = generateSeedCandles(
        SIM_SEEDS[epic],
        this.configs[epic].decimals,
      );
      this.rebuildSimMarket(epic);
      this.previousTrends[epic] = this.markets[epic].currentTrend;
    }

    this.seedInitialPreviewTrades();
    this.seedHistoricalClosedTrades();
  }

  public setGovernancePolicy(policy: {
    isAdminWorkspace: boolean;
    allowBrokerSecrets: boolean;
    globalAutoEnabled: boolean;
    maxLotCap: number;
  }): void {
    this.isAdminWorkspace = policy.isAdminWorkspace;
    this.allowBrokerSecrets = policy.allowBrokerSecrets;
    this.globalAutoEnabled = policy.globalAutoEnabled;
    this.maxLotCap = policy.maxLotCap;
    if (!this.allowBrokerSecrets && this.environment === 'LIVE') {
      this.environment = 'DEMO';
      this.cachedLiveAccount = null;
    }
  }

  public applyPersistedConfigs(
    savedConfigs: Partial<
      Record<
        EpicSymbol,
        Partial<
          Pick<
            InstrumentConfig,
            | 'mode'
            | 'sizingMode'
            | 'lot1'
            | 'lot2'
            | 'margin1'
            | 'margin2'
            | 'stEnabled'
            | 'stPeriod'
            | 'stMultiplier'
          >
        >
      >
    >,
  ): void {
    for (const epic of EPIC_LIST) {
      const patch = savedConfigs[epic];
      if (patch) {
        this.updateConfig(epic, patch);
      }
    }
  }

  private isLiveBrokerActive(): boolean {
    return this.allowBrokerSecrets && this.capital.isConfigured(this.environment);
  }

  private getEffectiveSize(
    config: InstrumentConfig,
    leg: 1 | 2,
    price: number,
  ): number {
    if (config.sizingMode === 'LOT') {
      return leg === 1 ? config.lot1 : config.lot2;
    }
    const targetMargin = leg === 1 ? config.margin1 : config.margin2;
    if (price <= 0) return config.minSize;
    const rawSize = (targetMargin * config.leverage) / price;
    const stepped = Math.max(
      config.minSize,
      Math.round(rawSize / config.sizeStep) * config.sizeStep,
    );
    return roundPrice(stepped, 4);
  }

  private calcMargin(size: number, price: number, leverage: number): number {
    return roundPrice((size * price) / leverage, 2);
  }

  private seedInitialPreviewTrades(): void {
    // Seed realistic initial positions, working midpoint limits, and history matching the active BULLISH cycle
    const now = Date.now();
    for (let idx = 0; idx < EPIC_LIST.length; idx += 1) {
      const epic = EPIC_LIST[idx];
      const config = this.configs[epic];
      const market = this.markets[epic];
      const bricks = market.bricks;
      if (bricks.length < 3) continue;

      // Find the 2nd green brick (the flip signal brick)
      const flipBrickIndex = Math.max(
        0,
        bricks.length - Math.max(1, market.consecutiveBricks - 1),
      );
      const signalBrick = bricks[flipBrickIndex] || bricks[bricks.length - 1];
      const { leg1Level, leg1Tp, leg2Level } = calculateTwoLegOrders(
        'BUY',
        signalBrick.close,
        market.brickSize,
        config.decimals,
      );

      const leg1Size = config.lot1;
      const leg2Size = config.lot2;
      const ts = new Date(now - (idx + 1) * 38 * 60 * 1000).toISOString();
      const leg1DealId = uid(`pos-${epic.toLowerCase()}-l1`);
      const leg2DealId = uid(`ord-${epic.toLowerCase()}-l2`);
      const isBtcFallback = epic === 'BTCUSD';

      // Open filled LEG1 position
      const entry = isBtcFallback
        ? roundPrice(leg1Level - market.spread * 0.4, config.decimals)
        : leg1Level;
      const pnl = roundPrice((market.bid - entry) * leg1Size, 2);

      this.positions.push({
        dealId: leg1DealId,
        epic,
        direction: 'BUY',
        size: leg1Size,
        entryLevel: entry,
        currentLevel: market.bid,
        tpLevel: leg1Tp,
        slLevel: null,
        pnl,
        margin: this.calcMargin(leg1Size, entry, config.leverage),
        leverage: config.leverage,
        source: isBtcFallback ? 'AUTO' : 'CHART_EXT',
        legLabel: 'LEG 1',
        openedAt: ts,
      });

      // Working LEG2 midpoint LIMIT order
      this.orders.push({
        dealId: leg2DealId,
        epic,
        direction: 'BUY',
        type: 'LIMIT',
        level: leg2Level,
        size: leg2Size,
        tpLevel: null,
        slLevel: null,
        source: 'AUTO',
        legLabel: 'LEG 2',
        createdAt: ts,
      });

      // History entries (LEG1 + LEG2)
      this.history.unshift({
        id: uid('hist'),
        epic,
        direction: 'BUY',
        source: 'AUTO',
        eventType: isBtcFallback ? 'LEG1_MARKET' : 'LEG1_LIMIT',
        status: isBtcFallback ? 'OPEN' : 'WORKING',
        size: leg1Size,
        price: leg1Level,
        tpLevel: leg1Tp,
        margin: this.calcMargin(leg1Size, leg1Level, config.leverage),
        leverage: config.leverage,
        note: isBtcFallback
          ? `AUTO BUY 1 MARKET (2nd attempt after LIMIT rejection) @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`
          : `AUTO BUY 1 LIMIT @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`,
        timestamp: ts,
      });

      this.history.unshift({
        id: uid('hist'),
        epic,
        direction: 'BUY',
        source: 'AUTO',
        eventType: 'LEG2_LIMIT',
        status: 'WORKING',
        size: leg2Size,
        price: leg2Level,
        tpLevel: null,
        margin: this.calcMargin(leg2Size, leg2Level, config.leverage),
        leverage: config.leverage,
        note: `AUTO BUY 2 LIMIT @ midpoint ${leg2Level} (No TP, No SL)`,
        timestamp: ts,
      });

      this.signalLocks[epic] = {
        direction: 'BUY',
        lockedAt: ts,
        brickClose: signalBrick.close,
        brickSize: market.brickSize,
        leg1DealId,
        leg2DealId,
        leg1OrderType: isBtcFallback ? 'MARKET' : 'LIMIT',
        leg1Filled: true,
        leg2Filled: false,
      };
    }

    // Also add one filled LEG2 position on OIL_CRUDE to mirror the multi-leg view
    const oilMarket = this.markets.OIL_CRUDE;
    const oilCfg = this.configs.OIL_CRUDE;
    const oilEntry = roundPrice(oilMarket.mid - oilMarket.brickSize * 1.15, oilCfg.decimals);
    this.positions.unshift({
      dealId: uid('pos-oil-l2'),
      epic: 'OIL_CRUDE',
      direction: 'BUY',
      size: oilCfg.lot2,
      entryLevel: oilEntry,
      currentLevel: oilMarket.bid,
      tpLevel: null,
      slLevel: null,
      pnl: roundPrice((oilMarket.bid - oilEntry) * oilCfg.lot2, 2),
      margin: this.calcMargin(oilCfg.lot2, oilEntry, oilCfg.leverage),
      leverage: oilCfg.leverage,
      source: 'CHART_EXT',
      legLabel: 'LEG 2',
      openedAt: new Date(now - 95 * 60 * 1000).toISOString(),
    });
  }

  private rebuildSimMarket(epic: EpicSymbol): void {
    const config = this.configs[epic];
    const seed = SIM_SEEDS[epic];
    const candles = this.simCandles[epic];
    const brickSize = seed.baseBrick;

    const bricks = buildRenkoBricks(candles, brickSize, config.decimals);
    const supertrend = calculateSupertrend(
      bricks,
      config.stPeriod,
      config.stMultiplier,
      config.decimals,
    );

    const lastCandle = candles[candles.length - 1];
    const firstCandle = candles[0];
    const mid = lastCandle.close;
    const halfSpread = seed.spread / 2;
    const bid = roundPrice(mid - halfSpread, config.decimals);
    const ask = roundPrice(mid + halfSpread, config.decimals);

    const recentSlice = candles.slice(-24);
    const high24h = roundPrice(
      Math.max(...recentSlice.map((c) => c.high)),
      config.decimals,
    );
    const low24h = roundPrice(
      Math.min(...recentSlice.map((c) => c.low)),
      config.decimals,
    );

    const refPrice = recentSlice[0]?.open || firstCandle.open;
    const change = roundPrice(mid - refPrice, config.decimals);
    const changePct = refPrice > 0 ? roundPrice((change / refPrice) * 100, 2) : 0;

    const lastBrick = bricks[bricks.length - 1];
    const lastSt = supertrend[supertrend.length - 1];

    this.markets[epic] = {
      epic,
      bid,
      ask,
      mid,
      spread: seed.spread,
      high24h,
      low24h,
      change,
      changePct,
      brickSize,
      bricks,
      supertrend,
      currentTrend: lastSt?.trend || 'BULLISH',
      consecutiveBricks: countConsecutiveBricks(bricks),
      lastBrickClose: lastBrick?.close ?? mid,
      lastStValue: lastSt?.value ?? mid,
      signalLock: this.signalLocks[epic],
      lastEvaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Advances simulated live quotes gently in Preview mode, checks limit fills & 5-brick TP hits,
   * and evaluates automated Supertrend flips.
   */
  public tickSimulation(): void {
    if (this.isLiveBrokerActive()) {
      return;
    }

    for (const epic of EPIC_LIST) {
      const cfg = this.configs[epic];
      const seed = SIM_SEEDS[epic];
      const candles = this.simCandles[epic];
      const last = candles[candles.length - 1];

      // Subtle realistic micro-tick (~3% of brick size)
      const drift = (Math.random() - 0.5) * seed.baseBrick * 0.06;
      const nextClose = roundPrice(
        Math.max(seed.baseBrick * 2, last.close + drift),
        cfg.decimals,
      );

      last.close = nextClose;
      last.high = Math.max(last.high, nextClose);
      last.low = Math.min(last.low, nextClose);
      last.timestamp = new Date().toISOString();

      this.rebuildSimMarket(epic);
      this.processSimOrderFillsAndTp(epic);
      this.evaluateAutomatedStrategySim(epic);
    }

    this.lastSyncAt = new Date().toISOString();
  }

  private processSimOrderFillsAndTp(epic: EpicSymbol): void {
    const market = this.markets[epic];
    const cfg = this.configs[epic];

    // Check working LIMIT fills
    const remainingOrders: WorkingLimitOrder[] = [];
    for (const ord of this.orders) {
      if (ord.epic !== epic) {
        remainingOrders.push(ord);
        continue;
      }

      const buyHit = ord.direction === 'BUY' && market.ask <= ord.level;
      const sellHit = ord.direction === 'SELL' && market.bid >= ord.level;

      if (buyHit || sellHit) {
        const fillPrice = ord.level;
        const posId = uid(`pos-${epic.toLowerCase()}`);
        this.positions.unshift({
          dealId: posId,
          epic,
          direction: ord.direction,
          size: ord.size,
          entryLevel: fillPrice,
          currentLevel: ord.direction === 'BUY' ? market.bid : market.ask,
          tpLevel: ord.tpLevel,
          slLevel: ord.slLevel,
          pnl: 0,
          margin: this.calcMargin(ord.size, fillPrice, cfg.leverage),
          leverage: cfg.leverage,
          source: ord.source === 'AUTO' ? 'CHART_EXT' : ord.source,
          legLabel: ord.legLabel,
          openedAt: new Date().toISOString(),
        });

        const lock = this.signalLocks[epic];
        if (lock && lock.leg1DealId === ord.dealId) {
          lock.leg1DealId = posId;
          lock.leg1Filled = true;
        }
        if (lock && lock.leg2DealId === ord.dealId) {
          lock.leg2DealId = posId;
          lock.leg2Filled = true;
        }
      } else {
        remainingOrders.push(ord);
      }
    }
    this.orders = remainingOrders;

    // Update live P&L & check 5-brick Take Profit hits
    const remainingPositions: BrokerPosition[] = [];
    for (const pos of this.positions) {
      if (pos.epic !== epic) {
        remainingPositions.push(pos);
        continue;
      }

      const mark = pos.direction === 'BUY' ? market.bid : market.ask;
      pos.currentLevel = mark;
      const diff =
        pos.direction === 'BUY' ? mark - pos.entryLevel : pos.entryLevel - mark;
      pos.pnl = roundPrice(diff * pos.size, 2);

      const tpReached =
        pos.tpLevel !== null &&
        ((pos.direction === 'BUY' && mark >= pos.tpLevel) ||
          (pos.direction === 'SELL' && mark <= pos.tpLevel));

      if (tpReached && pos.tpLevel !== null) {
        const realized = roundPrice(
          (pos.direction === 'BUY'
            ? pos.tpLevel - pos.entryLevel
            : pos.entryLevel - pos.tpLevel) * pos.size,
          2,
        );
        const closedIso = new Date().toISOString();
        this.simBalance = roundPrice(this.simBalance + realized, 2);
        this.closedTrades.unshift({
          id: uid('pnl'),
          epic,
          direction: pos.direction,
          legLabel: pos.legLabel,
          source: pos.source,
          size: pos.size,
          entryPrice: pos.entryLevel,
          exitPrice: pos.tpLevel,
          grossPnl: realized,
          feeOrSwap: 0,
          netPnl: realized,
          exitReason: 'TP_5_BRICKS',
          openedAt: pos.openedAt,
          closedAt: closedIso,
        });
        this.history.unshift({
          id: uid('hist'),
          epic,
          direction: pos.direction,
          source: 'AUTO',
          eventType: 'TP_HIT',
          status: 'CLOSED',
          size: pos.size,
          price: pos.tpLevel,
          tpLevel: pos.tpLevel,
          margin: pos.margin,
          leverage: pos.leverage,
          note: `${pos.legLabel} Take Profit hit @ ${pos.tpLevel} (P&L: ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)})`,
          timestamp: closedIso,
        });
      } else {
        remainingPositions.push(pos);
      }
    }
    this.positions = remainingPositions;
  }

  /**
   * Confirmed automated strategy rules:
   * 1. On Supertrend(1, 2.1) flip:
   *    - Automatically close open LEG 2 positions from previous trend
   *    - Automatically cancel all unfilled working LIMIT orders from previous trend
   *    - Unlock signal lock so new opposite mirrored 2-leg orders fire
   * 2. On active unlocked trend (both BUY and SELL mirrored):
   *    - LEG1 LIMIT @ brick close (TP = +/- 5 bricks, No SL), fallback to MARKET on rejection
   *    - LEG2 LIMIT @ brick midpoint (Close -/+ 0.5*brick, No TP, No SL)
   */
  private evaluateAutomatedStrategySim(epic: EpicSymbol): void {
    const cfg = this.configs[epic];
    const market = this.markets[epic];
    const prevTrend = this.previousTrends[epic];
    const newTrend = market.currentTrend;
    const signalDir: TradeDirection = newTrend === 'BULLISH' ? 'BUY' : 'SELL';

    const flipped = prevTrend !== newTrend;
    this.previousTrends[epic] = newTrend;

    if (!cfg.stEnabled || cfg.mode !== 'AUTO') {
      return;
    }

    if (!this.globalAutoEnabled && !this.isAdminWorkspace) {
      return;
    }

    if (flipped) {
      const prevDir: TradeDirection = prevTrend === 'BULLISH' ? 'BUY' : 'SELL';
      const nowIso = new Date().toISOString();

      // 1. Cancel all pending working LIMIT orders from previous direction
      const keptOrders: WorkingLimitOrder[] = [];
      for (const ord of this.orders) {
        if (ord.epic === epic && ord.direction === prevDir) {
          this.history.unshift({
            id: uid('hist'),
            epic,
            direction: ord.direction,
            source: 'AUTO',
            eventType: 'FLIP_CANCEL',
            status: 'CANCELLED',
            size: ord.size,
            price: ord.level,
            tpLevel: ord.tpLevel,
            margin: this.calcMargin(ord.size, ord.level, cfg.leverage),
            leverage: cfg.leverage,
            note: `Supertrend flipped ${newTrend}: cancelled pending ${ord.legLabel} ${ord.direction} LIMIT @ ${ord.level}`,
            timestamp: nowIso,
          });
        } else {
          keptOrders.push(ord);
        }
      }
      this.orders = keptOrders;

      // 2. Close open LEG 2 positions from previous direction
      const keptPositions: BrokerPosition[] = [];
      for (const pos of this.positions) {
        if (
          pos.epic === epic &&
          pos.direction === prevDir &&
          pos.legLabel === 'LEG 2'
        ) {
          this.simBalance = roundPrice(this.simBalance + pos.pnl, 2);
          this.closedTrades.unshift({
            id: uid('pnl'),
            epic,
            direction: pos.direction,
            legLabel: 'LEG 2',
            source: 'AUTO',
            size: pos.size,
            entryPrice: pos.entryLevel,
            exitPrice: pos.currentLevel,
            grossPnl: pos.pnl,
            feeOrSwap: 0,
            netPnl: pos.pnl,
            exitReason: 'FLIP_EXIT',
            openedAt: pos.openedAt,
            closedAt: nowIso,
          });
          this.history.unshift({
            id: uid('hist'),
            epic,
            direction: pos.direction,
            source: 'AUTO',
            eventType: 'FLIP_CLOSE',
            status: 'CLOSED',
            size: pos.size,
            price: pos.currentLevel,
            tpLevel: null,
            margin: pos.margin,
            leverage: pos.leverage,
            note: `Supertrend flipped ${newTrend}: auto-closed LEG 2 ${pos.direction} @ ${pos.currentLevel} (P&L: ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)})`,
            timestamp: nowIso,
          });
        } else {
          keptPositions.push(pos);
        }
      }
      this.positions = keptPositions;

      // Unlock signal for fresh mirrored entry
      this.signalLocks[epic] = null;
      market.signalLock = null;
    }

    // Check if unlocked for current trend direction
    const lock = this.signalLocks[epic];
    if (lock && lock.direction === signalDir) {
      return;
    }

    this.executeTwoLegAutoSim(epic, signalDir);
  }

  private executeTwoLegAutoSim(
    epic: EpicSymbol,
    direction: TradeDirection,
  ): void {
    const cfg = this.configs[epic];
    const market = this.markets[epic];
    const brickClose = market.lastBrickClose;
    const brickSize = market.brickSize;
    const { leg1Level, leg1Tp, leg2Level } = calculateTwoLegOrders(
      direction,
      brickClose,
      brickSize,
      cfg.decimals,
    );

    const leg1Size = this.getEffectiveSize(cfg, 1, leg1Level);
    const leg2Size = this.getEffectiveSize(cfg, 2, leg2Level);
    const nowIso = new Date().toISOString();

    // Check if LIMIT order at brick close would be rejected by broker (price already past limit side)
    const limitRejected =
      (direction === 'BUY' && market.ask <= leg1Level) ||
      (direction === 'SELL' && market.bid >= leg1Level);

    let leg1DealId: string;
    let leg1OrderType: 'LIMIT' | 'MARKET';
    let leg1Filled = false;

    if (limitRejected) {
      // 2nd attempt MARKET fallback
      const execPrice = direction === 'BUY' ? market.ask : market.bid;
      leg1DealId = uid(`pos-${epic.toLowerCase()}-l1`);
      leg1OrderType = 'MARKET';
      leg1Filled = true;

      this.positions.unshift({
        dealId: leg1DealId,
        epic,
        direction,
        size: leg1Size,
        entryLevel: execPrice,
        currentLevel: direction === 'BUY' ? market.bid : market.ask,
        tpLevel: leg1Tp,
        slLevel: null,
        pnl: roundPrice(-market.spread * leg1Size, 2),
        margin: this.calcMargin(leg1Size, execPrice, cfg.leverage),
        leverage: cfg.leverage,
        source: 'AUTO',
        legLabel: 'LEG 1',
        openedAt: nowIso,
      });

      this.history.unshift({
        id: uid('hist'),
        epic,
        direction,
        source: 'AUTO',
        eventType: 'LEG1_MARKET',
        status: 'OPEN',
        size: leg1Size,
        price: leg1Level,
        tpLevel: leg1Tp,
        margin: this.calcMargin(leg1Size, leg1Level, cfg.leverage),
        leverage: cfg.leverage,
        note: `AUTO ${direction} 1 MARKET (2nd attempt after LIMIT rejection) @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`,
        timestamp: nowIso,
      });
    } else {
      leg1DealId = uid(`ord-${epic.toLowerCase()}-l1`);
      leg1OrderType = 'LIMIT';

      this.orders.unshift({
        dealId: leg1DealId,
        epic,
        direction,
        type: 'LIMIT',
        level: leg1Level,
        size: leg1Size,
        tpLevel: leg1Tp,
        slLevel: null,
        source: 'AUTO',
        legLabel: 'LEG 1',
        createdAt: nowIso,
      });

      this.history.unshift({
        id: uid('hist'),
        epic,
        direction,
        source: 'AUTO',
        eventType: 'LEG1_LIMIT',
        status: 'WORKING',
        size: leg1Size,
        price: leg1Level,
        tpLevel: leg1Tp,
        margin: this.calcMargin(leg1Size, leg1Level, cfg.leverage),
        leverage: cfg.leverage,
        note: `AUTO ${direction} 1 LIMIT @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`,
        timestamp: nowIso,
      });
    }

    // LEG 2 LIMIT @ midpoint (No TP, No SL)
    const leg2DealId = uid(`ord-${epic.toLowerCase()}-l2`);
    this.orders.unshift({
      dealId: leg2DealId,
      epic,
      direction,
      type: 'LIMIT',
      level: leg2Level,
      size: leg2Size,
      tpLevel: null,
      slLevel: null,
      source: 'AUTO',
      legLabel: 'LEG 2',
      createdAt: nowIso,
    });

    this.history.unshift({
      id: uid('hist'),
      epic,
      direction,
      source: 'AUTO',
      eventType: 'LEG2_LIMIT',
      status: 'WORKING',
      size: leg2Size,
      price: leg2Level,
      tpLevel: null,
      margin: this.calcMargin(leg2Size, leg2Level, cfg.leverage),
      leverage: cfg.leverage,
      note: `AUTO ${direction} 2 LIMIT @ midpoint ${leg2Level} (No TP, No SL)`,
      timestamp: nowIso,
    });

    const lock: SignalLockState = {
      direction,
      lockedAt: nowIso,
      brickClose,
      brickSize,
      leg1DealId,
      leg2DealId,
      leg1OrderType,
      leg1Filled,
      leg2Filled: false,
    };

    this.signalLocks[epic] = lock;
    market.signalLock = lock;
  }

  /**
   * Synchronizes live market quotes, Renko 23h ATR5/5 candles, positions, working orders,
   * and executes live Capital.com automated strategy if credentials are configured.
   */
  public async syncWithBroker(): Promise<void> {
    if (!this.isLiveBrokerActive()) {
      this.errorMessage = null;
      this.tickSimulation();
      return;
    }

    try {
      const [acct, quotes, rawPositions, rawOrders] = await Promise.all([
        this.capital.getAccountSummary(this.environment),
        this.capital.getMarkets(this.environment, EPIC_LIST),
        this.capital.getPositions(this.environment),
        this.capital.getWorkingOrders(this.environment),
      ]);

      this.cachedLiveAccount = acct;
      this.errorMessage = null;

      // Update positions & working orders from broker
      this.positions = rawPositions
        .filter((p) => EPIC_LIST.includes(p.epic as EpicSymbol))
        .map((p) => {
          const epic = p.epic as EpicSymbol;
          const cfg = this.configs[epic];
          const lock = this.signalLocks[epic];
          const legLabel: 'LEG 1' | 'LEG 2' | 'MANUAL' =
            lock?.leg1DealId === p.dealId
              ? 'LEG 1'
              : lock?.leg2DealId === p.dealId
                ? 'LEG 2'
                : p.profitLevel !== null
                  ? 'LEG 1'
                  : 'LEG 2';
          return {
            dealId: p.dealId,
            epic,
            direction: p.direction,
            size: p.size,
            entryLevel: p.level,
            currentLevel: p.currentLevel,
            tpLevel: p.profitLevel,
            slLevel: p.stopLevel,
            pnl: p.upl,
            margin: this.calcMargin(p.size, p.level, cfg.leverage),
            leverage: cfg.leverage,
            source: lock?.leg1DealId === p.dealId && lock.leg1OrderType === 'MARKET'
              ? 'AUTO'
              : 'CHART_EXT',
            legLabel,
            openedAt: p.createdDateUTC,
          };
        });

      this.orders = rawOrders
        .filter((o) => EPIC_LIST.includes(o.epic as EpicSymbol))
        .map((o) => {
          const epic = o.epic as EpicSymbol;
          const lock = this.signalLocks[epic];
          return {
            dealId: o.dealId,
            epic,
            direction: o.direction,
            type: 'LIMIT',
            level: o.orderLevel,
            size: o.size,
            tpLevel: o.profitLevel,
            slLevel: o.stopLevel,
            source:
              lock?.leg1DealId === o.dealId || lock?.leg2DealId === o.dealId
                ? 'AUTO'
                : 'CHART_EXT',
            legLabel:
              lock?.leg1DealId === o.dealId
                ? 'LEG 1'
                : lock?.leg2DealId === o.dealId
                  ? 'LEG 2'
                  : o.profitLevel !== null
                    ? 'LEG 1'
                    : 'LEG 2',
            createdAt: o.createdDateUTC,
          };
        });

      // Fetch candles and compute 23h ATR5/5 Renko + Supertrend(1, 2.1) for each instrument
      for (const epic of EPIC_LIST) {
        const cfg = this.configs[epic];
        const quote = quotes[epic];
        const [dailyCandles, m15Candles] = await Promise.all([
          this.capital.getPrices(this.environment, epic, 'DAY', 10),
          this.capital.getPrices(this.environment, epic, 'MINUTE_15', 220),
        ]);

        const fallbackBrick = SIM_SEEDS[epic].baseBrick;
        const brickSize = calculate23hAtr5Div5(
          dailyCandles,
          cfg.decimals,
          fallbackBrick,
        );
        const bricks = buildRenkoBricks(m15Candles, brickSize, cfg.decimals);
        const supertrend = calculateSupertrend(
          bricks,
          cfg.stPeriod,
          cfg.stMultiplier,
          cfg.decimals,
        );

        const bid = quote?.bid ?? m15Candles[m15Candles.length - 1]?.close ?? 0;
        const ask = quote?.offer ?? bid;
        const mid = roundPrice((bid + ask) / 2, cfg.decimals);
        const spread = roundPrice(Math.max(0, ask - bid), cfg.decimals);
        const lastBrick = bricks[bricks.length - 1];
        const lastSt = supertrend[supertrend.length - 1];
        const newTrend: TrendDirection = lastSt?.trend || 'BULLISH';

        const prevTrend = this.previousTrends[epic];
        const flipped = prevTrend !== newTrend;
        this.previousTrends[epic] = newTrend;

        this.markets[epic] = {
          epic,
          bid,
          ask,
          mid,
          spread,
          high24h: quote?.high ?? mid,
          low24h: quote?.low ?? mid,
          change: quote?.netChange ?? 0,
          changePct: quote?.percentageChange ?? 0,
          brickSize,
          bricks,
          supertrend,
          currentTrend: newTrend,
          consecutiveBricks: countConsecutiveBricks(bricks),
          lastBrickClose: lastBrick?.close ?? mid,
          lastStValue: lastSt?.value ?? mid,
          signalLock: this.signalLocks[epic],
          lastEvaluatedAt: new Date().toISOString(),
        };

        await this.evaluateLiveStrategyForEpic(epic, flipped, prevTrend, newTrend);
      }

      this.lastSyncAt = new Date().toISOString();
    } catch (err) {
      this.errorMessage =
        err instanceof Error ? err.message : 'Failed to synchronize with Capital.com.';
    }
  }

  private async evaluateLiveStrategyForEpic(
    epic: EpicSymbol,
    flipped: boolean,
    prevTrend: TrendDirection,
    newTrend: TrendDirection,
  ): Promise<void> {
    const cfg = this.configs[epic];
    if (!cfg.stEnabled || cfg.mode !== 'AUTO') return;

    const market = this.markets[epic];
    const signalDir: TradeDirection = newTrend === 'BULLISH' ? 'BUY' : 'SELL';
    const nowIso = new Date().toISOString();

    // Detect external close on broker while signal active
    const existingLock = this.signalLocks[epic];
    if (existingLock && !flipped) {
      const hasAnyPos = this.positions.some((p) => p.epic === epic);
      const hasAnyOrd = this.orders.some((o) => o.epic === epic);
      if (!hasAnyPos && !hasAnyOrd) {
        this.signalLocks[epic] = null;
        market.signalLock = null;
        this.history.unshift({
          id: uid('hist'),
          epic,
          direction: existingLock.direction,
          source: 'AUTO',
          eventType: 'USER_CLOSED_AUTO',
          status: 'CLOSED',
          size: 0,
          price: market.mid,
          tpLevel: null,
          margin: 0,
          leverage: cfg.leverage,
          note: 'Detected AUTO order closed externally on broker; unlocked re-entry for available signal.',
          timestamp: nowIso,
        });
      }
    }

    if (flipped) {
      const prevDir: TradeDirection = prevTrend === 'BULLISH' ? 'BUY' : 'SELL';

      // Cancel working limits from previous direction
      for (const ord of this.orders.filter(
        (o) => o.epic === epic && o.direction === prevDir,
      )) {
        try {
          await this.capital.cancelWorkingOrder(this.environment, ord.dealId);
          this.history.unshift({
            id: uid('hist'),
            epic,
            direction: ord.direction,
            source: 'AUTO',
            eventType: 'FLIP_CANCEL',
            status: 'CANCELLED',
            size: ord.size,
            price: ord.level,
            tpLevel: ord.tpLevel,
            margin: this.calcMargin(ord.size, ord.level, cfg.leverage),
            leverage: cfg.leverage,
            note: `Supertrend flipped ${newTrend}: cancelled pending ${ord.legLabel} LIMIT @ ${ord.level}`,
            timestamp: nowIso,
          });
        } catch {
          // Broker may have already filled or cancelled
        }
      }

      // Close open LEG 2 positions from previous direction
      for (const pos of this.positions.filter(
        (p) =>
          p.epic === epic &&
          p.direction === prevDir &&
          p.legLabel === 'LEG 2',
      )) {
        try {
          await this.capital.closePosition(this.environment, pos.dealId);
          this.history.unshift({
            id: uid('hist'),
            epic,
            direction: pos.direction,
            source: 'AUTO',
            eventType: 'FLIP_CLOSE',
            status: 'CLOSED',
            size: pos.size,
            price: pos.currentLevel,
            tpLevel: null,
            margin: pos.margin,
            leverage: cfg.leverage,
            note: `Supertrend flipped ${newTrend}: auto-closed LEG 2 ${pos.direction} @ ${pos.currentLevel}`,
            timestamp: nowIso,
          });
        } catch {
          // Position may already be closed
        }
      }

      this.signalLocks[epic] = null;
      market.signalLock = null;
    }

    const lock = this.signalLocks[epic];
    if (lock && lock.direction === signalDir) return;

    // Place mirrored 2-leg orders on Capital.com
    const { leg1Level, leg1Tp, leg2Level } = calculateTwoLegOrders(
      signalDir,
      market.lastBrickClose,
      market.brickSize,
      cfg.decimals,
    );
    const leg1Size = this.getEffectiveSize(cfg, 1, leg1Level);
    const leg2Size = this.getEffectiveSize(cfg, 2, leg2Level);

    let leg1Ref: string | null = null;
    let leg1Type: 'LIMIT' | 'MARKET' = 'LIMIT';

    try {
      const res = await this.capital.createWorkingLimitOrder(this.environment, {
        epic,
        direction: signalDir,
        size: leg1Size,
        level: leg1Level,
        profitLevel: leg1Tp,
      });
      leg1Ref = res.dealReference;
      this.history.unshift({
        id: uid('hist'),
        epic,
        direction: signalDir,
        source: 'AUTO',
        eventType: 'LEG1_LIMIT',
        status: 'WORKING',
        size: leg1Size,
        price: leg1Level,
        tpLevel: leg1Tp,
        margin: this.calcMargin(leg1Size, leg1Level, cfg.leverage),
        leverage: cfg.leverage,
        note: `AUTO ${signalDir} 1 LIMIT @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`,
        timestamp: nowIso,
      });
    } catch {
      // 2nd attempt MARKET fallback after LIMIT rejection
      const res = await this.capital.createMarketPosition(this.environment, {
        epic,
        direction: signalDir,
        size: leg1Size,
        profitLevel: leg1Tp,
      });
      leg1Ref = res.dealReference;
      leg1Type = 'MARKET';
      this.history.unshift({
        id: uid('hist'),
        epic,
        direction: signalDir,
        source: 'AUTO',
        eventType: 'LEG1_MARKET',
        status: 'OPEN',
        size: leg1Size,
        price: leg1Level,
        tpLevel: leg1Tp,
        margin: this.calcMargin(leg1Size, leg1Level, cfg.leverage),
        leverage: cfg.leverage,
        note: `AUTO ${signalDir} 1 MARKET (2nd attempt after LIMIT rejection) @ ${leg1Level} (TP 5 bricks: ${leg1Tp}, No SL)`,
        timestamp: nowIso,
      });
    }

    let leg2Ref: string | null = null;
    try {
      const res2 = await this.capital.createWorkingLimitOrder(
        this.environment,
        {
          epic,
          direction: signalDir,
          size: leg2Size,
          level: leg2Level,
          profitLevel: null,
        },
      );
      leg2Ref = res2.dealReference;
      this.history.unshift({
        id: uid('hist'),
        epic,
        direction: signalDir,
        source: 'AUTO',
        eventType: 'LEG2_LIMIT',
        status: 'WORKING',
        size: leg2Size,
        price: leg2Level,
        tpLevel: null,
        margin: this.calcMargin(leg2Size, leg2Level, cfg.leverage),
        leverage: cfg.leverage,
        note: `AUTO ${signalDir} 2 LIMIT @ midpoint ${leg2Level} (No TP, No SL)`,
        timestamp: nowIso,
      });
    } catch {
      // Ignore if midpoint limit rejected
    }

    this.signalLocks[epic] = {
      direction: signalDir,
      lockedAt: nowIso,
      brickClose: market.lastBrickClose,
      brickSize: market.brickSize,
      leg1DealId: leg1Ref,
      leg2DealId: leg2Ref,
      leg1OrderType: leg1Type,
      leg1Filled: leg1Type === 'MARKET',
      leg2Filled: false,
    };
    market.signalLock = this.signalLocks[epic];
  }

  public async setEnvironment(env: BrokerEnvironment): Promise<DashboardSnapshot> {
    this.environment = env;
    this.cachedLiveAccount = null;
    this.errorMessage = null;
    await this.syncWithBroker();
    return this.getSnapshot();
  }

  public updateConfig(
    epic: EpicSymbol,
    patch: Partial<
      Pick<
        InstrumentConfig,
        | 'mode'
        | 'sizingMode'
        | 'lot1'
        | 'lot2'
        | 'margin1'
        | 'margin2'
        | 'stEnabled'
        | 'stPeriod'
        | 'stMultiplier'
      >
    >,
  ): DashboardSnapshot {
    const cfg = this.configs[epic];
    const lotCeiling = this.isAdminWorkspace ? 10000 : Math.max(cfg.minSize, this.maxLotCap);
    if (patch.mode !== undefined) cfg.mode = patch.mode;
    if (patch.sizingMode !== undefined) cfg.sizingMode = patch.sizingMode;
    if (patch.lot1 !== undefined && patch.lot1 >= cfg.minSize) {
      cfg.lot1 = Math.min(patch.lot1, lotCeiling);
    }
    if (patch.lot2 !== undefined && patch.lot2 >= cfg.minSize) {
      cfg.lot2 = Math.min(patch.lot2, lotCeiling);
    }
    if (patch.margin1 !== undefined && patch.margin1 > 0) cfg.margin1 = patch.margin1;
    if (patch.margin2 !== undefined && patch.margin2 > 0) cfg.margin2 = patch.margin2;
    if (patch.stEnabled !== undefined) cfg.stEnabled = patch.stEnabled;
    if (patch.stPeriod !== undefined && patch.stPeriod >= 1 && patch.stPeriod <= 20) {
      cfg.stPeriod = Math.round(patch.stPeriod);
    }
    if (
      patch.stMultiplier !== undefined &&
      patch.stMultiplier >= 0.5 &&
      patch.stMultiplier <= 10
    ) {
      cfg.stMultiplier = roundPrice(patch.stMultiplier, 2);
    }

    if (!this.isLiveBrokerActive()) {
      this.rebuildSimMarket(epic);
    }

    return this.getSnapshot();
  }

  public async placeManualOrder(
    epic: EpicSymbol,
    direction: TradeDirection,
    size?: number,
    tpBricks?: number,
  ): Promise<DashboardSnapshot> {
    const cfg = this.configs[epic];
    if (cfg.mode === 'AUTO') {
      throw new Error(
        `Manual trading is locked while ${epic} is in AUTO mode. Switch to MANUAL first.`,
      );
    }

    const market = this.markets[epic];
    const execPrice = direction === 'BUY' ? market.ask : market.bid;
    const orderSize =
      size && size >= cfg.minSize
        ? size
        : this.getEffectiveSize(cfg, 1, execPrice);
    const tpLevel =
      tpBricks && tpBricks > 0
        ? roundPrice(
            direction === 'BUY'
              ? execPrice + tpBricks * market.brickSize
              : execPrice - tpBricks * market.brickSize,
            cfg.decimals,
          )
        : null;

    if (this.isLiveBrokerActive()) {
      await this.capital.createMarketPosition(this.environment, {
        epic,
        direction,
        size: orderSize,
        profitLevel: tpLevel,
      });
      this.history.unshift({
        id: uid('hist'),
        epic,
        direction,
        source: 'MANUAL',
        eventType: 'MANUAL_ORDER',
        status: 'OPEN',
        size: orderSize,
        price: execPrice,
        tpLevel,
        margin: this.calcMargin(orderSize, execPrice, cfg.leverage),
        leverage: cfg.leverage,
        note: `MANUAL ${direction} MARKET @ ${execPrice}${tpLevel ? ` (TP: ${tpLevel})` : ' (No TP, No SL)'}`,
        timestamp: new Date().toISOString(),
      });
      await this.syncWithBroker();
      return this.getSnapshot();
    }

    const nowIso = new Date().toISOString();
    this.positions.unshift({
      dealId: uid(`pos-${epic.toLowerCase()}-man`),
      epic,
      direction,
      size: orderSize,
      entryLevel: execPrice,
      currentLevel: direction === 'BUY' ? market.bid : market.ask,
      tpLevel,
      slLevel: null,
      pnl: roundPrice(-market.spread * orderSize, 2),
      margin: this.calcMargin(orderSize, execPrice, cfg.leverage),
      leverage: cfg.leverage,
      source: 'MANUAL',
      legLabel: 'MANUAL',
      openedAt: nowIso,
    });

    this.history.unshift({
      id: uid('hist'),
      epic,
      direction,
      source: 'MANUAL',
      eventType: 'MANUAL_ORDER',
      status: 'OPEN',
      size: orderSize,
      price: execPrice,
      tpLevel,
      margin: this.calcMargin(orderSize, execPrice, cfg.leverage),
      leverage: cfg.leverage,
      note: `MANUAL ${direction} MARKET @ ${execPrice}${tpLevel ? ` (TP: ${tpLevel})` : ' (No TP, No SL)'}`,
      timestamp: nowIso,
    });

    return this.getSnapshot();
  }

  public async closePosition(dealId: string): Promise<DashboardSnapshot> {
    const pos = this.positions.find((p) => p.dealId === dealId);
    if (!pos) {
      throw new Error('Position not found.');
    }

    if (this.isLiveBrokerActive()) {
      await this.capital.closePosition(this.environment, dealId);
      await this.syncWithBroker();
      return this.getSnapshot();
    }

    const nowIso = new Date().toISOString();
    this.positions = this.positions.filter((p) => p.dealId !== dealId);
    this.simBalance = roundPrice(this.simBalance + pos.pnl, 2);

    this.closedTrades.unshift({
      id: uid('pnl'),
      epic: pos.epic,
      direction: pos.direction,
      legLabel: pos.legLabel,
      source: pos.source,
      size: pos.size,
      entryPrice: pos.entryLevel,
      exitPrice: pos.currentLevel,
      grossPnl: pos.pnl,
      feeOrSwap: 0,
      netPnl: pos.pnl,
      exitReason: 'MANUAL_CLOSE',
      openedAt: pos.openedAt,
      closedAt: nowIso,
    });

    this.history.unshift({
      id: uid('hist'),
      epic: pos.epic,
      direction: pos.direction,
      source: pos.source,
      eventType: 'MANUAL_CLOSE',
      status: 'CLOSED',
      size: pos.size,
      price: pos.currentLevel,
      tpLevel: pos.tpLevel,
      margin: pos.margin,
      leverage: pos.leverage,
      note: `Closed ${pos.legLabel} ${pos.direction} @ ${pos.currentLevel} (P&L: ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)})`,
      timestamp: nowIso,
    });

    // Check if closing this position left zero AUTO positions/orders for epic -> unlock re-entry!
    const lock = this.signalLocks[pos.epic];
    if (
      lock &&
      (lock.leg1DealId === dealId || lock.leg2DealId === dealId)
    ) {
      const remainingForEpic =
        this.positions.some((p) => p.epic === pos.epic) ||
        this.orders.some((o) => o.epic === pos.epic);
      if (!remainingForEpic) {
        this.signalLocks[pos.epic] = null;
        this.markets[pos.epic].signalLock = null;
        this.history.unshift({
          id: uid('hist'),
          epic: pos.epic,
          direction: pos.direction,
          source: 'AUTO',
          eventType: 'USER_CLOSED_AUTO',
          status: 'CLOSED',
          size: 0,
          price: pos.currentLevel,
          tpLevel: null,
          margin: 0,
          leverage: pos.leverage,
          note: 'Detected AUTO order closed externally on broker; unlocked re-entry for available signal.',
          timestamp: nowIso,
        });
      }
    }

    return this.getSnapshot();
  }

  public async cancelOrder(dealId: string): Promise<DashboardSnapshot> {
    const ord = this.orders.find((o) => o.dealId === dealId);
    if (!ord) {
      throw new Error('Working order not found.');
    }

    if (this.isLiveBrokerActive()) {
      await this.capital.cancelWorkingOrder(this.environment, dealId);
      await this.syncWithBroker();
      return this.getSnapshot();
    }

    const cfg = this.configs[ord.epic];
    this.orders = this.orders.filter((o) => o.dealId !== dealId);
    this.history.unshift({
      id: uid('hist'),
      epic: ord.epic,
      direction: ord.direction,
      source: ord.source,
      eventType: 'MANUAL_CLOSE',
      status: 'CANCELLED',
      size: ord.size,
      price: ord.level,
      tpLevel: ord.tpLevel,
      margin: this.calcMargin(ord.size, ord.level, cfg.leverage),
      leverage: cfg.leverage,
      note: `Cancelled ${ord.legLabel} ${ord.direction} LIMIT @ ${ord.level}`,
      timestamp: new Date().toISOString(),
    });

    return this.getSnapshot();
  }

  /**
   * Preview-only helper: pushes a 3-brick counter-move on the selected epic so the user can
   * observe a 2-brick reversal -> Supertrend(1, 2.1) flip -> auto-close LEG 2 + cancel working limits
   * -> mirrored opposite 2-leg BUY/SELL entry in real time.
   */
  public simulateTrendFlip(epic: EpicSymbol): DashboardSnapshot {
    if (this.isLiveBrokerActive()) {
      throw new Error('Flip simulation is only available in Paper Preview mode.');
    }

    const cfg = this.configs[epic];
    const market = this.markets[epic];
    const candles = this.simCandles[epic];
    const brickSize = market.brickSize;
    const targetDir: 1 | -1 = market.currentTrend === 'BULLISH' ? -1 : 1;

    // Need 3 bricks of counter-move from last brick close to force 2 opposite Renko bricks & flip ST(1, 2.1)
    let cursor = market.lastBrickClose;
    const baseTime = Date.now();
    for (let step = 1; step <= 3; step += 1) {
      const nextClose = roundPrice(
        cursor + targetDir * brickSize * 1.05,
        cfg.decimals,
      );
      candles.push({
        timestamp: new Date(baseTime + step * 1000).toISOString(),
        open: cursor,
        high: Math.max(cursor, nextClose),
        low: Math.min(cursor, nextClose),
        close: nextClose,
      });
      cursor = nextClose;
    }

    this.rebuildSimMarket(epic);
    this.processSimOrderFillsAndTp(epic);
    this.evaluateAutomatedStrategySim(epic);
    this.lastSyncAt = new Date().toISOString();

    return this.getSnapshot();
  }

  public getSnapshot(): DashboardSnapshot {
    const demoConfigured = this.capital.isConfigured('DEMO');
    const liveConfigured = this.capital.isConfigured('LIVE');
    const isSimulated = !this.isLiveBrokerActive();

    const totalUpl = roundPrice(
      this.positions.reduce((sum, p) => sum + p.pnl, 0),
      2,
    );
    const usedMargin = roundPrice(
      this.positions.reduce((sum, p) => sum + p.margin, 0),
      2,
    );

    const status: BrokerStatus = isSimulated
      ? {
          environment: this.environment,
          connected: true,
          isSimulated: true,
          accountName: this.isAdminWorkspace
            ? `Capital.com ${this.environment} (Admin Preview)`
            : `Isolated Trader Workspace (${this.environment} Sandbox)`,
          accountId: this.isAdminWorkspace
            ? this.environment === 'LIVE'
              ? 'CAP-LIVE-SIM'
              : 'CAP-DEMO-SIM'
            : `WS-${this.ownerUid.slice(0, 8).toUpperCase()}`,
          currency: 'USD',
          balance: this.simBalance,
          equity: roundPrice(this.simBalance + totalUpl, 2),
          available: roundPrice(Math.max(0, this.simBalance + totalUpl - usedMargin), 2),
          profitLoss: totalUpl,
          demoConfigured: this.allowBrokerSecrets && demoConfigured,
          liveConfigured: this.allowBrokerSecrets && liveConfigured,
          lastSyncAt: this.lastSyncAt,
          errorMessage: this.errorMessage,
          workspaceOwnerUid: this.ownerUid,
          isAdminWorkspace: this.isAdminWorkspace,
          globalAutoPaused: !this.globalAutoEnabled && !this.isAdminWorkspace,
          maxLotCap: this.maxLotCap,
        }
      : {
          environment: this.environment,
          connected: this.cachedLiveAccount !== null && this.errorMessage === null,
          isSimulated: false,
          accountName:
            this.cachedLiveAccount?.accountName || `Capital.com ${this.environment}`,
          accountId: this.cachedLiveAccount?.accountId || '—',
          currency: this.cachedLiveAccount?.currency || 'USD',
          balance: this.cachedLiveAccount?.balance ?? 0,
          equity: this.cachedLiveAccount?.equity ?? 0,
          available: this.cachedLiveAccount?.available ?? 0,
          profitLoss: this.cachedLiveAccount?.profitLoss ?? totalUpl,
          demoConfigured: this.allowBrokerSecrets && demoConfigured,
          liveConfigured: this.allowBrokerSecrets && liveConfigured,
          lastSyncAt: this.lastSyncAt,
          errorMessage: this.errorMessage,
          workspaceOwnerUid: this.ownerUid,
          isAdminWorkspace: this.isAdminWorkspace,
          globalAutoPaused: !this.globalAutoEnabled && !this.isAdminWorkspace,
          maxLotCap: this.maxLotCap,
        };

    return {
      status,
      configs: this.configs,
      markets: this.markets,
      positions: this.positions,
      orders: this.orders,
      history: this.history.slice(0, 100),
    };
  }

  /**
   * Seeds realistic multi-day realized Renko 2-leg trades (5-brick TPs, Leg 2 flip exits,
   * and manual closes) over the past 30 days so custom date-range P&L reports are immediately
   * verifiable in Preview mode.
   */
  private seedHistoricalClosedTrades(): void {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const templates: Array<{
      daysAgo: number;
      hourOffset: number;
      epic: EpicSymbol;
      direction: TradeDirection;
      legLabel: 'LEG 1' | 'LEG 2' | 'MANUAL';
      bricksGain: number;
      exitReason: 'TP_5_BRICKS' | 'FLIP_EXIT' | 'MANUAL_CLOSE';
      swap: number;
    }> = [
      { daysAgo: 0, hourOffset: 4, epic: 'OIL_CRUDE', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.18 },
      { daysAgo: 1, hourOffset: 9, epic: 'GOLD', direction: 'SELL', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.45 },
      { daysAgo: 1, hourOffset: 5, epic: 'GOLD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: 3.4, exitReason: 'FLIP_EXIT', swap: -0.62 },
      { daysAgo: 2, hourOffset: 11, epic: 'US100', direction: 'BUY', legLabel: 'LEG 2', bricksGain: -1.6, exitReason: 'FLIP_EXIT', swap: -0.84 },
      { daysAgo: 3, hourOffset: 14, epic: 'BTCUSD', direction: 'SELL', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -1.25 },
      { daysAgo: 3, hourOffset: 8, epic: 'BTCUSD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: 4.1, exitReason: 'FLIP_EXIT', swap: -1.4 },
      { daysAgo: 4, hourOffset: 16, epic: 'ETHUSD', direction: 'SELL', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.36 },
      { daysAgo: 4, hourOffset: 10, epic: 'ETHUSD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: 2.8, exitReason: 'FLIP_EXIT', swap: -0.48 },
      { daysAgo: 5, hourOffset: 13, epic: 'OIL_CRUDE', direction: 'SELL', legLabel: 'LEG 2', bricksGain: -1.3, exitReason: 'FLIP_EXIT', swap: -0.22 },
      { daysAgo: 6, hourOffset: 18, epic: 'GOLD', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.35 },
      { daysAgo: 6, hourOffset: 12, epic: 'US100', direction: 'SELL', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.95 },
      { daysAgo: 7, hourOffset: 15, epic: 'US100', direction: 'SELL', legLabel: 'LEG 2', bricksGain: 2.5, exitReason: 'FLIP_EXIT', swap: -1.1 },
      { daysAgo: 9, hourOffset: 9, epic: 'BTCUSD', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -1.12 },
      { daysAgo: 9, hourOffset: 6, epic: 'BTCUSD', direction: 'BUY', legLabel: 'LEG 2', bricksGain: 6.2, exitReason: 'FLIP_EXIT', swap: -1.9 },
      { daysAgo: 10, hourOffset: 14, epic: 'ETHUSD', direction: 'BUY', legLabel: 'LEG 2', bricksGain: -1.8, exitReason: 'FLIP_EXIT', swap: -0.52 },
      { daysAgo: 11, hourOffset: 17, epic: 'OIL_CRUDE', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.2 },
      { daysAgo: 12, hourOffset: 10, epic: 'GOLD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: -1.9, exitReason: 'FLIP_EXIT', swap: -0.55 },
      { daysAgo: 14, hourOffset: 15, epic: 'US100', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.78 },
      { daysAgo: 14, hourOffset: 8, epic: 'US100', direction: 'BUY', legLabel: 'LEG 2', bricksGain: 3.1, exitReason: 'FLIP_EXIT', swap: -0.92 },
      { daysAgo: 16, hourOffset: 12, epic: 'ETHUSD', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.34 },
      { daysAgo: 18, hourOffset: 11, epic: 'GOLD', direction: 'BUY', legLabel: 'LEG 2', bricksGain: 4.5, exitReason: 'FLIP_EXIT', swap: -0.74 },
      { daysAgo: 19, hourOffset: 16, epic: 'OIL_CRUDE', direction: 'SELL', legLabel: 'MANUAL', bricksGain: 2.2, exitReason: 'MANUAL_CLOSE', swap: -0.15 },
      { daysAgo: 21, hourOffset: 13, epic: 'BTCUSD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: -2.1, exitReason: 'FLIP_EXIT', swap: -1.35 },
      { daysAgo: 23, hourOffset: 10, epic: 'US100', direction: 'SELL', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.82 },
      { daysAgo: 25, hourOffset: 15, epic: 'GOLD', direction: 'BUY', legLabel: 'LEG 1', bricksGain: 5.0, exitReason: 'TP_5_BRICKS', swap: -0.4 },
      { daysAgo: 27, hourOffset: 9, epic: 'ETHUSD', direction: 'SELL', legLabel: 'LEG 2', bricksGain: 3.6, exitReason: 'FLIP_EXIT', swap: -0.42 },
    ];

    for (const tpl of templates) {
      const cfg = this.configs[tpl.epic];
      const seed = SIM_SEEDS[tpl.epic];
      const size = tpl.legLabel === 'LEG 2' ? cfg.lot2 : cfg.lot1;
      const entry = roundPrice(
        seed.startPrice + (tpl.daysAgo % 4 - 1.5) * seed.baseBrick * 0.8,
        cfg.decimals,
      );
      const sign = tpl.direction === 'BUY' ? 1 : -1;
      const exit = roundPrice(
        entry + sign * tpl.bricksGain * seed.baseBrick,
        cfg.decimals,
      );
      const grossPnl = roundPrice(
        (tpl.direction === 'BUY' ? exit - entry : entry - exit) * size,
        2,
      );
      const netPnl = roundPrice(grossPnl + tpl.swap, 2);
      const closedTime = now - tpl.daysAgo * dayMs - tpl.hourOffset * 60 * 60 * 1000;
      const openedTime = closedTime - 6 * 60 * 60 * 1000;

      this.closedTrades.push({
        id: uid(`seed-${tpl.epic.toLowerCase()}`),
        epic: tpl.epic,
        direction: tpl.direction,
        legLabel: tpl.legLabel,
        source: tpl.legLabel === 'MANUAL' ? 'MANUAL' : 'AUTO',
        size,
        entryPrice: entry,
        exitPrice: exit,
        grossPnl,
        feeOrSwap: tpl.swap,
        netPnl,
        exitReason: tpl.exitReason,
        openedAt: new Date(openedTime).toISOString(),
        closedAt: new Date(closedTime).toISOString(),
      });
    }

    this.closedTrades.sort(
      (a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt),
    );
  }

  private mapInstrumentNameToEpic(name: string): EpicSymbol {
    const upper = name.toUpperCase();
    if (upper.includes('GOLD') || upper.includes('XAU')) return 'GOLD';
    if (upper.includes('US100') || upper.includes('NASDAQ') || upper.includes('US TECH')) {
      return 'US100';
    }
    if (upper.includes('OIL') || upper.includes('CRUDE')) return 'OIL_CRUDE';
    if (upper.includes('BTC') || upper.includes('BITCOIN')) return 'BTCUSD';
    if (upper.includes('ETH') || upper.includes('ETHEREUM')) return 'ETHUSD';
    return 'GOLD';
  }

  public async getPnlReport(params: {
    from: string;
    to: string;
    epic: EpicSymbol | 'ALL';
  }): Promise<PnlReportResponse> {
    const { from, to, epic } = params;
    const fromMs = Date.parse(`${from}T00:00:00.000Z`);
    const toMs = Date.parse(`${to}T23:59:59.999Z`);
    const isSimulated = !this.isLiveBrokerActive();
    const currency = this.cachedLiveAccount?.currency || 'USD';

    let sourceTrades: ClosedTradeRecord[] = [];

    if (!isSimulated) {
      // Pull real settled P&L transactions directly from Capital.com API for [from, to]
      const rawTx = await this.capital.getTransactions(this.environment, from, to);
      const relevant = rawTx.filter((tx) =>
        ['TRADE', 'SWAP', 'TRADE_COMMISSION', 'TRADE_COMMISSION_GSL'].includes(
          tx.transactionType.toUpperCase(),
        ),
      );

      sourceTrades = relevant.map((tx, idx) => {
        const mappedEpic = this.mapInstrumentNameToEpic(tx.instrumentName || tx.note);
        const isFee =
          tx.transactionType.toUpperCase() === 'SWAP' ||
          tx.transactionType.toUpperCase().includes('COMMISSION');
        const amount = roundPrice(tx.size, 2);
        return {
          id: tx.reference || `cap-tx-${idx}`,
          epic: mappedEpic,
          direction: amount >= 0 ? 'BUY' : 'SELL',
          legLabel: 'BROKER',
          source: 'CHART_EXT',
          size: 0,
          entryPrice: 0,
          exitPrice: 0,
          grossPnl: isFee ? 0 : amount,
          feeOrSwap: isFee ? amount : 0,
          netPnl: amount,
          exitReason: 'BROKER_SETTLED',
          openedAt: tx.dateUtc,
          closedAt: tx.dateUtc,
        };
      });
    } else {
      sourceTrades = this.closedTrades.filter((t) => {
        const ts = Date.parse(t.closedAt);
        return ts >= fromMs && ts <= toMs;
      });
    }

    const filteredTrades =
      epic === 'ALL'
        ? sourceTrades
        : sourceTrades.filter((t) => t.epic === epic);

    filteredTrades.sort(
      (a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt),
    );

    // Aggregate summary metrics
    let grossProfit = 0;
    let grossLoss = 0;
    let feesAndSwaps = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let leg1NetPnl = 0;
    let leg2NetPnl = 0;

    for (const t of filteredTrades) {
      feesAndSwaps += t.feeOrSwap;
      if (t.netPnl > 0) {
        winningTrades += 1;
        grossProfit += t.netPnl;
        if (t.netPnl > largestWin) largestWin = t.netPnl;
      } else if (t.netPnl < 0) {
        losingTrades += 1;
        grossLoss += t.netPnl;
        if (t.netPnl < largestLoss) largestLoss = t.netPnl;
      }
      if (t.legLabel === 'LEG 1') leg1NetPnl += t.netPnl;
      if (t.legLabel === 'LEG 2') leg2NetPnl += t.netPnl;
    }

    const netRealizedPnl = roundPrice(
      filteredTrades.reduce((s, t) => s + t.netPnl, 0),
      2,
    );
    const openPositionsFiltered =
      epic === 'ALL'
        ? this.positions
        : this.positions.filter((p) => p.epic === epic);
    const unrealizedPnl = roundPrice(
      openPositionsFiltered.reduce((s, p) => s + p.pnl, 0),
      2,
    );

    const totalTrades = filteredTrades.length;
    const winRate =
      totalTrades > 0 ? roundPrice((winningTrades / totalTrades) * 100, 1) : 0;
    const absLoss = Math.abs(grossLoss);
    const profitFactor =
      absLoss > 0
        ? roundPrice(grossProfit / absLoss, 2)
        : grossProfit > 0
          ? null
          : 0;

    // Build chronological daily buckets across the requested date range
    const bucketMap = new Map<
      string,
      { realizedPnl: number; tradesCount: number; wins: number; losses: number }
    >();

    // Populate every calendar day in range (capped neatly if <= 62 days; otherwise sparse active days)
    const spanDays = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays <= 62) {
      for (let d = 0; d < spanDays; d += 1) {
        const dayKey = new Date(fromMs + d * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        bucketMap.set(dayKey, {
          realizedPnl: 0,
          tradesCount: 0,
          wins: 0,
          losses: 0,
        });
      }
    }

    for (const t of filteredTrades) {
      const dayKey = new Date(t.closedAt).toISOString().slice(0, 10);
      const bucket = bucketMap.get(dayKey) || {
        realizedPnl: 0,
        tradesCount: 0,
        wins: 0,
        losses: 0,
      };
      bucket.realizedPnl = roundPrice(bucket.realizedPnl + t.netPnl, 2);
      bucket.tradesCount += 1;
      if (t.netPnl > 0) bucket.wins += 1;
      if (t.netPnl < 0) bucket.losses += 1;
      bucketMap.set(dayKey, bucket);
    }

    const sortedDates = Array.from(bucketMap.keys()).sort();
    let runningCum = 0;
    const dailySeries: DailyPnlBucket[] = sortedDates.map((date) => {
      const b = bucketMap.get(date)!;
      runningCum = roundPrice(runningCum + b.realizedPnl, 2);
      return {
        date,
        realizedPnl: b.realizedPnl,
        cumulativePnl: runningCum,
        tradesCount: b.tradesCount,
        wins: b.wins,
        losses: b.losses,
      };
    });

    // Build per-instrument breakdown
    const byInstrument: InstrumentPnlBreakdown[] = EPIC_LIST.filter((e) =>
      epic === 'ALL' ? true : e === epic,
    ).map((sym) => {
      const subset = filteredTrades.filter((t) => t.epic === sym);
      let wins = 0;
      let losses = 0;
      let gp = 0;
      let gl = 0;
      let l1 = 0;
      let l2 = 0;
      for (const t of subset) {
        if (t.netPnl > 0) {
          wins += 1;
          gp += t.netPnl;
        } else if (t.netPnl < 0) {
          losses += 1;
          gl += t.netPnl;
        }
        if (t.legLabel === 'LEG 1') l1 += t.netPnl;
        if (t.legLabel === 'LEG 2') l2 += t.netPnl;
      }
      const net = roundPrice(gp + gl, 2);
      return {
        epic: sym,
        tradesCount: subset.length,
        wins,
        losses,
        winRate:
          subset.length > 0 ? roundPrice((wins / subset.length) * 100, 1) : 0,
        grossProfit: roundPrice(gp, 2),
        grossLoss: roundPrice(gl, 2),
        netPnl: net,
        leg1Pnl: roundPrice(l1, 2),
        leg2Pnl: roundPrice(l2, 2),
      };
    });

    return {
      from,
      to,
      epicFilter: epic,
      environment: this.environment,
      isSimulated,
      currency,
      summary: {
        netRealizedPnl,
        grossProfit: roundPrice(grossProfit, 2),
        grossLoss: roundPrice(grossLoss, 2),
        feesAndSwaps: roundPrice(feesAndSwaps, 2),
        unrealizedPnl,
        totalPnl: roundPrice(netRealizedPnl + unrealizedPnl, 2),
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        profitFactor,
        averageWin:
          winningTrades > 0 ? roundPrice(grossProfit / winningTrades, 2) : 0,
        averageLoss:
          losingTrades > 0 ? roundPrice(grossLoss / losingTrades, 2) : 0,
        largestWin: roundPrice(largestWin, 2),
        largestLoss: roundPrice(largestLoss, 2),
        leg1NetPnl: roundPrice(leg1NetPnl, 2),
        leg2NetPnl: roundPrice(leg2NetPnl, 2),
      },
      dailySeries,
      byInstrument,
      trades: filteredTrades,
    };
  }
}
