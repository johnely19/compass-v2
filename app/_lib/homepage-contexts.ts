import type { Context, Discovery } from './types';

interface HomepageContextVisibilityParams {
  contexts: Context[];
  discoveryBuckets: ReadonlyMap<string, Discovery[]> | Record<string, Discovery[]>;
}

export interface HomepageContextVisibility {
  visibleContexts: Context[];
  hiddenEmptyContextCount: number;
}

function getBucket(
  discoveryBuckets: HomepageContextVisibilityParams['discoveryBuckets'],
  contextKey: string,
): Discovery[] {
  if (discoveryBuckets instanceof Map) {
    return discoveryBuckets.get(contextKey) ?? [];
  }

  const recordBuckets = discoveryBuckets as Record<string, Discovery[]>;
  return recordBuckets[contextKey] ?? [];
}

/**
 * Homepage sections should stay decision-ready: only render contexts that have
 * at least one discovery after all matching, deduping, and ranking has run.
 */
export function getHomepageContextVisibility({
  contexts,
  discoveryBuckets,
}: HomepageContextVisibilityParams): HomepageContextVisibility {
  const visibleContexts = contexts.filter((context) => getBucket(discoveryBuckets, context.key).length > 0);

  return {
    visibleContexts,
    hiddenEmptyContextCount: contexts.length - visibleContexts.length,
  };
}
