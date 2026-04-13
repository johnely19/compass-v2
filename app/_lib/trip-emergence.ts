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
  field: 'dates' | 'city' | 'focus' | 'purpose' | 'people';
  value: string;
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
