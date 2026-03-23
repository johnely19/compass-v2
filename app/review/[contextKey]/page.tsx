import { getCurrentUser } from '../../_lib/user';
import { getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import ReviewContextClient from '../../_components/ReviewContextClient';

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

  const context = manifest?.contexts.find(c => c.key === contextKey);
  const discoveries = (discoveriesData?.discoveries ?? []).filter(
    d => d.contextKey === contextKey,
  );

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
