/* ============================================================
   Admin API — Users
   Returns all users with their Blob data
   ============================================================ */

import { NextResponse } from 'next/server';
import { getCurrentUser, getAllUsers } from '../../../_lib/user';
import { getUserPreferences, getUserManifest, getUserDiscoveries } from '../../../_lib/user-data';
import type { UserPreferences, UserManifest, UserDiscoveries } from '../../../_lib/types';

interface UserWithData {
  id: string;
  name: string;
  code: string;
  city: string;
  isOwner: boolean;
  createdAt: string;
  preferences: UserPreferences | null;
  manifest: UserManifest | null;
  discoveries: UserDiscoveries | null;
}

export const dynamic = 'force-dynamic';

export async function getAdminUsersData() {
  const users = getAllUsers();
  const usersWithData: UserWithData[] = await Promise.all(
    users.map(async (user) => {
      const [preferences, manifest, discoveries] = await Promise.all([
        getUserPreferences(user.id),
        getUserManifest(user.id),
        getUserDiscoveries(user.id),
      ]);

      return {
        id: user.id,
        name: user.name,
        code: user.code,
        city: user.city,
        isOwner: user.isOwner,
        createdAt: user.createdAt,
        preferences,
        manifest,
        discoveries,
      };
    })
  );

  return { users: usersWithData };
}

export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(await getAdminUsersData());
}
