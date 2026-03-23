/* ============================================================
   Admin Page — Server Component
   Owner-only access
   ============================================================ */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '../_lib/user';
import AdminClient from './AdminClient';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || !user.isOwner) {
    redirect('/');
  }

  return <AdminClient />;
}
