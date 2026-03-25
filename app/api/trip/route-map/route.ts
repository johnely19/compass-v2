/* ============================================================
   #84 — Trip Walking Route Map
   GET /api/trip/route-map?contextKey={key}
   
   Returns a Google Maps URL with all trip places as stops,
   sorted by neighborhood geography to minimize walking.
   No API key needed — uses maps.google.com/maps/dir/ format.
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../../_lib/user';
import { getUserManifest, getUserDiscoveries } from '../../../_lib/user-data';

export const dynamic = 'force-dynamic';

interface PlaceStop {
  name: string;
  address: string;
  type: string;
  lat?: number;
  lng?: number;
}

/** Load lat/lng from a place card if available */
function getPlaceCoords(placeId: string): { lat: number; lng: number } | null {
  try {
    const p = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const { lat, lng } = d.identity?.location || d.identity || {};
    if (lat && lng) return { lat, lng };
  } catch { /* ignore */ }
  return null;
}

/** NYC neighborhood geography: longitude ordering (west → east) */
const NEIGHBORHOOD_ORDER: Record<string, number> = {
  // Manhattan west → east
  'hell\'s kitchen': 0, 'west village': 1, 'chelsea': 2, 'meatpacking': 3,
  'greenwich village': 4, 'soho': 5, 'tribeca': 6, 'lower east side': 7,
  'east village': 8, 'midtown': 9, 'upper east side': 10, 'upper west side': 10,
  // Brooklyn west → east (more negative lng → more west)
  'williamsburg': 20, 'bushwick': 22, 'ridgewood': 24, 'bedford-stuyvesant': 23,
  'crown heights': 25, 'park slope': 21, 'brooklyn': 20,
};

function guessNeighborhoodOrder(address: string, city: string): number {
  const lower = (address + ' ' + city).toLowerCase();
  for (const [hood, order] of Object.entries(NEIGHBORHOOD_ORDER)) {
    if (lower.includes(hood)) return order;
  }
  // Default: Manhattan (lng ~-74.0) = 5, Brooklyn = 22
  if (lower.includes('brooklyn') || lower.includes('ny 112')) return 22;
  if (lower.includes('manhattan') || lower.includes('new york') || lower.includes('ny 100')) return 5;
  return 50; // unknown, put at end
}

/** Sort places geographically — cluster by neighborhood, minimize walking */
function sortPlacesByGeography(
  places: PlaceStop[],
  baseZone: string
): PlaceStop[] {
  // Assign geographic priority from zone hint or address
  const zoneHint = baseZone.toLowerCase();

  // Determine starting zone
  let startOrder = 20; // default Williamsburg
  if (zoneHint.includes('williamsburg')) startOrder = 20;
  else if (zoneHint.includes('manhattan')) startOrder = 5;
  else if (zoneHint.includes('bushwick')) startOrder = 22;

  return [...places].sort((a, b) => {
    // Sort by lat/lng if available (cluster by proximity)
    if (a.lat && b.lat && a.lng && b.lng) {
      // Sort by longitude (west → east in NYC/Brooklyn)
      const aLng = a.lng;
      const bLng = b.lng;
      // Start from base zone direction
      if (startOrder < 10) {
        // Manhattan start: go east
        return aLng - bLng;
      } else {
        // Brooklyn start: Williamsburg (most west) → east
        return aLng - bLng;
      }
    }
    // Fall back to neighborhood order
    const aOrder = guessNeighborhoodOrder(a.address, '');
    const bOrder = guessNeighborhoodOrder(b.address, '');
    return aOrder - bOrder;
  });
}

