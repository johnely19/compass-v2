import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../_lib/user';
import { getWritableUserManifest } from '../../../_lib/effective-user-data';
import { setUserData } from '../../../_lib/user-data';
import type { MonitoringTask } from '../../../_lib/types';

export const dynamic = 'force-dynamic';

function normalizeTask(task: Partial<MonitoringTask>, now: string): MonitoringTask | null {
  if (!task.id || !task.label || !task.detail) return null;
  if (task.action !== 'review' && task.action !== 'saved') return null;
  if (task.tone !== 'critical' && task.tone !== 'notable') return null;
  const status = task.status === 'done' ? 'done' : 'open';
  return {
    id: task.id,
    label: task.label,
    detail: task.detail,
    action: task.action,
    tone: task.tone,
    status,
    source: 'monitoring',
    createdAt: task.createdAt || now,
    updatedAt: now,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();
    const contextKey = typeof body?.contextKey === 'string' ? body.contextKey : '';
    const now = new Date().toISOString();
    const task = normalizeTask(body?.task, now);

    if (!contextKey) return NextResponse.json({ error: 'contextKey is required' }, { status: 400 });
    if (!task) return NextResponse.json({ error: 'valid task is required' }, { status: 400 });

    const manifest = await getWritableUserManifest(user.id);
    const contexts = [...manifest.contexts];
    const index = contexts.findIndex((context) => context.key === contextKey);
    if (index === -1) return NextResponse.json({ error: 'Context not found' }, { status: 404 });

    const context = contexts[index];
    if (!context) return NextResponse.json({ error: 'Context not found' }, { status: 404 });
    const existingTasks = context.monitoringTasks ?? [];
    const existing = existingTasks.find((entry) => entry.id === task.id);
    const nextTask: MonitoringTask = existing
      ? { ...existing, ...task, createdAt: existing.createdAt || task.createdAt }
      : task;

    contexts[index] = {
      ...context,
      monitoringTasks: [
        nextTask,
        ...existingTasks.filter((entry) => entry.id !== nextTask.id),
      ],
    };

    await setUserData(user.id, 'manifest', {
      contexts,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, task: nextTask });
  } catch (error) {
    console.error('[api/user/monitoring-tasks]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
