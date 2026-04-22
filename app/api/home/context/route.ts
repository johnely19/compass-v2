import { NextRequest, NextResponse } from 'next/server';
import { getHomepageContextData } from '../../../_lib/homepage-data';
import { getCurrentUser } from '../../../_lib/user';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contextKey = request.nextUrl.searchParams.get('key');
  if (!contextKey) {
    return NextResponse.json({ error: 'Missing context key' }, { status: 400 });
  }

  const data = await getHomepageContextData(user.id, contextKey);
  if (!data) {
    return NextResponse.json({ error: 'Context not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
