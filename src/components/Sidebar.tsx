import {
  Activity,
  BarChart3,
  Clock,
  Layers,
  ListOrdered,
  LogOut,
  PlugZap,
  Shield,
  TrendingUp,
} from 'lucide-react';
import type { BrokerStatus } from '../shared/types.ts';
import { formatCurrency, formatSignedCurrency } from '../lib/format.ts';

export type NavSection =
  | 'terminal'
  | 'watchlists'
  | 'positions'
  | 'orders'
  | 'history'
  | 'pnl'
  | 'broker'
  | 'admin';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  status: BrokerStatus;
  positionsCount: number;
  ordersCount: number;
  historyCount: number;
  isAdmin: boolean;
  userDisplayName: string;
  userEmail: string;
  onLogout: () => void;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  status,
  positionsCount,
  ordersCount,
  historyCount,
  isAdmin,
  userDisplayName,
  userEmail,
  onLogout,
}: SidebarProps) {
  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof BarChart3;
    count?: number;
  }> = [
    { id: 'terminal', label: 'Terminal', icon: BarChart3 },
    { id: 'watchlists', label: 'Watchlists', icon: Layers, count: 5 },
    { id: 'positions', label: 'Positions', icon: Activity, count: positionsCount },
    { id: 'orders', label: 'Working Orders', icon: ListOrdered, count: ordersCount },
    { id: 'history', label: 'Execution History', icon: Clock, count: historyCount },
    { id: 'pnl', label: 'P&L Report', icon: TrendingUp },
    { id: 'broker', label: 'Broker & Rules', icon: PlugZap },
  ];

  if (isAdmin) {
    navItems.push({ id: 'admin', label: 'Admin Control', icon: Shield });
  }

  return (
    <aside className="w-[248px] shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between min-h-screen sticky top-0 h-screen">
      <div>
        {/* Brand mark */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            RenkoDesk
          </span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {isAdmin ? 'Admin' : 'Trader'}
          </span>
        </div>

        {/* Navigation links */}
        <nav className="p-3 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isActive ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom account equity summary + signed-in user profile */}
      <div className="border-t border-slate-200 bg-slate-50/70">
        <div className="p-4 border-b border-slate-200/80">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="font-medium text-slate-700">
              Capital.com {status.environment}
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              {status.isSimulated
                ? 'Isolated'
                : status.connected
                  ? 'Connected'
                  : 'Offline'}
            </span>
          </div>

          <div className="mt-2.5 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Equity</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatCurrency(status.equity, status.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Open P&amp;L</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
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
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Available</span>
              <span className="font-mono text-slate-700 tabular-nums">
                {formatCurrency(status.available, status.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* User session bar */}
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {userDisplayName}
            </div>
            <div className="font-mono text-[11px] text-slate-500 truncate">
              {userEmail}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
