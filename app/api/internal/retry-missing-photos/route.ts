/**
 * GET /api/internal/retry-missing-photos
 * Scans all user discoveries for missing heroImage where place_id exists.
 * Calls fetch-photo for each (with 200ms delay between to avoid rate limits).
 * Returns summary of what was fixed.
 *
 * Query params: ?userId=xxx&dryRun=true
 */
import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import type { Discovery } from '../../../_lib/types';
import { recordDiscoveryHistoryEvent } from '../../../_lib/discovery-history';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'john';
  const dryRun = searchParams.get('dryRun') === 'true';

  // Load all user discoveries
  const { blobs } = await list({ prefix: `users/${userId}/discoveries` });
  if (blobs.length === 0) {
    return NextResponse.json({ error: 'No discoveries found' }, { status: 404 });
  }

  const matchedBlob = blobs.find(b => b.pathname === `users/${userId}/discoveries.json`) ?? blobs[0];
  const blobUrl = matchedBlob!.url;
  const res = await fetch(blobUrl);
  const raw = await res.json();
  const discoveries: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.discoveries || [];
  const previousDiscoveries = discoveries.map((d) => ({ ...d })) as unknown as Discovery[];

  // Find candidates missing heroImage but have place_id
  const candidates = discoveries.filter(d => d.place_id && !d.heroImage);

  const results = {
    total: discoveries.length,
    missing: candidates.length,
    fixed: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const d of candidates) {
    const placeId = d.place_id as string;

    try {
      if (dryRun) {
        results.fixed++;
      } else {
        const fetchRes = await fetch(new URL(req.url).origin + '/api/internal/fetch-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placeId }),
        });

        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.photoUrl) {
            d.heroImage = data.photoUrl;
            results.fixed++;
          } else {
            results.failed++;
            results.errors.push(`${d.name}: no photo URL returned`);
          }
        } else {
          results.failed++;
          results.errors.push(`${d.name}: fetch-photo failed ${fetchRes.status}`);
        }
      }
    } catch (e: unknown) {
      results.failed++;
      results.errors.push(`${d.name}: ${(e as Error).message}`);
    }

    // 200ms delay between requests to avoid rate limits
    if (!dryRun) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Save back to blob if not dry run and we fixed something
  if (!dryRun && results.fixed > 0) {
    const { blobs: toDelete } = await list({ prefix: `users/${userId}/discoveries` });
    for (const b of toDelete) {
      await fetch(b.url, { method: 'DELETE' }).catch(() => {});
    }

    const { put } = await import('@vercel/blob');
    await put(`users/${userId}/discoveries.json`, JSON.stringify(discoveries), {
      access: 'public',
      addRandomSuffix: false,
    });

    try {
      await recordDiscoveryHistoryEvent({
        userId,
        source: 'api/internal/retry-missing-photos',
        previous: previousDiscoveries,
        next: discoveries as unknown as Discovery[],
      });
    } catch {
      // best-effort history only
    }
  }

  return NextResponse.json({
    ...results,
    dryRun,
    coverage: `${discoveries.filter((d: Record<string, unknown>) => d.heroImage).length}/${discoveries.length}`,
  });
}
