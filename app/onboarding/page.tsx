import { redirect } from 'next/navigation';
import { getCurrentUser } from '../_lib/user';
import { getUserManifest } from '../_lib/user-data';
import OnboardingClient from './OnboardingClient';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  if (!user) redirect('/u/join');
  if (user.isOwner) redirect('/'); // owner never sees onboarding

  // If user already has a manifest with contexts, redirect home
  const manifest = await getUserManifest(user.id);
  if (manifest?.contexts && manifest.contexts.length > 0) redirect('/');

  return <OnboardingClient userName={user.name} city={user.city} />;
}
