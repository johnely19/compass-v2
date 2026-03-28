/**
 * POST /api/auth/token
 * Body: { code: string }   — user's invite code
 * Returns: { token: string, userId: string, name: string }
 *
 * Used by Charlie iOS to exchange an invite code for a JWT
 * stored in the iOS Keychain. Token is sent as:
 *   Authorization: Bearer {token}
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserByCode } from '../../../_lib/user';
import { signToken } from '../../../_lib/jwt';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : null;
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const user = getUserByCode(code);
  if (!user) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  const token = await signToken(user.id, user.code);

  return NextResponse.json({
    token,
    userId: user.id,
    name: user.name,
  });
}
