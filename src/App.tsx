import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Info,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import {
  EPIC_LIST,
  type BrokerEnvironment,
  type DashboardSnapshot,
  type EpicSymbol,
  type InstrumentConfig,
  type TradeDirection,
} from './shared/types.ts';
import { calculateTwoLegOrders } from './shared/renkoEngine.ts';
import {
  cancelWorkingLimitOrder,
  closeBrokerPosition,
  fetchSnapshot,
  hydrateWorkspaceConfigs,
  submitManualTrade,
  switchEnvironment,
  syncBroker,
  triggerPreviewFlip,
  updateInstrumentStrategy,
} from './lib/api.ts';
import {
  formatCurrency,
  formatPrice,
  formatShortTime,
  formatSignedCurrency,
} from './lib/format.ts';
import { useAuth } from './context/AuthContext.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { Sidebar, type NavSection } from './components/Sidebar.tsx';
import { RenkoChart } from './components/RenkoChart.tsx';
import { WatchlistGrid } from './components/WatchlistGrid.tsx';
import { PositionsTable } from './components/PositionsTable.tsx';
import { OrdersTable } from './components/OrdersTable.tsx';
import { HistoryLog } from './components/HistoryLog.tsx';
import { PnlReportView } from './components/PnlReportView.tsx';
import { BrokerConnectionPanel } from './components/BrokerConnectionPanel.tsx';
import { LiveConfirmModal } from './components/LiveConfirmModal.tsx';

const SECTION_TITLES: Record<NavSection, string> = {
  terminal: 'Terminal & Renko Chart',
  watchlists: 'Multi-Asset Watchlists',
  positions: 'Open Positions',
  orders: 'Working LIMIT Orders',
  history: 'Trade Execution History',
  pnl: 'Profit & Loss Report',
  broker: 'Broker Connection & Strategy Rules',
  admin: 'Admin Control & Governance',
};

