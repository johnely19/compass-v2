/**
 * set_active_context tool — Signal intent to focus a specific trip/outing/radar
 * context on the homepage. This is a lightweight tool: it does not mutate user
 * data. The chat route lifts its `contextKey` input into the SSE toolResult
 * event so ChatWidget can dispatch `compass-chat-context-switch` and HomeClient
 * can switch the active homepage context deterministically.
 *
 * The concierge should call this whenever the conversation starts focusing on
 * a different context than the one the user is currently viewing — e.g.
 * "let's review the NYC trip" while the homepage is showing Boston.
 */

import { getUserManifest } from '../../user-data';

export interface SetActiveContextInput {
  contextKey: string;
}

export async function setActiveContext(
  userId: string,
  input: SetActiveContextInput,
): Promise<string> {
  const key = input?.contextKey;
  if (!key || typeof key !== 'string') {
    return 'Failed to set active context: contextKey is required';
  }

  try {
    const manifest = await getUserManifest(userId);
    const ctx = manifest?.contexts?.find(c => c.key === key);
    if (!ctx) {
      return `Context not found for key: ${key}`;
    }
    return `🎯 Focused on ${ctx.emoji || '📌'} ${ctx.label} (${key})`;
  } catch (e) {
    console.error('[set_active_context] Failed:', e);
    return `Failed to set active context: ${e instanceof Error ? e.message : String(e)}`;
  }
}
