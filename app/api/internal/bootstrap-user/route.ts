import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../../_lib/user';
import { getUserData } from '../../../_lib/user-data';
import { mergeAndWriteDiscoveries } from '../../../_lib/discovery-write';
import type { UserDiscoveries, Discovery, UserManifest } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.isOwner) return NextResponse.json({ error: 'Owner cannot be bootstrapped' }, { status: 400 });

  // Do not re-seed if user already has discoveries (including AI-generated ones)
  const existing = await getUserData(user.id, 'discoveries');
  if (existing?.discoveries && existing.discoveries.length > 0) {
    return NextResponse.json({ ok: true, seeded: 0, reason: 'already has discoveries' });
  }

  // Check if onboarding-complete is still running (recently created manifest but no discoveries yet)
  // Give AI discovery a few seconds head start before falling back to seeds
  const manifest = await getUserData(user.id, 'manifest') as UserManifest | null;
  if (manifest?.updatedAt) {
    const manifestAge = Date.now() - new Date(manifest.updatedAt).getTime();
    // If manifest was just created (< 10s ago), the AI discovery is probably still running
    if (manifestAge < 10_000) {
      return NextResponse.json({ ok: true, seeded: 0, reason: 'waiting for ai-discovery' });
    }
  }

  const seedPath = path.join(process.cwd(), 'data', 'seed-discoveries.json');
  if (!existsSync(seedPath)) {
    return NextResponse.json({ ok: true, seeded: 0, reason: 'no seed file' });
  }

  let seedData: { discoveries: Discovery[] };
  try {
    seedData = JSON.parse(readFileSync(seedPath, 'utf8'));
  } catch {
    return NextResponse.json({ error: 'Failed to read seed data' }, { status: 500 });
  }

  let targetContextKey = 'radar:toronto-experiences';
  if (manifest?.contexts) {
    const radarCtx = manifest.contexts.find(c => c.type === 'radar' || c.key.includes('experiences'));
    if (radarCtx) targetContextKey = radarCtx.key;
  }

  const userCity = manifest?.contexts?.[0]?.city || 'Toronto';
  const now = new Date().toISOString();

  const seededDiscoveries: Discovery[] = seedData.discoveries.map(d => ({
    ...d,
    id: user.id + '_' + d.id.replace('seed_', ''),
    contextKey: targetContextKey,
    discoveredAt: now,
    city: userCity,
  }));

  // Merge-only write — never overwrites existing discoveries (#204)
  const result = await mergeAndWriteDiscoveries(user.id, seededDiscoveries);

  return NextResponse.json({ ok: true, seeded: result.added, contextKey: targetContextKey });
}