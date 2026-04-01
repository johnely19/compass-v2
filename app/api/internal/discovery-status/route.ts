/* ============================================================
   Discovery Status — Check if onboarding discoveries are ready
   GET /api/internal/discovery-status

   Returns the count and status of discoveries for the current user.
   Used by the frontend to poll for readiness after onboarding.
   ============================================================ */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserData } from '../../../_lib/user-data';
import type { UserDiscoveries, Discovery } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discoveries = await getUserData(user.id, 'discoveries') as UserDiscoveries | null;
  const items = discoveries?.discoveries || [];

  const aiGenerated = items.filter((d: Discovery) => d.source === 'onboarding:ai-discovery');
  const seeded = items.filter((d: Discovery) => d.source?.startsWith('seed:'));
  const verified = items.filter((d: Discovery) => d.placeIdStatus === 'verified');

  // Group by context
  const byContext: Record<string, number> = {};
  for (const d of items) {
    byContext[d.contextKey] = (byContext[d.contextKey] || 0) + 1;
  }

  return NextResponse.json({
    total: items.length,
    aiGenerated: aiGenerated.length,
    seeded: seeded.length,
    verified: verified.length,
    byContext,
    ready: items.length >= 3, // At least 3 discoveries = ready to show
  });
}
