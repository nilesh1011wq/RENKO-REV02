import { auth } from './firebase.ts';
import type {
  AdminActiveSessionSummary,
  BrokerEnvironment,
  DashboardSnapshot,
  EpicSymbol,
  InstrumentConfig,
  PnlReportResponse,
  TradeDirection,
  UserAccessStatus,
  UserRole,
  WorkspaceConfigPatch,
} from '../shared/types.ts';

async function getAuthHeaders(includeJson = false): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to access your trading workspace.');
  }
  const token = await currentUser.getIdToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let parsed: unknown = null;

  if (rawText.trim().length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      throw new Error(
        `Unexpected non-JSON response from server (${res.status}). Please retry.`,
      );
    }
  }

  if (!res.ok) {
    const errMsg =
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Empty response from server (${res.status}).`);
  }

  return parsed as T;
}

function assertValidSnapshot(data: unknown): DashboardSnapshot {
  const snap = data as Partial<DashboardSnapshot> | null;
  if (
    !snap ||
    typeof snap !== 'object' ||
    !snap.status ||
    !snap.configs ||
    !snap.configs.GOLD ||
    !snap.markets ||
    !snap.markets.GOLD ||
    !Array.isArray(snap.positions) ||
    !Array.isArray(snap.orders) ||
    !Array.isArray(snap.history)
  ) {
    throw new Error('Received an incomplete trading workspace snapshot.');
  }
  return snap as DashboardSnapshot;
}

export async function fetchSnapshot(): Promise<DashboardSnapshot> {
  const res = await fetch('/api/snapshot', {
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function hydrateWorkspaceConfigs(
  configs: Partial<Record<EpicSymbol, WorkspaceConfigPatch>>,
): Promise<DashboardSnapshot> {
  const res = await fetch('/api/workspace/hydrate', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify({ configs }),
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function fetchPnlReport(params: {
  from: string;
  to: string;
  epic: EpicSymbol | 'ALL';
}): Promise<PnlReportResponse> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    epic: params.epic,
  });
  const res = await fetch(`/api/reports/pnl?${qs.toString()}`, {
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  return handleJsonResponse<PnlReportResponse>(res);
}

export async function switchEnvironment(
  environment: BrokerEnvironment,
  confirmedLive = false,
): Promise<DashboardSnapshot> {
  const res = await fetch('/api/broker/environment', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify({ environment, confirmedLive }),
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function syncBroker(): Promise<DashboardSnapshot> {
  const res = await fetch('/api/broker/sync', {
    method: 'POST',
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function updateInstrumentStrategy(
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
): Promise<DashboardSnapshot> {
  const res = await fetch(`/api/strategy/${encodeURIComponent(epic)}`, {
    method: 'PATCH',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify(patch),
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function submitManualTrade(params: {
  epic: EpicSymbol;
  direction: TradeDirection;
  size?: number;
  tpBricks?: number;
}): Promise<DashboardSnapshot> {
  const res = await fetch('/api/trade/manual', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify(params),
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function closeBrokerPosition(
  dealId: string,
): Promise<DashboardSnapshot> {
  const res = await fetch(`/api/broker/positions/${encodeURIComponent(dealId)}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function cancelWorkingLimitOrder(
  dealId: string,
): Promise<DashboardSnapshot> {
  const res = await fetch(`/api/broker/orders/${encodeURIComponent(dealId)}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

export async function triggerPreviewFlip(
  epic: EpicSymbol,
): Promise<DashboardSnapshot> {
  const res = await fetch('/api/preview/simulate-flip', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify({ epic }),
  });
  const data = await handleJsonResponse<DashboardSnapshot>(res);
  return assertValidSnapshot(data);
}

// Admin-only backend governance sync routes
export async function syncAdminGovernance(policy: {
  requireAdminApproval: boolean;
  globalAutoTradingEnabled: boolean;
  allowNonAdminLiveMode: boolean;
  maxLotCap: number;
}): Promise<{ ok: boolean }> {
  const res = await fetch('/api/admin/governance', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify(policy),
  });
  return handleJsonResponse<{ ok: boolean }>(res);
}

export async function syncAdminUserAccess(payload: {
  uid: string;
  email: string;
  role: UserRole;
  status: UserAccessStatus;
  allowLiveMode: boolean;
}): Promise<{ ok: boolean }> {
  const res = await fetch('/api/admin/user-access', {
    method: 'POST',
    headers: await getAuthHeaders(true),
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<{ ok: boolean }>(res);
}

export async function fetchAdminSessions(): Promise<{
  count: number;
  sessions: AdminActiveSessionSummary[];
}> {
  const res = await fetch('/api/admin/sessions', {
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  return handleJsonResponse<{
    count: number;
    sessions: AdminActiveSessionSummary[];
  }>(res);
}
