/**
 * POST /api/internal/validate-discoveries?userId={id}
 *
 * Lightweight post-push validation triggered after Disco writes new discoveries.
 * Runs synchronously but fast — just city extraction + card stub creation.
 * Hero image fetching is skipped here (that's for the nightly cron).
 *
 * Auth: Bearer {BRIEFING_INGEST_TOKEN}
 */

import { NextRequest, NextResponse } from 'next/server';
import { list, put, del } from '@vercel/blob';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 30s limit — fast validation only

const VALID_TYPES = new Set([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 3] || parts[parts.length - 2];
    if (candidate && !/^\d/.test(candidate) && !/^(USA|Canada|ON|NY|QC|BC)$/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeCityForContext(city: string | null | undefined, contextKey: string | null | undefined): string | null {
  if (!contextKey || !city) return city ?? null;
  const key = contextKey.toLowerCase();
  if ((key.includes('nyc') || key.includes('new-york') || key.includes('brooklyn')) &&
      city.toLowerCase() === 'toronto') {
    return 'New York';
  }
  return city;
}

interface Discovery {
  id: string;
  name?: string;
  type?: string;
  place_id?: string;
  contextKey?: string;
  city?: string;
  address?: string;
  heroImage?: string | null;
  rating?: number | null;
}

export async function POST(request: NextRequest) {
  // Auth check
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.BRIEFING_INGEST_TOKEN || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = new URL(request.url).searchParams.get('userId') || 'john';

  try {
    // Load discoveries from Blob
    const { blobs } = await list({ prefix: `users/${userId}/discoveries`, limit: 1 });
    if (!blobs[0]) {
      return NextResponse.json({ ok: true, message: 'No discoveries found' });
    }

    const res = await fetch(blobs[0].url);
    if (!res.ok) return NextResponse.json({ error: 'Failed to fetch discoveries' }, { status: 500 });

    const raw = await res.json() as Discovery[] | { discoveries: Discovery[] };
    const discoveries: Discovery[] = Array.isArray(raw) ? raw : (raw.discoveries || []);

    const placesDir = path.join(process.cwd(), 'data', 'placecards');
    const indexFile = path.join(placesDir, 'index.json');
    let index: Record<string, { name: string; type: string }> = {};
    try {
      if (existsSync(indexFile)) {
        index = JSON.parse(readFileSync(indexFile, 'utf-8'));
      }
    } catch { /* use empty */ }

    let cityFixed = 0;
    let stubCreated = 0;
    let modified = false;

    for (const d of discoveries) {
      // Fix wrong city based on context
      const fixedCity = normalizeCityForContext(d.city, d.contextKey);
      if (fixedCity !== d.city) {
        d.city = fixedCity ?? undefined;
        modified = true;
        cityFixed++;
      }

      // Extract city from address if missing
      if (!d.city && d.address) {
        const extracted = extractCityFromAddress(d.address);
        if (extracted) {
          d.city = extracted;
          modified = true;
          cityFixed++;
        }
      }

      // Create card stub if missing
      if (d.place_id?.startsWith('ChIJ')) {
        const cardDir = path.join(placesDir, d.place_id);
        const cardFile = path.join(cardDir, 'card.json');
        if (!existsSync(cardFile)) {
          try {
            mkdirSync(cardDir, { recursive: true });
            const card = {
              place_id: d.place_id,
              name: d.name || '',
              type: VALID_TYPES.has(d.type || '') ? d.type : 'restaurant',
              address: d.address || null,
              city: d.city || null,
              rating: d.rating || null,
              stub: true,
            };
            writeFileSync(cardFile, JSON.stringify(card, null, 2) + '\n');
            index[d.place_id] = { name: d.name || '', type: card.type as string };
            stubCreated++;
          } catch { /* ignore fs errors in serverless */ }
        }
      }
    }

    // Write updated index if stubs were created
    if (stubCreated > 0) {
      try {
        writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
      } catch { /* ignore */ }
    }

    // Write patched discoveries back to Blob if changed
    if (modified) {
      const blobPath = `users/${userId}/discoveries.json`;
      const payload = Array.isArray(raw) ? discoveries : { ...raw, discoveries, updatedAt: new Date().toISOString() };
      const existing = blobs[0];
      if (existing) await del(existing.url);
      await put(blobPath, JSON.stringify(payload, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
    }

    console.log(`[validate-discoveries] ${userId}: cityFixed=${cityFixed} stubCreated=${stubCreated}`);
    return NextResponse.json({ ok: true, cityFixed, stubCreated, modified });

  } catch (err) {
    console.error('[validate-discoveries] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
