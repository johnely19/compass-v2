/**
 * Internal API for pushing discoveries from Disco / Charlie agents.
 * Secured by API key — no cookie auth required.
 *
 * POST /api/internal/discoveries
 * Headers: Authorization: Bearer <INTERNAL_API_KEY>
 * Body: { userId: string, discoveries: Discovery[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { mergeAndWriteDiscoveries } from '../../../_lib/discovery-write';

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

  // Merge-only write — never overwrites existing discoveries (#204)
  let result;
  try {
    result = await mergeAndWriteDiscoveries(userId, incoming as unknown[]);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 409 });
  }

  if (result.added === 0 && result.upgraded === 0) {
    return NextResponse.json({ added: 0, total: result.merged.length, message: 'All duplicates' });
  }

  console.log(`[internal/discoveries] Added ${result.added} discoveries for ${userId}`);

  // Fire-and-forget: trigger post-push validation to backfill stubs/cities
  // Uses the internal validate endpoint (non-blocking)
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || 'https://compass-v2-lake.vercel.app';
  fetch(`${baseUrl}/api/internal/validate-discoveries?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BRIEFING_INGEST_TOKEN || ''}` },
  }).catch(() => {}); // fire-and-forget — never block the response

  return NextResponse.json({ added: result.added, upgraded: result.upgraded, total: result.merged.length });
}
