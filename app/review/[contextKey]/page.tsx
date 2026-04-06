import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../_lib/user';
import { getUserManifest, getDerivedUserDiscoveries } from '../../_lib/user-data';
import ReviewContextClient from '../../_components/ReviewContextClient';

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
    getDerivedUserDiscoveries(user.id),
  ]);

  // Fall back to shared compass-manifest.json ONLY for the owner user
  const sharedManifest = user?.isOwner ? loadSharedManifest() : null;
  const context = manifest?.contexts.find(c => c.key === contextKey)
    ?? sharedManifest?.contexts?.find((c: { key: string }) => c.key === contextKey);
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

  if (!context) {
    return (
      <main className="page">
        <p className="text-muted">Context not found.</p>
      </main>
    );
  }

  return (
    <ReviewContextClient
      userId={user.id}
      context={context}
      discoveries={discoveries}
    />
  );
}
