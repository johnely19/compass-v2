import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import { persistChatData, getChatHistory } from '../../_lib/chat/persistence';
import { buildSystemPrompt, type ChatContext } from '../../_lib/chat/system-prompt';
import { TOOLS } from '../../_lib/chat/tools';
import { runToolCall, type ToolName } from '../../_lib/chat/tools/runner';
import { computeContextKey } from '../../_lib/chat/tools/create-context';
import { checkRateLimit, rateLimitHeaders } from '../../_lib/chat/rate-limiter';
import type { ChatMessage, Discovery } from '../../_lib/types';

// Vercel serverless config — tool loops need time
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Maximum message length to prevent abuse */
const MAX_MESSAGE_LENGTH = 4000;

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_TIME_MS = 50_000; // Stop tool loops before Vercel kills us
const PER_ROUND_BUDGET_MS = 12_000; // Warn threshold per round

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Map internal tool names (underscores) to frontend-expected names (hyphens).
 * ChatWidget.tsx checks for 'create-context' and 'update-trip'.
 */
function mapToolName(name: string): string {
  const mapping: Record<string, string> = {
    'create_context': 'create-context',
    'set_active_context': 'set-active-context',
    'update_trip': 'update-trip',
    'add_to_compass': 'add-to-compass',
    'save_discovery': 'save-discovery',
    'edit_discovery': 'edit-discovery',
    'remove_discovery': 'remove-discovery',
    'web_search': 'web-search',
    'lookup_place': 'lookup-place',
  };
  return mapping[name] || name;
}

/**
 * Resolve the contextKey that a tool call targets so the SSE layer can
 * include it in the toolResult event. ChatWidget uses this to dispatch
 * `compass-chat-context-switch` and HomeClient switches focus accordingly.
 *
 * - For create_context, derive the key from type+label using the same
 *   slugify rule as the tool implementation.
 * - For every other tool, prefer the explicit contextKey in the input.
 */
