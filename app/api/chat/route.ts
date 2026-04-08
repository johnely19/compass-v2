import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import { persistChatData, getChatHistory } from '../../_lib/chat/persistence';
import { buildUserContext } from '../../_lib/chat/user-context';
import { sendChatMessage as sendAnthropicFallback } from '../../_lib/chat/anthropic-client';
import { checkRateLimit, rateLimitHeaders } from '../../_lib/chat/rate-limiter';
import type { ChatMessage, Discovery } from '../../_lib/types';

/** Maximum message length to prevent abuse */
const MAX_MESSAGE_LENGTH = 4000;

const OPENCLAW_TIMEOUT_MS = 90_000; // longer timeout for streaming — tool calls can take time

interface OpenClawMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCallMessage[];
  tool_call_id?: string;
}

interface ToolCallMessage {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI function-calling tools for the Concierge agent */
const CONCIERGE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'create-context',
      description: 'Create a new trip, outing, or radar context in the user\'s Compass.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['trip', 'outing', 'radar'],
            description: 'The type of context to create',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for the context (e.g., "NYC Solo Trip")',
          },
          city: {
            type: 'string',
            description: 'City name (optional)',
          },
          dates: {
            type: 'string',
            description: 'Date range (optional, e.g., "Jun 15-22")',
          },
          focus: {
            type: 'array',
            items: { type: 'string' },
            description: 'Focus areas (optional, e.g., ["food", "jazz"])',
          },
          emoji: {
            type: 'string',
            description: 'Emoji icon (optional, defaults by type)',
          },
        },
        required: ['type', 'label'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update-trip',
      description: 'Update an existing trip, outing, or radar context in the user\'s Compass.',
      parameters: {
        type: 'object',
        properties: {
          contextKey: {
            type: 'string',
            description: 'The key of the context to update (e.g., "trip:nyc-solo")',
          },
          dates: {
            type: 'string',
            description: 'Updated date range (optional)',
          },
          city: {
            type: 'string',
            description: 'Updated city (optional)',
          },
          focus: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated focus areas (optional)',
          },
          accommodation: {
            type: 'string',
            description: 'Accommodation details (optional, e.g., "Airbnb in Alfama")',
          },
        },
        required: ['contextKey'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add-discovery',
      description: 'Add a discovered place (restaurant, bar, cafe, etc.) to the user\'s Compass radar or trip.',
      parameters: {
        type: 'object',
        properties: {
          contextKey: {
            type: 'string',
            description: 'The key of the context to add the discovery to (e.g., "radar:toronto" or "trip:nyc-solo")',
          },
          discovery: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the place',
              },
              type: {
                type: 'string',
                enum: ['restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum', 'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park', 'architecture', 'development', 'accommodation', 'neighbourhood'],
                description: 'Type of place',
              },
              city: {
                type: 'string',
                description: 'City where the place is located',
              },
              address: {
                type: 'string',
                description: 'Address (optional)',
              },
              place_id: {
                type: 'string',
                description: 'Google Places ID (optional)',
              },
              rating: {
                type: 'number',
                description: 'Rating (optional, 1-5)',
              },
            },
            required: ['name', 'type', 'city'],
          },
        },
        required: ['contextKey', 'discovery'],
      },
    },
  },
];

