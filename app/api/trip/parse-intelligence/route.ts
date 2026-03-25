/* ============================================================
   #83 — Trip Intelligence Parser
   POST /api/trip/parse-intelligence
   Natural language → structured trip intelligence fields
   Merges with existing manifest context (append-only)
   ============================================================ */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, loadUsers } from '../../../_lib/user';
import { getUserManifest, setUserData } from '../../../_lib/user-data';

export const dynamic = 'force-dynamic';

interface ParseRequest {
  text: string;
  contextKey: string;
}

async function parseWithClaude(text: string, contextKey: string, existing: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const existingContext = JSON.stringify({
    purpose: existing.purpose,
    people: existing.people,
    schedule: existing.schedule,
    priorities: existing.priorities,
    anchor_experiences: existing.anchor_experiences,
  }, null, 2);

  const prompt = `You are extracting trip intelligence from natural language text.

Context: ${contextKey}
Existing data (do NOT repeat — only add new information):
${existingContext}

New text to parse:
"${text}"

Extract any of these fields present in the text:
- purpose: one-line trip purpose/reason
- people: [{ name, relation?, base?, note? }] — who you're seeing, where they are
- schedule: [{ date (YYYY-MM-DD), notes }] — day-by-day plans
- priorities: string[] — what you want to do/see
- anchor_experiences: [{ name, type?, note? }] — specific places/events
- not_this_trip: string[] — explicit exclusions
- base: { address?, host?, zone? } — where you're staying

RULES:
- Return ONLY new information not already in existing data
- Infer dates from context (e.g. 'Tuesday the 28th' → '2026-04-28' for an April trip)
- People: if relation not stated, use 'contact'
- Empty fields should be omitted
- If nothing new was found, return {}

Return ONLY valid JSON with only the fields you extracted. No explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text2 = data.content?.[0]?.text?.trim() || '';
  const jsonMatch = text2.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};
  try { return JSON.parse(jsonMatch[0]) as Record<string, unknown>; } catch { return {}; }
}

function mergeIntel(existing: Record<string, unknown>, newData: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };

  // Simple fields: only set if not already present
  if (newData.purpose && !existing.purpose) merged.purpose = newData.purpose;

  // Arrays: append unique items
  for (const field of ['people', 'priorities', 'anchor_experiences', 'not_this_trip'] as const) {
    if (!Array.isArray(newData[field])) continue;
    const existing_arr = Array.isArray(existing[field]) ? existing[field] as unknown[] : [];
    const new_items = (newData[field] as unknown[]).filter((item: unknown) => {
      const name = (item as Record<string, unknown>)?.name as string || item as string;
      return !existing_arr.some(e => {
        const en = (e as Record<string, unknown>)?.name as string || e as string;
        return en?.toLowerCase() === name?.toLowerCase();
      });
    });
    if (new_items.length > 0) merged[field] = [...existing_arr, ...new_items];
  }

  // Schedule: append new dates
  if (Array.isArray(newData.schedule)) {
    const existing_sched = Array.isArray(existing.schedule) ? existing.schedule as Array<{ date: string }> : [];
    const existing_dates = new Set(existing_sched.map(d => d.date));
    const new_days = (newData.schedule as Array<{ date: string }>).filter(d => !existing_dates.has(d.date));
    if (new_days.length > 0) {
      merged.schedule = [...existing_sched, ...new_days].sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  // Base: merge subfields
  if (newData.base && typeof newData.base === 'object') {
    merged.base = { ...(existing.base as object || {}), ...(newData.base as object) };
  }

  return merged;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ParseRequest;
  try { body = await request.json() as ParseRequest; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.text || !body.contextKey) {
    return NextResponse.json({ error: 'text and contextKey required' }, { status: 400 });
  }

  // Get current manifest
  const manifest = await getUserManifest(user.id);
  if (!manifest) return NextResponse.json({ error: 'No manifest' }, { status: 404 });

  const ctxIndex = manifest.contexts.findIndex(c => c.key === body.contextKey);
  if (ctxIndex < 0) return NextResponse.json({ error: 'Context not found' }, { status: 404 });

  const existing = manifest.contexts[ctxIndex] as unknown as Record<string, unknown>;

  // Parse with Claude
  const extracted = await parseWithClaude(body.text, body.contextKey, existing);
  if (!extracted) return NextResponse.json({ error: 'Parse failed' }, { status: 500 });

  if (Object.keys(extracted).length === 0) {
    return NextResponse.json({ message: 'No new information found', changes: {} });
  }

  // Merge into context
  const updated = mergeIntel(existing, extracted);
  manifest.contexts[ctxIndex] = updated as unknown as typeof manifest.contexts[0];
  manifest.updatedAt = new Date().toISOString();

  await setUserData(user.id, 'manifest', manifest);

  // Also update local manifest if this is the owner
  const users = loadUsers();
  if (users.users[user.id]?.isOwner) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const localPath = path.join(process.cwd(), 'data', 'compass-manifest.json');
      const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      const localIdx = local.contexts.findIndex((c: { key: string }) => c.key === body.contextKey);
      if (localIdx >= 0) {
        local.contexts[localIdx] = { ...local.contexts[localIdx], ...updated };
        local.updatedAt = new Date().toISOString();
        fs.writeFileSync(localPath, JSON.stringify(local, null, 2));
      }
    } catch { /* ignore local write errors */ }
  }

  return NextResponse.json({ message: 'Trip intelligence updated', changes: extracted });
}
