import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      code: user.code,
      city: user.city,
      isOwner: user.isOwner,
    },
  });
}
