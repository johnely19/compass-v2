/**
 * GET /api/internal/monitor-digest
 *
 * Returns a structured digest of recent significant monitoring changes.
 * Used by homepage (short window) and external teasers (longer window).
 *
 * Query params:
 *   userId      — required
 *   windowHours — lookback period (default: 168 = 7 days)
 *   minLevel    — 'critical' | 'notable' | 'routine' (default: 'routine')
 *   mode        — 'full' | 'homepage' | 'teaser' (default: 'full')
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadMonitorInventory } from '../../../_lib/monitor-inventory';
import {
  buildDigest,
  buildHomepageDigest,
  generateTeaser,
} from '../../../_lib/monitor-digest';
import type { SignificanceLevel } from '../../../_lib/observation-significance';

export const dynamic = 'force-dynamic';

const VALID_LEVELS: SignificanceLevel[] = ['critical', 'notable', 'routine'];
type DigestMode = 'full' | 'homepage' | 'teaser';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }

  const mode = (searchParams.get('mode') ?? 'full') as DigestMode;
  const inventory = await loadMonitorInventory(userId);

  if (inventory.entries.length === 0) {
    return NextResponse.json({
      mode,
      message: 'No monitored entries',
      totalEntries: 0,
    });
  }

  // Homepage mode: short window, notable+ only, compact
  if (mode === 'homepage') {
    const result = buildHomepageDigest(inventory);
    return NextResponse.json({
      mode: 'homepage',
      ...result,
      totalEntries: inventory.entries.length,
    });
  }

  // Teaser mode: just the notification text
  if (mode === 'teaser') {
    const digest = buildDigest({
      inventory,
      windowHours: 24,
      minLevel: 'notable',
      maxPerLevel: 5,
    });
    const teaser = generateTeaser(digest);
    return NextResponse.json({
      mode: 'teaser',
      teaser,
      hasChanges: teaser !== null,
      stats: digest.stats,
      totalEntries: inventory.entries.length,
    });
  }

  // Full mode: configurable
  const windowHoursRaw = searchParams.get('windowHours');
  const windowHours = windowHoursRaw ? parseInt(windowHoursRaw, 10) : 168;
  const minLevelRaw = searchParams.get('minLevel') as SignificanceLevel | null;
  const minLevel = minLevelRaw && VALID_LEVELS.includes(minLevelRaw) ? minLevelRaw : 'routine';

  const digest = buildDigest({
    inventory,
    windowHours: Number.isFinite(windowHours) ? windowHours : 168,
    minLevel,
    maxPerLevel: 10,
  });

  return NextResponse.json({
    mode: 'full',
    ...digest,
  });
}
