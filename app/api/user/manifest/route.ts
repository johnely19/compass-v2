/**
 * GET /api/user/manifest
 * Returns the current user's manifest (contexts).
 * Used by the smoke test and any client that needs the manifest directly.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserManifest } from '../../../_lib/user-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    // Return auth signal rather than 401 so smoke tests can detect and skip
    return NextResponse.json({ _auth: true }, { status: 200 });
  }

  const manifest = await getUserManifest(user.id);
  if (!manifest) {
    return NextResponse.json({ contexts: [], updatedAt: '' });
  }

  return NextResponse.json(manifest);
}
