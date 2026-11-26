import { Clock, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

export function AuthGate() {
  const {
    user,
    profile,
    signingIn,
    authError,
    signInWithGoogle,
    logout,
  } = useAuth();

  // Case 1: Signed in, awaiting admin approval
  if (user && profile?.status === 'pending') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-7 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Workspace Approval Pending
              </h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Your account (<span className="font-mono text-slate-800">{profile.email}</span>) has been registered. The dashboard administrator must approve your access before your independent RenkoDesk workspace activates.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
            This screen updates automatically as soon as your access is approved.
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // Case 2: Signed in, suspended by admin
  if (user && profile?.status === 'suspended') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-7 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Workspace Access Suspended
              </h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Access for <span className="font-mono text-slate-800">{profile.email}</span> has been suspended by the dashboard administrator. Please contact the workspace owner if you need access restored.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // Case 3: Unauthenticated sign-in gate
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-8 space-y-6">
        <div className="space-y-2">
          <div className="font-display text-2xl font-bold tracking-tight text-slate-900">
            RenkoDesk
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Sign in with your Google account to launch your own isolated Renko (23h ATR5/5) &amp; Supertrend (1, 2.1) multi-asset workstation.
          </p>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2.5 text-xs text-slate-600">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>
              <strong className="text-slate-900 font-semibold">Independent Workspace:</strong>{' '}
              Your strategy configs, lot sizes, positions, orders, and date-filtered P&amp;L reports are strictly isolated to your account.
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
            <span>
              <strong className="text-slate-900 font-semibold">Admin-Governed Access:</strong>{' '}
              Live broker credentials remain server-side and are governed by the dashboard administrator.
            </span>
          </div>
        </div>

        {authError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            {authError}
          </div>
        )}

        <button
          type="button"
          disabled={signingIn}
          onClick={() => void signInWithGoogle()}
          className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="#FFFFFF"
              d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.48-1.69 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.88s2.59-5.88 5.76-5.88c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.15 14.69 3.2 12.17 3.2 7.21 3.2 3.2 7.21 3.2 12.17s4.01 8.97 8.97 8.97c5.18 0 8.61-3.64 8.61-8.77 0-.59-.07-1.04-.15-1.27z"
            />
          </svg>
          <span>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
        </button>
      </div>
    </div>
  );
}
