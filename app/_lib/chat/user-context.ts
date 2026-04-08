/**
 * Build a user-context system message for the OpenClaw Concierge agent.
 *
 * This replaces the old monolithic system prompt — the Concierge agent's
 * personality and tool definitions now live in OpenClaw's agent config.
 * We only need to inject who the user is, their preferences, and active contexts
 * so the agent can personalize its responses.
 */

import type { UserPreferences, UserManifest, Context } from '../types';

interface UserLike {
  id: string;
  code: string;
  city?: string;
  name?: string;
}

interface ProfileLike {
  city?: string;
  name?: string;
}

interface RecentDiscovery {
  name: string;
  type: string;
  city: string;
}

export function buildUserContext(
  user: UserLike,
  profile: ProfileLike | null,
  preferences: UserPreferences | null,
  manifest: UserManifest | null,
  recentDiscoveries: RecentDiscovery[],
): string {
  const parts: string[] = [];

  // User identity
  const city = profile?.city || user.city || 'unknown';
  const name = profile?.name || user.name || user.code;
  parts.push(`## User\nName: ${name}\nCode: ${user.code}\nHome city: ${city}`);

  // Preferences (Layer 1)
  if (preferences) {
    const prefLines: string[] = [];
    if (preferences.interests?.length) prefLines.push(`Interests: ${preferences.interests.join(', ')}`);
    if (preferences.cuisines?.length) prefLines.push(`Cuisines: ${preferences.cuisines.join(', ')}`);
    if (preferences.vibes?.length) prefLines.push(`Vibes: ${preferences.vibes.join(', ')}`);
    if (preferences.avoidances?.length) prefLines.push(`Avoids: ${preferences.avoidances.join(', ')}`);
    if (prefLines.length > 0) {
      parts.push(`## Preferences\n${prefLines.join('\n')}`);
    }
  }

  // Active contexts (trips, outings, radars)
  const activeContexts = manifest?.contexts?.filter((c: Context) => c.active) || [];
  if (activeContexts.length > 0) {
    const ctxLines = activeContexts.map((ctx: Context) => {
      const dates = ctx.dates ? ` (${ctx.dates})` : '';
      const focus = ctx.focus?.length ? ` — Focus: ${ctx.focus.join(', ')}` : '';
      return `- ${ctx.emoji || '📍'} ${ctx.label}${dates}${focus}  [key: ${ctx.key}]`;
    });
    parts.push(`## Active Contexts\n${ctxLines.join('\n')}`);
  } else {
    parts.push(`## Contexts\nNo active trips, outings, or radars.`);
  }

  // Recent discoveries
  if (recentDiscoveries.length > 0) {
    const discLines = recentDiscoveries.map(
      (d) => `- ${d.name} (${d.type}) — ${d.city}`,
    );
    parts.push(`## Recent Discoveries\n${discLines.join('\n')}`);
  }

  // Tool usage instructions for the Concierge
  parts.push(`## Available Tools

When the user wants to plan or create a trip, outing, or radar, use the "create-context" tool.

When the user mentions dates, city, focus areas, or accommodation for an existing trip, use the "update-trip" tool.

When you find or recommend places (restaurants, bars, cafes, etc.), use the "add-discovery" tool to save them to the user's radar or trip.

Always confirm with the user before creating or updating contexts, and let them know when you've saved discoveries.`);

  return parts.join('\n\n');
}
