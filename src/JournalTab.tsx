// Stoner Bud-E — Session Journal tab.
// Log tonight's session, see past entries, and optionally take the amount
// out of the stash. Plain words, 21+ tone, no medical claims.

import { useState } from 'react';
import { METHOD_LABELS } from './bude';
import type { Method, Session } from './bude';
import { newEntryId } from './journal';
import type { JournalEntry } from './journal';
import type { StashItem } from './stash';

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));
}

interface JournalTabProps {
  entries: JournalEntry[];
  onAdd: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
  session: Session;
  stash: StashItem[];
  onDeduct: (stashId: string, amount: number, unit: 'mg' | 'g') => void;
}

export default function JournalTab(props: JournalTabProps) {
  const { entries, onAdd, onDelete, session, stash, onDeduct } = props;

  const [method, setMethod] = useState<Method>(session.method);
  const [amount, setAmount] = useState(session.amount);
  const [unit, setUnit] = useState<'mg' | 'g'>(session.unit);
  const [strain, setStrain] = useState('');
  const [rating, setRating] = useState(3);
  const [note, setNote] = useState('');
  const [change, setChange] = useState('');
  const [dateVal, setDateVal] = useState(todayLocal());
  const [stashId, setStashId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Only stash items measured the same way as this entry can be used.
  const matchingStash = stash.filter((s) => s.unit === unit);

  function saveEntry(): void {
    const amt = amount.trim();
    if (!amt || Number.isNaN(Number(amt)) || Number(amt) <= 0) {
      setError('Add an amount first — like 10mg or 0.5g.');
      return;
    }
    const entry: JournalEntry = {
      id: newEntryId(),
      date: new Date(`${dateVal}T12:00:00`).toISOString(),
      method,
      strain: strain.trim(),
      amount: amt,
      unit,
      rating,
      note: note.trim(),
      change: change.trim(),
    };
    onAdd(entry);
    if (stashId) onDeduct(stashId, Number(amt), unit);
    setStrain('');
    setNote('');
    setChange('');
    setStashId('');
    setRating(3);
    setDateVal(todayLocal());
    setError('');
  }

  function deleteEntry(id: string): void {
    if (window.confirm('Delete this journal entry?')) onDelete(id);
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className="card">
        <h2>Log tonight</h2>
        <p className="muted small">
          Jot down what you took so you remember what worked. Just for you — it stays on this device.
        </p>

        <label htmlFor="journal-date">Date</label>
        <input
          id="journal-date"
          type="date"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
        />

        <label htmlFor="journal-method">What kind</label>
        <select
          id="journal-method"
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
        >
          {(Object.keys(METHOD_LABELS) as Method[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>

        <label htmlFor="journal-strain">Strain or product</label>
        <input
          id="journal-strain"
          type="text"
          placeholder="e.g. Blue Dream"
          value={strain}
          onChange={(e) => setStrain(e.target.value)}
        />

        <div className="field-row">
          <div className="grow-2">
            <label htmlFor="journal-amount">How much</label>
            <input
              id="journal-amount"
              type="text"
              inputMode="decimal"
              placeholder="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="journal-unit">Unit</label>
            <select
              id="journal-unit"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value as 'mg' | 'g');
                setStashId('');
              }}
            >
              <option value="mg">mg</option>
              <option value="g">g</option>
            </select>
          </div>
        </div>

        <label>How was it?</label>
        <div className="button-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={rating === n ? 'btn' : 'btn secondary'}
              aria-pressed={rating === n}
              onClick={() => setRating(n)}
            >
              {n} ★
            </button>
          ))}
        </div>

        <label htmlFor="journal-note">How did it feel? (optional)</label>
        <textarea
          id="journal-note"
          placeholder="e.g. Perfect for movies, super chill"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <label htmlFor="journal-change">What would you do different next time? (optional)</label>
        <input
          id="journal-change"
          type="text"
          placeholder="e.g. Take it earlier in the evening"
          value={change}
          onChange={(e) => setChange(e.target.value)}
        />

        <label htmlFor="journal-stash">Took from stash (optional)</label>
        <select
          id="journal-stash"
          value={stashId}
          disabled={matchingStash.length === 0}
          onChange={(e) => setStashId(e.target.value)}
        >
          {matchingStash.length === 0 ? (
            <option value="">No stash in this unit yet.</option>
          ) : (
            <>
              <option value="">Not from stash</option>
              {matchingStash.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.amount}
                  {s.unit} left
                </option>
              ))}
            </>
          )}
        </select>
        {stashId !== '' && (
          <p className="muted small">
            Saving will take {amount.trim() || '?'}
            {unit} out of that stash item.
          </p>
        )}

        {error !== '' && <p>{error}</p>}

        <p>
          <button type="button" className="btn btn-block" onClick={saveEntry}>
            Save entry
          </button>
        </p>
      </div>

      <div className="card">
        <h2>Past sessions</h2>
        {sorted.length === 0 ? (
          <p className="muted">Nothing logged yet. Your first entry will show up here.</p>
        ) : (
          sorted.map((e) => (
            <div key={e.id} className="result-box">
              <div
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                title="Tap to see more"
              >
                <p>
                  <strong>{showDate(e.date)}</strong> — {METHOD_LABELS[e.method]} {e.amount}
                  {e.unit}
                  {e.strain ? ` · ${e.strain}` : ''}
                </p>
                <p>
                  {stars(e.rating)} <span className="muted small">{e.rating}/5</span>
                </p>
                {e.note && <p className="muted small">{e.note}</p>}
                {expandedId === e.id && (
                  <div>
                    {e.note && (
                      <p>
                        <strong>How it felt:</strong> {e.note}
                      </p>
                    )}
                    {e.change ? (
                      <p>
                        <strong>Next time:</strong> {e.change}
                      </p>
                    ) : (
                      <p className="muted small">Nothing noted for next time.</p>
                    )}
                  </div>
                )}
              </div>
              <p>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => deleteEntry(e.id)}
                >
                  Delete
                </button>
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
