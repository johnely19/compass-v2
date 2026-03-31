/* ============================================================
   Compass v2 — Overnight Genius Latest API
   GET /api/overnight-genius/latest
   Authenticated via user cookie, returns latest report
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getLatestOvernightReport } from '../../../_lib/overnight/generator';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Authenticate user
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await getLatestOvernightReport(user.id);
    return NextResponse.json({ report });
  } catch (err) {
    console.error('[overnight-genius] Get latest error:', err);
    return NextResponse.json({ report: null });
  }
}