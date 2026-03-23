import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import { sendChatMessage } from '../../_lib/chat/anthropic-client';
import { persistChatData, getChatHistory } from '../../_lib/chat/persistence';
import type { ChatMessage, UserPreferences, UserManifest, Discovery } from '../../_lib/types';

interface ChatContext {
  userCode: string;
  userCity: string;
  preferences: UserPreferences | null;
  manifest: UserManifest | null;
  recentDiscoveries: Array<{ name: string; type: string; city: string }>;
}

export async function POST(request: NextRequest) {
  try {
    // Get current user from cookie
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { message, history: clientHistory } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Load user data from blob
    const profile = await getUserProfile(user.id);
    const preferences = await getUserPreferences(user.id);
    const manifest = await getUserManifest(user.id);
    const discoveries = await getUserDiscoveries(user.id);

    // Build chat context for system prompt
    const recentDiscoveries = (discoveries?.discoveries || [])
      .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, 5)
      .map((d: Discovery) => ({ name: d.name, type: d.type, city: d.city }));

    const context: ChatContext = {
      userCode: user.code,
      userCity: profile?.city || user.city || '',
      preferences,
      manifest,
      recentDiscoveries,
    };

    // Get chat history from blob if not provided by client
    const history = clientHistory || (await getChatHistory(user.id));

    // Send message to Claude
    const { reply, messageId } = await sendChatMessage(
      {
        message,
        userId: user.id,
        userCode: user.code,
        history,
      },
      context,
    );

    // Persist chat (fire-and-forget with timeout)
    persistChatData(user.id, message, reply, messageId, history).catch(() => {});

    return NextResponse.json({ reply, messageId });
  } catch (err) {
    console.error('[api/chat]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      reply: "Something went sideways — try again in a sec! 🔄",
      messageId: `${Date.now()}-concierge`,
    });
  }
}
