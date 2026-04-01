/* ============================================================
   Onboarding Complete — Trigger Immediate Discovery Run
   POST /api/internal/onboarding-complete

   When a new user finishes onboarding, this endpoint triggers
   an AI-powered discovery run based on their city, interests,
   and optional trip. Populates their homepage within minutes.

   Called fire-and-forget from OnboardingClient after /api/user/onboard.
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserData, setUserData } from '../../../_lib/user-data';
import type {
  UserManifest,
  UserPreferences,
  UserDiscoveries,
  Discovery,
  DiscoveryType,
} from '../../../_lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for AI discovery

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

/* ---------- Types ---------- */

interface DiscoveryCandidate {
  name: string;
  address?: string;
  city: string;
  type: DiscoveryType;
  description: string;
  why: string;
  rating?: number;
}

interface DiscoveryRunResult {
  contextKey: string;
  discoveries: Discovery[];
}

/* ---------- Google Places verification ---------- */

async function verifyPlace(
  name: string,
  city: string,
): Promise<{ place_id: string; address: string; rating: number; ratingCount: number } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.businessStatus',
      },
      body: JSON.stringify({ textQuery: `${name} ${city}`, maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data.places?.[0];
    if (!p || p.businessStatus === 'CLOSED_PERMANENTLY') return null;
    return {
      place_id: p.id,
      address: p.formattedAddress || '',
      rating: p.rating || 0,
      ratingCount: p.userRatingCount || 0,
    };
  } catch {
    return null;
  }
}

/* ---------- AI Discovery Generation ---------- */

async function generateDiscoveries(
  city: string,
  interests: string[],
  focus: string[],
  contextLabel: string,
  count: number = 8,
): Promise<DiscoveryCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const interestStr = interests.length > 0 ? interests.join(', ') : 'food, culture, local experiences';
  const focusStr = focus.length > 0 ? focus.join(', ') : 'local gems, culture, food';

  const prompt = `You are a world-class travel concierge. A new user just signed up for a discovery app. Generate ${count} outstanding place recommendations for them.

User info:
- City: ${city}
- Interests: ${interestStr}
- Focus: ${focusStr}
- Context: ${contextLabel}

Requirements:
- Return EXACTLY ${count} places as a JSON array
- Each place must be a REAL, currently operating place (not fictional)
- Mix of types: restaurants, bars, cafes, galleries, music venues, experiences, shops, parks, architecture
- Prioritize places that match their interests
- Include hidden gems and well-known-but-excellent spots
- Each entry needs: name, city, type (one of: restaurant, bar, cafe, grocery, gallery, museum, theatre, music-venue, hotel, experience, shop, park, architecture), description (2-3 sentences), why (one-liner hook)
- Optionally include address if you know it

Return ONLY valid JSON array, no markdown, no explanation. Example format:
[{"name":"Bar Isabel","city":"Toronto","type":"bar","description":"Legendary Spanish tapas bar on College St. Packed nightly with good reason — the bone marrow is transcendent, the patatas bravas perfect.","why":"The bone marrow alone is worth the wait"},{"name":"AGO","city":"Toronto","type":"gallery","description":"Art Gallery of Ontario. Frank Gehry's stunning renovation houses Canadian and international art spanning centuries.","why":"Gehry's architecture meets world-class Canadian art"}]`;

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[onboarding-complete] Anthropic error:', res.status);
      return [];
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[onboarding-complete] Failed to parse AI response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as DiscoveryCandidate[];
    return parsed.filter(
      (d) => d.name && d.city && d.type && d.description,
    );
  } catch (e) {
    console.error('[onboarding-complete] AI generation failed:', e);
    return [];
  }
}

/* ---------- Build discoveries from candidates ---------- */

