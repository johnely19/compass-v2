/**
 * POST /api/user/discoveries/mark-saved
 * Body: { discoveryId: string, contextKey?: string }
 *
 * 1. Sets savedAt timestamp on the discovery in discoveries.json
 * 2. Copies the full discovery record to saved.json (append-only)
 *
 * Called fire-and-forget from the triage system when a user saves a place.
 * Issue #204: Saved discoveries are immutable — write-through to saved.json.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../../_lib/user';
import { markDiscoverySaved, readRawDiscoveries } from '../../../../_lib/discovery-write';
import { savePlaceToSaved, discoveryToSavedPlace } from '../../../../_lib/saved-places';
import type { Discovery } from '../../../../_lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: { discoveryId?: string; contextKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.discoveryId) {
    return NextResponse.json({ error: 'discoveryId required' }, { status: 400 });
  }

  try {
    // 1. Mark savedAt in discoveries.json
    await markDiscoverySaved(userId, body.discoveryId);

    // 2. Write-through to saved.json (append-only)
    const allDiscoveries = await readRawDiscoveries(userId);
    const discovery = allDiscoveries.find(
      d => (d as Record<string, unknown>).id === body.discoveryId,
    ) as Discovery | undefined;

    if (discovery) {
      const savedPlace = discoveryToSavedPlace(discovery, 'triage:save');
      await savePlaceToSaved(userId, savedPlace);
    } else {
      console.warn(`[mark-saved] Discovery ${body.discoveryId} not found in discoveries.json for ${userId} — saved.json not updated`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[mark-saved] Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
