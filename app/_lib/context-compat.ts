/* ============================================================
   Context-Type Compatibility Filter
   Prevents mismatched discovery types in context sections.
   e.g. galleries shouldn't appear in dinner outings.
   ============================================================ */

import type { DiscoveryType } from './types';

/**
 * Allowed discovery types per context pattern.
 * If a context key matches a pattern, only listed types are shown.
 * Unmatched contexts allow all types.
 */
const CONTEXT_TYPE_RULES: Array<{
  pattern: RegExp;
  allowed: Set<DiscoveryType>;
}> = [
  {
    pattern: /^outing:dinner/,
    allowed: new Set(['restaurant', 'bar', 'cafe']),
  },
  {
    pattern: /^outing:date-night/,
    allowed: new Set(['restaurant', 'bar', 'cafe', 'music-venue', 'theatre']),
  },
  {
    pattern: /^radar:developments$/,
    allowed: new Set(['development']),
  },
  {
    pattern: /^radar:premium-grocery$/,
    allowed: new Set(['grocery']),
  },
  // Trips and general radars: all types welcome
];

/**
 * Check if a discovery type is compatible with a context.
 * Returns true if the type is allowed (or no rules match the context).
 */
export function isTypeCompatible(contextKey: string, type: DiscoveryType): boolean {
  for (const rule of CONTEXT_TYPE_RULES) {
    if (rule.pattern.test(contextKey)) {
      return rule.allowed.has(type);
    }
  }
  return true; // No rule = all types allowed
}
