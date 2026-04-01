/**
 * User context builder for OpenClaw Concierge integration.
 *
 * Builds a context block that gets injected into the system prompt
 * when routing chat through OpenClaw instead of direct Anthropic calls.
 *
 * This replaces the buildSystemPrompt() context injection from system-prompt.ts
 * with a format suitable for OpenClaw's session-based architecture.
 */

import type { UserPreferences, UserManifest, Context, Discovery } from '../types';

export interface OpenClawUserContext {
  userCode: string;
  userId: string;
  userCity: string;
  preferences: UserPreferences | null;
  manifest: UserManifest | null;
  recentDiscoveries: Array<{ name: string; type: string; city: string }>;
}

/**
 * Build a user context string for injection into OpenClaw system prompt.
 * This gets prepended to the conversation as a system-level context block.
 */
export function buildUserContextBlock(context: OpenClawUserContext | null): string {
  if (!context) {
    return `## ONBOARDING
No user data found. You are meeting this user for the first time.
1. Introduce yourself warmly as their Compass Concierge
2. Ask where they live (their home city)
3. Ask what kinds of places they love — interests, cuisines, vibes
4. Ask if they have any upcoming trips or outings planned
5. Build up their preferences through conversation`;
  }

  const parts: string[] = [];

  // User identity
  parts.push(`## USER\nCode: ${context.userCode} | ID: ${context.userId}`);

  // Home city
  if (context.userCity) {
    parts.push(`## USER CITY\nUser's home city: ${context.userCity}`);
  }

  // Preferences
  if (context.preferences) {
    const prefs = context.preferences;
    const prefParts: string[] = [];
    if (prefs.interests?.length) prefParts.push(`Interests: ${prefs.interests.join(', ')}`);
    if (prefs.cuisines?.length) prefParts.push(`Cuisines: ${prefs.cuisines.join(', ')}`);
    if (prefs.vibes?.length) prefParts.push(`Vibes: ${prefs.vibes.join(', ')}`);
    if (prefs.avoidances?.length) prefParts.push(`Avoids: ${prefs.avoidances.join(', ')}`);
    if (prefParts.length > 0) {
      parts.push(`## USER PREFERENCES (Layer 1)\n${prefParts.join('\n')}`);
    }
  }

  // Active contexts
  const activeContexts = context.manifest?.contexts?.filter((c: Context) => c.active) || [];
  if (activeContexts.length > 0) {
    const ctxLines = activeContexts.map((ctx: Context) => {
      const dates = ctx.dates ? ` (${ctx.dates})` : '';
      const focus = ctx.focus?.length ? ` — Focus: ${ctx.focus.join(', ')}` : '';
      return `- ${ctx.emoji} ${ctx.label}${dates}${focus}\n  Key: ${ctx.key}`;
    });
    parts.push(`## ACTIVE CONTEXTS\n${ctxLines.join('\n')}`);
  } else {
    parts.push(`## CONTEXTS\nNo active trips, outings, or radars. Help the user set one up if they mention a trip.`);
  }

  // Recent discoveries
  if (context.recentDiscoveries?.length > 0) {
    const discoLines = context.recentDiscoveries.map(
      d => `- ${d.name} (${d.type}) — ${d.city}`,
    );
    parts.push(`## RECENT DISCOVERIES\n${discoLines.join('\n')}`);
  }

  // Tool usage hint
  parts.push(`## TOOL USAGE
When recommending places, use the appropriate contextKey from ACTIVE CONTEXTS in your compass_add_discovery calls.
When the user explicitly saves a place, use compass_save_discovery.
Use compass_update_trip and compass_create_context for trip management.
User ID for all tool calls: "${context.userId}"`);

  return parts.join('\n\n');
}

/**
 * Generate the OpenClaw session key for a Compass user.
 * Each user gets their own persistent session.
 */
export function getSessionKey(userId: string): string {
  return `compass:user:${userId}`;
}