export default function App() {
  const {
    user,
    profile,
    governance,
    savedConfigs,
    isAdmin,
    authReady,
    logout,
    persistWorkspaceConfig,
  } = useAuth();

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('terminal');
  const [selectedEpic, setSelectedEpic] = useState<EpicSymbol>('GOLD');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [liveModalOpen, setLiveModalOpen] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const hydratedUidRef = useRef<string | null>(null);

  const canAccessWorkspace = Boolean(
    user && (isAdmin || profile?.status === 'active'),
  );
  const canUseLive = Boolean(
    isAdmin || (governance.allowNonAdminLiveMode && profile?.allowLiveMode),
  );

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Reset admin tab if user loses admin privileges or signs out
  useEffect(() => {
    if (!isAdmin && activeSection === 'admin') {
      setActiveSection('terminal');
    }
  }, [isAdmin, activeSection]);

  // Clear snapshot when signed out or switching users
  useEffect(() => {
    if (!canAccessWorkspace) {
      setSnapshot(null);
      setLoading(true);
      setLoadError(null);
      hydratedUidRef.current = null;
    }
  }, [canAccessWorkspace, user?.uid]);

  // Hydrate persisted Firestore strategy configs into user's isolated backend TradingEngine
  useEffect(() => {
    if (!canAccessWorkspace || !user) return;
    const keys = Object.keys(savedConfigs);
    if (keys.length === 0) return;

    const uidKey = `${user.uid}:${JSON.stringify(savedConfigs)}`;
    if (hydratedUidRef.current === uidKey) return;
    hydratedUidRef.current = uidKey;

    void hydrateWorkspaceConfigs(savedConfigs)
      .then((data) => {
        setSnapshot(data);
        setLoadError(null);
        setLoading(false);
      })
      .catch(() => {
        // Regular poll will recover
      });
  }, [canAccessWorkspace, user, savedConfigs]);

  const loadSnapshot = useCallback(async () => {
    if (!canAccessWorkspace) return;
    try {
      const data = await fetchSnapshot();
      setSnapshot(data);
      setLoadError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to fetch trading state.';
      setLoadError(msg);
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [canAccessWorkspace, showToast]);

  useEffect(() => {
    if (!canAccessWorkspace) return;
    void loadSnapshot();
    const interval = setInterval(() => {
      void fetchSnapshot()
        .then((data) => setSnapshot(data))
        .catch(() => {
          // Transient poll failure ignored; user can trigger manual sync
        });
    }, 2500);
    return () => clearInterval(interval);
  }, [canAccessWorkspace, loadSnapshot]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await syncBroker();
      setSnapshot(data);
      showToast(
        'success',
        `Synchronized ${data.status.environment} workspace state.`,
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Broker sync failed.',
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleRequestEnvironment = (env: BrokerEnvironment) => {
    if (!snapshot || snapshot.status.environment === env) return;
    if (env === 'LIVE') {
      if (!canUseLive) {
        showToast(
          'error',
          'Capital.com Live mode is restricted by the dashboard administrator.',
        );
        return;
      }
      setLiveModalOpen(true);
      return;
    }
    void performEnvironmentSwitch('DEMO', false);
  };

  const performEnvironmentSwitch = async (
    env: BrokerEnvironment,
    confirmedLive: boolean,
  ) => {
    setLiveModalOpen(false);
    setSyncing(true);
    try {
      const data = await switchEnvironment(env, confirmedLive);
      setSnapshot(data);
      showToast('success', `Switched to Capital.com ${env} environment.`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Environment switch failed.',
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateConfig = async (
    epic: EpicSymbol,
    patch: Partial<InstrumentConfig>,
  ) => {
    try {
      const data = await updateInstrumentStrategy(epic, patch);
      setSnapshot(data);
      // Persist updated strategy config to the user's isolated Firestore workspace
      await persistWorkspaceConfig(epic, data.configs[epic]);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to update strategy config.',
      );
    }
  };

  const handleManualTrade = async (
    epic: EpicSymbol,
    direction: TradeDirection,
  ) => {
    try {
      const data = await submitManualTrade({ epic, direction, tpBricks: 5 });
      setSnapshot(data);
      showToast('success', `Executed MANUAL ${direction} on ${epic}.`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Manual trade failed.',
      );
    }
  };

  const handleClosePosition = async (dealId: string) => {
    try {
      const data = await closeBrokerPosition(dealId);
      setSnapshot(data);
      showToast('success', 'Position closed and execution history updated.');
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to close position.',
      );
    }
  };

  const handleCancelOrder = async (dealId: string) => {
    try {
      const data = await cancelWorkingLimitOrder(dealId);
      setSnapshot(data);
      showToast('success', 'Working LIMIT order cancelled.');
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to cancel working order.',
      );
    }
  };

  const handleSimulateFlip = async () => {
    setFlipping(true);
    try {
      const data = await triggerPreviewFlip(selectedEpic);
      setSnapshot(data);
      const nextTrend = data.markets[selectedEpic].currentTrend;
      showToast(
        'success',
        `${selectedEpic} flipped to ${nextTrend}: closed Leg 2, cancelled prior limits, and staged mirrored 2-leg ${nextTrend === 'BULLISH' ? 'BUY' : 'SELL'}.`,
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Could not simulate flip.',
      );
    } finally {
      setFlipping(false);
    }
  };

  const handleSelectEpicFromTable = (epic: EpicSymbol) => {
    setSelectedEpic(epic);
    setActiveSection('terminal');
  };

  // Wait for Firebase Auth initialization
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-8">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="h-5 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-24 w-full bg-slate-100 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // Enforce Sign-In / Approval / Suspension Gate
  if (!canAccessWorkspace) {
    return <AuthGate />;
  }

  const activeConfig = snapshot?.configs?.[selectedEpic];
  const activeMarket = snapshot?.markets?.[selectedEpic];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-8">
        <div className="w-full max-w-xl bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-64 w-full bg-slate-100 rounded-lg animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot || !snapshot.status || !activeConfig || !activeMarket) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h1 className="font-display text-base font-bold text-slate-900">
                Unable to Load Trading Workspace
              </h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {loadError ||
                  'Your workspace session could not be initialized. Please retry or sign in again.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                void loadSnapshot();
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Workspace</span>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { status, configs, markets, positions, orders, history } = snapshot;
  const activeSignalDir: TradeDirection =
    activeMarket.currentTrend === 'BULLISH' ? 'BUY' : 'SELL';
  const nextSetup = calculateTwoLegOrders(
    activeSignalDir,
    activeMarket.lastBrickClose,
    activeMarket.brickSize,
    activeConfig.decimals,
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Persistent Left Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        status={status}
        positionsCount={positions.length}
        ordersCount={orders.length}
        historyCount={history.length}
        isAdmin={isAdmin}
        userDisplayName={
          profile?.displayName || user?.displayName || 'Trader'
        }
        userEmail={profile?.email || user?.email || ''}
        onLogout={() => void logout()}
      />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 font-medium whitespace-nowrap">
              {isAdmin ? 'Admin Workspace' : 'My Workspace'}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <h1 className="font-display font-bold text-slate-900 truncate">
              {SECTION_TITLES[activeSection]}
            </h1>
            <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline font-mono text-xs text-slate-500 whitespace-nowrap tabular-nums">
              Synced {formatShortTime(status.lastSyncAt)}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`}
              />
              <span>{syncing ? 'Syncing...' : 'Sync Broker'}</span>
            </button>
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <main className="flex-1 p-6 space-y-6 max-w-[1440px] w-full mx-auto">
          {/* Admin Global Notice Banner (if set) */}
          {governance.announcement && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2.5 text-xs text-slate-700">
              <Info className="w-4 h-4 text-slate-600 shrink-0" />
              <span>
                <strong className="font-semibold text-slate-900">
                  Admin Notice:
                </strong>{' '}
                {governance.announcement}
              </span>
            </div>
          )}

          {/* Global AUTO Paused Notice (for non-admin workspaces) */}
          {!governance.globalAutoTradingEnabled && !isAdmin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-900">
              <PauseCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Automated Renko execution is currently paused globally by the dashboard administrator. You may still inspect charts, run P&amp;L reports, and manage open positions manually.
              </span>
            </div>
          )}

          {/* Workspace Environment & Portfolio Summary Bar */}
          {activeSection !== 'admin' && (
            <div className="bg-white rounded-xl border border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
              {/* Environment Switcher (Demo | Live) */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => handleRequestEnvironment('DEMO')}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      status.environment === 'DEMO'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Capital.com Demo
                  </button>
                  <button
                    type="button"
                    disabled={!canUseLive}
                    title={
                      canUseLive
                        ? 'Switch to Capital.com Live'
                        : 'Restricted by dashboard administrator'
                    }
                    onClick={() => handleRequestEnvironment('LIVE')}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      status.environment === 'LIVE'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : !canUseLive
                          ? 'text-slate-400 cursor-not-allowed'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Capital.com Live
                  </button>
                </div>

                <div className="text-xs text-slate-600 flex items-center gap-2">
                  <span className="font-medium text-slate-800">
                    {status.accountName}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-slate-500">
                    {status.isSimulated
                      ? isAdmin
                        ? 'Preview Engine (Add server secrets to connect live)'
                        : `Isolated Sandbox · Max Lot ${governance.maxLotCap}`
                      : 'Live Broker Session Active'}
                  </span>
                </div>
              </div>

              {/* Key Account KPIs */}
              <div className="flex items-center gap-6 text-xs font-mono tabular-nums flex-wrap">
                <div>
                  <span className="text-slate-400 mr-1.5 font-sans">Balance</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(status.balance, status.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5 font-sans">Equity</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(status.equity, status.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5 font-sans">
                    Open P&amp;L
                  </span>
                  <span
                    className={`font-semibold ${
                      status.profitLoss > 0
                        ? 'text-emerald-700'
                        : status.profitLoss < 0
                          ? 'text-red-600'
                          : 'text-slate-700'
                    }`}
                  >
                    {formatSignedCurrency(status.profitLoss, status.currency)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Broker Error Alert (if any) */}
          {status.errorMessage && activeSection !== 'admin' && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-3 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{status.errorMessage}</span>
            </div>
          )}

          {/* Toast Notification */}
          {toast && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs font-medium flex items-center justify-between gap-3 ${
                toast.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-current opacity-70 hover:opacity-100 font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SECTION 1: TERMINAL & DARK RENKO CHART */}
          {activeSection === 'terminal' && (
            <div className="space-y-6">
              {/* Asset Selector Tabs + Preview Flip Simulator */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {EPIC_LIST.map((epic) => {
                    const isSel = selectedEpic === epic;
                    const trend = markets[epic].currentTrend;
                    return (
                      <button
                        key={epic}
                        type="button"
                        onClick={() => setSelectedEpic(epic)}
                        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap border ${
                          isSel
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span>{epic}</span>
                        <span
                          className={`ml-2 font-mono text-[11px] ${
                            isSel
                              ? 'text-emerald-100'
                              : trend === 'BULLISH'
                                ? 'text-emerald-700'
                                : 'text-orange-700'
                          }`}
                        >
                          {trend === 'BULLISH' ? 'BUY' : 'SELL'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {status.isSimulated && (
                  <button
                    type="button"
                    disabled={flipping}
                    onClick={() => void handleSimulateFlip()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-slate-600" />
                    <span>
                      {flipping
                        ? 'Simulating Flip...'
                        : `Test Supertrend Flip on ${selectedEpic}`}
                    </span>
                  </button>
                )}
              </div>

              {/* High-Contrast Dark Obsidian Renko Chart */}
              <RenkoChart
                config={activeConfig}
                market={activeMarket}
                positions={positions}
                orders={orders}
              />

              {/* Two-Leg Execution Blueprint Strip for Selected Instrument */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900">
                      {selectedEpic} Active 2-Leg Execution Blueprint (
                      {activeSignalDir})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      Live levels from zero-aligned Brick Close (
                      {formatPrice(
                        activeMarket.lastBrickClose,
                        activeConfig.decimals,
                      )}
                      ) · Brick (
                      {formatPrice(
                        activeMarket.brickSize,
                        activeConfig.decimals,
                      )}
                      {' = 23h ATR(5) '}
                      {formatPrice(activeMarket.atr5, activeConfig.decimals)} ÷ 5)
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-600 tabular-nums">
                    Supertrend ({activeConfig.stPeriod},{' '}
                    {activeConfig.stMultiplier}):{' '}
                    <span
                      className={`font-semibold ${
                        activeMarket.currentTrend === 'BULLISH'
                          ? 'text-emerald-700'
                          : 'text-orange-700'
                      }`}
                    >
                      {activeMarket.currentTrend} @{' '}
                      {formatPrice(
                        activeMarket.lastStValue,
                        activeConfig.decimals,
                      )}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-5 pt-4 text-xs">
                  <div>
                    <div className="text-slate-500 font-medium">
                      Leg 1 Entry (LIMIT / MKT Fallback)
                    </div>
                    <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {formatPrice(nextSetup.leg1Level, activeConfig.decimals)}
                    </div>
                    <div className="mt-0.5 text-slate-500 font-mono">
                      Lot: {activeConfig.lot1} · No SL
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 font-medium">
                      Leg 1 Take Profit (5 Bricks)
                    </div>
                    <div className="mt-1 font-mono text-base font-bold text-emerald-700 tabular-nums">
                      {formatPrice(nextSetup.leg1Tp, activeConfig.decimals)}
                    </div>
                    <div className="mt-0.5 text-slate-500 font-mono">
                      {activeSignalDir === 'BUY' ? '+5×' : '-5×'} Brick (
                      {formatPrice(
                        activeMarket.brickSize * 5,
                        activeConfig.decimals,
                      )}
                      )
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 font-medium">
                      Leg 2 Midpoint Entry (LIMIT)
                    </div>
                    <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                      {formatPrice(nextSetup.leg2Level, activeConfig.decimals)}
                    </div>
                    <div className="mt-0.5 text-slate-500 font-mono">
                      Lot: {activeConfig.lot2} · 0.5× Brick Pullback
                    </div>
                  </div>

                  <div>
                    <div className="text-slate-500 font-medium">
                      Flip &amp; Signal Lock Policy
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {activeMarket.signalLock
                        ? `Locked (${activeMarket.signalLock.direction})`
                        : 'Unlocked (Ready)'}
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      Auto-close Leg 2 &amp; cancel limits on flip
                    </div>
                  </div>
                </div>
              </div>

              {/* Compact Open Positions & Working Orders below Chart */}
              <div className="space-y-6">
                <PositionsTable
                  positions={positions}
                  configs={configs}
                  currency={status.currency}
                  onClosePosition={handleClosePosition}
                  onRefresh={handleSync}
                  onSelectEpic={handleSelectEpicFromTable}
                />
                <OrdersTable
                  orders={orders}
                  configs={configs}
                  markets={markets}
                  onCancelOrder={handleCancelOrder}
                  onRefresh={handleSync}
                  onSelectEpic={handleSelectEpicFromTable}
                />
              </div>
            </div>
          )}

          {/* SECTION 2: WATCHLISTS */}
          {activeSection === 'watchlists' && (
            <WatchlistGrid
              configs={configs}
              markets={markets}
              selectedEpic={selectedEpic}
              onSelectEpic={handleSelectEpicFromTable}
              onUpdateConfig={handleUpdateConfig}
              onManualTrade={handleManualTrade}
            />
          )}

          {/* SECTION 3: POSITIONS */}
          {activeSection === 'positions' && (
            <PositionsTable
              positions={positions}
              configs={configs}
              currency={status.currency}
              onClosePosition={handleClosePosition}
              onRefresh={handleSync}
              onSelectEpic={handleSelectEpicFromTable}
            />
          )}

          {/* SECTION 4: WORKING ORDERS */}
          {activeSection === 'orders' && (
            <OrdersTable
              orders={orders}
              configs={configs}
              markets={markets}
              onCancelOrder={handleCancelOrder}
              onRefresh={handleSync}
              onSelectEpic={handleSelectEpicFromTable}
            />
          )}

          {/* SECTION 5: EXECUTION HISTORY */}
          {activeSection === 'history' && (
            <HistoryLog
              history={history}
              configs={configs}
              currency={status.currency}
              onRefresh={handleSync}
            />
          )}

          {/* SECTION 6: CUSTOM DATE PROFIT & LOSS REPORT */}
          {activeSection === 'pnl' && (
            <PnlReportView
              configs={configs}
              environment={status.environment}
              onSelectEpic={handleSelectEpicFromTable}
            />
          )}

          {/* SECTION 7: BROKER CONNECTION & RULES */}
          {activeSection === 'broker' && (
            <BrokerConnectionPanel
              status={status}
              canUseLive={canUseLive}
              isAdmin={isAdmin}
              onRequestEnvironment={handleRequestEnvironment}
              onSync={handleSync}
            />
          )}

          {/* SECTION 8: ADMIN CONTROL & GOVERNANCE (ADMIN ONLY) */}
          {activeSection === 'admin' && isAdmin && <AdminPanel />}

          {/* Live Mode Risk Footer Notice */}
          {status.environment === 'LIVE' && activeSection !== 'admin' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                LIVE environment selected. Verify lot sizes and AUTO toggles carefully before running unattended execution.
              </span>
            </div>
          )}
        </main>
      </div>

      {/* Live Environment Safety Confirmation Modal */}
      <LiveConfirmModal
        open={liveModalOpen}
        liveConfigured={status.liveConfigured}
        onConfirm={() => void performEnvironmentSwitch('LIVE', true)}
        onCancel={() => setLiveModalOpen(false)}
      />
    </div>
  );
}
