import Link from 'next/link';
import { getCurrentUser } from './_lib/user';
import { getHomepageData, type HomepageContext } from './_lib/homepage-data';
import HomeClient from './_components/HomeClient';

export const dynamic = 'force-dynamic';

function sanitizeHomepageContexts(contexts: HomepageContext[]): HomepageContext[] {
  return contexts.map((context) => ({
    key: context.key,
    label: context.label,
    emoji: context.emoji,
    type: context.type,
    city: context.city,
    dates: context.dates,
    focus: [...context.focus],
    purpose: context.purpose,
    people: context.people?.map((person) => ({
      name: person.name,
      relation: person.relation,
    })),
  }));
}

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
  const contexts = sanitizeHomepageContexts(homepageData.contexts);

  if (!user.isOwner && contexts.length === 0) {
    const { redirect } = await import('next/navigation');
    redirect('/onboarding');
  }

  return (
    <HomeClient
      userId={user.id}
      contexts={contexts}
      initialContextKey={homepageData.initialContextKey}
    />
  );
}
