import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import { getUserByCode, COOKIE_NAME } from '../../_lib/user';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const user = getUserByCode(code);
  const searchParams = request.nextUrl.searchParams;
  const reset = searchParams.get('reset') === 'true';

  if (!user) {
    return new Response('Invalid invite code', { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, user.id, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });

  if (reset) {
    redirect(`/reset-local?redirect=/onboarding`);
  } else if (user.isOwner) {
    redirect('/');
  } else {
    redirect('/onboarding');
  }
}