import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SESSION,
  HIGH_THOUGHTS,
  METHOD_LABELS,
  SNACK_COMBOS,
  TRIVIA,
  formatClock,
  localReply,
  minutesSinceTaken,
  parseClock,
  pickRandom,
} from './bude';
import type { ChatMessage, Experience, Method, Session } from './bude';
import StrainsTab from './StrainsTab';
import TonightTab from './TonightTab';
import SettingsTab from './SettingsTab';
import { AGE_GATE_KEY, THEME_KEY, isThemeId, loadTheme } from './theme';
import type { ThemeId } from './theme';
import JournalTab from './JournalTab';
import StashTab from './StashTab';
import BreakTab from './BreakTab';
import DoseTab from './DoseTab';
import { JOURNAL_KEY, journalSummary } from './journal';
import type { JournalEntry } from './journal';
import { STASH_KEY } from './stash';
import type { StashItem } from './stash';
import AuthTab from './AuthTab';
import { uploadLocal } from './lib/sync';
import type { SyncSettings } from './lib/sync';
import { getSession } from './lib/auth-client';
import type { AuthUser } from './lib/auth-client';

const TRANSCRIPT_KEY = 'bude-transcript-v1';
const SESSION_KEY = 'bude-session-v1';
const VIBE_KEY = 'bude-vibe-v1';

// Where live AI lives. On plain web the API is same-origin, so a relative
// path is right. Inside the Capacitor APK the app runs from a local origin
// (capacitor://localhost) with no server, so a relative path would go
// nowhere — point it at the live Vercel deployment instead. A build-time
// VITE_API_URL override wins over both.
const LIVE_ORIGIN = 'https://stoner-bud-e-toonzkorner-9149s-projects.vercel.app';

function apiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim() !== '') {
    return `${envUrl.replace(/\/$/, '')}/api/chat`;
  }
  const isCapacitor =
    typeof window !== 'undefined' &&
    (window as unknown as { Capacitor?: unknown }).Capacitor !== undefined;
  if (isCapacitor) return `${LIVE_ORIGIN}/api/chat`;
  return '/api/chat';
}

type Tab = 'tonight' | 'chat' | 'tools' | 'plan' | 'strains' | 'journal' | 'stash' | 'break' | 'dose' | 'settings' | 'account';
type Source = 'live' | 'fallback' | null;

interface Vibe {
  setting: string;
  sound: string;
  snack: string;
  energy: string;
}

const DEFAULT_VIBE: Vibe = {
  setting: 'couch',
  sound: 'music',
  snack: 'something salty',
  energy: 'chill',
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) } as T;
  } catch {
    return fallback;
  }
}

