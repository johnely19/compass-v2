/* ============================================================
   Compass v2 — User Registry (filesystem)
   Reads from data/users.json
   ============================================================ */

import { readFileSync } from 'fs';
import path from 'path';
import { cookies, headers } from 'next/headers';
import type { User, UsersIndex } from './types';
import { verifyToken } from './jwt';

export const COOKIE_NAME = 'compass-user';

let usersCache: UsersIndex | null = null;

export function loadUsers(): UsersIndex {
  if (usersCache) return usersCache;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'data', 'users.json'), 'utf8');
    usersCache = JSON.parse(raw) as UsersIndex;
    return usersCache;
  } catch {
    return { users: {} };
  }
}

export function getUserById(userId: string): User | null {
  const { users } = loadUsers();
  return users[userId] ?? null;
}

export function getUserByCode(code: string): User | null {
  const { users } = loadUsers();
  return Object.values(users).find(u => u.code === code) ?? null;
}

export function getAllUsers(): User[] {
  const { users } = loadUsers();
  return Object.values(users);
}

/**
 * Get the current user from the cookie OR a Bearer JWT token.
 * Cookie auth: web app (Compass).
 * Bearer JWT auth: Charlie iOS app.
 */
export async function getCurrentUser(): Promise<User | null> {
  // 1. Try Bearer JWT (Charlie iOS)
  try {
    const headerStore = await headers();
    const auth = headerStore.get('authorization');
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      const payload = await verifyToken(token);
      if (payload?.sub) {
        return getUserById(payload.sub);
      }
    }
  } catch {
    // headers() may throw in some contexts — fall through to cookie
  }

  // 2. Try cookie (web app)
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return null;
  return getUserById(userId);
}
