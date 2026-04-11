import type { Context } from '../types';

export interface TripAttributeEvent {
  field: string;
  value: string;
  icon: string;
  label: string;
}

export interface ContextSnapshot {
  key: string;
  label?: string;
  emoji?: string;
  dates?: string;
  city?: string;
  focus?: string[];
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map(value => value.trim()).filter(Boolean)));
}

function formatFocusValue(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  return values.join(', ');
}

export function snapshotContext(ctx: Partial<ContextSnapshot>): ContextSnapshot {
  return {
    key: ctx.key ?? '',
    label: normalizeText(ctx.label),
    emoji: normalizeText(ctx.emoji),
    dates: normalizeText(ctx.dates),
    city: normalizeText(ctx.city),
    focus: uniqueList(ctx.focus),
  };
}

export function diffTripAttributes(prev: Partial<ContextSnapshot> | undefined, next: Partial<ContextSnapshot> | undefined): TripAttributeEvent[] {
  const before = snapshotContext(prev ?? {});
  const after = snapshotContext(next ?? {});
  const attrs: TripAttributeEvent[] = [];

  if (after.label && after.label !== before.label) {
    attrs.push({ field: 'label', value: after.label, icon: '🪪', label: 'Trip' });
  }

  if (after.city && after.city !== before.city) {
    attrs.push({ field: 'city', value: after.city, icon: '📍', label: 'Destination' });
  }

  if (after.dates && after.dates !== before.dates) {
    attrs.push({ field: 'dates', value: after.dates, icon: '📅', label: 'Dates' });
  }

  const newFocus = after.focus.filter(value => !before.focus?.includes(value));
  const focusValue = formatFocusValue(newFocus);
  if (focusValue) {
    attrs.push({ field: 'focus', value: focusValue, icon: '🏷️', label: 'Focus' });
  }

  if (after.emoji && after.emoji !== before.emoji) {
    attrs.push({ field: 'emoji', value: after.emoji, icon: '✨', label: 'Mood' });
  }

  return attrs;
}