function loadList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the app still works, it just won't remember.
  }
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('tonight');
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AGE_GATE_KEY) === 'yes';
    } catch {
      return false;
    }
  });
  const [ageDeclined, setAgeDeclined] = useState(false);
  const [session, setSession] = useState<Session>(() => load(SESSION_KEY, DEFAULT_SESSION));
  const [transcript, setTranscript] = useState<ChatMessage[]>(() => loadList(TRANSCRIPT_KEY));
  const [vibe, setVibe] = useState<Vibe>(() => load(VIBE_KEY, DEFAULT_VIBE));
  const [journal, setJournal] = useState<JournalEntry[]>(() => loadList(JOURNAL_KEY));
  const [stash, setStash] = useState<StashItem[]>(() => loadList(STASH_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  // Guards the debounced sync effect while a server state is being applied,
  // so applying a download does not immediately trigger an upload of itself.
  const applyingServerState = useRef(false);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(null);
  const [timerStatus, setTimerStatus] = useState('No timer running yet.');
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Who is signed in? Runs once on load; signed-out is fine, not an error.
  useEffect(() => {
    let cancelled = false;
    void getSession().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage blocked — the theme still applies for this visit.
    }
  }, [theme]);

  useEffect(() => save(SESSION_KEY, session), [session]);
  useEffect(() => save(TRANSCRIPT_KEY, transcript), [transcript]);
  useEffect(() => save(VIBE_KEY, vibe), [vibe]);
  useEffect(() => save(JOURNAL_KEY, journal), [journal]);
  useEffect(() => save(STASH_KEY, stash), [stash]);

  // While signed in, push local changes up a couple of seconds after the user
  // stops editing. Skipped when offline, when signed out, and while a server
  // state is being applied (Step 4). "Sync now" in the Account tab covers the
  // impatient path; sign-in covers the returning-device path.
  useEffect(() => {
    if (!user || !isOnline || applyingServerState.current) return;
    const id = window.setTimeout(() => {
      void syncNow('change');
    }, 2000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal, stash, session, vibe, theme, user, isOnline]);

  function deductFromStash(stashId: string, amount: number, unit: 'mg' | 'g'): void {
    setStash((items) =>
      items.map((i) =>
        i.id === stashId && i.unit === unit
          ? { ...i, amount: Math.max(0, Math.round((i.amount - amount) * 100) / 100) }
          : i,
      ),
    );
  }

  const BREAK_KEY = 'bude-break-v1';

  function readBreak(): SyncSettings['break'] {
    try {
      const raw = localStorage.getItem(BREAK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SyncSettings['break'];
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function currentSettings(): SyncSettings {
    return {
      theme,
      experience: session.experience,
      session,
      vibe,
      break: readBreak(),
    };
  }

  function applyServerState(state: {
    journal: JournalEntry[];
    stash: StashItem[];
    settings: SyncSettings | null;
  }): void {
    applyingServerState.current = true;
    setJournal(state.journal);
    setStash(state.stash);
    if (state.settings) {
      if (state.settings.theme && isThemeId(state.settings.theme)) {
        setTheme(state.settings.theme);
      }
      if (state.settings.session) {
        setSession({ ...DEFAULT_SESSION, ...state.settings.session });
      }
      if (state.settings.vibe) setVibe(state.settings.vibe);
      try {
        if (state.settings.break) {
          localStorage.setItem(BREAK_KEY, JSON.stringify(state.settings.break));
        } else {
          localStorage.removeItem(BREAK_KEY);
        }
      } catch {
        // Storage blocked — the break just won't carry over this time.
      }
    }
    // Let the state settle before the change-sync effect runs again.
    window.setTimeout(() => {
      applyingServerState.current = false;
    }, 500);
  }

  async function syncNow(reason: string): Promise<void> {
    const currentUser = userRef.current;
    if (!currentUser) return;
    setSyncMessage('Syncing…');
    try {
      const state = await uploadLocal({ journal, stash }, currentSettings());
      applyServerState(state);
      setSyncMessage(`Synced just now${reason === 'signin' ? ' — your stuff from this device is now on your account.' : '.'}`);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync did not work — try again.');
    }
  }

  function handleAuthChange(next: AuthUser | null): void {
    const wasSignedOut = user === null;
    setUser(next);
    if (next && wasSignedOut) {
      // First sync for this session: push this device's local lists up, then
      // take the merged server state as the source of truth.
      void syncNow('signin');
    }
    if (!next) {
      // Signed out: local data stays put as the offline cache. Nothing is wiped.
      setSyncMessage('Signed out. Your stuff is still saved on this device.');
    }
  }

  function askAboutStrain(name: string): void {
    setPendingQuestion(`Tell me about ${name} — what kind of high is it, and what should I know?`);
    setTab('chat');
  }

  function confirmAge(): void {
    try {
      localStorage.setItem(AGE_GATE_KEY, 'yes');
    } catch {
      // Storage blocked — still let them in for this visit.
    }
    setAgeDeclined(false);
    setAgeConfirmed(true);
  }

  if (!ageConfirmed) {
    return (
      <AgeGate declined={ageDeclined} onConfirm={confirmAge} onDecline={() => setAgeDeclined(true)} />
    );
  }

  return (
    <div className="app">
      <div className="garden-glow" aria-hidden />
      <header className="header">
        <h1>🌿 Stoner Bud-E</h1>
        <p className="tagline">A calm buddy for the night you already started. Timers, straight answers, no lecture.</p>
        {source === 'live' && <span className="badge live">● Live AI</span>}
        {source === 'fallback' && <span className="badge offline">● Offline buddy</span>}
        {source === null && <span className="badge">Say hey to get started</span>}
      </header>

      {!isOnline && (
        <p className="offline-banner" role="status">
          📶 You&apos;re offline — Bud-E&apos;s tools still work, but chat needs internet for
          live AI.
        </p>
      )}

      <nav className="tabs" aria-label="Main tabs">
        <button className={tab === 'tonight' ? 'tab active' : 'tab'} onClick={() => setTab('tonight')}>
          🌙 Tonight
        </button>
        <button className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}>
          💬 Chat
        </button>
        <button className={tab === 'tools' ? 'tab active' : 'tab'} onClick={() => setTab('tools')}>
          🧰 Tools
        </button>
        <button className={tab === 'plan' ? 'tab active' : 'tab'} onClick={() => setTab('plan')}>
          📋 Plan
        </button>
        <button className={tab === 'strains' ? 'tab active' : 'tab'} onClick={() => setTab('strains')}>
          🌿 Strains
        </button>
        <button className={tab === 'journal' ? 'tab active' : 'tab'} onClick={() => setTab('journal')}>
          📓 Journal
        </button>
        <button className={tab === 'stash' ? 'tab active' : 'tab'} onClick={() => setTab('stash')}>
          🎒 Stash
        </button>
        <button className={tab === 'break' ? 'tab active' : 'tab'} onClick={() => setTab('break')}>
          ⏸️ Break
        </button>
        <button className={tab === 'dose' ? 'tab active' : 'tab'} onClick={() => setTab('dose')}>
          ⚖️ Dose
        </button>
        <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
          ⚙️ Settings
        </button>
        <button className={tab === 'account' ? 'tab active' : 'tab'} onClick={() => setTab('account')}>
          👤 Account
        </button>
      </nav>

      {tab === 'tonight' && (
        <TonightTab
          session={session}
          vibe={vibe}
          timerStatus={timerStatus}
          onChat={() => setTab('chat')}
          onTools={() => setTab('tools')}
        />
      )}
      {tab === 'chat' && (
        <ChatTab
          session={session}
          setSession={setSession}
          transcript={transcript}
          setTranscript={setTranscript}
          setSource={setSource}
          journalNote={journalSummary(journal)}
          prefill={pendingQuestion}
          onPrefillUsed={() => setPendingQuestion(null)}
        />
      )}
      {tab === 'tools' && (
        <ToolsTab session={session} vibe={vibe} setVibe={setVibe} setTimerStatus={setTimerStatus} />
      )}
      {tab === 'plan' && <PlanTab session={session} vibe={vibe} timerStatus={timerStatus} />}
      {tab === 'strains' && <StrainsTab onAskAbout={askAboutStrain} />}
      {tab === 'journal' && (
        <JournalTab
          key={`${session.method}-${session.amount}-${session.timeTaken}`}
          entries={journal}
          onAdd={(e) => setJournal((j) => [e, ...j])}
          onDelete={(id) => setJournal((j) => j.filter((e) => e.id !== id))}
          session={session}
          stash={stash}
          onDeduct={deductFromStash}
        />
      )}
      {tab === 'stash' && <StashTab items={stash} onChange={setStash} />}
      {tab === 'break' && <BreakTab />}
      {tab === 'dose' && <DoseTab />}
      {tab === 'settings' && <SettingsTab theme={theme} onTheme={setTheme} />}
      {tab === 'account' && (
        <AuthTab
          user={user}
          onAuthChange={handleAuthChange}
          onSyncNow={() => void syncNow('manual')}
          syncMessage={syncMessage}
        />
      )}

      <footer className="footer">
        21+ only. Bud-E is a buddy, not a doctor. Start low, go slow. Never drive high.
        <br />
        If a pet eats edibles, call a vet right away.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 21+ age gate — first open only. Plain words, no lecture.
// ---------------------------------------------------------------------------

function AgeGate({
  declined,
  onConfirm,
  onDecline,
}: {
  declined: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="age-gate">
      <div className="garden-glow" aria-hidden />
      <div>
        <div className="garden-hero">
          <img src="/garden/leaf.jpg" alt="Green leaves in a calm night garden" />
        </div>
        <p className="eyebrow">21+ session companion</p>
        <h1>Bud-E</h1>
        <p className="muted" style={{ marginTop: 12, fontSize: '1.15rem', lineHeight: 1.4 }}>
          A calm buddy for the night you already started. Timers, straight answers, no lecture.
        </p>
      </div>
      <div>
        {declined ? (
          <>
            <h2>This one is for adults.</h2>
            <p className="muted">
              Bud-E is only for people 21 and over. If that was a mis-tap, you can continue.
            </p>
            <button className="btn btn-block" onClick={onConfirm}>
              I am 21 or older
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Cannabis information for adults. Bud-E is not a doctor, not a shop, and not legal
              advice. Start low, go slow. Never drive high.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
              <button className="btn btn-block" onClick={onConfirm}>
                I&apos;m 21 or older
              </button>
              <button className="btn secondary btn-block" onClick={onDecline}>
                I&apos;m under 21
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session panel (top of the Chat tab)
// ---------------------------------------------------------------------------

function SessionPanel({
  session,
  setSession,
}: {
  session: Session;
  setSession: (s: Session) => void;
}) {
  const update = <K extends keyof Session>(key: K, value: Session[K]) =>
    setSession({ ...session, [key]: value });

  return (
    <section className="card" aria-label="Tonight's session">
      <h2>🌙 Tonight&apos;s session</h2>
      <p className="muted small">
        Fill this in and Bud-E gives you real answers with your real numbers — not guesses.
      </p>
      <label htmlFor="method">What did you take?</label>
      <select
        id="method"
        value={session.method}
        onChange={(e) => {
          const method = e.target.value as Method;
          // Keep the unit sensible: flower is weighed in grams, the rest in mg.
          setSession({ ...session, method, unit: method === 'flower' ? 'g' : 'mg' });
        }}
      >
        {(Object.keys(METHOD_LABELS) as Method[]).map((m) => (
          <option key={m} value={m}>
            {METHOD_LABELS[m]}
          </option>
        ))}
      </select>

      <div className="field-row">
        <div className="grow-2">
          <label htmlFor="amount">How much?</label>
          <input
            id="amount"
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            placeholder="10"
            value={session.amount}
            onChange={(e) => update('amount', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="unit">Unit</label>
          <select id="unit" value={session.unit} onChange={(e) => update('unit', e.target.value as 'mg' | 'g')}>
            <option value="mg">mg</option>
            <option value="g">grams</option>
          </select>
        </div>
      </div>

      <label htmlFor="timeTaken">What time did you take it?</label>
      <input
        id="timeTaken"
        type="time"
        value={session.timeTaken}
        onChange={(e) => update('timeTaken', e.target.value)}
      />

      <label htmlFor="experience">How experienced are you?</label>
      <select
        id="experience"
        value={session.experience}
        onChange={(e) => update('experience', e.target.value as Experience)}
      >
        <option value="new">New — just starting out</option>
        <option value="some">Some experience</option>
        <option value="experienced">Experienced — I know my dose</option>
      </select>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({
  session,
  setSession,
  transcript,
  setTranscript,
  setSource,
  journalNote,
  prefill,
  onPrefillUsed,
}: {
  session: Session;
  setSession: (s: Session) => void;
  transcript: ChatMessage[];
  setTranscript: (t: ChatMessage[]) => void;
  setSource: (s: Source) => void;
  journalNote: string;
  prefill: string | null;
  onPrefillUsed: () => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [transcript]);

  // "Ask Bud-E about this strain" drops the question into the chat box.
  useEffect(() => {
    if (prefill !== null) {
      setInput(prefill);
      onPrefillUsed();
    }
  }, [prefill, onPrefillUsed]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...transcript, { role: 'user', text }];
    setTranscript(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-12),
          session,
          ...(journalNote !== '' ? { journal: journalNote } : {}),
        }),
      });
      const data: unknown = await res.json();
      const reply =
        data && typeof data === 'object' && 'reply' in data
          ? (data as { reply?: unknown }).reply
          : undefined;
      const src =
        data && typeof data === 'object' && 'source' in data
          ? (data as { source?: unknown }).source
          : undefined;
      if (typeof reply === 'string' && reply.trim() !== '') {
        setTranscript([...next, { role: 'bud', text: reply }]);
        setSource(src === 'live' ? 'live' : 'fallback');
      } else {
        throw new Error('no live reply');
      }
    } catch {
      // No key, no network, server hiccup — the offline buddy always answers.
      setTranscript([...next, { role: 'bud', text: localReply(text, session, next) }]);
      setSource('fallback');
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    if (window.confirm('Clear the whole chat? This wipes the saved transcript.')) {
      setTranscript([]);
      setSource(null);
    }
  }

  return (
    <main>
      <SessionPanel session={session} setSession={setSession} />

      <section className="card" aria-label="Chat with Bud-E">
        <h2>💬 Chat with Bud-E</h2>
        <div className="chat-list">
          {transcript.length === 0 && (
            <p className="chat-empty">
              Heyy! Tell me what you took tonight, or ask me anything — like &ldquo;when will this edible kick
              in?&rdquo;
            </p>
          )}
          {transcript.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'msg user' : 'msg bud'}>
              <span className="who">{m.role === 'user' ? 'You' : 'Bud-E'}</span>
              {m.text}
            </div>
          ))}
          {sending && (
            <div className="msg bud">
              <span className="who">Bud-E</span>thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <input
            type="text"
            value={input}
            placeholder="Ask Bud-E anything…"
            aria-label="Message Bud-E"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            disabled={sending}
          />
          <button className="btn" onClick={() => void send()} disabled={sending || input.trim() === ''}>
            Send
          </button>
        </div>

        <p style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn ghost" onClick={clearChat}>
            Clear chat
          </button>
        </p>
      </section>

      <p className="muted small">
        Bud-E keeps your chat on this device only. Nothing you type here leaves your phone unless live AI is
        on — and even then it&apos;s just the last few messages, no name attached.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tools tab
// ---------------------------------------------------------------------------

function ToolsTab({
  session,
  vibe,
  setVibe,
  setTimerStatus,
}: {
  session: Session;
  vibe: Vibe;
  setVibe: (v: Vibe) => void;
  setTimerStatus: (s: string) => void;
}) {
  return (
    <main className="tool-grid">
      <VibeCheck vibe={vibe} setVibe={setVibe} />
      <EdibleTimer session={session} setTimerStatus={setTimerStatus} />
      <BreathingBubble />
      <MunchiesMaker />
      <HighThoughts />
      <TriviaGame />
    </main>
  );
}

function VibeCheck({ vibe, setVibe }: { vibe: Vibe; setVibe: (v: Vibe) => void }) {
  const update = <K extends keyof Vibe>(key: K, value: Vibe[K]) => setVibe({ ...vibe, [key]: value });
  const sentence = `Tonight: ${vibe.setting} vibes, ${vibe.sound} on, craving ${vibe.snack}, feeling ${vibe.energy}.`;
  return (
    <section className="card" aria-label="Vibe check-in">
      <h2>✨ Vibe check-in</h2>
      <label htmlFor="setting">Where are you?</label>
      <select id="setting" value={vibe.setting} onChange={(e) => update('setting', e.target.value)}>
        <option value="couch">Couch</option>
        <option value="outside">Outside</option>
        <option value="friends">With friends</option>
        <option value="solo">Solo</option>
      </select>
      <label htmlFor="sound">What&apos;s on?</label>
      <select id="sound" value={vibe.sound} onChange={(e) => update('sound', e.target.value)}>
        <option value="music">Music</option>
        <option value="a show">A show</option>
        <option value="quiet">Quiet</option>
        <option value="a podcast">A podcast</option>
      </select>
      <label htmlFor="snack">Snack craving?</label>
      <select id="snack" value={vibe.snack} onChange={(e) => update('snack', e.target.value)}>
        <option value="something salty">Something salty</option>
        <option value="something sweet">Something sweet</option>
        <option value="something crunchy">Something crunchy</option>
        <option value="something cold">Something cold</option>
      </select>
      <label htmlFor="energy">Energy right now?</label>
      <select id="energy" value={vibe.energy} onChange={(e) => update('energy', e.target.value)}>
        <option value="chill">Chill</option>
        <option value="giggly">Giggly</option>
        <option value="sleepy">Sleepy</option>
        <option value="creative">Creative</option>
      </select>
      <p className="plan-sentence" style={{ marginTop: 14, marginBottom: 0 }}>
        {sentence}
      </p>
    </section>
  );
}

function EdibleTimer({
  session,
  setTimerStatus,
}: {
  session: Session;
  setTimerStatus: (s: string) => void;
}) {
  const [minutesInput, setMinutesInput] = useState(120);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      setFinished(true);
      setTimerStatus('Edible timer finished — waited the full time.');
      return;
    }
    const id = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running, remaining, setTimerStatus]);

  function startFromSession() {
    const since = minutesSinceTaken(session);
    const taken = parseClock(session.timeTaken);
    if (since === null || taken === null) {
      setMinutesInput(120);
      setRemaining(120 * 60);
      setTimerStatus('Edible timer running — 2 hours from now (no time taken set).');
    } else if (since >= 120) {
      setMinutesInput(0);
      setRemaining(0);
      setFinished(true);
      setTimerStatus('Edible timer finished — already past the 2-hour mark.');
    } else {
      const left = 120 - since;
      setMinutesInput(left);
      setRemaining(left * 60);
      setTimerStatus(
        `Edible timer running — counting down to the 2-hour mark from ${formatClock(taken)}.`,
      );
    }
    setFinished(false);
    setRunning(true);
  }

  function startManual() {
    const mins = Math.max(1, Math.min(720, Math.floor(minutesInput) || 120));
    setMinutesInput(mins);
    setRemaining(mins * 60);
    setFinished(false);
    setRunning(true);
    setTimerStatus(`Edible timer running — ${mins} minutes.`);
  }

  return (
    <section className="card" aria-label="Edible timer">
      <h2>⏱️ Edible timer</h2>
      <p className="muted">
        Edibles take 45–90 minutes to kick in. The golden rule: wait a full 2 hours before even thinking
        about more.
      </p>
      <label htmlFor="waitMinutes">Minutes to wait</label>
      <input
        id="waitMinutes"
        type="number"
        min="1"
        max="720"
        inputMode="numeric"
        value={minutesInput}
        onChange={(e) => setMinutesInput(Number(e.target.value))}
      />
      <div className="button-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={startManual} disabled={running}>
          ▶ Start timer
        </button>
        <button className="btn secondary" onClick={startFromSession} disabled={running}>
          🕐 From my session time
        </button>
      </div>
      {(running || remaining > 0) && (
        <>
          <div className="timer-big">{formatCountdown(remaining)}</div>
          <div className="button-row">
            <button className="btn secondary" onClick={() => setRunning((r) => !r)}>
              {running ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setRunning(false);
                setRemaining(0);
                setFinished(false);
                setTimerStatus('Edible timer reset.');
              }}
            >
              Reset
            </button>
          </div>
        </>
      )}
      {finished && (
        <p className="timer-done">
          ⏰ Time&apos;s up! Still feel nothing? Wait one more hour — do NOT redose yet. Edibles are sneaky
          and stack up late.
        </p>
      )}
    </section>
  );
}

function BreathingBubble() {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const phaseIndex = Math.floor(seconds / 4) % 3;
  const phases = ['Breathe in…', 'Hold…', 'Breathe out…'];
  const scale = phaseIndex === 2 ? 0.8 : 1.25;

  return (
    <section className="card" aria-label="Breathing bubble">
      <h2>🫧 Breathing bubble</h2>
      <p className="muted">Feeling a bit too high? Slow breaths help. 4 in, 4 hold, 4 out.</p>
      <div className="breath-wrap">
        <div
          className="breath-circle"
          style={{ transform: running ? `scale(${scale})` : 'scale(1)' }}
          aria-live="polite"
        >
          {running ? phases[phaseIndex] : '🌿'}
        </div>
        <div className="breath-phase">{running ? `4 seconds · ${phases[phaseIndex]}` : 'Tap start when ready'}</div>
        <button
          className="btn"
          onClick={() => {
            if (running) {
              setRunning(false);
            } else {
              setSeconds(0);
              setRunning(true);
            }
          }}
        >
          {running ? '⏸ Stop' : '▶ Start breathing'}
        </button>
      </div>
    </section>
  );
}

function MunchiesMaker() {
  const [snack, setSnack] = useState(SNACK_COMBOS[0]);
  return (
    <section className="card" aria-label="Munchies maker">
      <h2>🍿 Munchies maker</h2>
      <p className="result-box">{snack}</p>
      <button className="btn btn-block" onClick={() => setSnack(pickRandom(SNACK_COMBOS))}>
        🔀 Shuffle a snack
      </button>
    </section>
  );
}

function HighThoughts() {
  const [thought, setThought] = useState(HIGH_THOUGHTS[0]);
  return (
    <section className="card" aria-label="High-thought prompts">
      <h2>💭 High-thought prompts</h2>
      <p className="result-box">{thought}</p>
      <button className="btn btn-block" onClick={() => setThought(pickRandom(HIGH_THOUGHTS))}>
        🔀 Next thought
      </button>
    </section>
  );
}

function TriviaGame() {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const q = TRIVIA[index];

  function pick(i: number) {
    if (selected !== null) return;
    setSelected(i);
    if (i === q.answer) setScore((s) => s + 1);
  }

  function next() {
    if (index + 1 >= TRIVIA.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setSelected(null);
    }
  }

  function playAgain() {
    setIndex(0);
    setSelected(null);
    setScore(0);
    setDone(false);
  }

  return (
    <section className="card" aria-label="Cannabis trivia">
      <h2>🧠 Bud-E trivia</h2>
      {done ? (
        <>
          <p className="score-big">
            {score} / {TRIVIA.length}
          </p>
          <p style={{ textAlign: 'center' }}>
            {score === TRIVIA.length
              ? 'Perfect score — certified Bud-E brain. 🌿'
              : score >= 3
                ? 'Solid! You know your stuff.'
                : "Hey, that's what Bud-E is here for. Run it back!"}
          </p>
          <button className="btn btn-block" onClick={playAgain}>
            🔁 Play again
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            Question {index + 1} of {TRIVIA.length} · Score: {score}
          </p>
          <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>{q.question}</p>
          {q.options.map((opt, i) => (
            <button
              key={i}
              className={
                'trivia-option' +
                (selected !== null && i === q.answer ? ' correct' : '') +
                (selected === i && i !== q.answer ? ' wrong' : '')
              }
              onClick={() => pick(i)}
              disabled={selected !== null}
            >
              {opt}
            </button>
          ))}
          {selected !== null && (
            <>
              <p className="result-box">{q.fact}</p>
              <button className="btn btn-block" onClick={next}>
                {index + 1 >= TRIVIA.length ? 'See my score' : 'Next question →'}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// My Plan tab
// ---------------------------------------------------------------------------

function buildPlanText(session: Session, vibe: Vibe, timerStatus: string): string {
  const lines: string[] = [];
  lines.push('🌿 MY BUD-E PLAN FOR TONIGHT');
  lines.push('');
  const amount = session.amount.trim();
  lines.push(
    `Session: ${METHOD_LABELS[session.method]}${amount ? ` — ${amount}${session.unit}` : ''}` +
      (session.timeTaken ? ` at ${formatClock(parseClock(session.timeTaken) ?? 0)}` : '') +
      ` (${session.experience === 'new' ? 'new' : session.experience === 'some' ? 'some experience' : 'experienced'}).`,
  );
  lines.push(`Vibe: ${vibe.setting}, ${vibe.sound} on, craving ${vibe.snack}, feeling ${vibe.energy}.`);
  lines.push(`Timer: ${timerStatus}`);
  lines.push('');
  if (session.method === 'edible' || session.method === 'drink') {
    lines.push('• Edibles: wait a full 2 hours before even thinking about more. Onset 45–90 min, peak 2–4 hrs, lasts 4–8 hrs.');
  } else {
    lines.push('• Start low, go slow — one or two small hits, wait 15 minutes, then decide.');
  }
  lines.push('• Drink water. Have a snack ready for the munchies.');
  lines.push('• If it feels like too much: lie down, sip water, breathe slow. It passes.');
  lines.push('');
  lines.push("21+ only. Never drive high — wait until fully sober, and after edibles, until after a full night's sleep.");
  lines.push('Bud-E is a buddy, not a doctor. If something feels seriously wrong, get real help right away.');
  return lines.join('\n');
}

function PlanTab({
  session,
  vibe,
  timerStatus,
}: {
  session: Session;
  vibe: Vibe;
  timerStatus: string;
}) {
  const [copied, setCopied] = useState(false);
  const planText = buildPlanText(session, vibe, timerStatus);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(planText);
      setCopied(true);
    } catch {
      // Clipboard blocked — fall back to selecting the text so the user can copy it.
      textRef.current?.focus();
      textRef.current?.select();
      setCopied(false);
    }
    window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <main>
      <section className="card" aria-label="Tonight's plan">
        <h2>📋 Tonight&apos;s plan</h2>
        <p className="muted">
          Built from your session up top and your vibe check-in. Copy it, share it with your sesh buddy, or
          just keep it here.
        </p>
        <pre className="plan-text">{planText}</pre>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void copyPlan()}>
            {copied ? '✅ Copied!' : '📋 Copy my plan'}
          </button>
        </div>
        <textarea
          ref={textRef}
          readOnly
          value={planText}
          aria-label="Plan text (selectable fallback)"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          tabIndex={-1}
        />
      </section>
      <p className="muted small">
        21+ only. Bud-E is a buddy, not a doctor. Start low, go slow. Never drive high. If a pet eats
        edibles, call a vet right away.
      </p>
    </main>
  );
}
