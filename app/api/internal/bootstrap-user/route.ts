import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getCurrentUser } from '../../../_lib/user';
import { getUserData, setUserData } from '../../../_lib/user-data';
import type { UserDiscoveries, Discovery, UserManifest } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.isOwner) return NextResponse.json({ error: 'Owner cannot be bootstrapped' }, { status: 400 });

  // Do not re-seed if user already has discoveries
  const existing = await getUserData(user.id, 'discoveries');
  if (existing?.discoveries && existing.discoveries.length > 0) {
    return NextResponse.json({ ok: true, seeded: 0, reason: 'already has discoveries' });
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

  const manifest = await getUserData(user.id, 'manifest') as UserManifest | null;

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

  const discoveries: UserDiscoveries = {
    discoveries: seededDiscoveries,
    updatedAt: now,
  };

  await setUserData(user.id, 'discoveries', discoveries);

  return NextResponse.json({ ok: true, seeded: seededDiscoveries.length, contextKey: targetContextKey });
}