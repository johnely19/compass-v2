/* ============================================================
   Compass v2 — Overnight Genius Generate API
   POST /api/overnight-genius/generate
   Protected by token, generates overnight report for a user
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { generateOvernightReport } from '../../../_lib/overnight/generator';

const OVERNIGHT_GENIUS_TOKEN = process.env.OVERNIGHT_GENIUS_TOKEN ?? 'compass-overnight-2026';

interface GenerateRequest {
  userId: string;
  date?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Token auth
  const token = request.nextUrl.searchParams.get('token');
  if (token !== OVERNIGHT_GENIUS_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  if (!body.userId || typeof body.userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const report = await generateOvernightReport(body.userId, body.date);
    return NextResponse.json({ report });
  } catch (err) {
    console.error('[overnight-genius] Generate error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to generate report', details: message }, { status: 500 });
  }
}