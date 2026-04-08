import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserDiscoveries, setUserData } from '../../../_lib/user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../../_lib/types';

const VALID_DISCOVERY_TYPES: Set<string> = new Set([
  'restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum',
  'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park',
  'architecture', 'development', 'accommodation', 'neighbourhood',
]);

function isValidDiscoveryType(type: string): type is DiscoveryType {
  return VALID_DISCOVERY_TYPES.has(type);
}

/** Generate a short ID for the discovery */
function generateDiscoveryId(): string {
  return `dsc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { contextKey, discovery } = body;

    if (!contextKey || typeof contextKey !== 'string') {
      return NextResponse.json({ error: 'contextKey is required' }, { status: 400 });
    }

    if (!discovery || typeof discovery !== 'object') {
      return NextResponse.json({ error: 'discovery object is required' }, { status: 400 });
    }

    const { name, type, city, address, rating, place_id } = discovery as Record<string, unknown>;

    // Validate required discovery fields
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'discovery.name is required' }, { status: 400 });
    }
    if (!type || typeof type !== 'string') {
      return NextResponse.json({ error: 'discovery.type is required' }, { status: 400 });
    }
    if (!city || typeof city !== 'string') {
      return NextResponse.json({ error: 'discovery.city is required' }, { status: 400 });
    }

    if (!isValidDiscoveryType(type)) {
      return NextResponse.json(
        { error: `Invalid discovery type. Must be one of: ${Array.from(VALID_DISCOVERY_TYPES).join(', ')}` },
        { status: 400 },
      );
    }

    // Get existing discoveries
    const userDiscoveries = await getUserDiscoveries(user.id);
    const discoveries: Discovery[] = userDiscoveries?.discoveries || [];

    // Create new discovery
    const newDiscovery: Discovery = {
      id: generateDiscoveryId(),
      name,
      type,
      city,
      contextKey,
      source: 'chat:recommendation',
      discoveredAt: new Date().toISOString(),
      placeIdStatus: place_id ? 'verified' : 'missing',
      place_id: place_id as string | undefined,
      address: address as string | undefined,
      rating: typeof rating === 'number' ? rating : undefined,
    };

    // Save updated discoveries
    const updatedDiscoveries: UserDiscoveries = {
      discoveries: [...discoveries, newDiscovery],
      updatedAt: new Date().toISOString(),
    };

    await setUserData(user.id, 'discoveries', updatedDiscoveries);

    return NextResponse.json({
      added: true,
      discoveryId: newDiscovery.id,
    });
  } catch (err) {
    console.error('[api/compass/add-discovery]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}