import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserManifest, setUserData } from '../../../_lib/user-data';
import type { Context, ContextType } from '../../../_lib/types';

/** Generate kebab-case slug from label */
function kebabSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Validate context type */
function isValidContextType(type: string): type is ContextType {
  return ['trip', 'outing', 'radar'].includes(type);
}

/** Default emojis by type */
const DEFAULT_EMOJI: Record<ContextType, string> = {
  trip: '✈️',
  outing: '🚶',
  radar: '📡',
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { type, label, city, dates, focus, emoji } = body;

    // Validate required fields
    if (!type || typeof type !== 'string') {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }
    if (!label || typeof label !== 'string') {
      return NextResponse.json({ error: 'label is required' }, { status: 400 });
    }

    if (!isValidContextType(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: trip, outing, radar` },
        { status: 400 },
      );
    }

    const slug = kebabSlug(label);
    const key = `${type}:${slug}`;

    // Get existing manifest
    const manifest = await getUserManifest(user.id);
    const contexts: Context[] = manifest?.contexts || [];

    // Check for duplicate key
    const existing = contexts.find((c) => c.key === key);
    if (existing) {
      return NextResponse.json(
        { error: `Context '${key}' already exists` },
        { status: 409 },
      );
    }

    // Create new context
    const newContext: Context = {
      key,
      label,
      emoji: emoji || DEFAULT_EMOJI[type],
      type,
      city: city || undefined,
      dates: dates || undefined,
      focus: Array.isArray(focus) ? focus : [],
      active: true,
    };

    // Save updated manifest
    await setUserData(user.id, 'manifest', {
      contexts: [...contexts, newContext],
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      key: newContext.key,
      label: newContext.label,
      type: newContext.type,
      emoji: newContext.emoji,
    });
  } catch (err) {
    console.error('[api/compass/create-context]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}