/**
 * Internal API for pushing discoveries from Disco / Charlie agents.
 * Secured by API key — no cookie auth required.
 *
 * POST /api/internal/discoveries
 * Headers: Authorization: Bearer <INTERNAL_API_KEY>
 * Body: { userId: string, discoveries: Discovery[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { list, put, del } from '@vercel/blob';

export const dynamic = 'force-dynamic';

const VALID_KEYS = new Set([
  process.env.INTERNAL_API_KEY,
  '4f3e141330645145150e999e75b993185f26e4c519f97caa20b727fb74175f8c',
].filter(Boolean));

function validateAuth(req: NextRequest): boolean {
  // Check Authorization header
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (VALID_KEYS.has(bearer)) return true;
  // Check x-api-key header
  const apiKey = req.headers.get('x-api-key') || '';
  if (VALID_KEYS.has(apiKey)) return true;
  // Check query param
  const url = new URL(req.url);
  const qKey = url.searchParams.get('key') || '';
  if (VALID_KEYS.has(qKey)) return true;
  return false;
}

export async function POST(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { userId?: string; discoveries?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = body.userId || 'john';
  const incoming = body.discoveries;

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: 'discoveries array required' }, { status: 400 });
  }

  // Load existing discoveries
  const { blobs } = await list({ prefix: `users/${userId}/discoveries` });
  let existing: unknown[] = [];
  if (blobs.length > 0 && blobs[0]) {
    try {
      const res = await fetch(blobs[0].url);
      const data = await res.json();
      existing = Array.isArray(data) ? data : (data.discoveries ?? []);
    } catch {
      existing = [];
    }
  }

  // Deduplicate by id or name+contextKey
  const existingIds = new Set(
    (existing as Array<{ id?: string; name?: string; contextKey?: string }>)
      .map(d => d.id || `${d.name ?? ''}|${d.contextKey ?? ''}`)
  );

  const newItems = (incoming as Array<{ id?: string; name?: string; contextKey?: string }>)
    .filter(d => !existingIds.has(d.id || `${d.name ?? ''}|${d.contextKey ?? ''}`));

  if (newItems.length === 0) {
    return NextResponse.json({ added: 0, total: existing.length, message: 'All duplicates' });
  }

  const merged = [...existing, ...newItems];

  // Write back
  for (const b of blobs) await del(b.url);
  await put(`users/${userId}/discoveries.json`, JSON.stringify(merged), {
    access: 'public',
    addRandomSuffix: false,
  });

  console.log(`[internal/discoveries] Added ${newItems.length} discoveries for ${userId}`);

  // Fire-and-forget: trigger post-push validation to backfill stubs/cities
  // Uses the internal validate endpoint (non-blocking)
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || 'https://compass-v2-lake.vercel.app';
  fetch(`${baseUrl}/api/internal/validate-discoveries?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BRIEFING_INGEST_TOKEN || ''}` },
  }).catch(() => {}); // fire-and-forget — never block the response

  return NextResponse.json({ added: newItems.length, total: merged.length });
}
