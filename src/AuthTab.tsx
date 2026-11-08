// Stoner Bud-E — Account tab (sign-in / sign-up / sign-out).
//
// Self-contained: App.tsx renders it as <AuthTab user={user}
// onAuthChange={...} /> and never has to know about Better Auth. Signing in
// is OPTIONAL — everything works logged-out on this device exactly as before;
// an account only syncs the journal, stash, theme, session, vibe, and
// tolerance break to the user's other devices. The chat transcript is never
// synced and never leaves the device.
//
// Props:
//   user         — the signed-in user from getSession(), or null when signed out.
//   onAuthChange — called with the user after sign-in/sign-up, or null after
//                  sign-out, so App.tsx can run the sync-on-sign-in effect.
//   onSyncNow    — optional: when provided, a "Sync now" button is shown for
//                  signed-in users (App.tsx wires it to uploadLocal()).
//   syncMessage  — optional one-line status under the account area, e.g.
//                  "Synced just now" or "Sync did not work — try again."

import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { signIn, signOut, signUp } from './lib/auth-client';
import type { AuthUser } from './lib/auth-client';

export interface AuthTabProps {
  user: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
  onSyncNow?: () => void;
  syncMessage?: string;
}

function friendlySubmitError(message: string): string {
  return message;
}

export default function AuthTab({
  user,
  onAuthChange,
  onSyncNow,
  syncMessage,
}: AuthTabProps): ReactElement {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (email.trim() === '' || password === '') {
      setError('Add your email and password first.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next =
        mode === 'signup'
          ? await signUp(email, password, name)
          : await signIn(email, password);
      setPassword('');
      onAuthChange(next);
    } catch (err) {
      setError(friendlySubmitError(err instanceof Error ? err.message : 'Something went wrong — try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      onAuthChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out — try again.');
    } finally {
      setSigningOut(false);
    }
  }

  // -- Signed in -------------------------------------------------------------
  if (user) {
    return (
      <div>
        <section className="card" aria-label="Account">
          <h2>👤 Account</h2>
          <p>
            Signed in as <strong>{user.email}</strong>
            {user.name !== '' && user.name !== user.email ? ` (${user.name})` : ''}
          </p>
          <p className="muted small">
            Your journal, stash, theme, and break now sync to your other devices when
            you are online. Your chat always stays on this device only — it is never
            synced and never uploaded.
          </p>
          {syncMessage !== undefined && syncMessage !== '' && (
            <p className="result-box" role="status">
              {syncMessage}
            </p>
          )}
          <div className="button-row">
            {onSyncNow && (
              <button type="button" className="btn" onClick={onSyncNow}>
                🔄 Sync now
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => void doSignOut()}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          {error !== '' && (
            <p className="muted" role="alert" style={{ color: '#ff9d9d' }}>
              {error}
            </p>
          )}
        </section>
        <p className="muted small">
          21+ only. Bud-E is a buddy, not a doctor. Start low, go slow. Never drive high.
        </p>
      </div>
    );
  }

  // -- Signed out ------------------------------------------------------------
  return (
    <div>
      <section className="card" aria-label="Account">
        <h2>👤 Account</h2>
        <p className="muted">
          21+ only. Signing in is optional — Bud-E works fine without an account, saved
          on this device only. An account just syncs your journal, stash, theme, and
          break to your other devices.
        </p>
        <div className="button-row" role="group" aria-label="Sign in or create an account">
          <button
            type="button"
            className={mode === 'signin' ? 'btn' : 'btn secondary'}
            onClick={() => {
              setMode('signin');
              setError('');
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'btn' : 'btn secondary'}
            onClick={() => {
              setMode('signup');
              setError('');
            }}
          >
            Create account
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} style={{ marginTop: 12 }}>
          {mode === 'signup' && (
            <>
              <label htmlFor="account-name">What should Bud-E call you? (optional)</label>
              <input
                id="account-name"
                type="text"
                value={name}
                autoComplete="name"
                placeholder="Kartoon"
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </>
          )}
          <label htmlFor="account-email">Email</label>
          <input
            id="account-email"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="account-password">Password</label>
          <div className="field-row">
            <input
              id="account-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn secondary"
              onClick={() => setShowPassword((s) => !s)}
              disabled={busy}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {error !== '' && (
            <p className="muted" role="alert" style={{ color: '#ff9d9d' }}>
              {error}
            </p>
          )}
          <div className="button-row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-block" disabled={busy}>
              {busy
                ? 'One sec…'
                : mode === 'signup'
                  ? 'Create my account'
                  : 'Sign in'}
            </button>
          </div>
        </form>
      </section>
      <p className="muted small">
        Your password goes straight to Bud-E&apos;s own sign-in — it is never stored on
        this device and never shared. No email is ever sent.
      </p>
    </div>
  );
}
