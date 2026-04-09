import { notFound } from 'next/navigation';
import { getCurrentUser } from '../../_lib/user';
import { getDerivedUserDiscoveries } from '../../_lib/user-data';
import { adaptCard } from '../../_lib/card-adapter';
import { resolveImageUrl } from '../../_lib/image-url';
import { PlaceCardStore } from '../../_lib/place-card-store';
import PlaceCardDetail from '../../_components/PlaceCardDetail';
import AccommodationCard from '../../_components/AccommodationCard';
import type { PlaceCard, Discovery } from '../../_lib/types';

interface CottageEntry {
  id: string; name: string; platform?: string; url?: string;
  region?: string; pricePerWeek?: number | null; beds?: number;
  baths?: number; sleeps?: number; swimScore?: number;
  swimType?: string; swimVerdict?: string; amenities?: string[];
  images?: Array<string | { path: string; category: string }>;
  heroImage?: string; description?: string; notes?: string;
  guests?: number; scores?: Record<string, number>;
  driveTimes?: Record<string, { name?: string; minutes?: number }>;
  gates?: Record<string, boolean>; sourceTags?: string[];
  coordinates?: { lat: number; lng: number };
}

/** Build a PlaceCard from a cottage entry — passes through all cottage-specific fields */
function adaptCottage(c: CottageEntry): PlaceCard {
  const normalizedImages = (c.images || (c.heroImage ? [c.heroImage] : []))
    .map(img => {
      if (typeof img === 'string') {
        return { path: resolveImageUrl(img) || img, category: 'exterior' };
      }
      return { path: resolveImageUrl(img.path) || img.path, category: img.category || 'exterior' };
    });

  return {
    place_id: c.id,
    name: c.name,
    type: 'accommodation',
    data: {
      description: (c.description || c.notes || ''),
      highlights: [] as string[],
      images: normalizedImages,
      heroImage: c.heroImage ? resolveImageUrl(c.heroImage) || c.heroImage : undefined,
      // Pass through all cottage-specific fields for AccommodationCard
      name: c.name,
      address: c.region || 'Ontario',
      city: c.region || 'Ontario',
      region: c.region,
      platform: c.platform,
      url: c.url,
      pricePerWeek: c.pricePerWeek,
      beds: c.beds,
      baths: c.baths,
      sleeps: c.sleeps,
      guests: c.guests,
      swimType: c.swimType,
      swimVerdict: c.swimVerdict,
      amenities: c.amenities,
      scores: c.scores,
      driveTimes: c.driveTimes,
      notes: c.notes,
      gates: c.gates,
      lat: c.coordinates?.lat,
      lng: c.coordinates?.lng,
      latitude: c.coordinates?.lat,
      longitude: c.coordinates?.lng,
    },
  };
}

/** Look up a cottage by ID from data/cottages/index.json */
async function findCottage(id: string): Promise<PlaceCard | null> {
  const { readFileSync, existsSync } = await import('fs');
  const { join } = await import('path');
  const p = join(process.cwd(), 'data', 'cottages', 'index.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as { cottages: CottageEntry[] };
    const cottage = data.cottages.find(c => c.id === id);
    if (!cottage) return null;
    return adaptCottage(cottage);
  } catch { return null; }
}

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ placeId: string }>;
  searchParams: Promise<{ context?: string }>;
}

export default async function PlaceCardPage({ params, searchParams }: PageProps) {
  const { placeId } = await params;
  const { context: contextFromUrl } = await searchParams;

  let card: PlaceCard | null = null;

  // Try PlaceCardStore (Blob with local fallback)
  const raw = await PlaceCardStore.getCard(placeId);

  if (raw) {
    const manifest = await PlaceCardStore.getManifest(placeId) ?? undefined;
    card = adaptCard(raw, manifest);
  } else {
    // Fallback 1: check cottage data
    const cottage = await findCottage(placeId);
    if (cottage) {
      card = cottage;
    } else {
      // Fallback 2: synthesize card from user's discovery data (Google Place IDs without card.json)
      const user = await getCurrentUser();
      let contextKey = contextFromUrl;
      if (user) {
        const discData = await getDerivedUserDiscoveries(user.id);
        const match = discData?.discoveries?.find(
          d => d.place_id === placeId || d.id === placeId
        );
        if (!match) notFound();
        if (!contextKey) contextKey = match.contextKey;

        // Build a PlaceCard from discovery data — pass all known fields
        const disc = match as unknown as Record<string, unknown>;
        const synCard: PlaceCard = {
          place_id: (match.place_id || placeId) as string,
          name: match.name,
          type: match.type,
          data: {
            name: match.name,
            description: (disc.summary as string) || `${match.name} — discovered via ${match.source || 'Compass'}. ${match.address || ''}`.trim(),
            highlights: [],
            images: match.heroImage ? [{ path: match.heroImage, category: 'general' }] : [],
            address: match.address,
            city: (disc.city as string) || match.city,
            rating: match.rating,
            // Accommodation-specific fields
            heroImage: match.heroImage,
            region: (disc.address as string) || match.address,
            pricePerWeek: disc.price_per_week,
            price_per_week: disc.price_per_week,
            bedrooms: disc.bedrooms,
            beds: disc.bedrooms,
            sleeps: disc.max_guests,
            max_guests: disc.max_guests,
            swimType: disc.swim_quality,
            swim_quality: disc.swim_quality,
            water_body: disc.water_body,
            amenities: disc.amenities,
            drive_from_toronto: disc.drive_from_toronto,
            july_available: disc.july_available,
            match_score: disc.match_score,
            listing_url: disc.listing_url,
            nearest_grocery: disc.nearest_grocery,
            nearest_town: disc.nearest_town,
            setting_tags: disc.setting_tags,
            notes: disc.note || disc.notes,
          },
        };

        if (synCard.type === 'accommodation') {
          return (
            <AccommodationCard
              data={synCard.data as Record<string, unknown> & { name?: string }}
              placeId={synCard.place_id || ''}
              userId={user.id}
              contextKey={contextKey}
              discovery={match}
            />
          );
        }
        return (
          <PlaceCardDetail
            card={synCard}
            userId={user.id}
            contextKey={contextKey}
            discovery={match}
          />
        );
      }
      notFound();
    }
  }

  const user = await getCurrentUser();

  // Determine context: URL param > first matching context from user's discoveries
  let contextKey = contextFromUrl;
  let discoveryData: Partial<Discovery> | undefined;
  if (user) {
    const discData = await getDerivedUserDiscoveries(user.id);
    const match = discData?.discoveries?.find(d => d.place_id === placeId);
    if (match) {
      if (!contextKey) contextKey = match.contextKey;
      discoveryData = match;
    }
  }

  // Accommodation type gets the dedicated rental card UI
  if (card?.type === 'accommodation') {
    return (
      <AccommodationCard
        data={card.data as Record<string, unknown> & { name?: string }}
        placeId={card.place_id || ''}
        userId={user?.id}
        contextKey={contextKey}
        discovery={discoveryData}
      />
    );
  }

  return (
    <PlaceCardDetail
      card={card}
      userId={user?.id}
      contextKey={contextKey}
      discovery={discoveryData}
    />
  );
}
