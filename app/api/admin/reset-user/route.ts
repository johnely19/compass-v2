/* ============================================================
   Admin API — Reset User
   Deletes all Blob data for a specific user
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { list, del } from '@vercel/blob';
import { getCurrentUser, getUserById } from '../../../_lib/user';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser || !currentUser.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  const targetUser = getUserById(userId);
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (targetUser.isOwner) {
    return NextResponse.json({ error: 'Cannot reset owner user' }, { status: 403 });
  }

  // List all blobs with prefix 'users/{userId}/'
  const prefix = `users/${userId}/`;
  const { blobs } = await list({ prefix });

  // Delete each blob
  const deleted: string[] = [];
  for (const blob of blobs) {
    await del(blob.url);
    // Extract filename from URL for reporting
    const pathParts = blob.url.split('/');
    deleted.push(pathParts[pathParts.length - 1] || blob.url);
  }

  return NextResponse.json({ ok: true, deleted });
}
