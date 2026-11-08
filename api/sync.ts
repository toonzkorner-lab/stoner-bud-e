// Stoner Bud-E — /api/sync (Vercel Node serverless function).
//
// GET returns the signed-in user's server state; POST upserts the journal,
// stash, and settings the client sends and returns the merged server state.
// Authenticated only: a valid Better Auth session cookie is required, else
// 401 `sign_in_required`. Returns 503 `auth_not_configured` until
// DATABASE_URL is set. Same CORS pattern as api/chat.ts, plus credentials.
//
// Conflict rule (server-wins): a row is only overwritten when the incoming
// updated_at is NEWER than the stored one; otherwise the stored server copy
// is kept and returned. An item with no updated_at counts as new (stored
// with the server's current time). Chat is never synced — the transcript
// stays on the device only.
//
// Known gap (by design, see INTEGRATION.md): deletions do NOT sync yet. A
// journal entry or stash item deleted locally stays on the server and comes
// back on the next download. The follow-up is tombstones or a delete
// endpoint — NOT silent delete-missing, which would wipe a new device's
// empty first upload.

import { getPool, getSessionUser } from '../src/lib/auth-server.ts';
import { isPreflight, readJsonBody, setCorsHeaders } from '../src/lib/cors.ts';
import type { ReqLike, ResLike } from '../src/lib/cors.ts';
import type { Pool, PoolClient } from 'pg';

// NOTE: the wire types below deliberately mirror src/lib/sync.ts (the client
// half of this contract) instead of importing it. Importing it would pull
// src/journal.ts and src/lib/auth-client.ts into the node tsconfig, whose
// lib has no DOM — so `window` / `import.meta.env` in the client-only files
// would fail typecheck. The JSON shape is identical on both sides; keep them
// in step if either changes.
type SyncedRecord = Record<string, unknown> & { updatedAt: string };

interface ApiServerState {
  journal: SyncedRecord[];
  stash: SyncedRecord[];
  settings: (Record<string, unknown> & { updatedAt: string }) | null;
}

const MAX_JOURNAL = 500;
const MAX_STASH = 200;

type Req = ReqLike & { on?: unknown };
type Res = ResLike & { headersSent?: boolean };

interface IncomingItem {
  id: string;
  updatedAt: Date | null;
  data: Record<string, unknown>;
}

interface SyncBody {
  journal?: unknown;
  stash?: unknown;
  settings?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUpdatedAt(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Validate one uploaded list. Returns null when the list is malformed. */
function cleanItems(raw: unknown, limit: number): IncomingItem[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > limit) return null;
  const items: IncomingItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { updatedAt: _dropped, ...data } = entry;
    void _dropped;
    if (typeof data.id !== 'string' || data.id === '' || data.id.length > 128) return null;
    items.push({ id: data.id, updatedAt: parseUpdatedAt(entry.updatedAt), data });
  }
  return items;
}

const THEMES = new Set(['night', 'day', 'ember', 'moon']);
const EXPERIENCES = new Set(['new', 'some', 'experienced']);

/** Validate settings: only known keys are kept, everything else is dropped.
 *  Returns undefined when nothing was sent (skip the upsert), null when the
 *  value is malformed (the caller answers 400). */
function cleanSettings(
  raw: unknown,
): { data: Record<string, unknown>; updatedAt: Date | null } | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return null;
  const { updatedAt: _dropped, ...rest } = raw;
  void _dropped;
  const data: Record<string, unknown> = {};
  if (typeof rest.theme === 'string' && THEMES.has(rest.theme)) data.theme = rest.theme;
  if (typeof rest.experience === 'string' && EXPERIENCES.has(rest.experience)) {
    data.experience = rest.experience;
  }
  if (isRecord(rest.session)) data.session = rest.session;
  if (isRecord(rest.vibe)) data.vibe = rest.vibe;
  if (rest.break === null || isRecord(rest.break)) data.break = rest.break;
  return { data, updatedAt: parseUpdatedAt(raw.updatedAt) };
}

