/**
 * GET /api/user/saved?contextKey=...
 *
 * Returns the user's saved places from saved.json (canonical store).
 * Optional contextKey filter returns only saves for that context.
 * Only returns active saves (unsavedAt is null).
 *
 * Issue #204: saved.json is the source of truth for what's saved.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';
import { getSavedPlaces, getActiveSaved, getSavedCountsByContext } from '../../../_lib/saved-places';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const contextKey = new URL(request.url).searchParams.get('contextKey') || undefined;
  const countsOnly = new URL(request.url).searchParams.get('counts') === 'true';

  try {
    const store = await getSavedPlaces(userId);

    if (countsOnly) {
      return NextResponse.json({ counts: getSavedCountsByContext(store) });
    }

    const active = getActiveSaved(store, contextKey);
    return NextResponse.json({
      saved: active,
      total: active.length,
      allTimeSaved: store.saved.length,
    });
  } catch (e) {
    console.error('[user/saved] Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
