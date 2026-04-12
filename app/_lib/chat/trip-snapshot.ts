import type { TripAttributeEvent } from './emergence';

export interface TripSnapshotInput {
  city?: string;
  dates?: string;
  focus?: string[];
  emoji?: string;
  purpose?: string;
  people?: Array<{ name?: string; relation?: string }>;
}

export interface TripSnapshotItem {
  field: string;
  label: string;
  icon: string;
  value: string;
  highlighted: boolean;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildTripSnapshotItems(input: TripSnapshotInput, recentAttributes: TripAttributeEvent[] = []): TripSnapshotItem[] {
  const recentFields = new Set(recentAttributes.map(attr => attr.field));
  const focus = Array.from(new Set((input.focus ?? []).map(v => v.trim()).filter(Boolean)));
  const people = Array.from(new Set((input.people ?? []).map(person => cleanText(person.name)).filter(Boolean))) as string[];

  const items: Array<TripSnapshotItem | null> = [
    cleanText(input.city)
      ? {
          field: 'city',
          label: 'Destination',
          icon: '📍',
          value: cleanText(input.city) as string,
          highlighted: recentFields.has('city'),
        }
      : null,
    cleanText(input.dates)
      ? {
          field: 'dates',
          label: 'Dates',
          icon: '📅',
          value: cleanText(input.dates) as string,
          highlighted: recentFields.has('dates'),
        }
      : null,
    focus.length > 0
      ? {
          field: 'focus',
          label: 'Focus',
          icon: '🏷️',
          value: focus.join(', '),
          highlighted: recentFields.has('focus'),
        }
      : null,
    cleanText(input.purpose)
      ? {
          field: 'purpose',
          label: 'Purpose',
          icon: '🎯',
          value: cleanText(input.purpose) as string,
          highlighted: recentFields.has('purpose'),
        }
      : null,
    people.length > 0
      ? {
          field: 'people',
          label: people.length === 1 ? 'With' : 'People',
          icon: '👥',
          value: people.join(', '),
          highlighted: recentFields.has('people'),
        }
      : null,
    cleanText(input.emoji)
      ? {
          field: 'emoji',
          label: 'Mood',
          icon: '✨',
          value: cleanText(input.emoji) as string,
          highlighted: recentFields.has('emoji'),
        }
      : null,
  ];

  return items.filter((item): item is TripSnapshotItem => Boolean(item));
}