async function buildDiscoveries(
  candidates: DiscoveryCandidate[],
  contextKey: string,
  userId: string,
): Promise<Discovery[]> {
  const now = new Date().toISOString();
  const discoveries: Discovery[] = [];

  // Verify places in parallel (batch of 5 to avoid rate limits)
  const batchSize = 5;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const verified = await Promise.all(
      batch.map((c) => verifyPlace(c.name, c.city)),
    );

    for (let j = 0; j < batch.length; j++) {
      const candidate = batch[j]!;
      const placeData = verified[j];

      const id = `onboard_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      discoveries.push({
        id,
        place_id: placeData?.place_id,
        name: candidate.name,
        address: placeData?.address || candidate.address,
        city: candidate.city,
        type: candidate.type,
        rating: placeData?.rating || candidate.rating,
        ratingCount: placeData?.ratingCount,
        contextKey,
        source: 'onboarding:ai-discovery',
        discoveredAt: now,
        placeIdStatus: placeData?.place_id ? 'verified' : 'missing',
        description: candidate.description,
      });
    }
  }

  return discoveries;
}

/* ---------- Main handler ---------- */

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Don't re-run if user already has onboarding discoveries
  const existing = await getUserData(user.id, 'discoveries');
  if (
    existing?.discoveries &&
    existing.discoveries.some((d: Discovery) => d.source === 'onboarding:ai-discovery')
  ) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'already has onboarding discoveries',
    });
  }

  // Load user's manifest and preferences
  const [manifest, preferences] = await Promise.all([
    getUserData(user.id, 'manifest') as Promise<UserManifest | null>,
    getUserData(user.id, 'preferences') as Promise<UserPreferences | null>,
  ]);

  if (!manifest?.contexts || manifest.contexts.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'No contexts found — onboarding incomplete',
    }, { status: 400 });
  }

  const interests = preferences?.interests || ['food', 'culture', 'local experiences'];
  const allDiscoveries: Discovery[] = [];
  const results: DiscoveryRunResult[] = [];

  // Run discovery for each active context (radar + trips)
  const activeContexts = manifest.contexts.filter((c) => c.active);

  for (const ctx of activeContexts) {
    const city = ctx.city || 'Toronto';
    const focus = ctx.focus || [];
    const contextLabel =
      ctx.type === 'trip'
        ? `Trip to ${city}${ctx.dates ? ` (${ctx.dates})` : ''}`
        : ctx.type === 'outing'
          ? `${ctx.label} in ${city}`
          : `Local radar for ${city}`;

    // More discoveries for the primary radar, fewer for trips/outings
    const count = ctx.type === 'radar' ? 8 : 6;

    console.log(`[onboarding-complete] Generating ${count} discoveries for ${ctx.key} (${city})`);

    const candidates = await generateDiscoveries(
      city,
      interests,
      focus,
      contextLabel,
      count,
    );

    if (candidates.length > 0) {
      const discoveries = await buildDiscoveries(candidates, ctx.key, user.id);
      allDiscoveries.push(...discoveries);
      results.push({ contextKey: ctx.key, discoveries });
      console.log(
        `[onboarding-complete] ✅ ${discoveries.length} discoveries for ${ctx.key}`,
      );
    }
  }

  if (allDiscoveries.length === 0) {
    // Fallback: if AI generation failed, let bootstrap-user handle it
    console.log('[onboarding-complete] No AI discoveries generated, falling back to seed data');
    return NextResponse.json({ ok: true, generated: 0, fallback: true });
  }

  // Merge with any existing discoveries
  const existingDiscoveries = existing?.discoveries || [];
  const merged = [...allDiscoveries, ...existingDiscoveries];

  await setUserData(user.id, 'discoveries', {
    discoveries: merged,
    updatedAt: new Date().toISOString(),
  } as UserDiscoveries);

  console.log(
    `[onboarding-complete] ✅ Total: ${allDiscoveries.length} discoveries across ${results.length} contexts for user ${user.id}`,
  );

  // Fire-and-forget: trigger photo enrichment for verified places
  const verifiedPlaceIds = allDiscoveries
    .filter((d) => d.place_id)
    .map((d) => d.place_id);

  if (verifiedPlaceIds.length > 0) {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || 'https://compass-v2-lake.vercel.app';

    fetch(`${baseUrl}/api/internal/enrich-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BRIEFING_INGEST_TOKEN || ''}`,
      },
      body: JSON.stringify({ placeIds: verifiedPlaceIds }),
    }).catch(() => {}); // fire-and-forget
  }

  return NextResponse.json({
    ok: true,
    generated: allDiscoveries.length,
    contexts: results.map((r) => ({
      key: r.contextKey,
      count: r.discoveries.length,
    })),
  });
}
