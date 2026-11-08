// Stoner Bud-E — /api/chat (Vercel Node serverless function).
// POST only. Live AI via Groq Cloud when GROQ_API_KEY is set in the
// environment; otherwise returns { source: "fallback" } and the client answers
// with its local buddy engine. This function NEVER returns a 500 — any
// failure degrades to fallback so the chat always answers.
// The key is never logged and never sent to the client.

import { BUD_E_SYSTEM_PROMPT } from '../src/bude.ts';
import type { ChatMessage, Session } from '../src/bude.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] as const;

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

type Body = {
  messages?: ChatMessage[];
  session?: Partial<Session>;
  journal?: string;
};

type ReqLike = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ResLike = {
  status: (code: number) => ResLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

// CORS: the Capacitor APK calls this API cross-origin from its local origin
// (capacitor://localhost / https://localhost). Only reflect an origin we
// recognize; everything else gets no Access-Control-Allow-Origin and the
// browser blocks the read. The live web app is same-origin and needs no CORS.
const ALLOWED_ORIGINS = new Set([
  'https://stoner-bud-e-toonzkorner-9149s-projects.vercel.app',
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
]);

function corsOrigin(req: ReqLike): string | null {
  const raw = req.headers?.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  return origin && ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function setCorsHeaders(req: ReqLike, res: ResLike): void {
  const origin = corsOrigin(req);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function fallback(res: ResLike): void {
  res.status(200).json({ ok: true, source: 'fallback', reply: null });
}

function parseBody(raw: unknown): Body {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Body;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') return raw as Body;
  return {};
}

function sessionLine(session: Partial<Session> | undefined, journal?: string): string {
  const bits: string[] = [];
  if (session) {
    if (session.method) bits.push(`method: ${session.method}`);
    if (session.amount) bits.push(`amount: ${session.amount}${session.unit ?? 'mg'}`);
    if (session.timeTaken) bits.push(`time taken: ${session.timeTaken}`);
    if (session.experience) bits.push(`experience: ${session.experience}`);
  }
  const base =
    bits.length > 0 ? `Tonight's session — ${bits.join(', ')}.` : 'No session details were given.';
  const journalBit = journal && journal.trim() !== '' ? ` ${journal.trim()}` : '';
  return `${base}${journalBit}`;
}

async function callGroq(
  apiKey: string,
  model: string,
  messages: GroqChatMessage[],
): Promise<string | null> {
  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.9,
      max_tokens: 600,
    }),
  });

  if (!groqRes.ok) return null;

  const data = (await groqRes.json()) as GroqResponse;
  const reply = data.choices?.[0]?.message?.content?.trim();
  return reply ? reply : null;
}

export default async function handler(req: ReqLike, res: ResLike): Promise<void> {
  try {
    res.setHeader('Content-Type', 'application/json');
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      // CORS preflight from the APK — no body, just the headers above.
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method !== 'POST') {
      res.status(200).json({ ok: true, source: 'fallback', reply: null });
      return;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      fallback(res);
      return;
    }

    const body = parseBody(req.body);
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    if (messages.length === 0) {
      fallback(res);
      return;
    }

    const groqMessages: GroqChatMessage[] = [
      { role: 'system', content: BUD_E_SYSTEM_PROMPT },
      { role: 'user', content: sessionLine(body.session, body.journal) },
      ...messages.map((m): GroqChatMessage => ({
        role: m.role === 'bud' ? 'assistant' : 'user',
        content: m.text,
      })),
    ];

    let reply: string | null = null;
    for (const model of GROQ_MODELS) {
      reply = await callGroq(apiKey, model, groqMessages);
      if (reply) break;
    }
    if (!reply) {
      fallback(res);
      return;
    }

    res.status(200).json({ ok: true, source: 'live', reply });
  } catch {
    // Any surprise at all: degrade to fallback, never a 500.
    try {
      fallback(res);
    } catch {
      // Response already sent — nothing left to do.
    }
  }
}
