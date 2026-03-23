import { readFileSync } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import type { PlaceCard } from '../../_lib/types';
import { getCurrentUser } from '../../_lib/user';
import PlaceCardDetail from '../../_components/PlaceCardDetail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ placeId: string }>;
}

export default async function PlaceCardPage({ params }: PageProps) {
  const { placeId } = await params;
  const cardPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');

  let card: PlaceCard;
  try {
    const raw = readFileSync(cardPath, 'utf8');
    card = JSON.parse(raw) as PlaceCard;
  } catch {
    notFound();
  }

  const user = await getCurrentUser();

  return (
    <PlaceCardDetail
      card={card}
      userId={user?.id}
      contextKey={undefined}
    />
  );
}
