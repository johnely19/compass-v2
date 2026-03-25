/* ============================================================
   User Onboarding API
   POST /api/user/onboard
   Creates the user's manifest + preferences from onboarding input
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { setUserData } from '../../../_lib/user-data';
import type { UserManifest, UserPreferences } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

interface OnboardingInput {
  city: string;
  selections: Array<'trip' | 'date-night' | 'grocery' | 'experiences' | 'cottage' | 'skip'>;
  tripDestination?: string;
  tripDates?: string;
  dateNightWith?: string;
  city_area?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Owner already has a manifest — skip
  if (user.isOwner) {
    return NextResponse.json({ error: 'Owner cannot be onboarded' }, { status: 400 });
  }

  let body: OnboardingInput;
  try {
    body = await request.json() as OnboardingInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { city, selections } = body;
  if (!city) return NextResponse.json({ error: 'city required' }, { status: 400 });

  const citySlug = slugify(city);
  const now = new Date().toISOString();
  const contexts: UserManifest['contexts'] = [];

  for (const sel of selections) {
    if (sel === 'skip') continue;

    if (sel === 'trip' && body.tripDestination) {
      const dest = body.tripDestination;
      const destSlug = slugify(dest);
      contexts.push({
        key: `trip:${destSlug}`,
        label: `${dest} Trip`,
        emoji: '✈️',
        type: 'trip',
        city: dest,
        dates: body.tripDates || undefined,
        focus: ['food', 'culture', 'experiences'],
        active: true,
      });
    }

    if (sel === 'date-night') {
      const who = body.dateNightWith || '';
      const slug = who ? `date-night-${slugify(who)}` : 'date-night';
      contexts.push({
        key: `outing:${slug}`,
        label: who ? `Date Night with ${who}` : 'Date Night',
        emoji: '🍷',
        type: 'outing',
        city,
        focus: ['intimate', 'wine bar', 'nice dinner'],
        active: true,
      });
    }

    if (sel === 'grocery') {
      contexts.push({
        key: 'radar:premium-grocery',
        label: 'Premium Grocery Shopping',
        emoji: '🥬',
        type: 'radar',
        city,
        focus: ['exceptional produce', 'specialty stores', 'quality ingredients'],
        active: true,
      });
    }

    if (sel === 'experiences') {
      contexts.push({
        key: `radar:${citySlug}-experiences`,
        label: `${city} Experiences`,
        emoji: '🌆',
        type: 'radar',
        city,
        focus: ['local gems', 'new openings', 'culture', 'food'],
        active: true,
      });
    }

    if (sel === 'cottage') {
      const year = new Date().getFullYear();
      contexts.push({
        key: `trip:cottage-${year}`,
        label: `Cottage ${year}`,
        emoji: '🏡',
        type: 'trip',
        city: 'Ontario',
        focus: ['waterfront', 'swimming', 'private'],
        active: true,
      });
    }
  }

  // Always add a local experiences radar if nothing else matches
  if (contexts.length === 0) {
    contexts.push({
      key: `radar:${citySlug}-experiences`,
      label: `${city} Experiences`,
      emoji: '🌆',
      type: 'radar',
      city,
      focus: ['local gems', 'culture', 'food'],
      active: true,
    });
  }

  const manifest: UserManifest = {
    contexts,
    updatedAt: now,
  };

  // Basic preferences
  const preferences: UserPreferences = {
    interests: ['food', 'culture', 'local experiences'],
    updatedAt: now,
  };

  await Promise.all([
    setUserData(user.id, 'manifest', manifest),
    setUserData(user.id, 'preferences', preferences),
  ]);

  return NextResponse.json({
    ok: true,
    contextsCreated: contexts.length,
    contexts: contexts.map(c => ({ key: c.key, label: c.label })),
  });
}
