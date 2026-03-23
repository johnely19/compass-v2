/* ============================================================
   Compass v2 — User Registry (filesystem)
   Reads from data/users.json
   ============================================================ */

import { readFileSync } from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import type { User, UsersIndex } from './types';

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
 * Get the current user from the cookie. For use in server components and API routes.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const userId = cookieStore.get(COOKIE_NAME)?.value;
  if (!userId) return null;
  return getUserById(userId);
}
