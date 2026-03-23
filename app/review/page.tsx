import { getCurrentUser } from '../_lib/user';
import { getUserManifest } from '../_lib/user-data';
import ReviewHubClient from '../_components/ReviewHubClient';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>Review</h1>
          <p className="text-muted">Sign in to manage your discoveries.</p>
        </div>
      </main>
    );
  }

  const manifest = await getUserManifest(user.id);
  const contexts = (manifest?.contexts ?? []).filter(c => c.active);

  return <ReviewHubClient userId={user.id} contexts={contexts} />;
}
