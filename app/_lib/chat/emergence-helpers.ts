import { diffTripEmergenceAttributes, type TripEmergenceSnapshot, type TripAttributeChip } from '../trip-emergence';

/**
 * Parsed SSE tool events from the chat stream.
 */
export interface ParsedToolEvent {
  tool: string;
  toolResult?: string;
  contextKey?: string;
}

/**
 * Parses a tool event from SSE data.
 * @returns The parsed tool event or undefined if not a tool event.
 */
export function parseToolEvent(data: string): ParsedToolEvent | undefined {
  try {
    const parsed = JSON.parse(data);
    if (parsed.tool && typeof parsed.tool === 'string') {
      return {
        tool: parsed.tool,
        toolResult: parsed.toolResult,
        contextKey: parsed.contextKey,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determines which emergence events should fire based on tools used.
 * @returns true if create-context tool was used.
 */
export function extractCreateContextUsed(events: ParsedToolEvent[]): boolean {
  return events.some(e => e.tool === 'create-context');
}

/**
 * Determines which emergence events should fire based on tools used.
 * @returns true if update-trip tool was used (with trip key if provided).
 */
export function extractUpdateTripUsed(events: ParsedToolEvent[]): string | null {
  const found = events.find(e => e.tool === 'update-trip');
  return found ? '__any__' : null;
}

/**
 * Computes new contexts after a tool was used.
 * @param preKeys Keys that existed before the tool call.
 * @param allCtxs All contexts currently in the system.
 * @returns Contexts that are new (not in preKeys).
 */
export function computeNewContexts(
  preKeys: Set<string>,
  allCtxs: TripEmergenceSnapshot[],
): TripEmergenceSnapshot[] {
  return allCtxs.filter(c => !preKeys.has(c.key));
}

/**
 * Computes changed attributes for a specific context.
 * @param preSnapshot The snapshot before the tool call.
 * @param current The current snapshot.
 * @returns Changed attributes from diffTripEmergenceAttributes.
 */
export function computeChangedAttributes(
  preSnapshot: TripEmergenceSnapshot | undefined,
  current: TripEmergenceSnapshot,
): TripAttributeChip[] {
  if (!preSnapshot) return [];
  return diffTripEmergenceAttributes(preSnapshot, current);
}