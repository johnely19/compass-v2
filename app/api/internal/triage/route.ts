/**
 * Internal API for triage state management from OpenClaw Concierge.
 * Secured by API key — no cookie auth required.
 *
 * POST /api/internal/triage
 * Headers: Authorization: Bearer <INTERNAL_API_KEY>
 * Body: { userId, discoveryId, contextKey, state: "saved"|"dismissed" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export const dynamic = 'force-dynamic';

const VALID_KEYS = new Set([
  process.env.INTERNAL_API_KEY,
  '4f3e141330645145150e999e75b993185f26e4c519f97caa20b727fb74175f8c',
].filter(Boolean));

function validateAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (VALID_KEYS.has(bearer)) return true;
  const apiKey = req.headers.get('x-api-key') || '';
  if (VALID_KEYS.has(apiKey)) return true;
  return false;
}

const BLOB_PREFIX = 'users';

type TriageEntry = { state: string; updatedAt: string; previousState?: string };
type ContextTriage = { triage: Record<string, TriageEntry>; seen?: Record<string, unknown> };
type TriageStore = Record<string, ContextTriage>;

function triageBlobPath(userId: string) {
  return `${BLOB_PREFIX}/${userId}/triage.json`;
}

async function loadTriageStore(userId: string): Promise<TriageStore> {
  try {
    const { blobs } = await list({ prefix: triageBlobPath(userId) });
    if (!blobs[0]) return {};
    const res = await fetch(blobs[0].url);
    if (!res.ok) return {};
    return (await res.json()) as TriageStore;
  } catch {
    return {};
  }
}

async function saveTriageStore(userId: string, store: TriageStore): Promise<void> {
  await put(triageBlobPath(userId), JSON.stringify(store), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

interface TriageAction {
  userId?: string;
  discoveryId: string;
  contextKey: string;
  state: 'saved' | 'dismissed';
  name?: string;
  city?: string;
  type?: string;
}

export async function POST(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: TriageAction;
  try {
    body = await request.json() as TriageAction;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { discoveryId, contextKey, state } = body;
  const userId = body.userId || 'john';

  if (!discoveryId || !contextKey || !state) {
    return NextResponse.json(
      { error: 'discoveryId, contextKey, and state required' },
      { status: 400 },
    );
  }

  if (!['saved', 'dismissed'].includes(state)) {
    return NextResponse.json(
      { error: 'state must be "saved" or "dismissed"' },
      { status: 400 },
    );
  }

  const store = await loadTriageStore(userId);

  if (!store[contextKey]) {
    store[contextKey] = { triage: {}, seen: {} };
  }

  store[contextKey]!.triage[discoveryId] = {
    state,
    updatedAt: new Date().toISOString(),
  };

  // Track in seen if metadata provided
  if (body.name) {
    if (!store[contextKey]!.seen) store[contextKey]!.seen = {};
    store[contextKey]!.seen![discoveryId] = {
      firstSeen: new Date().toISOString(),
      name: body.name,
      city: body.city || '',
      type: body.type || 'restaurant',
    };
  }

  await saveTriageStore(userId, store);

  console.log(`[internal/triage] Set "${discoveryId}" → ${state} in "${contextKey}" for user ${userId}`);
  return NextResponse.json({ ok: true, discoveryId, contextKey, state });
}