function resolveTargetContextKey(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (toolName === 'create_context') {
    const type = typeof input?.type === 'string' ? input.type : undefined;
    const label = typeof input?.label === 'string' ? input.label : undefined;
    if (type && label) {
      try {
        return computeContextKey({ type, label });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  const ck = input?.contextKey;
  return typeof ck === 'string' && ck.length > 0 ? ck : undefined;
}

/**
 * Call Anthropic API (non-streaming) for tool execution rounds.
 * Returns the parsed response body or null on error.
 */
async function callAnthropicSync(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
): Promise<any> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    console.error('[chat/anthropic-sync] API error:', res.status, err);
    return null;
  }

  return res.json();
}

/**
 * Execute tool rounds synchronously (non-streaming).
 * Runs the tool loop: call Anthropic → execute tools → repeat.
 * Emits SSE events for tool usage so frontend can show status.
 * Returns the final response content blocks and accumulated text.
 */
async function executeToolLoop(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  userId: string,
  appOrigin: string,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
  messageId: string,
): Promise<{ finalContent: any[]; fullText: string }> {
  let fullText = '';
  let round = 0;
  let data: any = null;
  const startTime = Date.now();

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Time budget check — stop before Vercel kills the function
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_TOOL_TIME_MS) {
      console.warn(`[chat/tool-loop] Time budget exceeded at round ${round} (${elapsed}ms)`);
      // Graceful degradation: ask the model for a final summary without tools
      const wrapUp = fullText
        ? "\n\nI found some great options but ran out of time adding them all. Here's what I have so far — ask me to continue and I'll add the rest! ✨"
        : "\n\n(I ran out of time on this turn — ask me to continue and I'll pick up where I left off!)";
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ content: wrapUp, messageId })}\n\n`
      ));
      fullText += wrapUp;
      break;
    }

    data = await callAnthropicSync(apiKey, systemPrompt, messages);
    if (!data) {
      return { finalContent: [], fullText };
    }

    // Extract text from this round
    for (const block of (data.content || [])) {
      if (block.type === 'text' && block.text) {
        fullText += block.text;
        // Stream the text to the frontend immediately
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ content: block.text, messageId })}\n\n`
        ));
      }
    }

    // If no tool use, we're done
    if (data.stop_reason !== 'tool_use') {
      return { finalContent: data.content || [], fullText };
    }

    // Execute tool calls
    const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      return { finalContent: data.content || [], fullText };
    }

    // Add assistant message to conversation
    messages.push({ role: 'assistant', content: data.content });

    // Emit tool events to frontend for status display
    for (const toolBlock of toolUseBlocks) {
      const frontendToolName = mapToolName(toolBlock.name);
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ tool: frontendToolName, messageId })}\n\n`
      ));
      console.log(`[chat/tool] Executing ${toolBlock.name} for user ${userId}:`, JSON.stringify(toolBlock.input).slice(0, 200));
    }

    // Execute tool calls SEQUENTIALLY to avoid Blob race conditions.
    // Parallel adds cause read-modify-write conflicts where last write wins,
    // losing earlier discoveries. Sequential is ~3s slower but correct.
    const toolResults: any[] = [];
    for (const toolBlock of toolUseBlocks) {
        const frontendToolName = mapToolName(toolBlock.name);
        try {
          const result = await runToolCall(
            toolBlock.name as ToolName,
            toolBlock.input as Record<string, unknown>,
            userId,
            { appOrigin },
          );
          // Emit toolResult event so frontend can refresh
          // Include contextKey so frontend can auto-switch homepage. For
          // create_context, this key is derived from the tool input (the
          // tool itself uses the same derivation).
          const toolContextKey = resolveTargetContextKey(
            toolBlock.name as string,
            (toolBlock.input as Record<string, unknown>) || {},
          );
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ toolResult: frontendToolName, messageId, ...(toolContextKey ? { contextKey: toolContextKey } : {}) })}\n\n`
          ));
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        } catch (err) {
          console.error(`[chat/tool] Error executing ${toolBlock.name}:`, err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
    }

    messages.push({ role: 'user', content: toolResults });
    // Continue to next round
  }

  // Exhausted rounds — return whatever we have
  return { finalContent: data?.content || [], fullText };
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

    const { message, history: clientHistory, contextKey: activeContextKey, chatTarget } = await request.json();

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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        reply: "I'm getting set up — check back in a moment! 🔧",
        messageId: `${Date.now()}-concierge`,
      });
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

    // Build chat context for system prompt
    const chatContext: ChatContext = {
      userCode: user.code,
      userCity: profile?.city || user.city || '',
      preferences,
      manifest,
      recentDiscoveries,
      activeContextKey: typeof activeContextKey === 'string' ? activeContextKey : undefined,
      chatTarget: chatTarget && typeof chatTarget === 'object' ? {
        cardId: typeof chatTarget.cardId === 'string' ? chatTarget.cardId : undefined,
        cardName: typeof chatTarget.cardName === 'string' ? chatTarget.cardName : undefined,
        cardType: typeof chatTarget.cardType === 'string' ? chatTarget.cardType : undefined,
        cardPlaceId: typeof chatTarget.cardPlaceId === 'string' ? chatTarget.cardPlaceId : undefined,
      } : undefined,
    };

    const appOrigin = request.nextUrl.origin;
    const systemPrompt = buildSystemPrompt(chatContext, { appOrigin });

    // Build conversation history — cap at last 20 messages, truncate long content
    const MAX_CONTENT = 2000;
    const anthropicMessages: any[] = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-20)) {
        const content = typeof msg.content === 'string' && msg.content.length > MAX_CONTENT
          ? msg.content.slice(0, MAX_CONTENT) + '…'
          : msg.content;
        anthropicMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content,
        });
      }
    }
    anthropicMessages.push({ role: 'user', content: message });

    // Stream response with tool execution
    const encoder = new TextEncoder();
    const messageId = `${Date.now()}-concierge`;

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const { fullText } = await executeToolLoop(
            apiKey,
            systemPrompt,
            anthropicMessages,
            user.id,
            appOrigin,
            encoder,
            controller,
            messageId,
          );

          // Signal stream end
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));

          // Persist completed chat
          if (fullText) {
            persistChatData(user.id, message, fullText, messageId, history).catch(() => {});
          }
        } catch (err) {
          console.error('[chat/stream] Fatal error:', err);
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ content: "Something went sideways — try again in a sec! 🔄", messageId })}\n\n`
          ));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } finally {
          controller.close();
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
  } catch (err) {
    console.error('[api/chat]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      reply: "Something went sideways — try again in a sec! 🔄",
      messageId: `${Date.now()}-concierge`,
    });
  }
}
