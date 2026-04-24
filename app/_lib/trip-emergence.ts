export interface TripEmergenceSnapshot {
  key: string;
  label?: string;
  type?: string;
  emoji?: string;
  dates?: string;
  city?: string;
  focus?: string[];
  purpose?: string;
  people?: Array<{ name: string; relation?: string }>;
}

export interface TripAttributeChip {
  field: 'dates' | 'city' | 'focus' | 'purpose' | 'people' | 'intelligence';
  value: string;
  icon?: string;
  label?: string;
  tone?: 'neutral' | 'critical' | 'notable';
  action?: 'review' | 'saved';
}

export interface MonitoringActionPrompt {
  label: string;
  detail: string;
  tone: 'critical' | 'notable';
  action?: 'review' | 'saved';
}

export interface MonitoringActionSummary {
  label: string;
  action: 'review' | 'saved';
  tone: 'critical' | 'notable';
  count: number;
  detail: string;
}

export interface MonitoringTaskLike {
  id: string;
  label: string;
  detail: string;
  action: 'review' | 'saved';
  tone: 'critical' | 'notable';
  status: 'open' | 'done';
  source?: 'monitoring';
  createdAt?: string;
  updatedAt?: string;
}

export interface IntelligenceDigestLike {
  entryId: string;
  contextKey: string;
  name: string;
  significanceLevel: 'critical' | 'notable' | 'routine' | 'noise' | string;
  significanceSummary: string;
}

function normalizePeople(people: TripEmergenceSnapshot['people']): string[] {
  if (!Array.isArray(people)) return [];
  return people
    .map(person => {
      if (!person || typeof person.name !== 'string') return null;
      const name = person.name.trim();
      const relation = typeof person.relation === 'string' ? person.relation.trim() : '';
      if (!name) return null;
      return relation ? `${name} (${relation})` : name;
    })
    .filter((value): value is string => Boolean(value));
}

export function diffTripEmergenceAttributes(
  previous: TripEmergenceSnapshot | undefined,
  next: TripEmergenceSnapshot,
): TripAttributeChip[] {
  if (!previous) return [];

  const changedAttrs: TripAttributeChip[] = [];

  if (next.dates && next.dates !== previous.dates) {
    changedAttrs.push({ field: 'dates', value: next.dates });
  }

  if (next.city && next.city !== previous.city) {
    changedAttrs.push({ field: 'city', value: next.city });
  }

  const newFocus = (next.focus ?? []).filter(f => !(previous.focus ?? []).includes(f));
  if (newFocus.length > 0) {
    changedAttrs.push({ field: 'focus', value: newFocus.join(', ') });
  }

  if (next.purpose && next.purpose !== previous.purpose) {
    changedAttrs.push({ field: 'purpose', value: next.purpose });
  }

  const previousPeople = normalizePeople(previous.people);
  const nextPeople = normalizePeople(next.people);
  const newPeople = nextPeople.filter(person => !previousPeople.includes(person));
  if (newPeople.length > 0) {
    changedAttrs.push({ field: 'people', value: newPeople.join(', ') });
  }

  return changedAttrs;
}

function getGenericIntelligenceChipMetadata(significanceLevel: string): Pick<TripAttributeChip, 'icon' | 'label' | 'tone'> {
  if (significanceLevel === 'critical') {
    return {
      icon: '🚨',
      label: 'Critical update',
      tone: 'critical',
    };
  }

  return {
    icon: '🟡',
    label: 'Notable update',
    tone: 'notable',
  };
}

