import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  EPIC_LIST,
  type AdminActiveSessionSummary,
  type BrokerEnvironment,
  type EpicSymbol,
  type InstrumentConfig,
  type TradeDirection,
  type UserAccessStatus,
  type UserRole,
} from './src/shared/types.ts';
import { TradingEngine } from './server/tradingEngine.ts';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  verifyRequestAuth,
  type AuthenticatedUser,
} from './server/firebaseAuth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface AuthedRequest extends Request {
  authUser?: AuthenticatedUser;
  isAdmin?: boolean;
  engine?: TradingEngine;
}

interface UserSessionRecord {
  uid: string;
  email: string;
  engine: TradingEngine;
  lastActiveAt: string;
}

interface ServerGovernanceState {
  requireAdminApproval: boolean;
  globalAutoTradingEnabled: boolean;
  allowNonAdminLiveMode: boolean;
  maxLotCap: number;
}

function isValidEpic(value: string): value is EpicSymbol {
  return EPIC_LIST.includes(value as EpicSymbol);
}

function isValidDirection(value: unknown): value is TradeDirection {
  return value === 'BUY' || value === 'SELL';
}

function isValidEnv(value: unknown): value is BrokerEnvironment {
  return value === 'DEMO' || value === 'LIVE';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  // Per-user isolated TradingEngine registry (zero cross-user state sharing)
  const sessions = new Map<string, UserSessionRecord>();
  const inFlightSessions = new Map<string, Promise<UserSessionRecord>>();

  // Runtime governance controls synced by authenticated Admins
  const governance: ServerGovernanceState = {
    requireAdminApproval: false,
    globalAutoTradingEnabled: true,
    allowNonAdminLiveMode: false,
    maxLotCap: 100,
  };

  const adminUids = new Set<string>();
  const suspendedUids = new Set<string>();
  const pendingUids = new Set<string>();
  const liveAllowedUids = new Set<string>();

  function isUserAdmin(user: AuthenticatedUser): boolean {
    return user.isBootstrapAdmin || adminUids.has(user.uid);
  }

  function computeAllowBrokerSecrets(uid: string, isAdmin: boolean): boolean {
    if (isAdmin) return true;
    return governance.allowNonAdminLiveMode && liveAllowedUids.has(uid);
  }

  async function getOrCreateSession(
    user: AuthenticatedUser,
    isAdmin: boolean,
  ): Promise<UserSessionRecord> {
    const existing = sessions.get(user.uid);
    const allowBrokerSecrets = computeAllowBrokerSecrets(user.uid, isAdmin);

    if (existing) {
      existing.lastActiveAt = new Date().toISOString();
      existing.engine.setGovernancePolicy({
        isAdminWorkspace: isAdmin,
        allowBrokerSecrets,
        globalAutoEnabled: governance.globalAutoTradingEnabled,
        maxLotCap: governance.maxLotCap,
      });
      return existing;
    }

    const pendingInit = inFlightSessions.get(user.uid);
    if (pendingInit) {
      return pendingInit;
    }

    const initPromise = (async () => {
      const engine = new TradingEngine({
        ownerUid: user.uid,
        isAdminWorkspace: isAdmin,
        allowBrokerSecrets,
        globalAutoEnabled: governance.globalAutoTradingEnabled,
        maxLotCap: governance.maxLotCap,
      });
      await engine.syncWithBroker();
      const record: UserSessionRecord = {
        uid: user.uid,
        email: user.email,
        engine,
        lastActiveAt: new Date().toISOString(),
      };
      sessions.set(user.uid, record);
      return record;
    })().finally(() => {
      inFlightSessions.delete(user.uid);
    });

    inFlightSessions.set(user.uid, initPromise);
    return initPromise;
  }

  function applyGovernanceToAllSessions(): void {
    for (const [uid, record] of sessions.entries()) {
      const isAdmin =
        record.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL ||
        adminUids.has(uid);
      record.engine.setGovernancePolicy({
        isAdminWorkspace: isAdmin,
        allowBrokerSecrets: computeAllowBrokerSecrets(uid, isAdmin),
        globalAutoEnabled: governance.globalAutoTradingEnabled,
        maxLotCap: governance.maxLotCap,
      });
    }
  }

  // Periodic background ticks across active isolated user workspaces
  setInterval(() => {
    for (const record of sessions.values()) {
      const snap = record.engine.getSnapshot();
      if (snap.status.isSimulated) {
        record.engine.tickSimulation();
      }
    }
  }, 2000);

  setInterval(() => {
    for (const record of sessions.values()) {
      const snap = record.engine.getSnapshot();
      if (!snap.status.isSimulated) {
        void record.engine.syncWithBroker();
      }
    }
  }, 15000);

  // Enforce verified Firebase Auth Bearer Token on EVERY /api/* route
  async function requireAuth(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const user = await verifyRequestAuth(req);
      if (!user) {
        res.status(401).json({
          error: 'Authentication required. Please sign in with a verified Google account.',
        });
        return;
      }

      const isAdmin = isUserAdmin(user);

      if (!isAdmin && suspendedUids.has(user.uid)) {
        res.status(403).json({
          error: 'Your workspace access has been suspended by the administrator.',
        });
        return;
      }

      if (!isAdmin && pendingUids.has(user.uid)) {
        res.status(403).json({
          error: 'Your workspace is awaiting administrator approval.',
        });
        return;
      }

      const session = await getOrCreateSession(user, isAdmin);
      req.authUser = user;
      req.isAdmin = isAdmin;
      req.engine = session.engine;
      next();
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Workspace session initialization failed.',
      });
    }
  }

  function requireAdmin(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (!req.authUser || !req.isAdmin) {
      res.status(403).json({
        error: 'Administrator privileges are required for this action.',
      });
      return;
    }
    next();
  }

  app.use('/api', (req, res, next) => {
    void requireAuth(req as AuthedRequest, res, next);
  });

  // GET user's isolated dashboard snapshot
  app.get('/api/snapshot', (req, res) => {
    const authed = req as AuthedRequest;
    res.json(authed.engine!.getSnapshot());
  });

  // POST hydrate persisted Firestore strategy configs into user's isolated engine
  app.post('/api/workspace/hydrate', (req, res) => {
    const authed = req as AuthedRequest;
    const body = req.body as { configs?: Record<string, Record<string, unknown>> };
    const incoming = body?.configs;
    if (!incoming || typeof incoming !== 'object') {
      res.json(authed.engine!.getSnapshot());
      return;
    }

    const sanitized: Partial<
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
    > = {};

    for (const epic of EPIC_LIST) {
      const raw = incoming[epic];
      if (!raw || typeof raw !== 'object') continue;
      const patch: Record<string, unknown> = {};
      if (raw.mode === 'AUTO' || raw.mode === 'MANUAL') patch.mode = raw.mode;
      if (raw.sizingMode === 'LOT' || raw.sizingMode === 'MARGIN') {
        patch.sizingMode = raw.sizingMode;
      }
      if (typeof raw.stEnabled === 'boolean') patch.stEnabled = raw.stEnabled;
      const numFields = [
        'lot1',
        'lot2',
        'margin1',
        'margin2',
        'stPeriod',
        'stMultiplier',
      ] as const;
      for (const f of numFields) {
        const val = Number(raw[f]);
        if (Number.isFinite(val) && val > 0) {
          patch[f] = val;
        }
      }
      sanitized[epic] = patch;
    }

    authed.engine!.applyPersistedConfigs(sanitized);
    res.json(authed.engine!.getSnapshot());
  });

  // POST switch Capital.com environment (DEMO | LIVE) — LIVE restricted by Admin governance
  app.post('/api/broker/environment', async (req, res) => {
    const authed = req as AuthedRequest;
    const { environment, confirmedLive } = req.body as {
      environment?: unknown;
      confirmedLive?: unknown;
    };

    if (!isValidEnv(environment)) {
      res.status(400).json({ error: 'Invalid broker environment. Use DEMO or LIVE.' });
      return;
    }

    if (environment === 'LIVE') {
      const canUseLive =
        authed.isAdmin === true ||
        (governance.allowNonAdminLiveMode &&
          liveAllowedUids.has(authed.authUser!.uid));
      if (!canUseLive) {
        res.status(403).json({
          error:
            'Capital.com LIVE mode is restricted by the dashboard administrator. Continue trading in Demo/Sandbox mode or request access.',
        });
        return;
      }

      if (confirmedLive !== true) {
        res.status(400).json({
          error: 'Explicit confirmation is required before switching to Capital.com LIVE.',
        });
        return;
      }
    }

    try {
      const snapshot = await authed.engine!.setEnvironment(environment);
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to switch environment.',
      });
    }
  });

  // POST force broker sync & strategy evaluation
  app.post('/api/broker/sync', async (req, res) => {
    const authed = req as AuthedRequest;
    try {
      await authed.engine!.syncWithBroker();
      res.json(authed.engine!.getSnapshot());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Sync failed.',
      });
    }
  });

  // PATCH update instrument strategy config in user's isolated engine
  app.patch('/api/strategy/:epic', (req, res) => {
    const authed = req as AuthedRequest;
    const epicParam = String(req.params.epic || '').toUpperCase();
    if (!isValidEpic(epicParam)) {
      res.status(400).json({ error: 'Unknown instrument epic.' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.mode === 'AUTO' || body.mode === 'MANUAL') patch.mode = body.mode;
    if (body.sizingMode === 'LOT' || body.sizingMode === 'MARGIN') {
      patch.sizingMode = body.sizingMode;
    }
    if (typeof body.stEnabled === 'boolean') patch.stEnabled = body.stEnabled;

    const numericFields = [
      'lot1',
      'lot2',
      'margin1',
      'margin2',
      'stPeriod',
      'stMultiplier',
    ] as const;

    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const num = Number(body[field]);
        if (!Number.isFinite(num) || num <= 0) {
          res.status(400).json({ error: `Invalid numeric value for ${field}.` });
          return;
        }
        patch[field] = num;
      }
    }

    const snapshot = authed.engine!.updateConfig(epicParam, patch);
    res.json(snapshot);
  });

  // POST execute manual trade (blocked when instrument is in AUTO mode)
  app.post('/api/trade/manual', async (req, res) => {
    const authed = req as AuthedRequest;
    const { epic, direction, size, tpBricks } = req.body as {
      epic?: string;
      direction?: unknown;
      size?: unknown;
      tpBricks?: unknown;
    };

    const epicKey = String(epic || '').toUpperCase();
    if (!isValidEpic(epicKey)) {
      res.status(400).json({ error: 'Invalid instrument epic.' });
      return;
    }
    if (!isValidDirection(direction)) {
      res.status(400).json({ error: 'Direction must be BUY or SELL.' });
      return;
    }

    const parsedSize = size !== undefined ? Number(size) : undefined;
    if (parsedSize !== undefined && (!Number.isFinite(parsedSize) || parsedSize <= 0)) {
      res.status(400).json({ error: 'Order size must be a positive number.' });
      return;
    }

    const parsedTpBricks = tpBricks !== undefined ? Number(tpBricks) : undefined;
    if (
      parsedTpBricks !== undefined &&
      (!Number.isFinite(parsedTpBricks) || parsedTpBricks < 0)
    ) {
      res.status(400).json({ error: 'Take-profit bricks must be non-negative.' });
      return;
    }

    try {
      const snapshot = await authed.engine!.placeManualOrder(
        epicKey,
        direction,
        parsedSize,
        parsedTpBricks,
      );
      res.json(snapshot);
    } catch (err) {
      res.status(409).json({
        error: err instanceof Error ? err.message : 'Manual order failed.',
      });
    }
  });

  // DELETE close an open position
  app.delete('/api/broker/positions/:dealId', async (req, res) => {
    const authed = req as AuthedRequest;
    const dealId = String(req.params.dealId || '').trim();
    if (!dealId || dealId.length > 80) {
      res.status(400).json({ error: 'Invalid position dealId.' });
      return;
    }

    try {
      const snapshot = await authed.engine!.closePosition(dealId);
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to close position.',
      });
    }
  });

  // DELETE cancel a working limit order
  app.delete('/api/broker/orders/:dealId', async (req, res) => {
    const authed = req as AuthedRequest;
    const dealId = String(req.params.dealId || '').trim();
    if (!dealId || dealId.length > 80) {
      res.status(400).json({ error: 'Invalid working order dealId.' });
      return;
    }

    try {
      const snapshot = await authed.engine!.cancelOrder(dealId);
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to cancel order.',
      });
    }
  });

  // POST simulate trend flip (strictly in Preview/Sandbox mode)
  app.post('/api/preview/simulate-flip', (req, res) => {
    const authed = req as AuthedRequest;
    const epicKey = String((req.body as { epic?: string })?.epic || '').toUpperCase();
    if (!isValidEpic(epicKey)) {
      res.status(400).json({ error: 'Invalid instrument epic.' });
      return;
    }

    try {
      const snapshot = authed.engine!.simulateTrendFlip(epicKey);
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to simulate flip.',
      });
    }
  });

  // GET custom date-filtered Profit & Loss report for user's isolated workspace
  app.get('/api/reports/pnl', async (req, res) => {
    const authed = req as AuthedRequest;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const todayStr = new Date().toISOString().slice(0, 10);
    const defaultFrom = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const from =
      typeof req.query.from === 'string' && req.query.from.trim()
        ? req.query.from.trim()
        : defaultFrom;
    const to =
      typeof req.query.to === 'string' && req.query.to.trim()
        ? req.query.to.trim()
        : todayStr;
    const epicParam =
      typeof req.query.epic === 'string' && req.query.epic.trim()
        ? req.query.epic.trim().toUpperCase()
        : 'ALL';

    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      return;
    }

    const fromMs = Date.parse(`${from}T00:00:00.000Z`);
    const toMs = Date.parse(`${to}T23:59:59.999Z`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      res.status(400).json({ error: 'Invalid calendar date supplied.' });
      return;
    }
    if (fromMs > toMs) {
      res.status(400).json({ error: 'Start date must be on or before end date.' });
      return;
    }
    if (toMs - fromMs > 366 * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: 'Maximum report range is 366 days.' });
      return;
    }

    if (epicParam !== 'ALL' && !isValidEpic(epicParam)) {
      res.status(400).json({ error: 'Unknown instrument filter.' });
      return;
    }

    try {
      const report = await authed.engine!.getPnlReport({
        from,
        to,
        epic: epicParam === 'ALL' ? 'ALL' : epicParam,
      });
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to generate Profit & Loss report.',
      });
    }
  });

  // =========================================================================
  // ADMIN-ONLY GOVERNANCE ENDPOINTS
  // =========================================================================

  // POST sync global governance rules from Admin Control Panel into live server runtime
  app.post('/api/admin/governance', requireAdmin, (req, res) => {
    const body = req.body as Partial<ServerGovernanceState>;

    if (typeof body.requireAdminApproval === 'boolean') {
      governance.requireAdminApproval = body.requireAdminApproval;
    }
    if (typeof body.globalAutoTradingEnabled === 'boolean') {
      governance.globalAutoTradingEnabled = body.globalAutoTradingEnabled;
    }
    if (typeof body.allowNonAdminLiveMode === 'boolean') {
      governance.allowNonAdminLiveMode = body.allowNonAdminLiveMode;
    }
    if (body.maxLotCap !== undefined) {
      const cap = Number(body.maxLotCap);
      if (!Number.isFinite(cap) || cap <= 0 || cap > 10000) {
        res.status(400).json({ error: 'maxLotCap must be between 0.01 and 10000.' });
        return;
      }
      governance.maxLotCap = cap;
    }

    applyGovernanceToAllSessions();
    res.json({ ok: true, governance });
  });

  // POST sync user access/role/live permission changes immediately to server runtime
  app.post('/api/admin/user-access', requireAdmin, (req, res) => {
    const { uid, email, role, status, allowLiveMode } = req.body as {
      uid?: string;
      email?: string;
      role?: UserRole;
      status?: UserAccessStatus;
      allowLiveMode?: boolean;
    };

    if (!uid || typeof uid !== 'string' || uid.length > 128) {
      res.status(400).json({ error: 'Valid target user uid is required.' });
      return;
    }

    if (
      typeof email === 'string' &&
      email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
    ) {
      res.status(400).json({ error: 'Root administrator privileges cannot be modified.' });
      return;
    }

    if (role === 'admin') {
      adminUids.add(uid);
    } else if (role === 'trader') {
      adminUids.delete(uid);
    }

    if (status === 'suspended') {
      suspendedUids.add(uid);
      pendingUids.delete(uid);
      sessions.delete(uid);
    } else if (status === 'pending') {
      pendingUids.add(uid);
      suspendedUids.delete(uid);
      sessions.delete(uid);
    } else if (status === 'active') {
      suspendedUids.delete(uid);
      pendingUids.delete(uid);
    }

    if (typeof allowLiveMode === 'boolean') {
      if (allowLiveMode) {
        liveAllowedUids.add(uid);
      } else {
        liveAllowedUids.delete(uid);
      }
    }

    applyGovernanceToAllSessions();
    res.json({ ok: true });
  });

  // GET active isolated workspace sessions summary (Admin-only)
  app.get('/api/admin/sessions', requireAdmin, (_req, res) => {
    const activeSessions: AdminActiveSessionSummary[] = Array.from(
      sessions.values(),
    ).map((rec) => {
      const snap = rec.engine.getSnapshot();
      return {
        uid: rec.uid,
        email: rec.email,
        environment: snap.status.environment,
        isSimulated: snap.status.isSimulated,
        openPositions: snap.positions.length,
        workingOrders: snap.orders.length,
        lastActiveAt: rec.lastActiveAt,
      };
    });

    res.json({
      count: activeSessions.length,
      governance,
      sessions: activeSessions,
    });
  });

  // Never let unknown /api/* requests fall through to HTML SPA fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    '/api',
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal API error.',
      });
    },
  );

  if (IS_PROD) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RenkoDesk multi-tenant server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
