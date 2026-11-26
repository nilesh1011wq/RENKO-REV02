import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  Check,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase.ts';
import { useAuth } from '../context/AuthContext.tsx';
import {
  fetchAdminSessions,
  syncAdminGovernance,
  syncAdminUserAccess,
} from '../lib/api.ts';
import { formatGstTimestamp } from '../lib/format.ts';
import type {
  AdminActiveSessionSummary,
  AdminAuditLogRecord,
  UserAccessStatus,
  UserProfileRecord,
  UserRole,
} from '../shared/types.ts';

function tsToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function makeAuditId(): string {
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AdminPanel() {
  const { user, governance, isAdmin } = useAuth();

  const [users, setUsers] = useState<UserProfileRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([]);
  const [activeSessions, setActiveSessions] = useState<
    AdminActiveSessionSummary[]
  >([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Governance form state synced from Firestore governance doc
  const [requireApproval, setRequireApproval] = useState(
    governance.requireAdminApproval,
  );
  const [globalAutoEnabled, setGlobalAutoEnabled] = useState(
    governance.globalAutoTradingEnabled,
  );
  const [allowNonAdminLive, setAllowNonAdminLive] = useState(
    governance.allowNonAdminLiveMode,
  );
  const [maxLotCap, setMaxLotCap] = useState(String(governance.maxLotCap));
  const [announcement, setAnnouncement] = useState(governance.announcement);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    setRequireApproval(governance.requireAdminApproval);
    setGlobalAutoEnabled(governance.globalAutoTradingEnabled);
    setAllowNonAdminLive(governance.allowNonAdminLiveMode);
    setMaxLotCap(String(governance.maxLotCap));
    setAnnouncement(governance.announcement);
  }, [governance]);

  // Live Firestore list of all users (Admin-only collection query)
  useEffect(() => {
    if (!isAdmin || !user) return;

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list: UserProfileRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              uid: String(d.uid || docSnap.id),
              email: String(d.email || ''),
              displayName: String(d.displayName || 'Trader'),
              photoURL: String(d.photoURL || ''),
              role: (d.role === 'admin' ? 'admin' : 'trader') as UserRole,
              status: (d.status === 'suspended'
                ? 'suspended'
                : d.status === 'pending'
                  ? 'pending'
                  : 'active') as UserAccessStatus,
              allowLiveMode: Boolean(d.allowLiveMode),
              createdAt: tsToIso(d.createdAt),
              updatedAt: tsToIso(d.updatedAt),
              lastLoginAt: tsToIso(d.lastLoginAt),
            };
          })
          .sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt));
        setUsers(list);

        // Keep server runtime table aligned with persisted user RBAC states
        for (const u of list) {
          if (u.email.toLowerCase() !== BOOTSTRAP_ADMIN_EMAIL) {
            void syncAdminUserAccess({
              uid: u.uid,
              email: u.email,
              role: u.role,
              status: u.status,
              allowLiveMode: u.allowLiveMode,
            }).catch(() => {
              // Silent background sync
            });
          }
        }
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch (wrapped) {
          setFeedback({
            type: 'error',
            message:
              wrapped instanceof Error
                ? wrapped.message
                : 'Unable to load user directory.',
          });
        }
      },
    );

    const logsQuery = query(
      collection(db, 'auditLogs'),
      orderBy('createdAt', 'desc'),
      limit(30),
    );
    const unsubLogs = onSnapshot(
      logsQuery,
      (snap) => {
        const logs: AdminAuditLogRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            actorUid: String(d.actorUid || ''),
            actorEmail: String(d.actorEmail || ''),
            action: String(d.action || ''),
            targetUid: String(d.targetUid || ''),
            details: String(d.details || ''),
            createdAt: tsToIso(d.createdAt),
          };
        });
        setAuditLogs(logs);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'auditLogs');
        } catch (wrapped) {
          setFeedback({
            type: 'error',
            message:
              wrapped instanceof Error
                ? wrapped.message
                : 'Unable to load audit logs.',
          });
        }
      },
    );

    return () => {
      unsubUsers();
      unsubLogs();
    };
  }, [isAdmin, user]);

  const loadSessions = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingSessions(true);
    try {
      const data = await fetchAdminSessions();
      setActiveSessions(data.sessions);
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to fetch active workspace sessions.',
      });
    } finally {
      setLoadingSessions(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const writeAuditLog = async (
    action: string,
    targetUid: string,
    details: string,
  ) => {
    if (!user?.email) return;
    const logId = makeAuditId();
    const path = `auditLogs/${logId}`;
    try {
      await setDoc(doc(db, 'auditLogs', logId), {
        actorUid: user.uid,
        actorEmail: user.email,
        action: action.slice(0, 60),
        targetUid: targetUid.slice(0, 128),
        details: details.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const handleSaveGovernance = async () => {
    if (!user || !isAdmin) return;
    const parsedCap = Number(maxLotCap);
    if (!Number.isFinite(parsedCap) || parsedCap <= 0 || parsedCap > 10000) {
      setFeedback({
        type: 'error',
        message: 'Max lot cap must be between 0.01 and 10,000.',
      });
      return;
    }

    setSavingPolicy(true);
    setFeedback(null);
    try {
      await setDoc(doc(db, 'governance', 'global'), {
        requireAdminApproval: requireApproval,
        globalAutoTradingEnabled: globalAutoEnabled,
        allowNonAdminLiveMode: allowNonAdminLive,
        maxLotCap: parsedCap,
        announcement: announcement.trim().slice(0, 300),
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });

      await syncAdminGovernance({
        requireAdminApproval: requireApproval,
        globalAutoTradingEnabled: globalAutoEnabled,
        allowNonAdminLiveMode: allowNonAdminLive,
        maxLotCap: parsedCap,
      });

      await writeAuditLog(
        'UPDATE_GOVERNANCE',
        'global',
        `AUTO=${globalAutoEnabled ? 'ON' : 'PAUSED'}, Approval=${requireApproval ? 'REQ' : 'OPEN'}, Live=${allowNonAdminLive ? 'ALLOWED' : 'ADMIN_ONLY'}, MaxLot=${parsedCap}`,
      );

      setFeedback({
        type: 'success',
        message:
          'Global governance policy saved and enforced across all active workspaces.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to update governance policy.',
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleUpdateUser = async (
    target: UserProfileRecord,
    next: {
      role?: UserRole;
      status?: UserAccessStatus;
      allowLiveMode?: boolean;
    },
    actionCode: string,
    summary: string,
  ) => {
    if (!user || !isAdmin) return;
    if (target.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return;

    const updatedRole = next.role ?? target.role;
    const updatedStatus = next.status ?? target.status;
    const updatedLive = next.allowLiveMode ?? target.allowLiveMode;

    setBusyUid(target.uid);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'users', target.uid), {
        role: updatedRole,
        status: updatedStatus,
        allowLiveMode: updatedLive,
        updatedAt: serverTimestamp(),
      });

      // Keep /admins/{uid} role registry synchronized with Firestore rules
      if (next.role === 'admin' && target.role !== 'admin') {
        await setDoc(doc(db, 'admins', target.uid), {
          uid: target.uid,
          email: target.email,
          grantedBy: user.uid,
          createdAt: serverTimestamp(),
        });
      } else if (next.role === 'trader' && target.role === 'admin') {
        await deleteDoc(doc(db, 'admins', target.uid));
      }

      await syncAdminUserAccess({
        uid: target.uid,
        email: target.email,
        role: updatedRole,
        status: updatedStatus,
        allowLiveMode: updatedLive,
      });

      await writeAuditLog(actionCode, target.uid, `${target.email}: ${summary}`);
      await loadSessions();

      setFeedback({
        type: 'success',
        message: `Updated ${target.email}: ${summary}`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to update user access.',
      });
    } finally {
      setBusyUid(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <ShieldAlert className="w-6 h-6 text-red-600 mx-auto mb-2" />
        <h2 className="font-display text-base font-bold text-slate-900">
          Administrator Access Required
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Only verified dashboard administrators can access governance controls.
        </p>
      </div>
    );
  }

  const activeCount = users.filter((u) => u.status === 'active').length;
  const pendingCount = users.filter((u) => u.status === 'pending').length;
  const suspendedCount = users.filter((u) => u.status === 'suspended').length;

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500 font-medium">
            Registered Users
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {users.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono">
            {activeCount} active · {pendingCount} pending · {suspendedCount} suspended
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500 font-medium">
            Active Isolated Engines
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {activeSessions.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Zero shared state between users
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500 font-medium">
            Global AUTO Master Switch
          </div>
          <div
            className={`mt-1.5 font-display text-xl font-bold ${
              governance.globalAutoTradingEnabled
                ? 'text-emerald-700'
                : 'text-amber-700'
            }`}
          >
            {governance.globalAutoTradingEnabled ? 'Enabled' : 'Paused'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Applies to all shared trader workspaces
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs text-slate-500 font-medium">
            New User Onboarding
          </div>
          <div className="mt-1.5 font-display text-xl font-bold text-slate-900">
            {governance.requireAdminApproval
              ? 'Approval Required'
              : 'Instant Sandbox'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Live broker keys stay admin-governed
          </div>
        </div>
      </div>

      {/* Global Governance Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-slate-900" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Global Dashboard Governance
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Changes take effect immediately across every shared user&apos;s isolated RenkoDesk workspace.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={savingPolicy}
            onClick={() => void handleSaveGovernance()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{savingPolicy ? 'Saving...' : 'Save Governance Policy'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
            <input
              type="checkbox"
              checked={globalAutoEnabled}
              onChange={(e) => setGlobalAutoEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Allow AUTO Execution Globally
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Uncheck to pause automated 2-leg Renko execution across all non-admin workspaces.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Require Approval for New Users
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                New sign-ins remain in pending state until you explicitly approve them below.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50/70">
            <input
              type="checkbox"
              checked={allowNonAdminLive}
              onChange={(e) => setAllowNonAdminLive(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Permit Approved Users Live Mode
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                When off, server Capital.com Live credentials stay exclusively locked to Admin.
              </div>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Max Lot Cap (Non-Admin Workspaces)
            </label>
            <input
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={maxLotCap}
              onChange={(e) => setMaxLotCap(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Workspace Notice Banner (Optional)
            </label>
            <input
              type="text"
              maxLength={300}
              placeholder="Example: CPI release at 16:30 GST — verify lot sizes before enabling AUTO."
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>
        </div>
      </div>

      {/* User Directory & Access Control Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 text-slate-700" />
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">
                User Access &amp; Role Management
              </h2>
              <p className="text-xs text-slate-500">
                Approve pending users, suspend workspaces, grant Live permissions, or delegate admin roles.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loadingSessions}
            onClick={() => void loadSessions()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`}
            />
            <span>Refresh Sessions</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-5">User</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Broker Access</th>
                <th className="py-3 px-4">Live Session</th>
                <th className="py-3 px-4">Last Login</th>
                <th className="py-3 px-5 text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isRoot =
                  u.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
                const session = activeSessions.find((s) => s.uid === u.uid);
                const isBusy = busyUid === u.uid;

                return (
                  <tr key={u.uid} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-5">
                      <div className="font-semibold text-slate-900">
                        {u.displayName}
                        {isRoot && (
                          <span className="ml-2 font-mono text-[10px] text-emerald-700 uppercase">
                            Owner
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {u.email}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-800 uppercase">
                      {u.role}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-semibold">
                      <span
                        className={
                          u.status === 'active'
                            ? 'text-emerald-700'
                            : u.status === 'pending'
                              ? 'text-amber-700'
                              : 'text-red-600'
                        }
                      >
                        {u.status.toUpperCase()}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      {u.role === 'admin'
                        ? 'Full Demo & Live'
                        : u.allowLiveMode && governance.allowNonAdminLiveMode
                          ? 'Live Permitted'
                          : 'Isolated Sandbox'}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-600 tabular-nums">
                      {session
                        ? `${session.openPositions} pos · ${session.workingOrders} ord`
                        : 'Idle'}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                      {formatGstTimestamp(u.lastLoginAt)}
                    </td>

                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      {isRoot ? (
                        <span className="text-[11px] text-slate-400 font-mono">
                          Protected Root Admin
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          {u.status !== 'active' ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleUpdateUser(
                                  u,
                                  { status: 'active' },
                                  'APPROVE_USER',
                                  'Activated workspace access',
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
                            >
                              <UserCheck className="w-3 h-3" />
                              <span>Approve</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleUpdateUser(
                                  u,
                                  { status: 'suspended' },
                                  'SUSPEND_USER',
                                  'Suspended workspace access',
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 text-[11px] font-semibold disabled:opacity-50"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Suspend</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleUpdateUser(
                                u,
                                { allowLiveMode: !u.allowLiveMode },
                                'TOGGLE_LIVE_ACCESS',
                                !u.allowLiveMode
                                  ? 'Granted Live mode eligibility'
                                  : 'Revoked Live mode eligibility',
                              )
                            }
                            className="px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 text-[11px] font-semibold disabled:opacity-50"
                          >
                            {u.allowLiveMode ? 'Revoke Live' : 'Allow Live'}
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleUpdateUser(
                                u,
                                {
                                  role: u.role === 'admin' ? 'trader' : 'admin',
                                },
                                u.role === 'admin'
                                  ? 'DEMOTE_ADMIN'
                                  : 'PROMOTE_ADMIN',
                                u.role === 'admin'
                                  ? 'Changed role to trader'
                                  : 'Promoted to administrator',
                              )
                            }
                            className="px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 text-[11px] font-semibold disabled:opacity-50"
                          >
                            {u.role === 'admin' ? 'Set Trader' : 'Make Admin'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Immutable Admin Audit Log */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Admin Governance Audit Log
          </h2>
          <p className="text-xs text-slate-500">
            Append-only log of policy updates and user permission changes.
          </p>
        </div>

        {auditLogs.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No administrative actions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-5">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-5 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {formatGstTimestamp(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">
                      {log.actorEmail}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-5 text-slate-600">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
