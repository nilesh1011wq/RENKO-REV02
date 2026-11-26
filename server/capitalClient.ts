import type {
  BrokerEnvironment,
  EpicSymbol,
  OhlcCandle,
  TradeDirection,
} from '../src/shared/types.ts';

// Strictly pinned Capital.com Open API endpoints (prevents SSRF / arbitrary host forwarding)
const CAPITAL_BASE_URLS: Readonly<Record<BrokerEnvironment, string>> = {
  DEMO: 'https://demo-api-capital.backend-capital.com',
  LIVE: 'https://api-capital.backend-capital.com',
};

interface CapitalCredentials {
  apiKey: string;
  identifier: string;
  password: string;
}

interface CapitalSession {
  cst: string;
  securityToken: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface CapitalAccountInfo {
  accountId: string;
  accountName: string;
  currency: string;
  balance: number;
  available: number;
  profitLoss: number;
  equity: number;
}

export interface CapitalMarketQuote {
  epic: string;
  bid: number;
  offer: number;
  high: number;
  low: number;
  netChange: number;
  percentageChange: number;
}

export interface CapitalRawPosition {
  dealId: string;
  epic: string;
  direction: TradeDirection;
  size: number;
  level: number;
  currentLevel: number;
  profitLevel: number | null;
  stopLevel: number | null;
  upl: number;
  leverage: number;
  createdDateUTC: string;
}

export interface CapitalRawWorkingOrder {
  dealId: string;
  epic: string;
  direction: TradeDirection;
  size: number;
  orderLevel: number;
  type: 'LIMIT' | 'STOP';
  profitLevel: number | null;
  stopLevel: number | null;
  createdDateUTC: string;
}

export interface CapitalRawTransaction {
  reference: string;
  dateUtc: string;
  instrumentName: string;
  transactionType: string;
  size: number;
  currency: string;
  note: string;
}

const SESSION_REFRESH_MS = 8 * 60 * 1000; // Refresh before Capital.com 10-minute session timeout

export class CapitalApiClient {
  private sessions: Partial<Record<BrokerEnvironment, CapitalSession>> = {};

  getCredentials(env: BrokerEnvironment): CapitalCredentials | null {
    const prefix = env === 'LIVE' ? 'CAPITAL_LIVE_' : 'CAPITAL_DEMO_';
    const apiKey = (process.env[`${prefix}API_KEY`] || '').trim();
    const identifier = (process.env[`${prefix}IDENTIFIER`] || '').trim();
    const password = (process.env[`${prefix}PASSWORD`] || '').trim();

    if (!apiKey || !identifier || !password) {
      return null;
    }

    return { apiKey, identifier, password };
  }

  isConfigured(env: BrokerEnvironment): boolean {
    return this.getCredentials(env) !== null;
  }

  private getBaseUrl(env: BrokerEnvironment): string {
    return CAPITAL_BASE_URLS[env];
  }

  private async ensureSession(env: BrokerEnvironment): Promise<{
    creds: CapitalCredentials;
    session: CapitalSession;
  }> {
    const creds = this.getCredentials(env);
    if (!creds) {
      throw new Error(
        `Capital.com ${env} environment variables are not configured on the server.`,
      );
    }

    const existing = this.sessions[env];
    const now = Date.now();
    if (existing && now - existing.lastUsedAt < SESSION_REFRESH_MS) {
      return { creds, session: existing };
    }

    const res = await fetch(`${this.getBaseUrl(env)}/api/v1/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CAP-API-KEY': creds.apiKey,
      },
      body: JSON.stringify({
        identifier: creds.identifier,
        password: creds.password,
        encryptedPassword: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Capital.com ${env} authentication failed (HTTP ${res.status}).`);
    }

    const cst = res.headers.get('CST') || res.headers.get('cst');
    const securityToken =
      res.headers.get('X-SECURITY-TOKEN') || res.headers.get('x-security-token');

    if (!cst || !securityToken) {
      throw new Error(`Capital.com ${env} session response missing security tokens.`);
    }

    const session: CapitalSession = {
      cst,
      securityToken,
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions[env] = session;

    return { creds, session };
  }

