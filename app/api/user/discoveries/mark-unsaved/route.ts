/**
 * POST /api/user/discoveries/mark-unsaved
 * Body: { discoveryId: string, contextKey: string }
 *
 * Marks a place as unsaved in saved.json by setting unsavedAt timestamp.
 * DOES NOT remove from saved.json — preserves full save/unsave history.
 *
 * Issue #204: Unsave = set timestamp, never delete.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../../_lib/user';
import { unsavePlace } from '../../../../_lib/saved-places';

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

  if (!body.discoveryId || !body.contextKey) {
    return NextResponse.json({ error: 'discoveryId and contextKey required' }, { status: 400 });
  }

  try {
    const unsaved = await unsavePlace(userId, body.discoveryId, body.contextKey);
    return NextResponse.json({ ok: true, unsaved });
  } catch (e) {
    console.error('[mark-unsaved] Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
