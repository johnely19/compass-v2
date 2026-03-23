import { readFileSync } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '../../_lib/user';
import { adaptCard } from '../../_lib/card-adapter';
import PlaceCardDetail from '../../_components/PlaceCardDetail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ placeId: string }>;
}

export default async function PlaceCardPage({ params }: PageProps) {
  const { placeId } = await params;
  const cardPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'card.json');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(cardPath, 'utf8')) as Record<string, unknown>;
  } catch {
    notFound();
  }

  const card = adaptCard(raw);
  const user = await getCurrentUser();

  return (
    <PlaceCardDetail
      card={card}
      userId={user?.id}
      contextKey={undefined}
    />
  );
}
