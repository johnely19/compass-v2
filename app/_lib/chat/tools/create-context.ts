/**
 * create_context tool — Create a new trip, outing, or radar context in the user's manifest.
 * Called by Concierge when user says "I'm planning a trip to Boston" or "add a NYC radar".
 */

import { getUserManifest, setUserData } from '../../user-data';
import type { Context, ContextType, UserManifest } from '../../types';

export interface CreateContextInput {
  type: ContextType;        // "trip" | "outing" | "radar"
  label: string;            // e.g. "Boston Trip"
  emoji?: string;           // e.g. "🦞"
  city?: string;            // e.g. "Boston"
  dates?: string;           // e.g. "August 15–18, 2026"
  focus?: string[];         // e.g. ["food", "history"]
  setActive?: boolean;      // whether to mark this context active (default: true)
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

function defaultEmoji(type: ContextType, city?: string): string {
  if (type === 'radar') return '📡';
  if (type === 'outing') return '🎭';
  // Trip emoji by city hint
  const c = city?.toLowerCase() || '';
  if (c.includes('boston')) return '🦞';
  if (c.includes('nyc') || c.includes('new york')) return '🗽';
  if (c.includes('toronto')) return '🍁';
  if (c.includes('london')) return '🎡';
  if (c.includes('paris')) return '🗼';
  if (c.includes('tokyo')) return '🗾';
  return '✈️';
}

export async function createContext(userId: string, input: CreateContextInput): Promise<string> {
  try {
    const slug = slugify(input.label);
    const key = `${input.type}:${slug}`;
    const emoji = input.emoji || defaultEmoji(input.type, input.city);

    const newContext: Context = {
      key,
      label: input.label,
      emoji,
      type: input.type,
      city: input.city,
      dates: input.dates,
      focus: input.focus || [],
      active: input.setActive !== false,
    };

    let manifest = await getUserManifest(userId);
    if (!manifest) {
      // Create new manifest
      manifest = { contexts: [], updatedAt: new Date().toISOString() } as UserManifest;
    }

    // Check if key already exists
    const existing = manifest.contexts.findIndex(c => c.key === key);
    if (existing !== -1) {
      // Upsert — update existing
      manifest.contexts[existing] = { ...manifest.contexts[existing], ...newContext };
      manifest.updatedAt = new Date().toISOString();
      await setUserData(userId, 'manifest', manifest);
      console.log(`[create_context] ✅ Updated existing context "${key}" for user ${userId}`);
      return `✅ Updated existing context: ${emoji} ${input.label} (${key})`;
    }

    manifest.contexts.push(newContext);
    manifest.updatedAt = new Date().toISOString();

    await setUserData(userId, 'manifest', manifest);

    console.log(`[create_context] ✅ Created context "${key}" for user ${userId}`);

    const details: string[] = [];
    if (input.city) details.push(input.city);
    if (input.dates) details.push(input.dates);
    if (input.focus?.length) details.push(`focus: ${input.focus.join(', ')}`);

    return `✅ Created ${emoji} ${input.label} (${key})${details.length ? ' — ' + details.join(', ') : ''}`;
  } catch (e) {
    console.error('[create_context] Failed:', e);
    return `Failed to create context: ${e}`;
  }
}
