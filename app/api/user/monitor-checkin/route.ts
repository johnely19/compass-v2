/**
 * POST /api/user/monitor-checkin
 *
 * Records that the user has manually checked a monitored discovery.
 * This resets the monitoring clock for that discovery so the cadence
 * restarts from now.
 *
 * Body: { discoveryKey: string; note?: string }
 * discoveryKey mirrors getDiscoveryHistoryKey format:
 *   "id:{id}" | "place:{placeId}:{contextKey}" | "name:{name}:{contextKey}"
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, getUserById } from '../../../_lib/user';
import { recordCheckin } from '../../../_lib/monitor-checkins';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let body: { discoveryKey?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { discoveryKey, note } = body;
  if (!discoveryKey || typeof discoveryKey !== 'string') {
    return NextResponse.json({ error: 'discoveryKey is required' }, { status: 400 });
  }

  const checkin = await recordCheckin({ userId, discoveryKey, note });
  return NextResponse.json({ ok: true, checkin });
}