function summarizeIntelligenceChip(item: IntelligenceDigestLike): Pick<TripAttributeChip, 'icon' | 'label' | 'tone' | 'value'> {
  const summary = item.significanceSummary.trim();
  const normalized = summary.toLowerCase();
  const generic = getGenericIntelligenceChipMetadata(item.significanceLevel);

  if (/(reopen|re-open|reopened|reopening)/.test(normalized)) {
    return {
      ...generic,
      icon: '🟢',
      label: 'Reopened',
      value: `${item.name} reopened`,
    };
  }

  if (/(closure|closed|closing|shutdown|shut down|permanent close|may close)/.test(normalized)) {
    return {
      ...generic,
      icon: item.significanceLevel === 'critical' ? '🚨' : '🚪',
      label: item.significanceLevel === 'critical' ? 'Closure risk' : 'Closure update',
      value: `${item.name} · ${summary}`,
    };
  }

  if (/(hours|open now|opening|operating|service change|service update|temporarily closed|reservation)/.test(normalized)) {
    return {
      ...generic,
      icon: '🕒',
      label: 'Hours update',
      value: `${item.name} · ${summary}`,
    };
  }

  if (/(review|reviews|rating|ratings|stars?|sentiment|buzz)/.test(normalized)) {
    return {
      ...generic,
      icon: '📈',
      label: 'Review momentum',
      value: `${item.name} · ${summary}`,
    };
  }

  return {
    ...generic,
    value: `${item.name} · ${summary}`,
  };
}

export function buildIntelligenceAttachmentChips(params: {
  contextKey: string;
  digestItems: IntelligenceDigestLike[];
  previousEntryIds?: string[];
  limit?: number;
}): TripAttributeChip[] {
  const { contextKey, digestItems, previousEntryIds = [], limit = 2 } = params;
  const previous = new Set(previousEntryIds);

  return digestItems
    .filter(item => item.contextKey === contextKey)
    .filter(item => item.significanceLevel === 'critical' || item.significanceLevel === 'notable')
    .filter(item => !previous.has(item.entryId))
    .slice(0, limit)
    .map(item => ({
      field: 'intelligence' as const,
      ...summarizeIntelligenceChip(item),
    }));
}

export function buildMonitoringActionPrompts(params: {
  contextKey: string;
  digestItems: IntelligenceDigestLike[];
  limit?: number;
}): MonitoringActionPrompt[] {
  const { contextKey, digestItems, limit = 2 } = params;
  const prompts: MonitoringActionPrompt[] = [];
  const seenLabels = new Set<string>();

  for (const item of digestItems) {
    if (item.contextKey !== contextKey) continue;
    const summary = item.significanceSummary.trim();
    const normalized = summary.toLowerCase();

    let prompt: MonitoringActionPrompt | null = null;

    if (/(closure|closed|closing|shutdown|shut down|permanent close|may close)/.test(normalized)) {
      prompt = {
        label: 'Line up a backup',
        detail: `${item.name} shows closure risk. Save a fallback now.`,
        tone: item.significanceLevel === 'critical' ? 'critical' : 'notable',
        action: 'saved',
      };
    } else if (/(hours|open now|opening|service change|temporarily closed|reservation)/.test(normalized)) {
      prompt = {
        label: 'Re-check timing',
        detail: `${item.name} changed hours or service details. Confirm before you go.`,
        tone: item.significanceLevel === 'critical' ? 'critical' : 'notable',
        action: 'review',
      };
    } else if (/(availability|selling fast|book fast|scarce|limited|reservation)/.test(normalized)) {
      prompt = {
        label: 'Book sooner',
        detail: `${item.name} looks tighter than before. If it matters, lock it in.`,
        tone: item.significanceLevel === 'critical' ? 'critical' : 'notable',
        action: 'review',
      };
    } else if (/(reopen|re-open|reopened|reopening)/.test(normalized)) {
      prompt = {
        label: 'Reconsider this stop',
        detail: `${item.name} is back. It may be worth putting back in the plan.`,
        tone: 'notable',
        action: 'review',
      };
    } else if (/(review|reviews|rating|ratings|stars?|sentiment|buzz)/.test(normalized)) {
      prompt = {
        label: 'Check momentum',
        detail: `${item.name} has shifted in the reviews. Decide if it still fits the trip.`,
        tone: item.significanceLevel === 'critical' ? 'critical' : 'notable',
        action: 'review',
      };
    }

    if (!prompt) continue;
    if (seenLabels.has(prompt.label)) continue;
    seenLabels.add(prompt.label);
    prompts.push(prompt);
    if (prompts.length >= limit) break;
  }

  return prompts;
}