/** Execute a tool call locally by calling the appropriate API endpoint */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const cookieValue = `compass-user=${userId}`; // Simplified — real impl would need proper auth

  let endpoint = '';
  let method = 'POST';
  let body: Record<string, unknown> = {};

  if (toolName === 'create-context') {
    endpoint = `${baseUrl}/api/compass/create-context`;
    body = {
      type: args.type,
      label: args.label,
      city: args.city,
      dates: args.dates,
      focus: args.focus,
      emoji: args.emoji,
    };
  } else if (toolName === 'update-trip') {
    endpoint = `${baseUrl}/api/compass/update-trip`;
    body = {
      contextKey: args.contextKey,
      dates: args.dates,
      city: args.city,
      focus: args.focus,
      accommodation: args.accommodation,
    };
  } else if (toolName === 'add-discovery') {
    endpoint = `${baseUrl}/api/compass/add-discovery`;
    body = {
      contextKey: args.contextKey,
      discovery: args.discovery,
    };
  } else {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const res = await fetch(endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieValue,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Tool call failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Stream chat completions from the OpenClaw Gateway via SSE.
 * Returns a ReadableStream or null if gateway is unavailable.
 */
async function streamOpenClaw(
  messages: OpenClawMessage[],
  userId: string,
): Promise<Response | null> {
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
        'x-openclaw-scopes': 'operator.read,operator.write',
        'x-openclaw-session-key': `compass:user:${userId}`,
      },
      body: JSON.stringify({
        model: 'openclaw/concierge',
        messages,
        stream: true,
        tools: CONCIERGE_TOOLS,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error('[chat/openclaw] Gateway error:', res.status, await res.text().catch(() => ''));
      return null;
    }

    return res;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[chat/openclaw] Gateway timeout after', OPENCLAW_TIMEOUT_MS, 'ms');
    } else {
      console.error('[chat/openclaw] Gateway unreachable:', err instanceof Error ? err.message : err);
    }
    return null;
  }
}

/**
 * Non-streaming OpenClaw fallback (used if stream: true isn't supported).
 */
