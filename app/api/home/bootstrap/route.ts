import { NextRequest, NextResponse } from 'next/server';
import { getHomepageBootstrapData } from '../../../_lib/homepage-data';
import { getCurrentUser } from '../../../_lib/user';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contextKey = request.nextUrl.searchParams.get('key');
  const data = await getHomepageBootstrapData(user.id, contextKey);
  return NextResponse.json(data);
}
