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
}

export interface IntelligenceDigestLike {
  entryId: string;
  contextKey: string;
  name: string;
  significanceLevel: 'critical' | 'notable' | 'routine' | 'noise' | string;
  significanceSummary: string;
}

export interface MonitoringActionPrompt {
  label: string;
  detail: string;
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

function parsePeopleValue(value: string): Array<{ name: string; relation?: string }> {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^(.*?)\s*\((.*?)\)$/);
      if (!match) return { name: part };
      return {
        name: match[1]?.trim() || part,
        relation: match[2]?.trim() || undefined,
      };
    });
}

export function applyTripAttributeChips(
  snapshot: TripEmergenceSnapshot,
  chips: TripAttributeChip[],
): TripEmergenceSnapshot {
  if (chips.length === 0) return snapshot;

  const next: TripEmergenceSnapshot = {
    ...snapshot,
    focus: [...(snapshot.focus ?? [])],
    people: [...(snapshot.people ?? [])],
  };

  for (const chip of chips) {
    if (!chip.value) continue;

    if (chip.field === 'dates') {
      next.dates = chip.value;
      continue;
    }

    if (chip.field === 'city') {
      next.city = chip.value;
      continue;
    }

    if (chip.field === 'focus') {
      const additions = chip.value.split(',').map(value => value.trim()).filter(Boolean);
      next.focus = [...new Set([...(next.focus ?? []), ...additions])];
      continue;
    }

    if (chip.field === 'purpose') {
      next.purpose = chip.value;
      continue;
    }

    if (chip.field === 'people') {
      const existing = normalizePeople(next.people);
      const additions = parsePeopleValue(chip.value);
      for (const person of additions) {
        const normalized = person.relation ? `${person.name} (${person.relation})` : person.name;
        if (!existing.includes(normalized)) {
          (next.people ??= []).push(person);
          existing.push(normalized);
        }
      }
    }
  }

  return next;
}

function isHighSignalIntelligence(item: IntelligenceDigestLike): boolean {
  return item.significanceLevel === 'critical' || item.significanceLevel === 'notable';
}

export function buildTripMonitoringHighlights(params: {
  contextKey: string;
  digestItems: IntelligenceDigestLike[];
  limit?: number;
}): string[] {
  const { contextKey, digestItems, limit = 2 } = params;

  return digestItems
    .filter(item => item.contextKey === contextKey)
    .filter(isHighSignalIntelligence)
    .slice(0, limit)
    .map(item => `${item.name} · ${item.significanceSummary}`);
}

export function buildMonitoringActionPrompts(params: {
  contextKey: string;
  digestItems: IntelligenceDigestLike[];
  limit?: number;
}): MonitoringActionPrompt[] {
  const { contextKey, digestItems, limit = 2 } = params;

  return digestItems
    .filter(item => item.contextKey === contextKey)
    .filter(isHighSignalIntelligence)
    .map((item): MonitoringActionPrompt | null => {
      const summary = item.significanceSummary.toLowerCase();
      if (summary.includes('closure')) {
        return {
          label: 'Backup plan',
          detail: `${item.name} may be at risk, line up an alternate now.`,
        };
      }
      if (summary.includes('hours')) {
        return {
          label: 'Reconfirm timing',
          detail: `${item.name} changed hours, recheck before you go.`,
        };
      }
      if (summary.includes('rating dropped')) {
        return {
          label: 'Quality check',
          detail: `${item.name} slipped, make sure it still deserves a slot.`,
        };
      }
      if (summary.includes('availability')) {
        return {
          label: 'Booking window',
          detail: `${item.name} availability moved, it may be time to act.`,
        };
      }
      return {
        label: 'Watch closely',
        detail: `${item.name} changed, worth a quick recheck.`,
      };
    })
    .filter((item): item is MonitoringActionPrompt => Boolean(item))
    .slice(0, limit);
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
    .filter(isHighSignalIntelligence)
    .filter(item => !previous.has(item.entryId))
    .slice(0, limit)
    .map(item => ({
      field: 'intelligence' as const,
      value: `${item.name} · ${item.significanceSummary}`,
    }));
}
