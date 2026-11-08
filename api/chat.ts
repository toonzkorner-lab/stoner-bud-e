// Stoner Bud-E — /api/chat (Vercel Node serverless function).
// POST only. Live AI via Google Gemini when GEMINI_API_KEY is set in the
// environment; otherwise returns { source: "fallback" } and the client answers
// with its local buddy engine. This function NEVER returns a 500 — any
// failure degrades to fallback so the chat always answers.
// The key is never logged and never sent to the client.

import { BUD_E_SYSTEM_PROMPT } from '../src/bude.ts';
import type { ChatMessage, Session } from '../src/bude.ts';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
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

    const apiKey = process.env.GEMINI_API_KEY;
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

    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: sessionLine(body.session, body.journal) }] },
      ...messages.map((m): GeminiContent => ({
        role: m.role === 'bud' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
    ];

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: BUD_E_SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.9, maxOutputTokens: 600 },
      }),
    });

    if (!geminiRes.ok) {
      fallback(res);
      return;
    }

    const data = (await geminiRes.json()) as GeminiResponse;
    const reply = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join('')
      .trim();
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