async function callOpenClawSync(
  messages: OpenClawMessage[],
  userId: string,
): Promise<string | null> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

  if (!gatewayUrl || !gatewayToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
        'x-openclaw-agent-id': 'concierge',
        'x-openclaw-scopes': 'operator.read,operator.write',
        'x-openclaw-session-key': `compass:user:${userId}`,
      },
      body: JSON.stringify({
        model: 'openclaw/concierge',
        messages,
        tools: CONCIERGE_TOOLS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Parsed tool call from the stream */
interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Consume an SSE stream from the OpenClaw Gateway.
 * Forwards content deltas and tool-name events to the browser controller.
 * Accumulates tool_calls arguments across chunked deltas.
 * Returns the full content, any tool calls, and the finish_reason.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  messageId: string,
  onContent: (text: string) => void,
): Promise<{ content: string; toolCalls: ParsedToolCall[]; finishReason: string | null }> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let content = '';
  let finishReason: string | null = null;

  // Accumulate tool calls by index (they arrive in chunks)
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed?.choices?.[0];
          const delta = choice?.delta;

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (delta?.content) {
            content += delta.content;
            onContent(delta.content);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: delta.content, messageId })}\n\n`),
            );
          }

          // Accumulate tool call chunks
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallMap.get(idx);
              if (!existing) {
                toolCallMap.set(idx, {
                  id: tc.id || '',
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                });
                // Emit tool event to frontend on first chunk (has the name)
                if (tc.function?.name) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ tool: tc.function.name, messageId })}\n\n`),
                  );
                }
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
          }
        } catch {
          // Not valid JSON — skip
        }
      }
    }
  } catch (err) {
    console.error('[chat/consumeStream] Read error:', err);
  }

  const toolCalls: ParsedToolCall[] = [];
  for (const [, tc] of toolCallMap) {
    if (tc.name) {
      toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.args });
    }
  }

  return { content, toolCalls, finishReason };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // ─── Rate limiting ───────────────────────────────────────────
    const rateResult = checkRateLimit(user.id);
    if (!rateResult.allowed) {
      const retrySeconds = Math.ceil(rateResult.retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          reply: `You've been chatting a lot! 😅 Give me ${retrySeconds > 120 ? `${Math.ceil(retrySeconds / 60)} minutes` : `${retrySeconds} seconds`} and we can pick back up.`,
          messageId: `${Date.now()}-rate-limit`,
        },
        { status: 429, headers: rateLimitHeaders(rateResult) },
      );
    }

    const { message, history: clientHistory } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // ─── Input validation ────────────────────────────────────────
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: 'Message too long', reply: "That's a bit much — keep it under 4,000 characters? 📝", messageId: `${Date.now()}-validation` },
        { status: 400 },
      );
    }

    // Load user data in parallel
    const [profile, preferences, manifest, discoveries] = await Promise.all([
      getUserProfile(user.id),
      getUserPreferences(user.id),
      getUserManifest(user.id),
      getUserDiscoveries(user.id),
    ]);

    const recentDiscoveries = (discoveries?.discoveries || [])
      .sort((a: Discovery, b: Discovery) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, 5)
      .map((d: Discovery) => ({ name: d.name, type: d.type, city: d.city }));

    const history: ChatMessage[] = clientHistory || (await getChatHistory(user.id));

    // Cap history at last 20 messages, truncate long content
    const MAX_CONTENT = 2000;
    const trimmedHistory: OpenClawMessage[] = (history || []).slice(-20).map((msg: ChatMessage) => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content:
        typeof msg.content === 'string' && msg.content.length > MAX_CONTENT
          ? msg.content.slice(0, MAX_CONTENT) + '…'
          : msg.content,
    }));

    const systemContent = buildUserContext(user, profile, preferences, manifest, recentDiscoveries);

    const openclawMessages: OpenClawMessage[] = [
      { role: 'system', content: systemContent },
      ...trimmedHistory,
      { role: 'user', content: message },
    ];

    // Try streaming from OpenClaw Gateway
    const streamRes = await streamOpenClaw(openclawMessages, user.id);

    if (streamRes?.body) {
      const encoder = new TextEncoder();
      const messageId = `${Date.now()}-concierge`;
      let fullReply = '';

      // Messages accumulator for tool-call loops (starts with our initial messages)
      const loopMessages = [...openclawMessages];

      const readable = new ReadableStream({
        async start(controller) {
          const MAX_TOOL_ROUNDS = 5;
          let currentStream: Response | null = streamRes;

          try {
            for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
              if (!currentStream?.body) break;

              const { content, toolCalls, finishReason } = await consumeStream(
                currentStream.body,
                controller,
                encoder,
                messageId,
                (text) => { fullReply += text; },
              );

              // If the model finished with tool_calls, execute them and loop
              if (finishReason === 'tool_calls' && toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
                // Append the assistant's tool-call message
                loopMessages.push({
                  role: 'assistant',
                  content: content || '',
                  tool_calls: toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.arguments },
                  })),
                });

                // Execute each tool call and append results
                for (const tc of toolCalls) {
                  let result: unknown;
                  try {
                    const args = JSON.parse(tc.arguments);
                    result = await executeToolCall(tc.name, args, user.id);
                  } catch (err) {
                    result = { error: err instanceof Error ? err.message : 'Tool execution failed' };
                  }

                  loopMessages.push({
                    role: 'tool',
                    content: JSON.stringify(result),
                    tool_call_id: tc.id,
                  });
                }

                // Make a new streaming request with tool results
                currentStream = await streamOpenClaw(loopMessages, user.id);
              } else {
                // No more tool calls — done
                break;
              }
            }
          } catch (err) {
            console.error('[chat/stream] Stream error:', err);
          } finally {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            if (fullReply) {
              persistChatData(user.id, message, fullReply, messageId, history).catch(() => {});
            }
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Message-Id': messageId,
          ...rateLimitHeaders(rateResult),
        },
      });
    }

    // Fallback: try non-streaming OpenClaw, then direct Anthropic
    console.warn('[chat] OpenClaw streaming unavailable, trying sync fallback');
    let reply = await callOpenClawSync(openclawMessages, user.id);

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
    persistChatData(user.id, message, reply!, messageId, history).catch(() => {});

    return NextResponse.json(
      { reply, messageId },
      { headers: rateLimitHeaders(rateResult) },
    );
  } catch (err) {
    console.error('[api/chat]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      reply: "Something went sideways — try again in a sec! 🔄",
      messageId: `${Date.now()}-concierge`,
    });
  }
}
