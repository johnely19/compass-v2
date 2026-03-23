/**
 * Anthropic API client for the Compass Concierge.
 * Uses raw fetch to avoid SDK type complexity with tool-use loops.
 */

import { TOOLS } from './tools';
import { buildSystemPrompt, type ChatContext } from './system-prompt';
import { runToolCall, type ToolName } from './tools/runner';
import type { ChatMessage } from '../types';

interface ChatRequest {
  message: string;
  userId: string;
  userCode: string;
  history?: ChatMessage[];
}

interface ChatResponse {
  reply: string;
  messageId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

async function callAnthropic(
  apiKey: string,
  system: string,
  messages: any[],
  tools?: any[],
): Promise<any> {
  const body: any = {
    model: MODEL,
    max_tokens: 2048,
    system,
    messages,
  };
  if (tools) body.tools = tools;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[chat] Anthropic API error:', res.status, err);
    return null;
  }

  return res.json();
}

export async function sendChatMessage(
  request: ChatRequest,
  context: ChatContext | null,
): Promise<ChatResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      reply: "I'm getting set up — check back in a moment! 🔧",
      messageId: `${Date.now()}-concierge`,
    };
  }

  const systemPrompt = buildSystemPrompt(context);

  // Build conversation history
  const messages: any[] = [];
  if (request.history && Array.isArray(request.history)) {
    for (const msg of request.history.slice(-20)) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }
  messages.push({ role: 'user', content: request.message });

  // First call
  let data = await callAnthropic(apiKey, systemPrompt, messages, TOOLS);
  if (!data) {
    return { reply: 'Having a moment — try again? 🙏', messageId: `${Date.now()}-concierge` };
  }

  // Tool use loop (max 5 rounds)
  let rounds = 0;
  while (data.stop_reason === 'tool_use' && rounds < 5) {
    rounds++;

    const toolResults: any[] = [];
    for (const block of data.content) {
      if (block.type === 'tool_use') {
        const result = await runToolCall(
          block.name as ToolName,
          block.input as Record<string, unknown>,
          request.userId,
        );
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
    }

    messages.push({ role: 'assistant', content: data.content });
    messages.push({ role: 'user', content: toolResults });

    data = await callAnthropic(apiKey, systemPrompt, messages, TOOLS);
    if (!data) break;
  }

  // Extract text from response
  const textBlocks = (data?.content || []).filter((b: any) => b.type === 'text');
  const reply =
    textBlocks.map((b: any) => b.text || '').join('\n') ||
    "I found some great options! Check your Compass for the latest additions. ✨";

  return { reply, messageId: `${Date.now()}-concierge` };
}
