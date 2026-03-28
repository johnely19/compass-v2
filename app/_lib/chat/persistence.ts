/**
 * Chat persistence.
 * Handles saving chat history to Vercel Blob.
 */

import { setUserData, getUserData } from '../user-data';
import type { ChatMessage, UserChat, UserDocType, UserDocMap } from '../types';

/**
 * Persist chat history to blob storage.
 * Uses Promise.race with a 5s timeout so the response isn't blocked.
 */
export async function persistChatData(
  userId: string,
  message: string,
  reply: string,
  messageId: string,
  history?: ChatMessage[],
): Promise<void> {
  // Cap history at 40 messages (~20 exchanges) before appending new pair.
  // Without this the blob grows unboundedly and eventually exceeds Claude's context window.
  const MAX_STORED = 40;
  const trimmed = (history || []).slice(-MAX_STORED);

  const updatedMessages: ChatMessage[] = [
    ...trimmed,
    { role: 'user', content: message, timestamp: new Date().toISOString() },
    { role: 'assistant', content: reply, timestamp: new Date().toISOString() },
  ];

  const persistChat = setUserData(userId, 'chat', {
    messages: updatedMessages,
    updatedAt: new Date().toISOString(),
  }).catch((e) =>
    console.error('[chat] Failed to persist chat history:', e)
  );

  // Wait with timeout
  await Promise.race([
    persistChat,
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

/**
 * Get chat history for a user.
 */
export async function getChatHistory(userId: string): Promise<ChatMessage[]> {
  try {
    const chat = await getUserData<'chat'>(userId, 'chat');
    return chat?.messages || [];
  } catch {
    return [];
  }
}
