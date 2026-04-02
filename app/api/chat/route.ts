import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import { persistChatData, getChatHistory } from '../../_lib/chat/persistence';
import { buildUserContext } from '../../_lib/chat/user-context';
import { sendChatMessage as sendAnthropicFallback } from '../../_lib/chat/anthropic-client';
import type { ChatMessage, Discovery } from '../../_lib/types';

const OPENCLAW_TIMEOUT_MS = 30_000;

interface OpenClawMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Call the OpenClaw Gateway, returning the assistant reply text.
 * Returns null if unreachable / timed out so the caller can fall back.
 */
async function callOpenClaw(
  messages: OpenClawMessage[],
  userId: string,
): Promise<string | null> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

  if (!gatewayUrl || !gatewayToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENCLAW_TIMEOUT_MS);

  try {
    const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
        'x-openclaw-agent-id': 'concierge',
        'x-openclaw-session-key': `compass:user:${userId}`,
      },
      body: JSON.stringify({
        model: 'openclaw/concierge',
        messages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error('[chat/openclaw] Gateway error:', res.status, await res.text().catch(() => ''));
      return null;
    }

    // OpenAI-compatible response shape
    const data = await res.json();
    const choice = data?.choices?.[0];
    return choice?.message?.content ?? null;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[chat/openclaw] Gateway timeout after', OPENCLAW_TIMEOUT_MS, 'ms');
    } else {
      console.error('[chat/openclaw] Gateway unreachable:', err instanceof Error ? err.message : err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    const [profile, preferences, manifest, discoveries] = await Promise.all([
      getUserProfile(user.id),
      getUserPreferences(user.id),
      getUserManifest(user.id),
      getUserDiscoveries(user.id),
    ]);

    // Build recent discoveries summary
    const recentDiscoveries = (discoveries?.discoveries || [])
      .sort((a: Discovery, b: Discovery) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, 5)
      .map((d: Discovery) => ({ name: d.name, type: d.type, city: d.city }));

    // Get chat history from blob if not provided by client
    const history: ChatMessage[] = clientHistory || (await getChatHistory(user.id));

    // Cap history at last 20 messages and truncate long content
    const MAX_CONTENT = 2000;
    const trimmedHistory: OpenClawMessage[] = (history || []).slice(-20).map((msg: ChatMessage) => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content:
        typeof msg.content === 'string' && msg.content.length > MAX_CONTENT
          ? msg.content.slice(0, MAX_CONTENT) + '…'
          : msg.content,
    }));

    // Build user context system message
    const systemContent = buildUserContext(
      user,
      profile,
      preferences,
      manifest,
      recentDiscoveries,
    );

    // Assemble messages for OpenClaw (OpenAI-compatible format)
    const openclawMessages: OpenClawMessage[] = [
      { role: 'system', content: systemContent },
      ...trimmedHistory,
      { role: 'user', content: message },
    ];

    // Try OpenClaw Gateway first, fall back to direct Anthropic
    let reply = await callOpenClaw(openclawMessages, user.id);

    if (reply === null) {
      console.warn('[chat] OpenClaw unavailable, falling back to direct Anthropic');
      const context = {
        userCode: user.code,
        userCity: profile?.city || user.city || '',
        preferences,
        manifest,
        recentDiscoveries,
      };
      const fallback = await sendAnthropicFallback(
        { message, userId: user.id, userCode: user.code, history },
        context,
      );
      reply = fallback.reply;
    }

    const messageId = `${Date.now()}-concierge`;

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
