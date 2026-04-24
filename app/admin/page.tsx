/* ============================================================
   Admin Page — Server Component
   Owner-only access
   ============================================================ */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '../_lib/user';
import { getAdminAgentsData } from '../api/admin/agents/route';
import { getAdminCronsData } from '../api/admin/crons/route';
import { getAdminDiscoData } from '../api/admin/disco/route';
import { getAdminTokensData } from '../api/admin/tokens/route';
import { getAdminUsersData } from '../api/admin/users/route';
import AdminClient, { type AdminPageData } from './AdminClient';

export const dynamic = 'force-dynamic';

async function loadInitialAdminData(): Promise<AdminPageData | null> {
  try {
    const [agentsData, cronsData, tokenData, usersData, discoData] = await Promise.all([
      getAdminAgentsData(),
      getAdminCronsData(),
      getAdminTokensData(),
      getAdminUsersData(),
      getAdminDiscoData(),
    ]);

    return {
      agents: agentsData.agents || [],
      stats: agentsData.stats || null,
      crons: cronsData.jobs || [],
      tokenData: tokenData || null,
      users: usersData.users || [],
      discoActivity: discoData || null,
      workers: agentsData.workers || [],
    };
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || !user.isOwner) {
    redirect('/');
  }

  const initialData = await loadInitialAdminData();

  return <AdminClient initialData={initialData ?? undefined} />;
}
