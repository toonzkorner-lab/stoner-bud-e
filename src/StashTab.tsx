// Stoner Bud-E — Stash Tracker tab.
// Keep track of what you have on hand and get a heads-up when you're
// running low. Plain words, no selling, no sourcing talk.

import { useEffect, useState } from 'react';
import { newStashId } from './stash';
import type { StashForm, StashItem } from './stash';

const FORM_LABELS: Record<StashForm, string> = {
  flower: 'Flower',
  edible: 'Edible',
  vape: 'Vape',
  dab: 'Dab',
  drink: 'Drink',
  other: 'Other',
};

type StashUnit = 'g' | 'mg' | 'pieces';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function StashRow(props: {
  item: StashItem;
  onUpdate: (item: StashItem) => void;
  onDelete: (id: string) => void;
}) {
  const { item, onUpdate, onDelete } = props;
  const [draft, setDraft] = useState(String(item.amount));

  // If the amount changes somewhere else (like a journal entry taking
  // some out), refresh what the input shows.
  useEffect(() => {
    setDraft(String(item.amount));
  }, [item.amount]);

  const step = item.unit === 'g' ? 0.5 : item.unit === 'mg' ? 5 : 1;

  function bump(delta: number): void {
    onUpdate({ ...item, amount: Math.max(0, round2(item.amount + delta)) });
  }

  function saveDraft(): void {
    const n = Number(draft);
    if (Number.isNaN(n) || n < 0) return;
    onUpdate({ ...item, amount: round2(n) });
  }

  function deleteItem(): void {
    if (window.confirm(`Delete ${item.name} from your stash?`)) onDelete(item.id);
  }

  const runningLow = item.amount <= item.lowAt;

  return (
    <div className="result-box">
      <p>
        <strong>{item.name}</strong> · {FORM_LABELS[item.form]}
      </p>
      <p>
        {item.amount}
        {item.unit}
        {item.thcPct.trim() !== '' ? ` · ${item.thcPct.trim()}% THC` : ''}
      </p>
      {runningLow && <p>⚠️ Running low!</p>}
      {item.lowAt > 0 && (
        <p className="muted small">
          Warns under {item.lowAt}
          {item.unit}
        </p>
      )}
      <div className="field-row">
        <button type="button" className="btn secondary" onClick={() => bump(-step)}>
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Amount of ${item.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => bump(step)}>
          +
        </button>
      </div>
      <div className="button-row">
        <button type="button" className="btn secondary" onClick={saveDraft}>
          Save amount
        </button>
        <button type="button" className="btn danger" onClick={deleteItem}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function StashTab(props: {
  items: StashItem[];
  onChange: (items: StashItem[]) => void;
}) {
  const { items, onChange } = props;

  const [name, setName] = useState('');
  const [form, setForm] = useState<StashForm>('flower');
  const [amountStr, setAmountStr] = useState('');
  const [unit, setUnit] = useState<StashUnit>('g');
  const [thcPct, setThcPct] = useState('');
  const [lowAtStr, setLowAtStr] = useState('');
  const [error, setError] = useState('');

  function addItem(): void {
    const amt = Number(amountStr);
    if (!name.trim()) {
      setError('Give it a name first — like the strain or product name.');
      return;
    }
    if (!amountStr.trim() || Number.isNaN(amt) || amt <= 0) {
      setError('Add how much you have.');
      return;
    }
    const low = Number(lowAtStr);
    const item: StashItem = {
      id: newStashId(),
      name: name.trim(),
      form,
      amount: round2(amt),
      unit,
      thcPct: thcPct.trim(),
      lowAt: lowAtStr.trim() === '' || Number.isNaN(low) || low < 0 ? 0 : round2(low),
    };
    onChange([...items, item]);
    setName('');
    setAmountStr('');
    setThcPct('');
    setLowAtStr('');
    setError('');
  }

  function updateItem(updated: StashItem): void {
    onChange(items.map((i) => (i.id === updated.id ? updated : i)));
  }

  function deleteItem(id: string): void {
    onChange(items.filter((i) => i.id !== id));
  }

  return (
    <div>
      <div className="card">
        <h2>Add to stash</h2>
        <p className="muted small">
          What you have on hand. Just for you — it stays on this device.
        </p>

        <label htmlFor="stash-name">Name / strain</label>
        <input
          id="stash-name"
          type="text"
          placeholder="e.g. Blue Dream"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="stash-form">What kind</label>
        <select
          id="stash-form"
          value={form}
          onChange={(e) => setForm(e.target.value as StashForm)}
        >
          {(Object.keys(FORM_LABELS) as StashForm[]).map((f) => (
            <option key={f} value={f}>
              {FORM_LABELS[f]}
            </option>
          ))}
        </select>

        <div className="field-row">
          <div className="grow-2">
            <label htmlFor="stash-amount">How much</label>
            <input
              id="stash-amount"
              type="text"
              inputMode="decimal"
              placeholder="7"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stash-unit">Unit</label>
            <select
              id="stash-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as StashUnit)}
            >
              <option value="g">g</option>
              <option value="mg">mg</option>
              <option value="pieces">pieces</option>
            </select>
          </div>
        </div>

        <label htmlFor="stash-thc">THC % (optional)</label>
        <input
          id="stash-thc"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 22"
          value={thcPct}
          onChange={(e) => setThcPct(e.target.value)}
        />

        <label htmlFor="stash-low">Warn me when under… ({unit})</label>
        <input
          id="stash-low"
          type="text"
          inputMode="decimal"
          placeholder="e.g. 3.5"
          value={lowAtStr}
          onChange={(e) => setLowAtStr(e.target.value)}
        />

        {error !== '' && <p>{error}</p>}

        <p>
          <button type="button" className="btn btn-block" onClick={addItem}>
            Add to stash
          </button>
        </p>
      </div>

      <div className="card">
        <h2>Your stash</h2>
        {items.length === 0 ? (
          <p className="muted">Nothing in the stash yet. Add your first item above.</p>
        ) : (
          items.map((item) => (
            <StashRow
              key={item.id}
              item={item}
              onUpdate={updateItem}
              onDelete={deleteItem}
            />
          ))
        )}
      </div>
    </div>
  );
}
