/* ============================================================
   #63 — Dynamic Travel Intel API
   Computes walk/transit/drive times from user's trip
   accommodation address to a place card.
   
   GET /api/travel-intel?placeId={id}&contextKey={key}
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../_lib/user';
import { getUserManifest } from '../../_lib/user-data';

export const dynamic = 'force-dynamic';

interface TravelMode {
  duration: string;
  distance: string;
  durationSecs: number;
}

interface TravelIntelResult {
  from: string;
  fromLabel: string;
  to: string;
  toAddress: string;
  modes: {
    walking?: TravelMode;
    transit?: TravelMode;
    driving?: TravelMode;
  };
  best: 'walking' | 'transit' | 'driving';
  bestReason: string;
}

/** Hardcoded accommodation addresses for trips (updated by chat/user) */
const TRIP_ACCOMMODATIONS: Record<string, { address: string; label: string }> = {
  'trip:nyc-april-2026': {
    address: '126 Leonard St, Brooklyn, NY 11211',
    label: "Arnold's, 126 Leonard St, Brooklyn",
  },
  'trip:cottage-july-2026': {
    address: 'Lake Huron, Ontario, Canada',
    label: 'Cottage, Lake Huron',
  },
};

function loadLocalManifest() {
  const p = path.join(process.cwd(), 'data', 'compass-manifest.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

async function getPlaceAddress(placeId: string): Promise<string | null> {
  const cardPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');
  if (!existsSync(cardPath)) return null;
  try {
    const card = JSON.parse(readFileSync(cardPath, 'utf8'));
    return card.identity?.address || null;
  } catch { return null; }
}

async function computeRoutes(
  origin: string,
  destination: string,
  apiKey: string,
): Promise<TravelIntelResult['modes']> {
  const modes: TravelIntelResult['modes'] = {};

  // Google Routes API (New) or Distance Matrix
  const baseUrl = 'https://maps.googleapis.com/maps/api/distancematrix/json';
  const travelModes: Array<'walking' | 'transit' | 'driving'> = ['walking', 'transit', 'driving'];

  for (const mode of travelModes) {
    try {
      const params = new URLSearchParams({
        origins: origin,
        destinations: destination,
        mode,
        key: apiKey,
      });

      const res = await fetch(`${baseUrl}?${params}`);
      if (!res.ok) continue;
      const data = await res.json() as {
        rows?: Array<{
          elements?: Array<{
            status?: string;
            duration?: { text: string; value: number };
            distance?: { text: string };
          }>;
        }>;
      };

      const element = data.rows?.[0]?.elements?.[0];
      if (element?.status === 'OK' && element.duration && element.distance) {
        modes[mode] = {
          duration: element.duration.text,
          distance: element.distance.text,
          durationSecs: element.duration.value,
        };
      }
    } catch { /* skip */ }
  }

  return modes;
}

function pickBest(modes: TravelIntelResult['modes']): { best: TravelIntelResult['best']; reason: string } {
  const { walking, transit, driving } = modes;

  // Under 15min walk → walk
  if (walking && walking.durationSecs < 900) {
    return { best: 'walking', reason: 'Close enough to walk' };
  }

  // Transit faster than driving by 5+ min → transit
  if (transit && driving && transit.durationSecs < driving.durationSecs - 300) {
    return { best: 'transit', reason: 'Fastest option' };
  }

  // Transit under 30min → transit
  if (transit && transit.durationSecs < 1800) {
    return { best: 'transit', reason: 'Quick transit ride' };
  }

  // Default to transit if available, else driving
  if (transit) return { best: 'transit', reason: 'Recommended' };
  if (driving) return { best: 'driving', reason: 'Best by car' };
  if (walking) return { best: 'walking', reason: 'Walking distance' };

  return { best: 'transit', reason: '' };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get('placeId');
  const contextKey = searchParams.get('contextKey');

  if (!placeId) {
    return NextResponse.json({ error: 'placeId required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || '';

  // Get destination address
  const toAddress = await getPlaceAddress(placeId);
  if (!toAddress) {
    return NextResponse.json({ error: 'Place address not found' }, { status: 404 });
  }

  // Get accommodation address from context
  let fromInfo = { address: '', label: '' };

  if (contextKey && TRIP_ACCOMMODATIONS[contextKey]) {
    fromInfo = TRIP_ACCOMMODATIONS[contextKey];
  } else if (contextKey) {
    // Try to get from user manifest
    try {
      const user = await getCurrentUser();
      if (user) {
        const manifest = await getUserManifest(user.id);
        const ctx = manifest?.contexts?.find(c => c.key === contextKey);
        if (ctx?.city) {
          fromInfo = { address: ctx.city, label: ctx.label };
        }
      }
    } catch { /* fallback */ }

    // Fallback to local manifest
    if (!fromInfo.address) {
      const local = loadLocalManifest();
      const ctx = local?.contexts?.find((c: { key: string }) => c.key === contextKey);
      if (ctx?.city) {
        fromInfo = { address: ctx.city, label: ctx.label || ctx.city };
      }
    }
  }

  if (!fromInfo.address) {
    return NextResponse.json({ error: 'No accommodation address for this trip' }, { status: 404 });
  }

  if (!apiKey) {
    // Return mock data when no API key
    return NextResponse.json({
      from: fromInfo.address,
      fromLabel: fromInfo.label,
      to: placeId,
      toAddress,
      modes: {
        transit: { duration: '25 min', distance: '2.5 mi', durationSecs: 1500 },
        walking: { duration: '44 min', distance: '2.0 mi', durationSecs: 2640 },
        driving: { duration: '13 min', distance: '2.2 mi', durationSecs: 780 },
      },
      best: 'transit' as const,
      bestReason: 'Fastest option',
      _mock: true,
    });
  }

  const modes = await computeRoutes(fromInfo.address, toAddress, apiKey);
  const { best, reason } = pickBest(modes);

  return NextResponse.json({
    from: fromInfo.address,
    fromLabel: fromInfo.label,
    to: placeId,
    toAddress,
    modes,
    best,
    bestReason: reason,
  } satisfies TravelIntelResult);
}
