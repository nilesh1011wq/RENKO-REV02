# RenkoDesk Firestore Security Specification

## 1. Access Matrix & Data Invariants

| Collection Path | Read (`get`) | Read (`list`) | Create | Update | Delete |
|---|---|---|---|---|---|
| `/users/{userId}` | Owner or Admin | Admin only | Verified owner only (non-admin forced `role='trader'`, `allowLiveMode=false`, `status='pending'` when approval required) | Owner: `displayName`, `photoURL`, `lastLoginAt`, `updatedAt` only. Admin: `role`, `status`, `allowLiveMode`, `updatedAt` only (root admin immutable) | Denied |
| `/admins/{userId}` | Owner or Admin | Admin only | Admin only (`grantedBy == request.auth.uid`) | Denied | Admin only (cannot delete self or root bootstrap admin) |
| `/workspaces/{userId}/configs/{epic}` | Owner or Admin | Owner (`userId == auth.uid`) or Admin | Verified active Owner or Admin (`ownerId == userId`, valid epic & bounds) | Verified active Owner or Admin (`ownerId` & `epic` immutable) | Admin only |
| `/governance/{docId}` | Signed-in user (`docId == 'global'`) | Denied | Admin only (`docId == 'global'`) | Admin only (`docId == 'global'`) | Denied |
| `/auditLogs/{logId}` | Admin only | Admin only | Admin only (`actorUid == auth.uid`, `createdAt == request.time`) | Denied | Denied |

## 2. Bootstrap Administrator
- Root Administrator: `Parimandape@gmail.com` with `request.auth.token.email_verified == true`.
- Additional administrators may be registered in `/admins/{uid}` strictly by an existing verified administrator.

## 3. Dirty Dozen Negative Test Payloads
1. **Unauthenticated read on `/users/{uid}`** -> MUST DENY.
2. **Cross-user read on `/users/{otherUid}`** -> MUST DENY (PII isolation).
3. **Non-admin `list` on `/users`** -> MUST DENY (prevents directory scraping).
4. **Privilege escalation on `/users/{uid}` create (`role: 'admin'`)** -> MUST DENY for non-bootstrap email.
5. **Privilege escalation on `/users/{uid}` update (`role: 'admin'` or `status: 'active'` or `allowLiveMode: true`)** -> MUST DENY for non-admin owner.
6. **Approval bypass on `/users/{uid}` create (`status: 'active'` while `/governance/global.requireAdminApproval == true`)** -> MUST DENY.
7. **Cross-tenant read/write on `/workspaces/{otherUid}/configs/GOLD`** -> MUST DENY.
8. **Invalid epic or out-of-range lot size (`lot1: -5` or `lot1: 999999`)** -> MUST DENY.
9. **Non-admin write to `/governance/global`** -> MUST DENY.
10. **Non-admin read or write to `/auditLogs/{logId}`** -> MUST DENY.
11. **Admin attempt to modify or delete `/auditLogs/{logId}`** -> MUST DENY (immutable log).
12. **Timestamp forgery (`createdAt` or `updatedAt` != `request.time`) or unknown extra fields** -> MUST DENY.
