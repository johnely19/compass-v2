/* ============================================================
   #173 — GeoJSON endpoint for interactive maps
   GET /api/maps/geojson?contextKey={key}
   
   Returns a GeoJSON FeatureCollection of all discoveries with
   coordinates for the given context. Use with geojson.io or
   any GeoJSON-compatible viewer.
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserDiscoveries } from '../../../_lib/user-data';
import type { Discovery } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function getCoords(d: Discovery): { lat: number; lng: number } | null {
  const lat = d.lat ?? (d as unknown as Record<string, unknown>).latitude as number | undefined;
  const lng = d.lng ?? (d as unknown as Record<string, unknown>).longitude as number | undefined;
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) return { lat, lng };
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contextKey = searchParams.get('contextKey');

  if (!contextKey) {
    return NextResponse.json({ error: 'contextKey query parameter required' }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discoveriesData = await getUserDiscoveries(user.id);
  const discoveries = (discoveriesData?.discoveries || []).filter(d => {
    if (d.contextKey === contextKey) return true;
    // Fuzzy match on slug portion
    const dSlug = d.contextKey.split(':').slice(1).join(':');
    const ctxSlug = contextKey.split(':').slice(1).join(':');
    return dSlug === ctxSlug || dSlug.includes(ctxSlug) || ctxSlug.includes(dSlug);
  });

  const mappable = discoveries.filter(d => getCoords(d) !== null);

  const geojson = {
    type: 'FeatureCollection' as const,
    features: mappable.map((d, i) => {
      const c = getCoords(d)!;
      const label = LABELS[i] || String(i + 1);
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [c.lng, c.lat],
        },
        properties: {
          name: `${label} ${d.name}`,
          description: [d.address, d.description].filter(Boolean).join(' — '),
          'marker-symbol': String(i + 1),
          'marker-color': '#e74c3c',
          type: d.type,
          address: d.address || '',
          city: d.city || '',
          contextKey: d.contextKey,
        },
      };
    }),
  };

  return NextResponse.json(geojson, {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
