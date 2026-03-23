/* ============================================================
   Compass v2 — Briefing Ingest API
   POST /api/briefing-ingest
   Receives morning briefings from Charlie and stores in Blob
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { put, list, del } from '@vercel/blob';

interface BriefingPayload {
  userId: string;
  title?: string;
  summary: string;
  highlights?: BriefingHighlight[];
  deliveredAt?: string;
}

interface BriefingHighlight {
  label: string;
  count?: number;
  contextKey?: string;
  emoji?: string;
}

interface StoredBriefing {
  userId: string;
  title: string;
  summary: string;
  highlights: BriefingHighlight[];
  deliveredAt: string;
  ingestedAt: string;
}

const BRIEFING_TOKEN = process.env.BRIEFING_INGEST_TOKEN ?? 'compass-briefing-2026';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Token auth
  const token = request.nextUrl.searchParams.get('token');
  if (token !== BRIEFING_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: BriefingPayload;
  try {
    body = (await request.json()) as BriefingPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  if (!body.userId || typeof body.userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!body.summary || typeof body.summary !== 'string') {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const briefing: StoredBriefing = {
    userId: body.userId,
    title: body.title ?? 'Morning Briefing',
    summary: body.summary,
    highlights: body.highlights ?? [],
    deliveredAt: body.deliveredAt ?? now,
    ingestedAt: now,
  };

  // Store in Blob: briefings/{userId}/latest.json
  const blobPath = `briefings/${body.userId}/latest.json`;

  // Delete existing
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const existing = blobs[0];
    if (existing) {
      await del(existing.url);
    }
  } catch {
    // Ignore delete errors
  }

  await put(blobPath, JSON.stringify(briefing, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return NextResponse.json({
    ok: true,
    briefing: {
      userId: briefing.userId,
      title: briefing.title,
      ingestedAt: briefing.ingestedAt,
      highlightCount: briefing.highlights.length,
    },
  });
}

// GET: Retrieve latest briefing for a user
export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = request.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }

  const blobPath = `briefings/${userId}/latest.json`;

  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    const blob = blobs[0];
    if (!blob) {
      return NextResponse.json({ briefing: null });
    }

    const res = await fetch(blob.url);
    if (!res.ok) {
      return NextResponse.json({ briefing: null });
    }

    const briefing = (await res.json()) as StoredBriefing;

    // Only return briefings from today (within 24h)
    const age = Date.now() - new Date(briefing.ingestedAt).getTime();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

    if (age > MAX_AGE) {
      return NextResponse.json({ briefing: null, stale: true });
    }

    return NextResponse.json({ briefing });
  } catch {
    return NextResponse.json({ briefing: null });
  }
}
