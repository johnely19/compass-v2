import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../_lib/user';
import { getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import ReviewContextClient from '../../_components/ReviewContextClient';
import TripPlanningWidget from '../../_components/TripPlanningWidget';

function loadSharedManifest() {
  try {
    const p = path.join(process.cwd(), 'data', 'compass-manifest.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ contextKey: string }>;
}

export default async function ReviewContextPage({ params }: Props) {
  const { contextKey: encodedKey } = await params;
  const contextKey = decodeURIComponent(encodedKey);
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <p className="text-muted"><a href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</a> to review.</p>
      </main>
    );
  }

  const [manifest, discoveriesData] = await Promise.all([
    getUserManifest(user.id),
    getUserDiscoveries(user.id),
  ]);

  // Fall back to shared compass-manifest.json ONLY for the owner user
  const sharedManifest = user?.isOwner ? loadSharedManifest() : null;
  const context = manifest?.contexts.find(c => c.key === contextKey)
    ?? sharedManifest?.contexts?.find((c: { key: string }) => c.key === contextKey);

  const raw = context as unknown as Record<string, unknown>;
  const isTrip = context?.type === 'trip';

  const discoveries = (discoveriesData?.discoveries ?? []).filter(d => {
    if (d.contextKey !== contextKey) return false;
    // Only show fully-built discoveries (must have name + address or description or rating)
    if (!d.name || d.name === 'Unknown Place') return false;
    const rec = d as unknown as Record<string, unknown>;
    const hasAddress = !!(rec.address as string);
    const hasDescription = !!(rec.description || rec.summary);
    const hasRating = d.rating != null && d.rating > 0;
    return hasAddress || hasDescription || hasRating;
  });

  const savedCount = discoveries.filter(d => d.state === 'saved').length;

  const contextMeta = isTrip ? {
    travel: raw.travel,
    accommodation: raw.accommodation,
    bookingStatus: raw.bookingStatus as string | undefined,
  } : undefined;

  if (!context) {
    return (
      <main className="page">
        <p className="text-muted">Context not found.</p>
      </main>
    );
  }

  return (
    <>
      {isTrip && (
        <TripPlanningWidget
          userId={user.id}
          contextKey={contextKey}
          travel={contextMeta?.travel as never}
          accommodation={contextMeta?.accommodation as never}
          bookingStatus={contextMeta?.bookingStatus}
          savedCount={savedCount}
          purpose={raw.purpose as string | undefined}
          people={raw.people as Array<{ name: string; relation?: string }> | undefined}
        />
      )}
      <ReviewContextClient
        userId={user.id}
        context={context}
        discoveries={discoveries}
      />
    </>
  );
}
