// Stoner Bud-E — Settings tab: theme picker + about. The theme choice
// is stored in localStorage (bude-theme-v1) and applied via
// html[data-theme], exactly like the Grok night-garden app.

import { THEMES } from './theme';
import type { ThemeId } from './theme';

export default function SettingsTab(props: {
  theme: ThemeId;
  onTheme: (theme: ThemeId) => void;
}) {
  const { theme, onTheme } = props;
  return (
    <main>
      <h1 className="tonight-hero">Settings</h1>
      <p className="muted">Look, and what stays on this phone.</p>

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
          Everything in this app — your chat, tonight&apos;s session, journal, and stash — stays on
          this device. Nothing leaves your phone unless live AI is on, and even then it&apos;s just
          the last few messages, no name attached.
        </p>
      </section>
    </main>
  );
}
