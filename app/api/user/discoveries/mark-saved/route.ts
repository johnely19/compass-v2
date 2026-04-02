/**
 * POST /api/user/discoveries/mark-saved
 * Body: { discoveryId: string }
 *
 * Sets the savedAt timestamp on a discovery, marking it as permanently saved.
 * Called fire-and-forget from the triage system when a user saves a place.
 * Issue #204: Saved discoveries are immutable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../../_lib/user';
import { markDiscoverySaved } from '../../../../_lib/discovery-write';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: { discoveryId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.discoveryId) {
    return NextResponse.json({ error: 'discoveryId required' }, { status: 400 });
  }

  try {
    await markDiscoverySaved(userId, body.discoveryId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[mark-saved] Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
