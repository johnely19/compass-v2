/* ============================================================
   Compass v2 — Context Lifecycle
   Trips: active → completed → archived
   Outings: occasion stays active, instances archive
   Radars: active ↔ paused
   ============================================================ */

import type { Context, ContextStatus } from './types';

/**
 * Resolve the effective status of a context.
 * If `status` is set, use it. Otherwise derive from `active` boolean.
 */
export function getContextStatus(context: Context): ContextStatus {
  if (context.status) return context.status;
  return context.active ? 'active' : 'archived';
}

/**
 * Is this context currently active (showing on homepage, radar firing)?
 */
export function isContextActive(context: Context): boolean {
  const status = getContextStatus(context);
  return status === 'active';
}

/**
 * Is this context visible in the review page?
 * Active and completed show. Archived shows in separate section.
 */
export function isContextReviewable(context: Context): boolean {
  const status = getContextStatus(context);
  return status !== 'paused'; // all except paused show in review
}

/**
 * Parse a date range string and return the end date.
 * Handles formats:
 *   "April 27-30, 2026" → April 30, 2026
 *   "April 27 - May 2, 2026" → May 2, 2026
 *   "July 2026" → July 31, 2026 (last day of month)
 *   "July 2026 (3+ weeks)" → July 31, 2026
 *   "March 6, 2026" → March 6, 2026
 */
export function parseDateEnd(dates: string): Date | null {
  if (!dates) return null;

  // Clean up parenthetical notes
  const cleaned = dates.replace(/\s*\(.*?\)\s*/g, '').trim();

  // "April 27-30, 2026" → end is April 30, 2026
  const rangeInMonth = cleaned.match(/^(\w+)\s+\d+\s*[-–]\s*(\d+),?\s+(\d{4})$/);
  if (rangeInMonth) {
    const [, month, endDay, year] = rangeInMonth;
    const d = new Date(`${month} ${endDay}, ${year}`);
    if (!isNaN(d.getTime())) return d;
  }

  // "April 27 - May 2, 2026" → end is May 2, 2026
  const rangeAcrossMonths = cleaned.match(/^\w+\s+\d+\s*[-–]\s*(\w+\s+\d+),?\s+(\d{4})$/);
  if (rangeAcrossMonths) {
    const [, endPart, year] = rangeAcrossMonths;
    const d = new Date(`${endPart}, ${year}`);
    if (!isNaN(d.getTime())) return d;
  }

  // "July 2026" → last day of July 2026
  const monthYear = cleaned.match(/^(\w+)\s+(\d{4})$/);
  if (monthYear) {
    const [, month, year] = monthYear;
    const d = new Date(`${month} 1, ${year}`);
    if (!isNaN(d.getTime())) {
      // Move to last day of month
      d.setMonth(d.getMonth() + 1);
      d.setDate(0);
      return d;
    }
  }

  // "March 6, 2026" → exact date
  const exactDate = cleaned.match(/^(\w+\s+\d+),?\s+(\d{4})$/);
  if (exactDate) {
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

const GRACE_DAYS = 7;

/**
 * Check if a trip or outing should auto-complete.
 * Returns true if the end date + 7 day grace period has passed.
 */
export function shouldAutoComplete(context: Context): boolean {
  if (getContextStatus(context) !== 'active') return false;
  if (context.type === 'radar') return false;
  if (!context.dates) return false;

  const endDate = parseDateEnd(context.dates);
  if (!endDate) return false;

  const graceEnd = new Date(endDate);
  graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

  return new Date() > graceEnd;
}

/**
 * Get contexts that should auto-complete.
 */
export function getAutoCompleteCandidates(contexts: Context[]): Context[] {
  return contexts.filter(shouldAutoComplete);
}

/**
 * Apply a status transition to a context.
 * Returns updated context or null if transition is invalid.
 */
export function transitionContext(
  context: Context,
  action: 'pause' | 'resume' | 'complete' | 'archive'
): Context | null {
  const currentStatus = getContextStatus(context);

  switch (action) {
    case 'pause':
      if (context.type !== 'radar') return null;
      if (currentStatus !== 'active') return null;
      return { ...context, status: 'paused', active: false };

    case 'resume':
      if (currentStatus !== 'paused') return null;
      return { ...context, status: 'active', active: true };

    case 'complete':
      if (currentStatus !== 'active') return null;
      if (context.type === 'radar') return null; // radars don't complete
      return { ...context, status: 'completed', active: false };

    case 'archive':
      if (currentStatus !== 'completed' && currentStatus !== 'active') return null;
      return { ...context, status: 'archived', active: false };

    default:
      return null;
  }
}
