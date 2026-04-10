/**
 * update_trip tool — Update trip/outing/radar context in the user's manifest.
 * Called by Concierge when the user shares trip details, dates, accommodation, etc.
 */

import { setUserData } from '../../user-data';
import { getWritableUserManifest } from '../../effective-user-data';
import type { Context } from '../../types';

export interface UpdateTripInput {
  contextKey: string;           // e.g. "trip:boston-august-2026"
  dates?: string;               // e.g. "August 15–18, 2026"
  city?: string;                // e.g. "Boston"
  label?: string;               // e.g. "Boston August Trip"
  emoji?: string;               // e.g. "🦞"
  focus?: string[];             // e.g. ["food", "architecture"]
  accommodationName?: string;   // e.g. "The Liberty Hotel"
  accommodationAddress?: string;
  notes?: string;               // any freeform details
}

export async function updateTrip(userId: string, input: UpdateTripInput): Promise<string> {
  try {
    const manifest = await getWritableUserManifest(userId);

    const idx = manifest.contexts.findIndex(c => c.key === input.contextKey);
    if (idx === -1) {
      return `❌ Context not found: "${input.contextKey}". Available contexts: ${manifest.contexts.map(c => c.key).join(', ')}`;
    }

    const ctx = manifest.contexts[idx] as Context;
    const updated: Context = {
      ...ctx,
      ...(input.dates && { dates: input.dates }),
      ...(input.city && { city: input.city }),
      ...(input.label && { label: input.label }),
      ...(input.emoji && { emoji: input.emoji }),
      ...(input.focus && { focus: input.focus }),
    };

    manifest.contexts[idx] = updated;
    manifest.updatedAt = new Date().toISOString();

    await setUserData(userId, 'manifest', manifest);

    const changes: string[] = [];
    if (input.dates) changes.push(`dates → ${input.dates}`);
    if (input.city) changes.push(`city → ${input.city}`);
    if (input.label) changes.push(`label → ${input.label}`);
    if (input.emoji) changes.push(`emoji → ${input.emoji}`);
    if (input.focus) changes.push(`focus → ${input.focus.join(', ')}`);
    if (input.accommodationName) changes.push(`accommodation → ${input.accommodationName}`);

    console.log(`[update_trip] ✅ Updated context "${input.contextKey}" for user ${userId}: ${changes.join('; ')}`);
    return `✅ Updated ${updated.emoji} ${updated.label}: ${changes.join(', ')}`;
  } catch (e) {
    console.error('[update_trip] Failed:', e);
    return `Failed to update trip: ${e}`;
  }
}
