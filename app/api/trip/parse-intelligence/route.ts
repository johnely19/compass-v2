/* ============================================================
   #83 — Trip Intelligence Parser (revised)
   POST /api/trip/parse-intelligence
   
   TWO outputs:
   1. Trip fields → compass-manifest.json context (append-only)
   2. Preference signals → users/{userId}/preferences.json in Blob
   
   Returns suggestions for USER.md (not auto-written)
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { put, list, del } from '@vercel/blob';
import { getCurrentUser, loadUsers } from '../../../_lib/user';
import { getUserManifest, setUserData } from '../../../_lib/user-data';

export const dynamic = 'force-dynamic';

interface ParseRequest {
  text: string;
  contextKey: string;
}

interface PreferenceSignals {
  art_galleries?: boolean;
  natural_wine?: boolean;
  jazz?: boolean;
  comedy?: boolean;
  food_adventurous?: boolean;
  family_travel?: boolean;
  solo_travel?: boolean;
  urban_explorer?: boolean;
  likes_neighbourhoods?: string[];
  preferred_cities?: string[];
  not_interested?: string[];
}

async function callClaude(prompt: string, maxTokens = 1200): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text?.trim() || null;
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return {};
    return JSON.parse(m[0]);
  } catch { return null; }
}

// ── Pass 1: Extract trip fields ──────────────────────────────
async function extractTripFields(
  text: string,
  contextKey: string,
  existing: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const prompt = `Extract trip planning information from this text. Return ONLY new info not already in "existing".

Context: ${contextKey}
Existing (don't repeat):
${JSON.stringify({ purpose: existing.purpose, people: existing.people, schedule: existing.schedule, priorities: existing.priorities, anchor_experiences: existing.anchor_experiences }, null, 2)}

Text: "${text}"

Fields to extract (omit if empty/already known):
- purpose: string — one-line trip purpose
- people: [{name, relation?, base?, note?}]
- schedule: [{date (YYYY-MM-DD), notes}]
- priorities: string[]
- anchor_experiences: [{name, type?, note?}]
- not_this_trip: string[]
- base: {address?, host?, zone?}

Infer dates from context. Return ONLY valid JSON.`;

  const result = await callClaude(prompt);
  if (!result) return {};
  return extractJson(result) || {};
}

// ── Pass 2: Extract preference signals ──────────────────────
async function extractPreferences(
  text: string,
  tripFields: Record<string, unknown>,
  contextKey: string
): Promise<{ signals: PreferenceSignals; suggestions: string[] }> {
  const prompt = `Analyze this trip information and extract permanent preference signals about the user.

Trip context: ${contextKey}
Text: "${text}"
Trip fields extracted: ${JSON.stringify(tripFields, null, 2)}

Extract preference signals that reveal ONGOING interests (not just one-off things):
Return JSON with these optional fields (only include if clearly evidenced):
{
  "signals": {
    "art_galleries": boolean,     // visits major gallery exhibitions
    "natural_wine": boolean,      // seeks out natural wine bars
    "jazz": boolean,              // goes to jazz venues
    "comedy": boolean,            // attends comedy shows
    "food_adventurous": boolean,  // seeks unusual/ethnic cuisine
    "family_travel": boolean,     // often travels involving family
    "solo_travel": boolean,       // travels solo / values solo time
    "urban_explorer": boolean,    // explores neighborhoods on foot
    "likes_neighbourhoods": ["Williamsburg", "Ridgewood"],  // specific hoods
    "preferred_cities": ["New York", "Toronto"],
    "not_interested": ["theatre"]  // explicit dislikes this trip
  },
  "suggestions": [
    "Add 'art galleries' to permanent preferences — you visit major exhibitions on every NYC trip",
    "Note: Brooklyn (Williamsburg → Ridgewood corridor) appears to be a consistent base"
  ]
}

Be conservative — only flag true ongoing patterns. Return ONLY valid JSON.`;

  const result = await callClaude(prompt, 800);
  if (!result) return { signals: {}, suggestions: [] };
  const parsed = extractJson(result);
  if (!parsed) return { signals: {}, suggestions: [] };
  return {
    signals: (parsed.signals as PreferenceSignals) || {},
    suggestions: (parsed.suggestions as string[]) || [],
  };
}

// ── Merge trip fields (append-only) ─────────────────────────
function mergeTripFields(
  existing: Record<string, unknown>,
  newData: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  if (newData.purpose && !existing.purpose) merged.purpose = newData.purpose;
  for (const field of ['people', 'priorities', 'anchor_experiences', 'not_this_trip']) {
    if (!Array.isArray(newData[field])) continue;
    const arr = Array.isArray(existing[field]) ? existing[field] as unknown[] : [];
    const additions = (newData[field] as unknown[]).filter((item: unknown) => {
      const name = (item as Record<string, unknown>)?.name ?? item;
      return !arr.some(e => ((e as Record<string, unknown>)?.name ?? e) === name);
    });
    if (additions.length) merged[field] = [...arr, ...additions];
  }
  if (Array.isArray(newData.schedule)) {
    const existing_sched = (Array.isArray(existing.schedule) ? existing.schedule : []) as Array<{ date: string }>;
    const existing_dates = new Set(existing_sched.map(d => d.date));
    const newDays = (newData.schedule as Array<{ date: string }>).filter(d => !existing_dates.has(d.date));
    if (newDays.length) {
      merged.schedule = [...existing_sched, ...newDays].sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (newData.base && typeof newData.base === 'object') {
    merged.base = { ...(existing.base as object || {}), ...(newData.base as object) };
  }
  return merged;
}

// ── Merge preferences (OR booleans, union arrays) ────────────
async function mergeAndSavePreferences(
  userId: string,
  newSignals: PreferenceSignals
): Promise<void> {
  const blobPath = `users/${userId}/preferences.json`;

  // Load existing
  let existing: Record<string, unknown> = { interests: [], cuisines: [], vibes: [], updatedAt: '' };
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    if (blobs[0]) {
      const r = await fetch(blobs[0].url);
      if (r.ok) existing = await r.json();
    }
  } catch { /* start fresh */ }

  // Merge signal booleans as tags into interests array
  const interests = Array.isArray(existing.interests) ? [...existing.interests as string[]] : [];
  const boolSignals: Record<string, string> = {
    art_galleries: 'art galleries',
    natural_wine: 'natural wine',
    jazz: 'jazz',
    comedy: 'comedy',
    food_adventurous: 'adventurous food',
    family_travel: 'family travel',
    solo_travel: 'solo travel',
    urban_explorer: 'urban exploration',
  };

  for (const [key, label] of Object.entries(boolSignals)) {
    if ((newSignals as Record<string, unknown>)[key] === true && !interests.includes(label)) {
      interests.push(label);
    }
  }

  // Union array signals
  const likes = Array.isArray(existing.likes_neighbourhoods) ? existing.likes_neighbourhoods as string[] : [];
  const newLikes = [...new Set([...likes, ...(newSignals.likes_neighbourhoods || [])])];

  const cities = Array.isArray(existing.preferred_cities) ? existing.preferred_cities as string[] : [];
  const newCities = [...new Set([...cities, ...(newSignals.preferred_cities || [])])];

  const updated = {
    ...existing,
    interests,
    likes_neighbourhoods: newLikes,
    preferred_cities: newCities,
    updatedAt: new Date().toISOString(),
  };

  // Save back to Blob
  try {
    const { blobs } = await list({ prefix: blobPath, limit: 1 });
    if (blobs[0]) await del(blobs[0].url);
  } catch { /* ignore */ }

  await put(blobPath, JSON.stringify(updated, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

// ── Main handler ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ParseRequest;
  try { body = await request.json() as ParseRequest; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.text || !body.contextKey) {
    return NextResponse.json({ error: 'text and contextKey required' }, { status: 400 });
  }

  const manifest = await getUserManifest(user.id);
  if (!manifest) return NextResponse.json({ error: 'No manifest' }, { status: 404 });

  const ctxIndex = manifest.contexts.findIndex(c => c.key === body.contextKey);
  if (ctxIndex < 0) return NextResponse.json({ error: 'Context not found' }, { status: 404 });

  const existing = manifest.contexts[ctxIndex] as unknown as Record<string, unknown>;

  // ── Pass 1: Trip fields ──
  const tripFields = await extractTripFields(body.text, body.contextKey, existing);
  const hasTripChanges = Object.keys(tripFields).length > 0;

  // ── Pass 2: Preferences ──
  const { signals, suggestions } = await extractPreferences(body.text, tripFields, body.contextKey);
  const hasPrefs = Object.keys(signals).length > 0;

  // ── Save trip fields ──
  if (hasTripChanges) {
    const updated = mergeTripFields(existing, tripFields);
    manifest.contexts[ctxIndex] = updated as unknown as typeof manifest.contexts[0];
    manifest.updatedAt = new Date().toISOString();
    await setUserData(user.id, 'manifest', manifest);

    // Also update local manifest for owner
    const users = loadUsers();
    if (users.users[user.id]?.isOwner) {
      try {
        const { readFileSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const localPath = join(process.cwd(), 'data', 'compass-manifest.json');
        const local = JSON.parse(readFileSync(localPath, 'utf8'));
        const localIdx = local.contexts.findIndex((c: { key: string }) => c.key === body.contextKey);
        if (localIdx >= 0) {
          local.contexts[localIdx] = mergeTripFields(local.contexts[localIdx] as Record<string, unknown>, tripFields);
          local.updatedAt = new Date().toISOString();
          writeFileSync(localPath, JSON.stringify(local, null, 2));
        }
      } catch { /* ignore */ }
    }
  }

  // ── Save preferences ──
  if (hasPrefs) {
    await mergeAndSavePreferences(user.id, signals);
  }

  // ── Build confirmation message ──
  const prefCount = Object.values(signals).filter(v => v === true || (Array.isArray(v) && v.length > 0)).length;
  const tripFieldCount = Object.keys(tripFields).length;

  const message = [
    hasTripChanges ? `Trip updated · ${tripFieldCount} field${tripFieldCount !== 1 ? 's' : ''} added` : '',
    hasPrefs ? `${prefCount} preference signal${prefCount !== 1 ? 's' : ''} learned` : '',
  ].filter(Boolean).join(' · ') || 'No new information found';

  return NextResponse.json({
    message,
    tripFields: hasTripChanges ? tripFields : null,
    preferences: hasPrefs ? signals : null,
    suggestions: suggestions.length > 0 ? suggestions : null,
    prefCount,
    tripFieldCount,
  });
}