  private async request<T>(
    env: BrokerEnvironment,
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const { creds, session } = await this.ensureSession(env);
    const url = `${this.getBaseUrl(env)}${path}`;

    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-CAP-API-KEY': creds.apiKey,
        CST: session.cst,
        'X-SECURITY-TOKEN': session.securityToken,
        ...(init.headers || {}),
      },
    });

    if (res.status === 401 && !retried) {
      delete this.sessions[env];
      return this.request<T>(env, path, init, true);
    }

    session.lastUsedAt = Date.now();

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { errorCode?: string };
        if (errBody?.errorCode) {
          reason = `${reason}: ${errBody.errorCode}`;
        }
      } catch {
        // Ignore non-JSON error body
      }
      throw new Error(`Capital.com API request failed (${reason})`);
    }

    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  }

  async getAccountSummary(env: BrokerEnvironment): Promise<CapitalAccountInfo> {
    const data = await this.request<{
      accounts?: Array<{
        accountId: string;
        accountName: string;
        preferred?: boolean;
        currency: string;
        balance?: {
          balance?: number;
          deposit?: number;
          profitLoss?: number;
          available?: number;
        };
      }>;
    }>(env, '/api/v1/accounts');

    const acct =
      data.accounts?.find((a) => a.preferred) || data.accounts?.[0];

    if (!acct) {
      throw new Error(`No active Capital.com ${env} trading accounts found.`);
    }

    const balance = Number(acct.balance?.balance ?? 0);
    const profitLoss = Number(acct.balance?.profitLoss ?? 0);
    const available = Number(acct.balance?.available ?? balance);

    return {
      accountId: acct.accountId,
      accountName: acct.accountName || `Capital.com ${env}`,
      currency: acct.currency || 'USD',
      balance,
      available,
      profitLoss,
      equity: balance + profitLoss,
    };
  }

  async getMarkets(
    env: BrokerEnvironment,
    epics: EpicSymbol[],
  ): Promise<Record<string, CapitalMarketQuote>> {
    const query = encodeURIComponent(epics.join(','));
    const data = await this.request<{
      marketDetails?: Array<{
        instrument?: { epic?: string };
        snapshot?: {
          bid?: number;
          offer?: number;
          high?: number;
          low?: number;
          netChange?: number;
          percentageChange?: number;
        };
      }>;
    }>(env, `/api/v1/markets?epics=${query}`);

    const map: Record<string, CapitalMarketQuote> = {};
    for (const item of data.marketDetails || []) {
      const epic = item.instrument?.epic;
      if (!epic || !item.snapshot) continue;
      map[epic] = {
        epic,
        bid: Number(item.snapshot.bid ?? 0),
        offer: Number(item.snapshot.offer ?? 0),
        high: Number(item.snapshot.high ?? 0),
        low: Number(item.snapshot.low ?? 0),
        netChange: Number(item.snapshot.netChange ?? 0),
        percentageChange: Number(item.snapshot.percentageChange ?? 0),
      };
    }
    return map;
  }

  async getPrices(
    env: BrokerEnvironment,
    epic: EpicSymbol,
    resolution: 'MINUTE_15' | 'HOUR' | 'DAY',
    max = 120,
  ): Promise<OhlcCandle[]> {
    const data = await this.request<{
      prices?: Array<{
        snapshotTimeUTC?: string;
        openPrice?: { bid?: number; ask?: number };
        highPrice?: { bid?: number; ask?: number };
        lowPrice?: { bid?: number; ask?: number };
        closePrice?: { bid?: number; ask?: number };
      }>;
    }>(
      env,
      `/api/v1/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${max}`,
    );

    return (data.prices || [])
      .map((p) => {
        const open = ((p.openPrice?.bid ?? 0) + (p.openPrice?.ask ?? 0)) / 2;
        const high = ((p.highPrice?.bid ?? 0) + (p.highPrice?.ask ?? 0)) / 2;
        const low = ((p.lowPrice?.bid ?? 0) + (p.lowPrice?.ask ?? 0)) / 2;
        const close = ((p.closePrice?.bid ?? 0) + (p.closePrice?.ask ?? 0)) / 2;
        return {
          timestamp: p.snapshotTimeUTC || new Date().toISOString(),
          open,
          high,
          low,
          close,
        };
      })
      .filter((c) => c.close > 0);
  }

  async getPositions(env: BrokerEnvironment): Promise<CapitalRawPosition[]> {
    const data = await this.request<{
      positions?: Array<{
        position?: {
          dealId?: string;
          direction?: TradeDirection;
          size?: number;
          level?: number;
          profitLevel?: number;
          stopLevel?: number;
          upl?: number;
          leverage?: number;
          createdDateUTC?: string;
        };
        market?: {
          epic?: string;
          bid?: number;
          offer?: number;
        };
      }>;
    }>(env, '/api/v1/positions');

    return (data.positions || [])
      .filter((item) => item.position?.dealId && item.market?.epic)
      .map((item) => {
        const p = item.position!;
        const m = item.market!;
        const currentLevel =
          p.direction === 'BUY'
            ? Number(m.bid ?? p.level ?? 0)
            : Number(m.offer ?? p.level ?? 0);
        return {
          dealId: p.dealId!,
          epic: m.epic!,
          direction: p.direction || 'BUY',
          size: Number(p.size ?? 0),
          level: Number(p.level ?? 0),
          currentLevel,
          profitLevel: p.profitLevel != null ? Number(p.profitLevel) : null,
          stopLevel: p.stopLevel != null ? Number(p.stopLevel) : null,
          upl: Number(p.upl ?? 0),
          leverage: Number(p.leverage ?? 20),
          createdDateUTC: p.createdDateUTC || new Date().toISOString(),
        };
      });
  }

  async getWorkingOrders(
    env: BrokerEnvironment,
  ): Promise<CapitalRawWorkingOrder[]> {
    const data = await this.request<{
      workingOrders?: Array<{
        workingOrderData?: {
          dealId?: string;
          epic?: string;
          direction?: TradeDirection;
          orderSize?: number;
          orderLevel?: number;
          type?: 'LIMIT' | 'STOP';
          profitLevel?: number;
          stopLevel?: number;
          createdDateUTC?: string;
        };
      }>;
    }>(env, '/api/v1/workingorders');

    return (data.workingOrders || [])
      .filter((item) => item.workingOrderData?.dealId)
      .map((item) => {
        const w = item.workingOrderData!;
        return {
          dealId: w.dealId!,
          epic: w.epic || '',
          direction: w.direction || 'BUY',
          size: Number(w.orderSize ?? 0),
          orderLevel: Number(w.orderLevel ?? 0),
          type: w.type || 'LIMIT',
          profitLevel: w.profitLevel != null ? Number(w.profitLevel) : null,
          stopLevel: w.stopLevel != null ? Number(w.stopLevel) : null,
          createdDateUTC: w.createdDateUTC || new Date().toISOString(),
        };
      });
  }

  async createWorkingLimitOrder(
    env: BrokerEnvironment,
    params: {
      epic: EpicSymbol;
      direction: TradeDirection;
      size: number;
      level: number;
      profitLevel?: number | null;
    },
  ): Promise<{ dealReference: string }> {
    const payload: Record<string, unknown> = {
      epic: params.epic,
      direction: params.direction,
      size: params.size,
      level: params.level,
      type: 'LIMIT',
    };
    if (params.profitLevel != null) {
      payload.profitLevel = params.profitLevel;
    }

    return this.request<{ dealReference: string }>(env, '/api/v1/workingorders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createMarketPosition(
    env: BrokerEnvironment,
    params: {
      epic: EpicSymbol;
      direction: TradeDirection;
      size: number;
      profitLevel?: number | null;
    },
  ): Promise<{ dealReference: string }> {
    const payload: Record<string, unknown> = {
      epic: params.epic,
      direction: params.direction,
      size: params.size,
      guaranteedStop: false,
    };
    if (params.profitLevel != null) {
      payload.profitLevel = params.profitLevel;
    }

    return this.request<{ dealReference: string }>(env, '/api/v1/positions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async closePosition(env: BrokerEnvironment, dealId: string): Promise<void> {
    await this.request(env, `/api/v1/positions/${encodeURIComponent(dealId)}`, {
      method: 'DELETE',
    });
  }

  async cancelWorkingOrder(
    env: BrokerEnvironment,
    dealId: string,
  ): Promise<void> {
    await this.request(
      env,
      `/api/v1/workingorders/${encodeURIComponent(dealId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async getTransactions(
    env: BrokerEnvironment,
    fromDate: string,
    toDate: string,
  ): Promise<CapitalRawTransaction[]> {
    const fromParam = encodeURIComponent(`${fromDate}T00:00:00`);
    const toParam = encodeURIComponent(`${toDate}T23:59:59`);
    const data = await this.request<{
      transactions?: Array<{
        reference?: string;
        dateUtc?: string;
        dateUTC?: string;
        instrumentName?: string;
        transactionType?: string;
        type?: string;
        size?: number;
        amount?: number;
        currency?: string;
        note?: string;
      }>;
    }>(env, `/api/v1/history/transactions?from=${fromParam}&to=${toParam}`);

    return (data.transactions || []).map((t) => ({
      reference: t.reference || '',
      dateUtc: t.dateUtc || t.dateUTC || new Date().toISOString(),
      instrumentName: t.instrumentName || '',
      transactionType: t.transactionType || t.type || 'TRADE',
      size: Number(t.size ?? t.amount ?? 0),
      currency: t.currency || 'USD',
      note: t.note || '',
    }));
  }
}
