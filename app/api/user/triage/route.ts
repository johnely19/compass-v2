/**
 * GET /api/user/triage  — fetch full triage store from Blob
 * POST /api/user/triage — merge triage changes into Blob
 *
 * Blob path: users/{userId}/triage.json
 * Format: TriageStore (same as localStorage compass-triage-{userId})
 *
 * Merge strategy (POST):
 *   For each contextKey → placeId entry:
 *   - Keep the entry with the latest updatedAt timestamp
 *   - Server store is the authoritative source between syncs
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { list, put, del } from '@vercel/blob';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';

export const dynamic = 'force-dynamic';

const BLOB_PREFIX = 'users';

function triageBlobPath(userId: string) {
  return `${BLOB_PREFIX}/${userId}/triage.json`;
}

// Lean type definitions (mirror triage.ts without importing client code)
interface TriageEntry { state: string; updatedAt: string; previousState?: string }
type ContextTriage = { triage: Record<string, TriageEntry>; seen?: Record<string, unknown> };
type TriageStore = Record<string, ContextTriage>;

async function loadServerStore(userId: string): Promise<TriageStore> {
  const { blobs } = await list({ prefix: triageBlobPath(userId) });
  if (blobs.length === 0) return {};
  try {
    const b0 = blobs[0]; if (!b0) return {}; const res = await fetch(b0.url, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as TriageStore;
  } catch {
    return {};
  }
}

async function saveServerStore(userId: string, store: TriageStore): Promise<void> {
  // Delete old blob(s) first
  const { blobs } = await list({ prefix: triageBlobPath(userId) });
  await Promise.all(blobs.map(b => del(b.url)));
  await put(triageBlobPath(userId), JSON.stringify(store), {
    access: 'public',
    addRandomSuffix: false,
  });
}

/** Merge two TriageStore objects — keep the entry with the later updatedAt */
function mergeStores(server: TriageStore, client: TriageStore): TriageStore {
  const merged: TriageStore = {};

  const allContexts = new Set([...Object.keys(server), ...Object.keys(client)]);
  for (const ctx of allContexts) {
    const sCtx = server[ctx] ?? { triage: {} };
    const cCtx = client[ctx] ?? { triage: {} };

    const mergedTriage: Record<string, TriageEntry> = {};
    const allPlaces = new Set([...Object.keys(sCtx.triage), ...Object.keys(cCtx.triage)]);

    for (const placeId of allPlaces) {
      const sEntry = sCtx.triage[placeId];
      const cEntry = cCtx.triage[placeId];

      if (!sEntry) { mergedTriage[placeId] = cEntry; continue; }
      if (!cEntry) { mergedTriage[placeId] = sEntry; continue; }

      // Both exist — keep whichever is newer
      const sTime = new Date(sEntry.updatedAt).getTime();
      const cTime = new Date(cEntry.updatedAt).getTime();
      mergedTriage[placeId] = cTime >= sTime ? cEntry : sEntry;
    }

    // Merge seen (union — once seen, always seen)
    const mergedSeen = { ...(sCtx.seen ?? {}), ...(cCtx.seen ?? {}) };

    merged[ctx] = { triage: mergedTriage, seen: mergedSeen };
  }

  return merged;
}

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const store = await loadServerStore(userId);
  return NextResponse.json(store);
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let clientStore: TriageStore;
  try {
    clientStore = (await req.json()) as TriageStore;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate minimal structure
  if (typeof clientStore !== 'object' || Array.isArray(clientStore)) {
    return NextResponse.json({ error: 'Invalid store format' }, { status: 400 });
  }

  const serverStore = await loadServerStore(userId);
  const merged = mergeStores(serverStore, clientStore);

  await saveServerStore(userId, merged);

  return NextResponse.json({ ok: true, contexts: Object.keys(merged).length });
}
