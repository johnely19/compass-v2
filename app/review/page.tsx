import { getCurrentUser } from '../_lib/user';
import { getUserManifest } from '../_lib/user-data';
import { getContextStatus } from '../_lib/context-lifecycle';
import ReviewHubClient from '../_components/ReviewHubClient';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Review</h1>
          <p className="text-muted"><a href="/u/join" style={{textDecoration: 'underline', color: 'inherit'}}>Sign in</a> to manage your discoveries.</p>
        </div>
      </main>
    );
  }

  const manifest = await getUserManifest(user.id);
  const allContexts = manifest?.contexts ?? [];

  // Active + completed contexts shown in main section
  const activeContexts = allContexts.filter(c => {
    const status = getContextStatus(c);
    return status === 'active' || status === 'completed';
  });

  // Archived contexts shown in separate section
  const archivedContexts = allContexts.filter(c => {
    const status = getContextStatus(c);
    return status === 'archived';
  });

  return (
    <ReviewHubClient
      userId={user.id}
      contexts={activeContexts}
      archivedContexts={archivedContexts}
    />
  );
}
