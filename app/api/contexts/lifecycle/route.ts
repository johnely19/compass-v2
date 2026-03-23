/* ============================================================
   Context Lifecycle API
   GET: returns contexts with computed lifecycle status
   POST: update context status (pause/resume/archive/complete)
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getUserManifest, setUserData } from '../../../_lib/user-data';
import {
  getContextStatus,
  shouldAutoComplete,
  transitionContext,
} from '../../../_lib/context-lifecycle';
import type { ContextStatus } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const manifest = await getUserManifest(user.id);
  if (!manifest) {
    return NextResponse.json({ contexts: [], autoCompleteCandidates: [] });
  }

  const contexts = manifest.contexts.map(ctx => ({
    ...ctx,
    computedStatus: getContextStatus(ctx),
    shouldAutoComplete: shouldAutoComplete(ctx),
  }));

  const autoCompleteCandidates = contexts
    .filter(c => c.shouldAutoComplete)
    .map(c => c.key);

  return NextResponse.json({ contexts, autoCompleteCandidates });
}

interface LifecycleAction {
  contextKey: string;
  action: 'pause' | 'resume' | 'complete' | 'archive';
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: LifecycleAction;
  try {
    body = (await request.json()) as LifecycleAction;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.contextKey || !body.action) {
    return NextResponse.json(
      { error: 'contextKey and action are required' },
      { status: 400 }
    );
  }

  const validActions = ['pause', 'resume', 'complete', 'archive'] as const;
  if (!validActions.includes(body.action as typeof validActions[number])) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 }
    );
  }

  const manifest = await getUserManifest(user.id);
  if (!manifest) {
    return NextResponse.json({ error: 'No manifest found' }, { status: 404 });
  }

  const contextIndex = manifest.contexts.findIndex(c => c.key === body.contextKey);
  if (contextIndex === -1) {
    return NextResponse.json(
      { error: `Context not found: ${body.contextKey}` },
      { status: 404 }
    );
  }

  const context = manifest.contexts[contextIndex];
  if (!context) {
    return NextResponse.json({ error: 'Context not found' }, { status: 404 });
  }

  const updated = transitionContext(context, body.action);
  if (!updated) {
    const currentStatus = getContextStatus(context);
    return NextResponse.json(
      { error: `Cannot ${body.action} a ${context.type} with status '${currentStatus}'` },
      { status: 400 }
    );
  }

  manifest.contexts[contextIndex] = updated;
  manifest.updatedAt = new Date().toISOString();

  await setUserData(user.id, 'manifest', manifest);

  return NextResponse.json({
    ok: true,
    context: {
      key: updated.key,
      status: getContextStatus(updated),
      type: updated.type,
    },
  });
}