export function summarizeMonitoringActionPrompts(prompts: MonitoringActionPrompt[]): MonitoringActionSummary | null {
  const first = prompts[0];
  if (!first) return null;
  const action = first.action ?? 'review';
  return {
    label: action === 'saved'
      ? (prompts.length > 1 ? `${prompts.length} backup moves ready` : 'Backup move ready')
      : (prompts.length > 1 ? `${prompts.length} review moves ready` : 'Review move ready'),
    action,
    tone: first.tone,
    count: prompts.length,
    detail: first.detail,
  };
}

function slugifyMonitoringTaskPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function buildMonitoringTaskFromSummary(
  summary: MonitoringActionSummary,
  now = new Date().toISOString(),
): MonitoringTaskLike {
  return {
    id: `monitoring-${summary.action}-${slugifyMonitoringTaskPart(summary.detail)}`,
    label: summary.label,
    detail: summary.detail,
    action: summary.action,
    tone: summary.tone,
    status: 'open',
    source: 'monitoring',
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertMonitoringTask(
  tasks: MonitoringTaskLike[] | undefined,
  nextTask: MonitoringTaskLike,
): MonitoringTaskLike[] {
  const existingTasks = tasks ?? [];
  const updatedAt = nextTask.updatedAt ?? new Date().toISOString();
  const next = existingTasks
    .filter((task) => task.id !== nextTask.id)
    .map((task) => {
      if (nextTask.status === 'open' && task.status === 'open') {
        return {
          ...task,
          status: 'done' as const,
          updatedAt,
        };
      }
      return task;
    });

  return [nextTask, ...next];
}

export function shouldAutoCloseMonitoringTask(
  task: MonitoringTaskLike | null | undefined,
  summary: MonitoringActionSummary | null | undefined,
): boolean {
  if (!task) return false;
  if (task.status !== 'open') return false;
  return !summary;
}

function monitoringTaskUpdatedAt(task: MonitoringTaskLike): number {
  const value = task.updatedAt ?? task.createdAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getRecentCompletedMonitoringTasks(
  tasks: MonitoringTaskLike[] | undefined,
  limit = 2,
): MonitoringTaskLike[] {
  return (tasks ?? [])
    .filter((task) => task.status === 'done')
    .sort((a, b) => monitoringTaskUpdatedAt(b) - monitoringTaskUpdatedAt(a))
    .slice(0, limit);
}

export function resolveOpenMonitoringTask(
  tasks: MonitoringTaskLike[] | undefined,
  summary: MonitoringActionSummary | null | undefined,
): MonitoringTaskLike | null {
  const openTask = tasks?.find(task => task.status === 'open');
  if (openTask) return openTask;
  if (!summary) return null;
  return buildMonitoringTaskFromSummary(summary);
}

export function resolveVisibleMonitoringSummary(
  summary: MonitoringActionSummary | null | undefined,
  dismissedDetail: string | null | undefined,
): MonitoringActionSummary | null {
  if (!summary) return null;
  if (summary.detail === dismissedDetail) return null;
  return summary;
}

export function buildMonitoringPromptAttachmentChips(params: {
  contextKey: string;
  digestItems: IntelligenceDigestLike[];
  previousEntryIds?: string[];
  limit?: number;
}): TripAttributeChip[] {
  const { contextKey, digestItems, previousEntryIds = [], limit = 1 } = params;
  const previous = new Set(previousEntryIds);
  const freshItems = digestItems
    .filter(item => item.contextKey === contextKey)
    .filter(item => (item.significanceLevel === 'critical' || item.significanceLevel === 'notable') && !previous.has(item.entryId));

  return buildMonitoringActionPrompts({
    contextKey,
    digestItems: freshItems,
    limit,
  }).map(prompt => ({
    field: 'intelligence' as const,
    value: prompt.detail,
    label: prompt.label,
    tone: prompt.tone,
    icon: prompt.tone === 'critical' ? '🚨' : '🧭',
    action: prompt.action,
  }));
}
