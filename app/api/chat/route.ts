import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../_lib/user';
import { getUserProfile, getUserPreferences, getUserManifest, getUserDiscoveries } from '../../_lib/user-data';
import { persistChatData, getChatHistory } from '../../_lib/chat/persistence';
import { buildSystemPrompt, type ChatContext } from '../../_lib/chat/system-prompt';
import { TOOLS } from '../../_lib/chat/tools';
import { runToolCall, type ToolName } from '../../_lib/chat/tools/runner';
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

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Stream a response from Anthropic with tool execution support.
 * Handles the full tool-use loop: stream → detect tool_use → execute → continue.
 * Emits SSE events for both content and tool calls so the frontend can animate.
 */
async function streamAnthropicWithTools(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  userId: string,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
  messageId: string,
): Promise<string> {
  let fullReply = '';
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Call Anthropic with streaming
    const body: any = {
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: TOOLS,
      stream: true,
    };

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      console.error('[chat/anthropic-stream] API error:', res.status, err);
      const fallbackMsg = "Having a moment — try again? 🙏";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fallbackMsg, messageId })}\n\n`));
      fullReply += fallbackMsg;
      break;
    }

    // Parse the SSE stream from Anthropic
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason = '';
    const contentBlocks: any[] = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || !data) continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'content_block_start') {
              const block = event.content_block;
              if (block.type === 'tool_use') {
                currentToolUse = { id: block.id, name: block.name, inputJson: '' };
                // Emit tool event to frontend — map tool names for ChatWidget detection
                const frontendToolName = mapToolName(block.name);
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ tool: frontendToolName, messageId })}\n\n`
                ));
              }
              contentBlocks.push(block);
            }

            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              if (delta.type === 'text_delta' && delta.text) {
                fullReply += delta.text;
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ content: delta.text, messageId })}\n\n`
                ));
              }
              if (delta.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.inputJson += delta.partial_json;
              }
            }

            if (event.type === 'content_block_stop') {
              if (currentToolUse) {
                // Finalize tool use block
                const toolBlock = {
                  type: 'tool_use' as const,
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: JSON.parse(currentToolUse.inputJson || '{}'),
                };
                // Replace the placeholder in contentBlocks
                const idx = contentBlocks.findIndex(
                  (b: any) => b.type === 'tool_use' && b.id === currentToolUse!.id
                );
                if (idx !== -1) contentBlocks[idx] = toolBlock;
                else contentBlocks.push(toolBlock);
                currentToolUse = null;
              }
            }

            if (event.type === 'message_delta') {
              if (event.delta?.stop_reason) {
                stopReason = event.delta.stop_reason;
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (err) {
      console.error('[chat/anthropic-stream] Stream read error:', err);
      break;
    }

    // If the model wants to use tools, execute them and continue
    if (stopReason === 'tool_use') {
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      // Build assistant message with all content blocks
      const assistantContent = contentBlocks.map((b: any) => {
        if (b.type === 'tool_use') return b;
        if (b.type === 'text') return { type: 'text', text: b.text || '' };
        return b;
      });
      messages.push({ role: 'assistant', content: assistantContent });

      // Execute each tool and collect results
      const toolResults: any[] = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`[chat/tool] Executing ${toolBlock.name} for user ${userId}:`, JSON.stringify(toolBlock.input).slice(0, 200));
        try {
          const result = await runToolCall(
            toolBlock.name as ToolName,
            toolBlock.input as Record<string, unknown>,
            userId,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });

          // Emit a status event so the UI can show feedback
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ toolResult: mapToolName(toolBlock.name), messageId })}\n\n`
          ));
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
      // Continue the loop — next round will stream the follow-up response
      continue;
    }

    // Normal end_turn — we're done
    break;
  }

  return fullReply;
}

/**
 * Map internal tool names (underscores) to frontend-expected names (hyphens).
 * ChatWidget.tsx checks for 'create-context' and 'update-trip'.
 */
function mapToolName(name: string): string {
  const mapping: Record<string, string> = {
    'create_context': 'create-context',
    'update_trip': 'update-trip',
    'add_to_compass': 'add-to-compass',
    'save_discovery': 'save-discovery',
    'web_search': 'web-search',
    'lookup_place': 'lookup-place',
  };
  return mapping[name] || name;
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
    };

    const systemPrompt = buildSystemPrompt(chatContext);

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
          const fullReply = await streamAnthropicWithTools(
            apiKey,
            systemPrompt,
            anthropicMessages,
            user.id,
            encoder,
            controller,
            messageId,
          );

          // Signal stream end
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));

          // Persist completed chat
          if (fullReply) {
            persistChatData(user.id, message, fullReply, messageId, history).catch(() => {});
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
