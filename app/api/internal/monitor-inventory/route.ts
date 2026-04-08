/**
 * Internal monitor inventory API.
 *
 * GET  /api/internal/monitor-inventory       → load full inventory for current user
 * POST /api/internal/monitor-inventory       → promote a place into the inventory
 * PUT  /api/internal/monitor-inventory       → record an observation on an entry
 * DELETE /api/internal/monitor-inventory?id= → remove an entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import {
  loadMonitorInventory,
  promoteToInventory,
  recordObservation,
  removeFromInventory,
  getDueEntries,
} from '../../../_lib/monitor-inventory';
import type { MonitorEntry } from '../../../_lib/monitor-inventory';

export const dynamic = 'force-dynamic';

// ---- GET: load inventory ----

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const inventory = await loadMonitorInventory(user.id);
  const { searchParams } = new URL(request.url);

  if (searchParams.get('due') === 'true') {
    return NextResponse.json({ entries: getDueEntries(inventory), updatedAt: inventory.updatedAt });
  }

  return NextResponse.json(inventory);
}

// ---- POST: promote a place ----

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Partial<MonitorEntry>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.discoveryId || !body.name || !body.monitorStatus || !body.monitorType) {
    return NextResponse.json(
      { error: 'Required: discoveryId, name, monitorStatus, monitorType' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const entry = await promoteToInventory({
    userId: user.id,
    entry: {
      id: body.place_id ?? body.discoveryId,
      place_id: body.place_id,
      discoveryId: body.discoveryId,
      name: body.name,
      city: body.city ?? '',
      address: body.address,
      type: body.type ?? 'general',
      contextKey: body.contextKey ?? '',
      monitorStatus: body.monitorStatus as Exclude<typeof body.monitorStatus, 'none'>,
      monitorType: body.monitorType,
      monitorReasons: body.monitorReasons ?? [],
      monitorDimensions: body.monitorDimensions ?? [],
      baselineState: body.baselineState,
      firstPromotedAt: now,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}

// ---- PUT: record an observation ----

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { entryId: string; observation: { observedAt: string; source: string; state: object; changeSummary?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.entryId || !body.observation?.state) {
    return NextResponse.json({ error: 'Required: entryId, observation.state' }, { status: 400 });
  }

  const entry = await recordObservation({
    userId: user.id,
    entryId: body.entryId,
    observation: {
      observedAt: body.observation.observedAt ?? new Date().toISOString(),
      source: body.observation.source ?? 'manual',
      state: body.observation.state as never,
      changeSummary: body.observation.changeSummary,
    },
  });

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  return NextResponse.json({ entry });
}

// ---- DELETE: remove an entry ----

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const entryId = searchParams.get('id');
  if (!entryId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await removeFromInventory({ userId: user.id, entryId });
  return NextResponse.json({ ok: true });
}
