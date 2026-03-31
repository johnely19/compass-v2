import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES } from '../_lib/discovery-types';
import { getCurrentUser } from '../_lib/user';
import { PlaceCardStore } from '../_lib/place-card-store';
import { getUserDiscoveries, getUserManifest } from '../_lib/user-data';
import PlacecardsBrowseClient from './PlacecardsBrowseClient';
import type { PlaceCardData } from './PlacecardsBrowseClient';

export const dynamic = 'force-dynamic';

interface CardData {
  identity?: { city?: string | null };
  narrative?: { summary?: string | null };
}

function extractRating(summary: string | null): number | null {
  if (!summary) return null;
  const match = summary.match(/(\d+\.?\d*)\s*★/);
  if (!match || !match[1]) return null;
  return parseFloat(match[1]);
}

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function PlacecardsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header"><h1>My Places</h1></div>
        <p className="text-muted">Sign in to see your places.</p>
      </main>
    );
  }

  const isOwner = user.isOwner ?? false;
  const params = await searchParams;
  const viewAll = isOwner && params?.view === 'all';

  if (viewAll) {
    // Admin: show global index
    const index = await PlaceCardStore.getIndex();
    const cards: PlaceCardData[] = await Promise.all(
      Object.entries(index).map(async ([placeId, entry]) => {
        const cardData = await PlaceCardStore.getCard(placeId) as CardData | null;
        const city = cardData?.identity?.city ?? '';
        const rating = extractRating(cardData?.narrative?.summary ?? null);
        return {
          placeId,
          name: (entry as { name: string }).name,
          type: (entry as { type: DiscoveryType }).type,
          city,
          rating,
          contextKey: '',
          heroImage: null,
        };
      })
    );
    const typeSet = new Set<DiscoveryType>(cards.map((c) => c.type));
    const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));
    return (
      <PlacecardsBrowseClient
        cards={cards}
        availableTypes={availableTypes}
        availableContexts={[]}
        contextLabels={{}}
        userId={user.id}
        isOwner={isOwner}
        adminViewAll={true}
      />
    );
  }

  // Normal: load user's discoveries and manifest (for context labels)
  const [discData, manifestData] = await Promise.all([
    getUserDiscoveries(user.id),
    getUserManifest(user.id),
  ]);

  const discoveries = discData?.discoveries ?? [];
  const contexts = manifestData?.contexts ?? [];

  // Build context label map
  const contextLabels: Record<string, string> = {};
  for (const ctx of contexts) {
    contextLabels[ctx.key] = `${ctx.emoji ?? ''} ${ctx.label}`.trim();
  }

  // Build card list from user's own discoveries
  const cards: PlaceCardData[] = discoveries.map((d) => ({
    placeId: d.place_id || d.id,
    name: d.name,
    type: d.type as DiscoveryType,
    city: d.city ?? '',
    rating: d.rating ?? null,
    contextKey: d.contextKey,
    heroImage: d.heroImage ?? null,
  }));

  // Deduplicate by placeId (keep first occurrence)
  const seen = new Set<string>();
  const uniqueCards = cards.filter((c) => {
    if (seen.has(c.placeId)) return false;
    seen.add(c.placeId);
    return true;
  });

  // Get available types from actual data
  const typeSet = new Set<DiscoveryType>(uniqueCards.map((c) => c.type));
  const availableTypes = ALL_TYPES.filter((t) => typeSet.has(t));

  // Available contexts (only those that appear in user's discoveries)
  const contextKeySet = new Set(uniqueCards.map((c) => c.contextKey));
  const availableContexts = contexts
    .filter((ctx) => contextKeySet.has(ctx.key))
    .map((ctx) => ({ key: ctx.key, label: `${ctx.emoji ?? ''} ${ctx.label}`.trim() }));

  return (
    <PlacecardsBrowseClient
      cards={uniqueCards}
      availableTypes={availableTypes}
      availableContexts={availableContexts}
      contextLabels={contextLabels}
      userId={user.id}
      isOwner={isOwner}
      adminViewAll={false}
    />
  );
}