/** Build a Google Maps directions URL with waypoints */
function buildMapsUrl(origin: string, stops: PlaceStop[]): string {
  const base = 'https://www.google.com/maps/dir/';

  // Encode each stop as "Name+Address" or just address
  const encodeStop = (s: PlaceStop | string) => {
    const stop = typeof s === 'string' ? s : `${s.name}, ${s.address}`;
    return encodeURIComponent(stop);
  };

  // Max ~10 waypoints in the URL to keep it manageable
  const MAX_STOPS = 10;
  const selectedStops = stops.length > MAX_STOPS
    ? stops.filter((_, i) => i % Math.ceil(stops.length / MAX_STOPS) === 0).slice(0, MAX_STOPS)
    : stops;

  const parts = [encodeStop(origin), ...selectedStops.map(encodeStop)];
  return base + parts.join('/') + '/@?entry=ttu&mode=walking';
}

/** Build Google Maps embed URL (for iframe — no API key needed via embed link) */
function buildEmbedUrl(mapsUrl: string): string {
  // Google Maps embed link for directions — wrap the full URL
  // This uses the shareable format that works in iframes
  return mapsUrl.replace('https://www.google.com/maps/dir/', 'https://maps.google.com/maps?q=')
    .split('/')[0] || mapsUrl;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contextKey = searchParams.get('contextKey');

  if (!contextKey) {
    return NextResponse.json({ error: 'contextKey required' }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Load manifest to get accommodation address
  const manifest = await getUserManifest(user.id);

  // Check local manifest too
  let localCtx: Record<string, unknown> | null = null;
  try {
    const localPath = path.join(process.cwd(), 'data', 'compass-manifest.json');
    if (existsSync(localPath)) {
      const local = JSON.parse(readFileSync(localPath, 'utf8'));
      localCtx = local.contexts?.find((c: { key: string }) => c.key === contextKey) || null;
    }
  } catch { /* ignore */ }

  const blobCtx = manifest?.contexts?.find(c => c.key === contextKey) as Record<string, unknown> | undefined;
  const ctx = blobCtx || localCtx;

  if (!ctx) return NextResponse.json({ error: 'Context not found' }, { status: 404 });

  // Only trip contexts
  if (ctx.type !== 'trip') {
    return NextResponse.json({ error: 'Route map only available for trip contexts' }, { status: 400 });
  }

  // Get accommodation address
  const accommodation = ctx.accommodation as Record<string, unknown> | undefined;
  const base = ctx.base as Record<string, unknown> | undefined;
  const accommodationAddress = (base?.address as string) || (accommodation?.address as string);

  if (!accommodationAddress) {
    return NextResponse.json({ error: 'No accommodation address for this trip' }, { status: 404 });
  }

  // Load discoveries for this trip
  const discoveriesData = await getUserDiscoveries(user.id);
  const discoveries = (discoveriesData?.discoveries || []).filter(d => {
    if (d.contextKey !== contextKey) {
      // Fuzzy match
      const dSlug = d.contextKey.split(':').slice(1).join(':');
      const ctxSlug = contextKey.split(':').slice(1).join(':');
      return dSlug === ctxSlug || dSlug.includes(ctxSlug) || ctxSlug.includes(dSlug);
    }
    return true;
  });

  if (discoveries.length < 3) {
    return NextResponse.json({
      error: 'Not enough places for a route map',
      count: discoveries.length,
    }, { status: 404 });
  }

  // Build place stops with coordinates
  const baseZone = (base?.zone as string) || (ctx.city as string) || 'New York';

  const stops: PlaceStop[] = discoveries
    .filter(d => d.address || d.place_id)
    .map(d => {
      const coords = d.place_id ? getPlaceCoords(d.place_id) : null;
      return {
        name: d.name,
        address: d.address || d.city || '',
        type: d.type,
        ...(coords || {}),
      };
    });

  const sorted = sortPlacesByGeography(stops, baseZone);
  const mapsUrl = buildMapsUrl(accommodationAddress, sorted);

  return NextResponse.json({
    origin: accommodationAddress,
    originLabel: base?.host ? `${base.host as string}'s, ${accommodationAddress}` : accommodationAddress,
    mapsUrl,
    places: sorted.slice(0, 10), // return sample
    totalPlaces: sorted.length,
    zone: baseZone,
  });
}
