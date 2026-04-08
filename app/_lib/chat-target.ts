/**
 * Contextual Chat Target — defines what the chat is scoped to.
 *
 * Supports three levels of targeting:
 * 1. Global (no target) — normal chat behavior
 * 2. Context-level — scoped to a trip, outing, or radar
 * 3. Card-level — scoped to a specific discovery/place within a context
 */

export interface ChatTargetCard {
  /** Discovery ID or place_id */
  id: string;
  /** Place name */
  name: string;
  /** Place type (restaurant, bar, etc.) */
  type: string;
  /** Place ID for Google Maps links */
  placeId?: string;
}

export interface ChatTarget {
  /** Context key (e.g. "trip:siena-2026", "outing:dinner-tonight") */
  contextKey: string;
  /** Human-readable context label */
  contextLabel: string;
  /** Context emoji */
  contextEmoji?: string;
  /** Context type */
  contextType?: 'trip' | 'outing' | 'radar';

  /** Optional: target a specific card/place within the context */
  card?: ChatTargetCard;
}

/**
 * Custom event types for chat targeting.
 */
export const CHAT_TARGET_EVENT = 'compass-chat-target' as const;
export const CHAT_TARGET_CLEAR_EVENT = 'compass-chat-target-clear' as const;

/**
 * Dispatch a chat target event (card-level or context-level).
 */
export function dispatchChatTarget(target: ChatTarget): void {
  window.dispatchEvent(new CustomEvent(CHAT_TARGET_EVENT, { detail: target }));
}

/**
 * Dispatch a clear chat target event (revert to global).
 */
export function dispatchClearChatTarget(): void {
  window.dispatchEvent(new CustomEvent(CHAT_TARGET_CLEAR_EVENT));
}

/**
 * Serialize chat target for API transmission.
 */
export function serializeChatTarget(target: ChatTarget): Record<string, unknown> {
  return {
    contextKey: target.contextKey,
    contextLabel: target.contextLabel,
    contextEmoji: target.contextEmoji,
    contextType: target.contextType,
    ...(target.card ? {
      cardId: target.card.id,
      cardName: target.card.name,
      cardType: target.card.type,
      cardPlaceId: target.card.placeId,
    } : {}),
  };
}

/**
 * Build a human-readable label for the chat target.
 */
export function chatTargetLabel(target: ChatTarget): string {
  if (target.card) {
    return target.card.name;
  }
  return target.contextLabel;
}

/**
 * Build a short emoji + label for the target pill.
 */
export function chatTargetPill(target: ChatTarget): { emoji: string; label: string } {
  if (target.card) {
    return {
      emoji: '📍',
      label: target.card.name,
    };
  }
  return {
    emoji: target.contextEmoji || '🧭',
    label: target.contextLabel,
  };
}
