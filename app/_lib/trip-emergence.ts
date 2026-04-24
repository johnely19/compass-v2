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
  priorities?: string[];
  base?: { address?: string; host?: string; zone?: string };
  accommodationName?: string;
  accommodationAddress?: string;
  anchorExperiences?: Array<{ name: string; type?: string; note?: string }>;
  neighbourhoodPreferences?: string[];
}

export interface TripAttributeChip {
  field: 'dates' | 'city' | 'focus' | 'purpose' | 'people' | 'intelligence' | 'priorities' | 'base' | 'accommodation' | 'anchor' | 'neighbourhoods';
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

  const newPriorities = (next.priorities ?? []).filter(p => !(previous.priorities ?? []).includes(p));
  if (newPriorities.length > 0) {
    changedAttrs.push({ field: 'priorities', value: newPriorities.join(', ') });
  }

  // Base field diffing - capture address, host, or zone changes
  if (next.base) {
    const prevBase = previous.base;
    const prevAddr = prevBase?.address ?? '';
    const nextAddr = next.base.address ?? '';
    const prevHost = prevBase?.host ?? '';
    const nextHost = next.base.host ?? '';
    const prevZone = prevBase?.zone ?? '';
    const nextZone = next.base.zone ?? '';

    if (nextAddr && nextAddr !== prevAddr) {
      changedAttrs.push({ field: 'base', value: nextAddr + (nextHost ? ` (${nextHost})` : '') });
    } else if (nextHost && nextHost !== prevHost) {
      changedAttrs.push({ field: 'base', value: `Host: ${nextHost}` });
    } else if (nextZone && nextZone !== prevZone) {
      changedAttrs.push({ field: 'base', value: `Zone: ${nextZone}` });
    }
  }

  // Accommodation name changes
  if (next.accommodationName && next.accommodationName !== previous.accommodationName) {
    const value = next.accommodationAddress
      ? `${next.accommodationName} · ${next.accommodationAddress}`
      : next.accommodationName;
    changedAttrs.push({ field: 'accommodation', value });
  } else if (next.accommodationAddress && next.accommodationAddress !== previous.accommodationAddress && !next.accommodationName) {
    changedAttrs.push({ field: 'accommodation', value: next.accommodationAddress });
  }

  // Anchor experiences - new items only, cap at 2 for low noise
  const newAnchors = (next.anchorExperiences ?? []).filter(
    a => !(previous.anchorExperiences ?? []).some(p => p.name === a.name)
  );
  if (newAnchors.length > 0) {
    const limited = newAnchors.slice(0, 2);
    changedAttrs.push({
      field: 'anchor',
      value: limited.map(a => a.type ? `${a.name} (${a.type})` : a.name).join(', '),
    });
  }

  // Neighbourhood preferences - new items only, cap at 2 for low noise
  const newNeighbourhoods = (next.neighbourhoodPreferences ?? []).filter(
    n => !(previous.neighbourhoodPreferences ?? []).includes(n)
  );
  if (newNeighbourhoods.length > 0) {
    const limited = newNeighbourhoods.slice(0, 2);
    changedAttrs.push({
      field: 'neighbourhoods',
      value: limited.join(', '),
    });
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
    priorities: [...(snapshot.priorities ?? [])],
    anchorExperiences: [...(snapshot.anchorExperiences ?? [])],
    neighbourhoodPreferences: [...(snapshot.neighbourhoodPreferences ?? [])],
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

    if (chip.field === 'priorities') {
      const additions = chip.value.split(',').map(v => v.trim()).filter(Boolean);
      next.priorities = [...new Set([...(next.priorities ?? []), ...additions])];
    }

    if (chip.field === 'base') {
      // Parse base value: "123 Main St (John)" or "Host: John" or "Zone: Brooklyn"
      const value = chip.value;
      const existingBase = next.base ?? {};

      // Check for "Host: X" or "Zone: X" format
      const hostMatch = value.match(/^Host:\s*(.+)$/);
      const zoneMatch = value.match(/^Zone:\s*(.+)$/);

      if (hostMatch) {
        next.base = { ...existingBase, host: hostMatch[1].trim() };
      } else if (zoneMatch) {
        next.base = { ...existingBase, zone: zoneMatch[1].trim() };
      } else {
        // Default: treat as address, optionally with host in parens
        const addrMatch = value.match(/^(.+?)\s*\((.+)\)$/);
        if (addrMatch) {
          next.base = { ...existingBase, address: addrMatch[1].trim(), host: addrMatch[2].trim() };
        } else {
          next.base = { ...existingBase, address: value.trim() };
        }
      }
    }

    if (chip.field === 'accommodation') {
      // Parse accommodation value: "The Liberty Hotel · 215 Chestnut St" or just "The Liberty Hotel"
      const value = chip.value;
      const parts = value.split(' · ');
      next.accommodationName = parts[0].trim();
      if (parts[1]) {
        next.accommodationAddress = parts[1].trim();
      }
    }

    if (chip.field === 'anchor') {
      // Parse anchor value: "Guggenheim (gallery), MoMA (museum)" or just "The Four Horsemen"
      const existing = new Set((next.anchorExperiences ?? []).map(a => a.name));
      const items = chip.value.split(',').map(v => v.trim()).filter(Boolean);
      for (const item of items) {
        const match = item.match(/^(.+?)\s*\((.+)\)$/);
        if (match && !existing.has(match[1].trim())) {
          next.anchorExperiences!.push({ name: match[1].trim(), type: match[2].trim() });
          existing.add(match[1].trim());
        } else if (!match && !existing.has(item)) {
          next.anchorExperiences!.push({ name: item });
          existing.add(item);
        }
      }
    }

    if (chip.field === 'neighbourhoods') {
      // Parse neighbourhoods value: "Williamsburg, Ridgewood"
      const additions = chip.value.split(',').map(v => v.trim()).filter(Boolean);
      next.neighbourhoodPreferences = [...new Set([...(next.neighbourhoodPreferences ?? []), ...additions])];
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
