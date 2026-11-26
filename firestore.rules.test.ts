/**
 * RenkoDesk Firestore Security Rules — Dirty Dozen Verification Suite
 * Documents exact expected ALLOW/DENY test payloads against firestore.rules.
 */

export interface SecurityTestCase {
  id: string;
  description: string;
  actor: {
    uid: string | null;
    email?: string;
    email_verified?: boolean;
    isAdmin?: boolean;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'ALLOW' | 'DENY';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 'DD-01',
    description: 'Unauthenticated user reading /users/user-a',
    actor: { uid: null },
    operation: 'get',
    path: '/users/user-a',
    expected: 'DENY',
  },
  {
    id: 'DD-02',
    description: 'User A attempting to read User B private profile (PII isolation)',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'get',
    path: '/users/user-b',
    expected: 'DENY',
  },
  {
    id: 'DD-03',
    description: 'Non-admin attempting to list /users collection',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'list',
    path: '/users',
    expected: 'DENY',
  },
  {
    id: 'DD-04',
    description: 'Non-admin attempting role escalation to admin on create',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/users/user-a',
    payload: {
      uid: 'user-a',
      email: 'a@example.com',
      displayName: 'User A',
      photoURL: '',
      role: 'admin',
      status: 'active',
      allowLiveMode: true,
    },
    expected: 'DENY',
  },
  {
    id: 'DD-05',
    description: 'Non-admin attempting to self-approve or escalate role on update',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'update',
    path: '/users/user-a',
    payload: { status: 'active', role: 'admin', allowLiveMode: true },
    expected: 'DENY',
  },
  {
    id: 'DD-06',
    description: 'Unverified email attempting to claim bootstrap admin email',
    actor: { uid: 'spoof-uid', email: 'Parimandape@gmail.com', email_verified: false },
    operation: 'list',
    path: '/users',
    expected: 'DENY',
  },
  {
    id: 'DD-07',
    description: 'User A attempting to write into User B isolated workspace config',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'update',
    path: '/workspaces/user-b/configs/GOLD',
    payload: { ownerId: 'user-b', epic: 'GOLD', mode: 'MANUAL' },
    expected: 'DENY',
  },
  {
    id: 'DD-08',
    description: 'Out-of-range negative lot size value poisoning in workspace config',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'create',
    path: '/workspaces/user-a/configs/GOLD',
    payload: { ownerId: 'user-a', epic: 'GOLD', lot1: -50, lot2: 0.1 },
    expected: 'DENY',
  },
  {
    id: 'DD-09',
    description: 'Non-admin attempting to modify global governance settings',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'update',
    path: '/governance/global',
    payload: { requireAdminApproval: false, allowNonAdminLiveMode: true },
    expected: 'DENY',
  },
  {
    id: 'DD-10',
    description: 'Non-admin attempting to read or create admin audit logs',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'list',
    path: '/auditLogs',
    expected: 'DENY',
  },
  {
    id: 'DD-11',
    description: 'Admin attempting to delete immutable audit log record',
    actor: { uid: 'admin-uid', email: 'Parimandape@gmail.com', email_verified: true, isAdmin: true },
    operation: 'delete',
    path: '/auditLogs/log-1',
    expected: 'DENY',
  },
  {
    id: 'DD-12',
    description: 'Valid owner updating own workspace GOLD config with strict fields',
    actor: { uid: 'user-a', email: 'a@example.com', email_verified: true },
    operation: 'update',
    path: '/workspaces/user-a/configs/GOLD',
    payload: {
      ownerId: 'user-a',
      epic: 'GOLD',
      mode: 'AUTO',
      sizingMode: 'LOT',
      lot1: 0.1,
      lot2: 0.1,
      margin1: 1,
      margin2: 1,
      stEnabled: true,
      stPeriod: 1,
      stMultiplier: 2.1,
    },
    expected: 'ALLOW',
  },
];
