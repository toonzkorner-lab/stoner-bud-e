// Stoner Bud-E — Tonight tab: tonight's session at a glance.
// Reuses the session state from App.tsx — no second session store.

import { useEffect, useState } from 'react';
import { METHOD_LABELS, formatClock, minutesSinceTaken, parseClock } from './bude';
import type { Session } from './bude';

interface Vibe {
  setting: string;
  sound: string;
  snack: string;
  energy: string;
}

const EXPERIENCE_LABELS: Record<Session['experience'], string> = {
  new: 'New — just starting out',
  some: 'Some experience',
  experienced: 'Experienced — I know my dose',
};

function timeline(session: Session): { label: string; detail: string }[] {
  const inhaled = session.method === 'flower' || session.method === 'vape' || session.method === 'dab';
  if (inhaled) {
    return [
      { label: 'Lands', detail: 'Flower and vapes usually land in 5–15 minutes.' },
      { label: 'Peak', detail: 'Strongest around 30 minutes in.' },
      { label: 'Eases off', detail: 'Usually lasts 1–3 hours.' },
    ];
  }
  return [
    { label: 'Onset', detail: 'Edibles are quiet at first. Most people feel them around 45–90 minutes.' },
    { label: 'Peak', detail: 'Strongest 2–4 hours after taking it.' },
    { label: 'Eases off', detail: 'Usually lasts 4–8 hours, sometimes up to 12.' },
  ];
}

function activePhase(session: Session, since: number | null): number | null {
  if (since === null) return null;
  const inhaled = session.method === 'flower' || session.method === 'vape' || session.method === 'dab';
  if (inhaled) return since < 15 ? 0 : since < 60 ? 1 : 2;
  return since < 90 ? 0 : since < 240 ? 1 : 2;
}

export default function TonightTab(props: {
  session: Session;
  vibe: Vibe;
  timerStatus: string;
  onChat: () => void;
  onTools: () => void;
}) {
  const { session, vibe, timerStatus, onChat, onTools } = props;
  const [, setNow] = useState(Date.now());

  // Refresh the "how long ago" line every minute.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const since = minutesSinceTaken(session);
  const taken = parseClock(session.timeTaken);
  const amount = session.amount.trim();
  const phases = timeline(session);
  const active = activePhase(session, since);

  const agoText =
    since === null || taken === null
      ? 'No time logged yet'
      : since === 0
        ? `${formatClock(taken)} · just now`
        : `${formatClock(taken)} · ${since < 60 ? `${since} min ago` : `${Math.floor(since / 60)}h ${since % 60}m ago`}`;

  const status =
    since === null
      ? 'Add the time you took it and Bud-E will mark where you are.'
      : session.method === 'edible' || session.method === 'drink'
        ? since < 90
          ? 'Still early — edibles are quiet at first. Give it the full 2 hours before even thinking about more.'
          : since < 240
            ? 'Right in the peak window. Sip some water and ride it out.'
            : "Past the peak and on the way down. Feeling mellow or sleepy for a while longer is normal."
        : since < 15
          ? 'Just landed or about to — one or two small hits, then wait 15 minutes.'
          : 'You are in it now. Drink some water, settle in.';

  return (
    <main>
      <div className="garden-hero">
        <img src="/garden/leaf.jpg" alt="Green leaves in a calm night garden" />
      </div>
      <h1 className="tonight-hero">Tonight</h1>
      <p className="muted">Log the real dose. Bud-E will time it and stop guessing.</p>

      <section className="card" aria-label="Tonight's session at a glance">
        <p className="eyebrow">{METHOD_LABELS[session.method]}</p>
        <p className="tonight-big">
          {amount ? `${amount}${session.unit}` : 'No dose logged yet'}
        </p>
        <p className="muted">{EXPERIENCE_LABELS[session.experience]}</p>
        <p>{agoText}</p>
        <p className="muted">{status}</p>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onChat}>
            💬 Ask Bud-E
          </button>
          <button className="btn secondary" onClick={onTools}>
            ⏱️ Open the timer
          </button>
        </div>
        <p style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn ghost" onClick={onChat}>
            Change what I took
          </button>
        </p>
      </section>

      <section className="card" aria-label="How this usually goes">
        <h2>How this usually goes</h2>
        <ol className="timeline">
          {phases.map((phase, i) => (
            <li key={phase.label} className={i === active ? 'active' : ''}>
              <span className="dot" aria-hidden />
              <span>
                <span className="phase-label" style={{ fontWeight: 700 }}>
                  {phase.label}
                </span>
                <span className="muted" style={{ display: 'block' }}>
                  {phase.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-label="Tonight's plan summary">
        <h2>📋 Tonight&apos;s plan</h2>
        <p className="plan-sentence" style={{ marginBottom: 10 }}>
          {vibe.setting} vibes, {vibe.sound} on, craving {vibe.snack}, feeling {vibe.energy}.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          ⏱️ {timerStatus}
        </p>
      </section>

      <p className="muted small">
        Start low, go slow. Never drive high. If a pet eats an edible, call a vet.
      </p>
    </main>
  );
}
