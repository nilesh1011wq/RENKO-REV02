import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase.ts';
import {
  EPIC_LIST,
  type EpicSymbol,
  type GovernancePolicyRecord,
  type InstrumentConfig,
  type UserProfileRecord,
  type WorkspaceConfigPatch,
} from '../shared/types.ts';
import { syncAdminGovernance } from '../lib/api.ts';

const DEFAULT_GOVERNANCE: GovernancePolicyRecord = {
  requireAdminApproval: false,
  globalAutoTradingEnabled: true,
  allowNonAdminLiveMode: false,
  maxLotCap: 100,
  announcement: '',
  updatedBy: '',
  updatedAt: new Date(0).toISOString(),
};

function tsToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfileRecord | null;
  governance: GovernancePolicyRecord;
  savedConfigs: Partial<Record<EpicSymbol, WorkspaceConfigPatch>>;
  isAdmin: boolean;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  persistWorkspaceConfig: (
    epic: EpicSymbol,
    config: InstrumentConfig,
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [governance, setGovernance] =
    useState<GovernancePolicyRecord>(DEFAULT_GOVERNANCE);
  const [savedConfigs, setSavedConfigs] = useState<
    Partial<Record<EpicSymbol, WorkspaceConfigPatch>>
  >({});
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  const reportFirestoreError = useCallback(
    (err: unknown, op: OperationType, path: string) => {
      try {
        handleFirestoreError(err, op, path);
      } catch (wrapped) {
        setFatalError(
          wrapped instanceof Error ? wrapped : new Error(String(wrapped)),
        );
      }
    },
    [],
  );

  const isBootstrapAdmin =
    (user?.email?.toLowerCase() ?? '') === BOOTSTRAP_ADMIN_EMAIL &&
    user?.emailVerified === true;

  const isAdmin =
    isBootstrapAdmin ||
    (profile?.role === 'admin' && profile?.status === 'active');

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    setFatalError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Google sign-in failed. Please try again.';
      setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthError(null);
    setFatalError(null);
    await signOut(auth);
    setProfile(null);
    setSavedConfigs({});
  }, []);

  // 1. Observe Firebase Auth state & bootstrap/update user profile document
  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setSavedConfigs({});
        setAuthReady(true);
        return;
      }

      setAuthReady(false);

      const bootstrapUser = async () => {
        const uid = firebaseUser.uid;
        const email = firebaseUser.email || '';
        const isRootAdmin =
          email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL &&
          firebaseUser.emailVerified === true;
        const displayName =
          firebaseUser.displayName?.trim() ||
          email.split('@')[0] ||
          'Trader';
        const photoURL = (firebaseUser.photoURL || '').slice(0, 500);

        const userRef = doc(db, 'users', uid);
        const govRef = doc(db, 'governance', 'global');

        try {
          const [userSnap, govSnap] = await Promise.all([
            getDoc(userRef),
            getDoc(govRef).catch(() => null),
          ]);

          const requireApproval =
            govSnap?.exists() && govSnap.data()?.requireAdminApproval === true;

          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid,
              email,
              displayName: displayName.slice(0, 120),
              photoURL,
              role: isRootAdmin ? 'admin' : 'trader',
              status: isRootAdmin
                ? 'active'
                : requireApproval
                  ? 'pending'
                  : 'active',
              allowLiveMode: isRootAdmin,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastLoginAt: serverTimestamp(),
            });
          } else {
            await updateDoc(userRef, {
              displayName: displayName.slice(0, 120),
              photoURL,
              lastLoginAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          // Initialize singleton governance doc on first bootstrap admin sign-in
          if (isRootAdmin && (!govSnap || !govSnap.exists())) {
            await setDoc(govRef, {
              requireAdminApproval: false,
              globalAutoTradingEnabled: true,
              allowNonAdminLiveMode: false,
              maxLotCap: 100,
              announcement: '',
              updatedBy: uid,
              updatedAt: serverTimestamp(),
            });
          } else if (isRootAdmin && govSnap?.exists()) {
            const g = govSnap.data();
            void syncAdminGovernance({
              requireAdminApproval: Boolean(g.requireAdminApproval),
              globalAutoTradingEnabled: g.globalAutoTradingEnabled !== false,
              allowNonAdminLiveMode: Boolean(g.allowNonAdminLiveMode),
              maxLotCap: Number(g.maxLotCap) || 100,
            }).catch(() => {
              // Server sync retried when admin opens panel
            });
          }
        } catch (err) {
          if (active) {
            reportFirestoreError(err, OperationType.WRITE, `users/${uid}`);
          }
        } finally {
          if (active) {
            setAuthReady(true);
          }
        }
      };

      void bootstrapUser();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [reportFirestoreError]);

  // 2. Attach real-time Firestore listeners ONLY after authenticated user exists
  useEffect(() => {
    if (!authReady || !user) return;

    const userPath = `users/${user.uid}`;
    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setProfile({
            uid: String(d.uid || user.uid),
            email: String(d.email || user.email || ''),
            displayName: String(d.displayName || user.displayName || 'Trader'),
            photoURL: String(d.photoURL || ''),
            role: d.role === 'admin' ? 'admin' : 'trader',
            status:
              d.status === 'suspended'
                ? 'suspended'
                : d.status === 'pending'
                  ? 'pending'
                  : 'active',
            allowLiveMode: Boolean(d.allowLiveMode),
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
            lastLoginAt: tsToIso(d.lastLoginAt),
          });
        }
      },
      (err) => {
        reportFirestoreError(err, OperationType.GET, userPath);
      },
    );

    const govPath = 'governance/global';
    const unsubGov = onSnapshot(
      doc(db, 'governance', 'global'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setGovernance({
            requireAdminApproval: Boolean(d.requireAdminApproval),
            globalAutoTradingEnabled: d.globalAutoTradingEnabled !== false,
            allowNonAdminLiveMode: Boolean(d.allowNonAdminLiveMode),
            maxLotCap: Number(d.maxLotCap) || 100,
            announcement: String(d.announcement || ''),
            updatedBy: String(d.updatedBy || ''),
            updatedAt: tsToIso(d.updatedAt),
          });
        }
      },
      (err) => {
        reportFirestoreError(err, OperationType.GET, govPath);
      },
    );

    const configsPath = `workspaces/${user.uid}/configs`;
    const unsubConfigs = onSnapshot(
      collection(db, 'workspaces', user.uid, 'configs'),
      (snap) => {
        const next: Partial<Record<EpicSymbol, WorkspaceConfigPatch>> = {};
        for (const docSnap of snap.docs) {
          const epic = docSnap.id as EpicSymbol;
          if (!EPIC_LIST.includes(epic)) continue;
          const d = docSnap.data();
          next[epic] = {
            mode: d.mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
            sizingMode: d.sizingMode === 'MARGIN' ? 'MARGIN' : 'LOT',
            lot1: Number(d.lot1),
            lot2: Number(d.lot2),
            margin1: Number(d.margin1),
            margin2: Number(d.margin2),
            stEnabled: Boolean(d.stEnabled),
            stPeriod: Number(d.stPeriod),
            stMultiplier: Number(d.stMultiplier),
          };
        }
        setSavedConfigs(next);
      },
      (err) => {
        reportFirestoreError(err, OperationType.LIST, configsPath);
      },
    );

    return () => {
      unsubProfile();
      unsubGov();
      unsubConfigs();
    };
  }, [authReady, user, reportFirestoreError]);

  const persistWorkspaceConfig = useCallback(
    async (epic: EpicSymbol, config: InstrumentConfig) => {
      if (!user) return;
      const path = `workspaces/${user.uid}/configs/${epic}`;
      try {
        await setDoc(doc(db, 'workspaces', user.uid, 'configs', epic), {
          ownerId: user.uid,
          epic,
          mode: config.mode,
          sizingMode: config.sizingMode,
          lot1: config.lot1,
          lot2: config.lot2,
          margin1: config.margin1,
          margin2: config.margin2,
          stEnabled: config.stEnabled,
          stPeriod: config.stPeriod,
          stMultiplier: config.stMultiplier,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        governance,
        savedConfigs,
        isAdmin,
        authReady,
        signingIn,
        authError,
        signInWithGoogle,
        logout,
        persistWorkspaceConfig,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
