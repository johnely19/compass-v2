import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getEffectiveUserManifest } from '../../_lib/effective-user-data';
import { isContextActive } from '../../_lib/context-lifecycle';

/**
 * GET /api/contexts
 * Returns the active contexts for the current user.
 * Used by the chat widget to detect newly created contexts after a chat turn.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const manifest = await getEffectiveUserManifest(user.id);
  const contexts = (manifest?.contexts ?? []).filter(isContextActive);

  return NextResponse.json({
    contexts,
    updatedAt: manifest?.updatedAt ?? '',
  });
}
