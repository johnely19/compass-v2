import Link from 'next/link';
import { getCurrentUser } from './_lib/user';
import { getHomepageData } from './_lib/homepage-data';
import HomeClient from './_components/HomeClient';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="page">
        <div className="page-header">
          <h1>🧭 Compass</h1>
          <p>Personal travel intelligence. <Link href="/u/join" style={{ textDecoration: 'underline', color: 'inherit' }}>Sign in</Link> to get started.</p>
        </div>
      </main>
    );
  }

  const homepageData = await getHomepageData(user.id);

  if (!user.isOwner && homepageData.contexts.length === 0) {
    const { redirect } = await import('next/navigation');
    redirect('/onboarding');
  }

  return (
    <HomeClient
      userId={user.id}
      contexts={homepageData.contexts}
      initialContextKey={homepageData.initialContextKey}
    />
  );
}
