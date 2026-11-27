export type BrokerEnvironment = 'DEMO' | 'LIVE';

export type EpicSymbol = 'GOLD' | 'US100' | 'OIL_CRUDE' | 'BTCUSD' | 'ETHUSD';

export type TradeDirection = 'BUY' | 'SELL';

export type OrderSource = 'AUTO' | 'MANUAL' | 'CHART_EXT';

export type TradeMode = 'AUTO' | 'MANUAL';

export type SizingMode = 'LOT' | 'MARGIN';

export type TrendDirection = 'BULLISH' | 'BEARISH';

export interface OhlcCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RenkoBrick {
  index: number;
  open: number;
  close: number;
  high: number;
  low: number;
  direction: 'UP' | 'DOWN';
  timestamp: string;
}

export interface SupertrendPoint {
  brickIndex: number;
  value: number;
  upperBand: number;
  lowerBand: number;
  trend: TrendDirection;
}

export interface InstrumentConfig {
  epic: EpicSymbol;
  displayName: string;
  subtitle: string;
  decimals: number;
  leverage: number;
  marginPct: number;
  mode: TradeMode;
  sizingMode: SizingMode;
  lot1: number;
  lot2: number;
  margin1: number;
  margin2: number;
  stEnabled: boolean;
  stPeriod: number;
  stMultiplier: number;
  minSize: number;
  sizeStep: number;
}

export interface SignalLockState {
  direction: TradeDirection;
  lockedAt: string;
  brickClose: number;
  brickSize: number;
  leg1DealId: string | null;
  leg2DealId: string | null;
  leg1Level?: number;
  leg1Tp?: number;
  leg2Level?: number;
  leg1OrderType: 'LIMIT' | 'MARKET' | null;
  leg1Filled: boolean;
  leg2Filled: boolean;
}

export interface InstrumentMarketState {
  epic: EpicSymbol;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  high24h: number;
  low24h: number;
  change: number;
  changePct: number;
  atr5: number;
  brickSize: number;
  bricks: RenkoBrick[];
  supertrend: SupertrendPoint[];
  currentTrend: TrendDirection;
  consecutiveBricks: number;
  lastBrickClose: number;
  lastStValue: number;
  signalLock: SignalLockState | null;
  lastEvaluatedAt: string;
}

export interface BrokerPosition {
  dealId: string;
  epic: EpicSymbol;
  direction: TradeDirection;
  size: number;
  entryLevel: number;
  currentLevel: number;
  tpLevel: number | null;
  slLevel: number | null;
  pnl: number;
  margin: number;
  leverage: number;
  source: OrderSource;
  legLabel: 'LEG 1' | 'LEG 2' | 'MANUAL';
  openedAt: string;
}

export interface WorkingLimitOrder {
  dealId: string;
  epic: EpicSymbol;
  direction: TradeDirection;
  type: 'LIMIT';
  level: number;
  size: number;
  tpLevel: number | null;
  slLevel: number | null;
  source: OrderSource;
  legLabel: 'LEG 1' | 'LEG 2' | 'MANUAL';
  createdAt: string;
}

export type ExecutionEventType =
  | 'LEG1_LIMIT'
  | 'LEG1_MARKET'
  | 'LEG2_LIMIT'
  | 'FLIP_CLOSE'
  | 'FLIP_CANCEL'
  | 'USER_CLOSED_AUTO'
  | 'TP_HIT'
  | 'MANUAL_ORDER'
  | 'MANUAL_CLOSE';

export interface ExecutionHistoryItem {
  id: string;
  epic: EpicSymbol;
  direction: TradeDirection;
  source: OrderSource;
  eventType: ExecutionEventType;
  status: 'WORKING' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  size: number;
  price: number;
  tpLevel: number | null;
  margin: number;
  leverage: number;
  note: string;
  timestamp: string;
}

export interface BrokerStatus {
  environment: BrokerEnvironment;
  connected: boolean;
  isSimulated: boolean;
  accountName: string;
  accountId: string;
  currency: string;
  balance: number;
  equity: number;
  available: number;
  profitLoss: number;
  demoConfigured: boolean;
  liveConfigured: boolean;
  lastSyncAt: string;
  errorMessage: string | null;
  workspaceOwnerUid?: string;
  isAdminWorkspace?: boolean;
  globalAutoPaused?: boolean;
  maxLotCap?: number;
}

export interface DashboardSnapshot {
  status: BrokerStatus;
  configs: Record<EpicSymbol, InstrumentConfig>;
  markets: Record<EpicSymbol, InstrumentMarketState>;
  positions: BrokerPosition[];
  orders: WorkingLimitOrder[];
  history: ExecutionHistoryItem[];
}

export type ClosedTradeExitReason =
  | 'TP_5_BRICKS'
  | 'FLIP_EXIT'
  | 'MANUAL_CLOSE'
  | 'BROKER_SETTLED';

export interface ClosedTradeRecord {
  id: string;
  epic: EpicSymbol;
  direction: TradeDirection;
  legLabel: 'LEG 1' | 'LEG 2' | 'MANUAL' | 'BROKER';
  source: OrderSource;
  size: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  feeOrSwap: number;
  netPnl: number;
  exitReason: ClosedTradeExitReason;
  openedAt: string;
  closedAt: string;
}

export interface DailyPnlBucket {
  date: string; // YYYY-MM-DD
  realizedPnl: number;
  cumulativePnl: number;
  tradesCount: number;
  wins: number;
  losses: number;
}

export interface InstrumentPnlBreakdown {
  epic: EpicSymbol;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  leg1Pnl: number;
  leg2Pnl: number;
}

export interface PnlReportSummary {
  netRealizedPnl: number;
  grossProfit: number;
  grossLoss: number;
  feesAndSwaps: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number | null;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  leg1NetPnl: number;
  leg2NetPnl: number;
}

export interface PnlReportResponse {
  from: string;
  to: string;
  epicFilter: EpicSymbol | 'ALL';
  environment: BrokerEnvironment;
  isSimulated: boolean;
  currency: string;
  summary: PnlReportSummary;
  dailySeries: DailyPnlBucket[];
  byInstrument: InstrumentPnlBreakdown[];
  trades: ClosedTradeRecord[];
}

export type UserRole = 'admin' | 'trader';
export type UserAccessStatus = 'active' | 'pending' | 'suspended';

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  status: UserAccessStatus;
  allowLiveMode: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface GovernancePolicyRecord {
  requireAdminApproval: boolean;
  globalAutoTradingEnabled: boolean;
  allowNonAdminLiveMode: boolean;
  maxLotCap: number;
  announcement: string;
  updatedBy: string;
  updatedAt: string;
}

export interface AdminAuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetUid: string;
  details: string;
  createdAt: string;
}

export interface WorkspaceConfigPatch {
  mode?: TradeMode;
  sizingMode?: SizingMode;
  lot1?: number;
  lot2?: number;
  margin1?: number;
  margin2?: number;
  stEnabled?: boolean;
  stPeriod?: number;
  stMultiplier?: number;
}

export interface AdminActiveSessionSummary {
  uid: string;
  email: string;
  environment: BrokerEnvironment;
  isSimulated: boolean;
  openPositions: number;
  workingOrders: number;
  lastActiveAt: string;
}

export const EPIC_LIST: EpicSymbol[] = [
  'GOLD',
  'US100',
  'OIL_CRUDE',
  'BTCUSD',
  'ETHUSD',
];
