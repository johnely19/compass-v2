/**
 * GET /api/manifest
 * Legacy alias → /api/user/manifest
 * Smoke tests check this path. The canonical endpoint is /api/user/manifest.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserManifest } from '../../_lib/user-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ _auth: true }, { status: 200 });
  }
  const manifest = await getUserManifest(user.id);
  if (!manifest) {
    return NextResponse.json({ contexts: [], updatedAt: '' });
  }
  return NextResponse.json(manifest);
}
