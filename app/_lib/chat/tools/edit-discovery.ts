/**
 * edit_discovery tool — Edit fields on an existing discovery in the user's Compass.
 * Called by Concierge when the user wants to correct, refine, or enrich
 * a discovery within their targeted context.
 *
 * Examples:
 * - "Change that restaurant to a bar"
 * - "Actually the address is 123 Main St"
 * - "Update the rating to 4.5"
 */

import { getUserData, setUserData } from '../../user-data';
import type { Discovery, DiscoveryType, UserDiscoveries } from '../../types';

export interface EditDiscoveryInput {
  /** Name of the discovery to edit (fuzzy-matched) */
  name: string;
  /** Context key to search within (required for scoping) */
  contextKey: string;
  /** Fields to update */
  updates: {
    name?: string;
    city?: string;
    type?: DiscoveryType;
    address?: string;
    rating?: number;
    contextKey?: string;  // move to a different context
    description?: string;
  };
}

/**
 * Fuzzy match a discovery by name within a context.
 * Returns the best match index or -1.
 */
function findDiscoveryByName(
  discoveries: Discovery[],
  name: string,
  contextKey: string,
): number {
  const nameLower = name.toLowerCase().trim();

  // 1. Exact match within context
  const exactIdx = discoveries.findIndex(
    d => d.contextKey === contextKey && d.name.toLowerCase() === nameLower,
  );
  if (exactIdx !== -1) return exactIdx;

  // 2. Partial/fuzzy match within context
  const partialIdx = discoveries.findIndex(
    d => d.contextKey === contextKey && (
      d.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(d.name.toLowerCase())
    ),
  );
  if (partialIdx !== -1) return partialIdx;

  // 3. Exact match across all contexts (fallback)
  const globalIdx = discoveries.findIndex(
    d => d.name.toLowerCase() === nameLower,
  );
  return globalIdx;
}

export async function editDiscovery(
  userId: string,
  input: EditDiscoveryInput,
): Promise<string> {
  try {
    let discData: UserDiscoveries | null = null;
    try {
      discData = await getUserData<'discoveries'>(userId, 'discoveries');
    } catch {
      return '❌ No discoveries found. Nothing to edit.';
    }

    if (!discData?.discoveries?.length) {
      return '❌ No discoveries found. Nothing to edit.';
    }

    const idx = findDiscoveryByName(discData.discoveries, input.name, input.contextKey);
    if (idx === -1) {
      // Suggest available discoveries in this context
      const inContext = discData.discoveries
        .filter(d => d.contextKey === input.contextKey)
        .map(d => d.name)
        .slice(0, 5);
      const hint = inContext.length > 0
        ? ` Available in this context: ${inContext.join(', ')}`
        : ' No discoveries in this context.';
      return `❌ Could not find "${input.name}" to edit.${hint}`;
    }

    const discovery = discData.discoveries[idx]!;
    const changes: string[] = [];

    if (input.updates.name) {
      changes.push(`name: "${discovery.name}" → "${input.updates.name}"`);
      discovery.name = input.updates.name;
    }
    if (input.updates.city) {
      changes.push(`city: "${discovery.city}" → "${input.updates.city}"`);
      discovery.city = input.updates.city;
    }
    if (input.updates.type) {
      changes.push(`type: ${discovery.type} → ${input.updates.type}`);
      discovery.type = input.updates.type;
    }
    if (input.updates.address) {
      changes.push(`address → "${input.updates.address}"`);
      discovery.address = input.updates.address;
    }
    if (input.updates.rating !== undefined) {
      changes.push(`rating: ${discovery.rating ?? 'none'} → ${input.updates.rating}`);
      discovery.rating = input.updates.rating;
    }
    if (input.updates.contextKey) {
      changes.push(`moved to context: ${input.updates.contextKey}`);
      discovery.contextKey = input.updates.contextKey;
    }
    if (input.updates.description) {
      changes.push(`description updated`);
      discovery.description = input.updates.description;
    }

    if (changes.length === 0) {
      return `ℹ️ No changes specified for "${discovery.name}".`;
    }

    discData.discoveries[idx] = discovery;
    discData.updatedAt = new Date().toISOString();
    await setUserData(userId, 'discoveries', discData);

    console.log(`[edit_discovery] ✅ Edited "${discovery.name}" for user ${userId}: ${changes.join('; ')}`);
    return `✅ Updated "${discovery.name}": ${changes.join(', ')}`;
  } catch (e) {
    console.error('[edit_discovery] Failed:', e);
    return `Failed to edit discovery: ${e}`;
  }
}
