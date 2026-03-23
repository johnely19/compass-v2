import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getChatHistory } from '../../../_lib/chat/persistence';

export async function GET(request: NextRequest) {
  try {
    // Get current user from cookie
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const messages = await getChatHistory(user.id);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error('[api/chat/history]', err instanceof Error ? err.message : err);
    return NextResponse.json({ messages: [] });
  }
}
