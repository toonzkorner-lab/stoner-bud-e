// Stoner Bud-E — sync helpers (browser side).
//
// Pure merge logic + the upload/download calls for /api/sync. The chat
// transcript is NEVER synced — it stays on the device only.
//
// How conflict resolution works (both sides agree on this):
// - Every synced item carries `updatedAt` (ISO string). The server only
//   overwrites a row when the incoming updatedAt is NEWER than the stored
//   one; otherwise the server copy wins (see api/sync.ts).
// - Local edits must bump updatedAt — uploadLocal() does that for you: it
//   keeps a snapshot of the last server state in localStorage, and any local
//   item whose content differs from the snapshot (or is brand new) gets a
//   fresh updatedAt at upload time. So App.tsx does NOT have to stamp edits
//   itself; it just passes the current local lists in.
// - mergeLocalWithServer() (for display/merge before an upload): union by id,
//   later updatedAt wins, a tie goes to the server copy, and an item with no
//   updatedAt at all (legacy local data from before sign-in existed) counts
//   as the oldest — uploadLocal stamps those on first sync.
// - After a successful upload or download, the server state is the source of
//   truth: App.tsx replaces its local lists with what the server returned.

import { authedFetch } from './auth-client.ts';
import type { JournalEntry } from '../journal.ts';
import type { StashItem } from '../stash.ts';
import type { Experience, Session } from '../bude.ts';
import type { ThemeId } from '../theme.ts';

export type Synced<T> = T & { updatedAt?: string };

export type SyncedJournalEntry = Synced<JournalEntry>;
export type SyncedStashItem = Synced<StashItem>;

export interface VibeState {
  setting: string;
  sound: string;
  snack: string;
  energy: string;
}

export interface BreakCheckin {
  date: string; // "YYYY-MM-DD"
  mood: string;
  cravings: number; // 1–5
  note: string;
}

export interface BreakState {
  startDate: string; // "YYYY-MM-DD"
  lengthDays: number;
  checkins: BreakCheckin[];
  status: 'active' | 'done' | 'ended';
}

export interface SyncSettings {
  theme?: ThemeId;
  experience?: Experience;
  session?: Session;
  vibe?: VibeState;
  break?: BreakState | null;
  updatedAt?: string;
}

export interface ServerState {
  journal: SyncedJournalEntry[];
  stash: SyncedStashItem[];
  settings: SyncSettings | null;
}

export interface LocalState {
  journal: SyncedJournalEntry[];
  stash: SyncedStashItem[];
}

const SNAPSHOT_KEY = 'bude-sync-snapshot-v1';

/** Stable JSON for content comparison (keys sorted, updatedAt excluded). */
function contentKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(contentKey).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => k !== 'updatedAt')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${contentKey(obj[k])}`).join(',')}}`;
}

interface Snapshot {
  journal: Record<string, string>;
  stash: Record<string, string>;
  settings: string | null;
}

function loadSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return { journal: {}, stash: {}, settings: null };
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    return {
      journal: parsed.journal ?? {},
      stash: parsed.stash ?? {},
      settings: parsed.settings ?? null,
    };
  } catch {
    return { journal: {}, stash: {}, settings: null };
  }
}

function saveSnapshot(state: ServerState): void {
  try {
    const snapshot: Snapshot = {
      journal: Object.fromEntries(state.journal.map((e) => [e.id, contentKey(e)])),
      stash: Object.fromEntries(state.stash.map((i) => [i.id, contentKey(i)])),
      settings: state.settings ? contentKey(state.settings) : null,
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage blocked — sync still works, it just re-stamps on next upload.
  }
}

function stampIfChanged<T extends { id: string; updatedAt?: string }>(
  items: T[],
  snapshot: Record<string, string>,
  now: string,
): T[] {
  return items.map((item) => {
    const prev = snapshot[item.id];
    if (prev !== undefined && prev === contentKey(item) && item.updatedAt !== undefined) {
      return item; // unchanged since last sync — keep the old stamp
    }
    return { ...item, updatedAt: now };
  });
}

/**
 * Merge a local list with the server list, by id. Later updatedAt wins; a
 * tie goes to the server copy; a local item with no updatedAt counts as
 * oldest. Items only on one side are always kept.
 */
export function mergeLocalWithServer<T extends { id: string; updatedAt?: string }>(
  local: T[],
  server: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of server) byId.set(item.id, item);
  for (const item of local) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const localTime = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    const serverTime = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    // Strictly newer local wins; tie or older local loses to the server copy.
    if (!Number.isNaN(localTime) && !Number.isNaN(serverTime) && localTime > serverTime) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function syncErrorMessage(status: number, body: unknown): string {
  const code =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: unknown }).error ?? '')
      : '';
  if (status === 401 || code === 'sign_in_required') {
    return 'You are signed out — sign in to sync.';
  }
  if (status === 503 || code === 'auth_not_configured') {
    return 'Sync is not set up yet — the database is still being connected.';
  }
  return 'Sync did not work — check your connection and try again.';
}

async function readState(res: Response): Promise<ServerState> {
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(syncErrorMessage(res.status, body));
  const state = body as Partial<ServerState>;
  const journal = Array.isArray(state.journal) ? state.journal : [];
  const stash = Array.isArray(state.stash) ? state.stash : [];
  const settings =
    state.settings && typeof state.settings === 'object' ? state.settings : null;
  const merged: ServerState = { journal, stash, settings };
  saveSnapshot(merged);
  return merged;
}

/**
 * Upload the local journal/stash/settings, then return the merged server
 * state (the source of truth — App.tsx should replace its local lists with
 * this). Items changed since the last sync get a fresh updatedAt; unchanged
 * items keep theirs, so an older device cannot clobber a newer server row.
 */
export async function uploadLocal(
  local: LocalState,
  settings: SyncSettings | null,
): Promise<ServerState> {
  const now = new Date().toISOString();
  const snapshot = loadSnapshot();
  const journal = stampIfChanged(local.journal, snapshot.journal, now);
  const stash = stampIfChanged(local.stash, snapshot.stash, now);
  const stampedSettings =
    settings === null
      ? null
      : snapshot.settings !== null &&
          snapshot.settings === contentKey(settings) &&
          settings.updatedAt !== undefined
        ? settings
        : { ...settings, updatedAt: now };
  const res = await authedFetch('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ journal, stash, settings: stampedSettings }),
  });
  return readState(res);
}

/** Download the server state (source of truth). Throws a plain-words Error. */
export async function downloadServer(): Promise<ServerState> {
  const res = await authedFetch('/api/sync', { method: 'GET' });
  return readState(res);
}
