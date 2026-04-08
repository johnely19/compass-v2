import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserManifest, setUserData } from '../../../_lib/user-data';
import type { Context } from '../../../_lib/types';

interface UpdateFields {
  dates?: string;
  city?: string;
  focus?: string[];
  accommodation?: string;
}

interface Change {
  field: string;
  value: string | string[];
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { contextKey, dates, city, focus, accommodation } = body;

    if (!contextKey || typeof contextKey !== 'string') {
      return NextResponse.json({ error: 'contextKey is required' }, { status: 400 });
    }

    // Build update object with only provided fields
    const updates: UpdateFields = {};
    if (dates !== undefined) updates.dates = dates;
    if (city !== undefined) updates.city = city;
    if (focus !== undefined) updates.focus = focus;
    if (accommodation !== undefined) updates.accommodation = accommodation;

    // No updates provided
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'At least one of dates, city, focus, or accommodation is required' },
        { status: 400 },
      );
    }

    // Get existing manifest
    const manifest = await getUserManifest(user.id);
    const contexts: Context[] = manifest?.contexts || [];

    // Find context by key (supports prefix matching too)
    const contextIndex = contexts.findIndex(
      (c) => c.key === contextKey || c.key.startsWith(`${contextKey}:`),
    );

    if (contextIndex === -1) {
      return NextResponse.json(
        { error: `Context '${contextKey}' not found` },
        { status: 404 },
      );
    }

    const context = contexts[contextIndex];
    if (!context) {
      return NextResponse.json(
        { error: `Context '${contextKey}' not found` },
        { status: 404 },
      );
    }
    const changes: Change[] = [];

    // Apply updates and record changes
    if (dates !== undefined && context.dates !== dates) {
      changes.push({ field: 'dates', value: dates });
      context.dates = dates;
    }
    if (city !== undefined && context.city !== city) {
      changes.push({ field: 'city', value: city });
      context.city = city;
    }
    if (focus !== undefined) {
      const focusStr = focus.join(', ');
      const currentFocusStr = (context.focus || []).join(', ');
      if (focusStr !== currentFocusStr) {
        changes.push({ field: 'focus', value: focus });
        context.focus = focus;
      }
    }
    if (accommodation !== undefined && context.accommodation !== accommodation) {
      changes.push({ field: 'accommodation', value: accommodation });
      context.accommodation = accommodation;
    }

    // Save updated manifest
    await setUserData(user.id, 'manifest', {
      contexts,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      updated: true,
      changes,
    });
  } catch (err) {
    console.error('[api/compass/update-trip]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}