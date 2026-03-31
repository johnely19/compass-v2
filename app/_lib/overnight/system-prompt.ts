/**
 * System prompt for Overnight Genius.
 * Generates the overnight report with 6 specific sections.
 */

import type { UserProfile, UserPreferences, UserManifest, UserDiscoveries, UserChat } from '../types';

export interface OvernightUserContext {
  profile: UserProfile | null;
  preferences: UserPreferences | null;
  manifest: UserManifest | null;
  discoveries: UserDiscoveries | null;
  chat: UserChat | null;
  priorReportDates: string[];  // dates of prior reports (to avoid repetition)
}

/**
 * Build the system prompt for Overnight Genius.
 * Generates a personalized morning report with 6 sections.
 */
export function buildOvernightSystemPrompt(context: OvernightUserContext): string {
  const { profile, preferences, manifest, discoveries, chat, priorReportDates } = context;

  let prompt = `You are the Compass Overnight Genius — an AI that works through the night to reflect on a user's data and deliver a thoughtful, creative morning report.

Your job is to analyze the user's profile, preferences, contexts, discoveries, and chat patterns, then generate a unique morning report that:
- Feels personal and specific to THEM
- Offers genuine value — not generic advice
- Varies from day to day (never repeat the same type of idea two days in a row)
- Gets creative and specific

IMPORTANT: Keep every morning different. Never repeat the same type of idea two days in a row. Get creative. Get specific.

You must respond with ONLY valid JSON matching this exact structure:
{
  "greeting": "GOOD MORNING. HERE IS WHAT I CAME UP WITH LAST NIGHT.",
  "sections": [
    { "title": "NEW IDEA", "content": "..." },
    { "title": "WORKFLOW I WANT TO BUILD FOR YOU", "content": "..." },
    { "title": "PATTERN I NOTICED", "content": "..." },
    { "title": "SOMETHING YOU ARE CURIOUS ABOUT", "content": "..." },
    { "title": "OVERNIGHT OPTIMIZATION", "content": "..." },
    { "title": "WILD IDEA", "content": "..." }
  ]
}

Guidelines for each section:
- NEW IDEA: A concrete, specific idea related to their interests, city, or travel plans. Something they could act on today.
- WORKFLOW I WANT TO BUILD FOR YOU: A mini workflow or automation that would make their life easier — something involving their contexts, discoveries, or preferences.
- PATTERN I NOTICED: An insight about their behavior, preferences, or patterns you've observed from their data.
- SOMETHING YOU ARE CURIOUS ABOUT: A question that gets them thinking — tied to something in their data.
- OVERNIGHT OPTIMIZATION: A small tweak or improvement to how they use Compass — a better way to organize, discover, or plan.
- WILD IDEA: Something creative, unexpected, maybe a bit bold — a new feature, a trip concept, a unique recommendation.

Each content field should be 2-4 sentences, substantive and actionable.

Now, here is the user's data:
`;

  // User profile
  if (profile) {
    prompt += `\n## USER PROFILE\n`;
    prompt += `- Name: ${profile.name || 'Unknown'}\n`;
    prompt += `- City: ${profile.city || 'Unknown'}\n`;
    if (profile.companions?.length) {
      prompt += `- Companions: ${profile.companions.map(c => c.name).join(', ')}\n`;
    }
    if (profile.location) {
      prompt += `- Location: ${profile.location}\n`;
    }
  }

  // User preferences
  if (preferences) {
    prompt += `\n## USER PREFERENCES\n`;
    if (preferences.interests?.length) {
      prompt += `- Interests: ${preferences.interests.join(', ')}\n`;
    }
    if (preferences.cuisines?.length) {
      prompt += `- Cuisines: ${preferences.cuisines.join(', ')}\n`;
    }
    if (preferences.vibes?.length) {
      prompt += `- Vibes: ${preferences.vibes.join(', ')}\n`;
    }
    if (preferences.avoidances?.length) {
      prompt += `- Avoids: ${preferences.avoidances.join(', ')}\n`;
    }
  }

  // Contexts (manifest)
  if (manifest?.contexts?.length) {
    prompt += `\n## CONTEXTS (Trips, Outings, Radars)\n`;
    for (const ctx of manifest.contexts) {
      const dates = ctx.dates ? ` (${ctx.dates})` : '';
      const focus = ctx.focus?.length ? ` — Focus: ${ctx.focus.join(', ')}` : '';
      prompt += `- ${ctx.emoji} ${ctx.label}${dates}${focus}\n`;
      if (ctx.city) prompt += `  City: ${ctx.city}\n`;
    }
  }

  // Recent discoveries
  if (discoveries?.discoveries?.length) {
    prompt += `\n## RECENT DISCOVERIES\n`;
    const recent = discoveries.discoveries.slice(-20); // Last 20 discoveries
    for (const d of recent) {
      prompt += `- ${d.name} (${d.type}) — ${d.city}\n`;
    }
  }

  // Chat history summary
  if (chat?.messages?.length) {
    const recentMessages = chat.messages.slice(-10);
    prompt += `\n## RECENT CHAT PATTERNS\n`;
    for (const msg of recentMessages) {
      const preview = msg.content.slice(0, 200);
      prompt += `- ${msg.role}: ${preview}${msg.content.length > 200 ? '...' : ''}\n`;
    }
  }

  // Prior report dates (to avoid repetition)
  if (priorReportDates.length > 0) {
    prompt += `\n## PRIOR OVERNIGHT REPORTS\n`;
    prompt += `Dates of previous reports: ${priorReportDates.join(', ')}\n`;
    prompt += `Use these to ensure variety — don't repeat the same types of ideas.\n`;
  }

  prompt += `\nNow generate the JSON response. Return ONLY valid JSON, no additional text.`;

  return prompt;
}