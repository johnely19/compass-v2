/**
 * Build a user-context system message for the OpenClaw Concierge agent.
 *
 * This replaces the old monolithic system prompt — the Concierge agent's
 * personality and tool definitions now live in OpenClaw's agent config.
 * We only need to inject who the user is, their preferences, and known contexts
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

type RichContext = Context & Record<string, unknown>;

function truncate(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function isContextActive(context: Context): boolean {
  if (context.status) return context.status === 'active';
  return Boolean(context.active);
}

function summarizeContext(context: Context): string {
  const raw = context as RichContext;
  const status = typeof raw.status === 'string' && raw.status.length > 0
    ? raw.status
    : raw.active ? 'active' : 'inactive';
  const bookingStatus = typeof raw.bookingStatus === 'string' ? raw.bookingStatus : '';
  const facts = [
    context.city ? `Location: ${context.city}` : '',
    context.dates ? `Dates: ${context.dates}` : '',
    context.focus?.length ? `Focus: ${context.focus.join(', ')}` : '',
    bookingStatus ? `Booking: ${bookingStatus}` : '',
  ].filter(Boolean);

  const extras = [
    raw.accommodation && typeof raw.accommodation === 'object'
      ? `Accommodation: ${[
          typeof (raw.accommodation as { name?: unknown }).name === 'string' ? (raw.accommodation as { name: string }).name : '',
          typeof (raw.accommodation as { address?: unknown }).address === 'string' ? (raw.accommodation as { address: string }).address : '',
        ].filter(Boolean).join(', ')}`
      : '',
    typeof raw.purpose === 'string' && raw.purpose.trim() ? `Purpose: ${truncate(raw.purpose)}` : '',
    typeof raw.notes === 'string' && raw.notes.trim() ? `Notes: ${truncate(raw.notes)}` : '',
  ].filter(Boolean);

  return [
    `- ${context.emoji || '📍'} ${context.label} [${context.type}, ${status}${bookingStatus ? `, booking: ${bookingStatus}` : ''}] [key: ${context.key}]`,
    ...(facts.length > 0 ? [`  ${facts.join(' · ')}`] : []),
    ...extras.slice(0, 2).map((extra) => `  ${extra}`),
  ].join('\n');
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

  const allContexts = manifest?.contexts || [];
  if (allContexts.length > 0) {
    const activeContexts = allContexts.filter(isContextActive);
    const otherContexts = allContexts.filter((context) => !isContextActive(context));

    if (activeContexts.length > 0) {
      parts.push(`## Active Contexts\n${activeContexts.map(summarizeContext).join('\n')}`);
    }

    if (otherContexts.length > 0) {
      parts.push(`## Other Known Contexts\n${otherContexts.map(summarizeContext).join('\n')}`);
    }
  } else {
    parts.push(`## Contexts\nNo saved trips, outings, or radars.`);
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

When the user mentions dates, city, focus areas, accommodation, or other known trip details for an existing trip, use the "update-trip" tool.

When you find or recommend places (restaurants, bars, cafes, etc.), use the "add-discovery" tool to save them to the user's radar or trip.

Always confirm with the user before creating or updating contexts, and let them know when you've saved discoveries.`);

  return parts.join('\n\n');
}