interface Row {
  // Index signature so Row satisfies pg's QueryResultRow constraint.
  [key: string]: unknown;
  id?: string;
  data: Record<string, unknown>;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function readState(client: Pool | PoolClient, userId: string): Promise<ApiServerState> {
  const journalRes = await client.query<Row>(
    'select id, data, updated_at from journal_entries where user_id = $1 order by updated_at desc',
    [userId],
  );
  const stashRes = await client.query<Row>(
    'select id, data, updated_at from stash_items where user_id = $1 order by updated_at desc',
    [userId],
  );
  const settingsRes = await client.query<Row>(
    'select data, updated_at from user_settings where user_id = $1',
    [userId],
  );
  const journal: SyncedRecord[] = journalRes.rows.map(
    (r) => ({ ...(r.data as object), updatedAt: toIso(r.updated_at) }) as SyncedRecord,
  );
  const stash: SyncedRecord[] = stashRes.rows.map(
    (r) => ({ ...(r.data as object), updatedAt: toIso(r.updated_at) }) as SyncedRecord,
  );
  const settingsRow = settingsRes.rows[0];
  const settings: ApiServerState['settings'] = settingsRow
    ? ({
        ...(settingsRow.data as object),
        updatedAt: toIso(settingsRow.updated_at),
      } as ApiServerState['settings'])
    : null;
  return { journal, stash, settings };
}

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    res.setHeader('Content-Type', 'application/json');
    setCorsHeaders(req, res, 'GET, POST, OPTIONS');
    if (isPreflight(req)) {
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed' });
      return;
    }

    let user: { id: string } | null;
    try {
      user = await getSessionUser(req);
    } catch {
      res.status(503).json({ ok: false, error: 'auth_not_configured' });
      return;
    }
    if (!user) {
      res.status(401).json({ ok: false, error: 'sign_in_required' });
      return;
    }

    const pool = getPool();
    if (req.method === 'GET') {
      const state = await readState(pool, user.id);
  res.status(200).json({ ok: true, ...state });
      return;
    }

    // POST — validate first, then upsert in one transaction.
    const body = await readJsonBody<SyncBody>(req);
    const journal = cleanItems(body.journal, MAX_JOURNAL);
    const stash = cleanItems(body.stash, MAX_STASH);
    const settings = cleanSettings(body.settings);
    if (journal === null || stash === null || settings === null) {
      res.status(400).json({ ok: false, error: 'bad_sync_body' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of journal) {
        // Server-wins: only overwrite when the incoming copy is strictly newer.
        await client.query(
          `insert into journal_entries (user_id, id, data, updated_at)
           values ($1, $2, $3, $4)
           on conflict (user_id, id) do update
             set data = excluded.data, updated_at = excluded.updated_at
             where journal_entries.updated_at < excluded.updated_at`,
          [user.id, item.id, item.data, item.updatedAt ?? new Date()],
        );
      }
      for (const item of stash) {
        await client.query(
          `insert into stash_items (user_id, id, data, updated_at)
           values ($1, $2, $3, $4)
           on conflict (user_id, id) do update
             set data = excluded.data, updated_at = excluded.updated_at
             where stash_items.updated_at < excluded.updated_at`,
          [user.id, item.id, item.data, item.updatedAt ?? new Date()],
        );
      }
      if (settings !== undefined) {
        await client.query(
          `insert into user_settings (user_id, data, updated_at)
           values ($1, $2, $3)
           on conflict (user_id) do update
             set data = excluded.data, updated_at = excluded.updated_at
             where user_settings.updated_at < excluded.updated_at`,
          [user.id, settings.data, settings.updatedAt ?? new Date()],
        );
      }
      const state = await readState(client, user.id);
      await client.query('COMMIT');
      res.status(200).json({ ok: true, ...state });
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Already gone — nothing left to roll back.
      }
      res.status(500).json({ ok: false, error: 'sync_failed' });
    } finally {
      client.release();
    }
  } catch {
    if (!res.headersSent) {
      try {
        res.status(500).json({ ok: false, error: 'sync_failed' });
      } catch {
        // Response already sent — nothing left to do.
      }
    }
  }
}
