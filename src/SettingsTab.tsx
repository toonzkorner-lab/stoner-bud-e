// Stoner Bud-E — Settings tab: theme picker + Legal (About, Privacy
// Policy, Terms of Service, Delete account). The theme choice is stored
// in localStorage (bude-theme-v1) and applied via html[data-theme],
// exactly like the Grok night-garden app. Legal screens live here — not
// a bottom-nav slot — so nothing else in the nav moves.

import { useState } from 'react';
import { THEMES } from './theme';
import type { ThemeId } from './theme';
import { APP_VERSION, COPYRIGHT, getLegalDoc } from './legal';
import type { LegalDoc } from './legal';
import type { AuthUser } from './lib/auth-client';
import { PageHead } from './bits';

type LegalView = 'main' | LegalDoc['id'] | 'delete';

export default function SettingsTab(props: {
  theme: ThemeId;
  onTheme: (theme: ThemeId) => void;
  user: AuthUser | null;
  onDeleteAccount: () => Promise<void>;
}) {
  const { theme, onTheme, user, onDeleteAccount } = props;
  const [view, setView] = useState<LegalView>('main');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function confirmDelete(): Promise<void> {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      // App.tsx wipes the device's local copy and signs out on success —
      // this tab unmounts when it switches back to Tonight.
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete the account — try again.',
      );
      setDeleting(false);
    }
  }

  // -- One legal document, with a way back ---------------------------------
  if (view === 'about' || view === 'privacy' || view === 'terms') {
    const doc = getLegalDoc(view);
    return (
      <main>
        <button type="button" className="tool-back" onClick={() => setView('main')}>
          ← Back to Settings
        </button>
        <h1 className="page-title" style={{ marginTop: 8 }}>
          {doc.title}
        </h1>
        <section className="card legal-doc" aria-label={doc.title}>
          <p>{doc.intro}</p>
          {doc.sections.map((section) => (
            <div key={section.heading}>
              <p className="eyebrow" style={{ marginTop: 20 }}>
                {section.heading}
              </p>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 24)}>{paragraph}</p>
              ))}
            </div>
          ))}
          {doc.id === 'about' && (
            <p className="muted" style={{ marginTop: 20 }}>
              {COPYRIGHT} · Version {APP_VERSION}
            </p>
          )}
        </section>
      </main>
    );
  }

  // -- Delete account: confirm step, then the button does the work ---------
  if (view === 'delete') {
    return (
      <main>
        <button type="button" className="tool-back" onClick={() => setView('main')}>
          ← Back to Settings
        </button>
        <h1 className="page-title" style={{ marginTop: 8 }}>
          Delete my account
        </h1>
        <section className="card" aria-label="Delete my account">
          <p>
            This deletes your account <strong>{user ? user.email : ''}</strong> and
            everything stored under it — your journal, stash, settings, and sessions —
            from Bud-E&apos;s database. It also clears your journal, stash, and chat from
            this device.
          </p>
          <p>
            <strong>There is no undo.</strong> If you just want to stop syncing for a
            while, sign out instead — your stuff stays on this device and your account
            stays as it is.
          </p>
          {deleteError !== '' && (
            <p className="muted" role="alert" style={{ color: '#ff9d9d' }}>
              {deleteError}
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              className="btn danger btn-block"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Yes, delete everything'}
            </button>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="btn secondary btn-block"
              onClick={() => setView('main')}
              disabled={deleting}
            >
              Keep my account
            </button>
          </div>
        </section>
      </main>
    );
  }

  // -- Main settings view ----------------------------------------------------
  return (
    <main>
      <PageHead title="Settings" sub="Look, and what stays on this phone." />

      <section className="card" aria-label="Appearance">
        <p className="eyebrow">Appearance</p>
        <p className="muted">Swap the whole garden. It stays on this phone.</p>
        <div className="theme-grid">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="theme-swatch"
              data-swatch={item.id}
              aria-pressed={theme === item.id}
              onClick={() => onTheme(item.id)}
            >
              <span>
                <span className="swatch-dot" aria-hidden />
                <strong>{item.name}</strong>
              </span>
              <span className="swatch-bar" aria-hidden />
              <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>{item.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" aria-label="About Bud-E">
        <p className="eyebrow">About</p>
        <p style={{ marginTop: 8 }}>
          Bud-E is a 21+ companion. Not a doctor, not a shop, and not legal advice. Start low, go
          slow. Never drive high.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Your chat always stays on this device. When you are signed in, your journal, stash, and
          settings sync to your account so they follow you — nothing else leaves this phone.
        </p>
      </section>

      <section className="card" aria-label="Legal">
        <p className="eyebrow">Legal</p>
        <div className="legal-list">
          <button type="button" className="legal-row" onClick={() => setView('about')}>
            <span>
              <strong>About Bud-E</strong>
              <span className="muted">What it is, who makes it</span>
            </span>
            <span aria-hidden>›</span>
          </button>
          <button type="button" className="legal-row" onClick={() => setView('privacy')}>
            <span>
              <strong>Privacy Policy</strong>
              <span className="muted">What we keep, what we never do</span>
            </span>
            <span aria-hidden>›</span>
          </button>
          <button type="button" className="legal-row" onClick={() => setView('terms')}>
            <span>
              <strong>Terms of Service</strong>
              <span className="muted">21+, safety, and the rules</span>
            </span>
            <span aria-hidden>›</span>
          </button>
          {user && (
            <button
              type="button"
              className="legal-row danger-row"
              onClick={() => setView('delete')}
            >
              <span>
                <strong>Delete my account</strong>
                <span className="muted">Wipes your account and everything in it</span>
              </span>
              <span aria-hidden>›</span>
            </button>
          )}
        </div>
        {!user && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Sign in to see the delete-account option here.
          </p>
        )}
      </section>

      <p className="footer" style={{ marginTop: 16, paddingTop: 0 }}>
        {COPYRIGHT} · Stoner Bud-E v{APP_VERSION}
      </p>
    </main>
  );
}
