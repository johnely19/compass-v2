import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '../../_lib/user';
import { getUserDiscoveries } from '../../_lib/user-data';
import { adaptCard } from '../../_lib/card-adapter';
import PlaceCardDetail from '../../_components/PlaceCardDetail';

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

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(cardPath, 'utf8')) as Record<string, unknown>;
  } catch {
    notFound();
  }

  // Load manifest for image data
  let manifest: Record<string, unknown> | undefined;
  const manifestPath = path.join(cardDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  const card = adaptCard(raw, manifest);
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
