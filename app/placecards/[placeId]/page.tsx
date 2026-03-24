import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '../../_lib/user';
import { getUserDiscoveries } from '../../_lib/user-data';
import { adaptCard } from '../../_lib/card-adapter';
import { resolveImageUrl } from '../../_lib/image-url';
import PlaceCardDetail from '../../_components/PlaceCardDetail';
import type { PlaceCard } from '../../_lib/types';

interface CottageEntry {
  id: string; name: string; platform?: string; url?: string;
  region?: string; pricePerWeek?: number | null; beds?: number;
  baths?: number; sleeps?: number; swimScore?: number;
  swimType?: string; swimVerdict?: string; amenities?: string[];
  images?: string[]; heroImage?: string; description?: string;
  notes?: string; guests?: number;
}

/** Build a PlaceCard from a cottage entry */
function adaptCottage(c: CottageEntry): PlaceCard {
  const highlights: string[] = [];
  if (c.beds) highlights.push(`${c.beds} bed${c.beds !== 1 ? 's' : ''}`);
  if (c.baths) highlights.push(`${c.baths} bath${c.baths !== 1 ? 's' : ''}`);
  if (c.sleeps) highlights.push(`Sleeps ${c.sleeps}`);
  if (c.swimType) highlights.push(c.swimType);
  if (c.amenities) highlights.push(...c.amenities.slice(0, 4));

  const images = (c.images || (c.heroImage ? [c.heroImage] : []))
    .map(img => ({ path: resolveImageUrl(img) || img, category: 'exterior' }));

  const price = c.pricePerWeek ? `$${c.pricePerWeek.toLocaleString()}/week` : null;
  const summary = [
    c.description || c.name,
    c.region ? `Located in ${c.region}.` : '',
    price ? `From ${price}.` : '',
    c.swimVerdict || '',
    c.url ? `Book at ${c.platform || 'listing site'}: ${c.url}` : '',
  ].filter(Boolean).join(' ');

  return {
    place_id: c.id,
    name: c.name,
    type: 'accommodation',
    data: {
      description: summary,
      highlights,
      images,
      address: c.region || 'Ontario',
      city: 'Ontario',
      website: c.url,
      price_level: c.pricePerWeek ? (c.pricePerWeek > 5000 ? 4 : c.pricePerWeek > 3000 ? 3 : 2) : undefined,
    },
  };
}

/** Look up a cottage by ID from data/cottages/index.json */
function findCottage(id: string): PlaceCard | null {
  const p = path.join(process.cwd(), 'data', 'cottages', 'index.json');
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
  const cardDir = path.join(process.cwd(), 'data', 'placecards', placeId);
  const cardPath = path.join(cardDir, 'card.json');

  let card: PlaceCard;

  if (existsSync(cardPath)) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(cardPath, 'utf8')) as Record<string, unknown>;
    } catch {
      notFound();
    }
    let manifest: Record<string, unknown> | undefined;
    const manifestPath = path.join(cardDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      } catch { /* ignore */ }
    }
    card = adaptCard(raw, manifest);
  } else {
    // Fallback: check cottage data
    const cottage = findCottage(placeId);
    if (!cottage) notFound();
    card = cottage;
  }
  const user = await getCurrentUser();

  // Determine context: URL param > first matching context from user's discoveries
  let contextKey = contextFromUrl;
  if (!contextKey && user) {
    const discData = await getUserDiscoveries(user.id);
    const match = discData?.discoveries?.find(d => d.place_id === placeId);
    if (match) contextKey = match.contextKey;
  }

  return (
    <PlaceCardDetail
      card={card}
      userId={user?.id}
      contextKey={contextKey}
    />
  );
}
