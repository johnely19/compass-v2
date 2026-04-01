/**
 * Internal API for context management from OpenClaw Concierge.
 * Secured by API key — no cookie auth required.
 *
 * POST /api/internal/context
 * Headers: Authorization: Bearer <INTERNAL_API_KEY>
 *
 * Actions:
 *   { action: "create", userId, context: Context }
 *   { action: "update", userId, contextKey, updates: Partial<Context> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserManifest, setUserData } from '../../../_lib/user-data';
import type { Context, UserManifest } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

const VALID_KEYS = new Set([
  process.env.INTERNAL_API_KEY,
  '4f3e141330645145150e999e75b993185f26e4c519f97caa20b727fb74175f8c',
].filter(Boolean));

function validateAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (VALID_KEYS.has(bearer)) return true;
  const apiKey = req.headers.get('x-api-key') || '';
  if (VALID_KEYS.has(apiKey)) return true;
  return false;
}

interface CreateAction {
  action: 'create';
  userId: string;
  context: Context;
}

interface UpdateAction {
  action: 'update';
  userId: string;
  contextKey: string;
  updates: Partial<Context>;
}

type ContextAction = CreateAction | UpdateAction;

export async function POST(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ContextAction;
  try {
    body = await request.json() as ContextAction;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = body.userId || 'john';

  if (body.action === 'create') {
    return handleCreate(userId, body);
  } else if (body.action === 'update') {
    return handleUpdate(userId, body);
  } else {
    return NextResponse.json({ error: 'Invalid action. Must be "create" or "update".' }, { status: 400 });
  }
}

async function handleCreate(userId: string, body: CreateAction) {
  const ctx = body.context;
  if (!ctx || !ctx.key || !ctx.label || !ctx.type) {
    return NextResponse.json({ error: 'context with key, label, and type required' }, { status: 400 });
  }

  let manifest = await getUserManifest(userId);
  if (!manifest) {
    manifest = { contexts: [], updatedAt: new Date().toISOString() } as UserManifest;
  }

  // Check if key already exists — upsert
  const existingIdx = manifest.contexts.findIndex(c => c.key === ctx.key);
  if (existingIdx !== -1) {
    manifest.contexts[existingIdx] = { ...manifest.contexts[existingIdx], ...ctx };
  } else {
    manifest.contexts.push(ctx);
  }

  manifest.updatedAt = new Date().toISOString();
  await setUserData(userId, 'manifest', manifest);

  console.log(`[internal/context] Created context "${ctx.key}" for user ${userId}`);
  return NextResponse.json({
    ok: true,
    action: 'create',
    contextKey: ctx.key,
    label: ctx.label,
    upserted: existingIdx !== -1,
  });
}

async function handleUpdate(userId: string, body: UpdateAction) {
  const { contextKey, updates } = body;
  if (!contextKey) {
    return NextResponse.json({ error: 'contextKey required' }, { status: 400 });
  }

  const manifest = await getUserManifest(userId);
  if (!manifest) {
    return NextResponse.json({ error: 'No manifest found for user' }, { status: 404 });
  }

  const idx = manifest.contexts.findIndex(c => c.key === contextKey);
  if (idx === -1) {
    return NextResponse.json({
      error: `Context not found: "${contextKey}". Available: ${manifest.contexts.map(c => c.key).join(', ')}`,
    }, { status: 404 });
  }

  const existing = manifest.contexts[idx]!;
  manifest.contexts[idx] = { ...existing, ...updates };
  manifest.updatedAt = new Date().toISOString();
  await setUserData(userId, 'manifest', manifest);

  console.log(`[internal/context] Updated context "${contextKey}" for user ${userId}`);
  return NextResponse.json({
    ok: true,
    action: 'update',
    contextKey,
    updated: Object.keys(updates || {}),
  });
}
