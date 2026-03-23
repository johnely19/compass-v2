'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Discovery } from '../_lib/types';
import { getTriageState, getContextCounts } from '../_lib/triage';
import PlaceCard from './PlaceCard';

interface PlaceGridProps {
  discoveries: Discovery[];
  contextKey: string;
  userId?: string;
  showFilters?: boolean;
}

export default function PlaceGrid({
  discoveries,
  contextKey,
  userId,
}: PlaceGridProps) {
  const [, setRefresh] = useState(0);

  // Listen for triage changes
  useEffect(() => {
    const handler = () => setRefresh((r) => r + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  // Filter out dismissed places
  const visibleDiscoveries = useMemo(() => {
    if (!userId) return discoveries;

    return discoveries.filter((d) => {
      const state = d.place_id
        ? getTriageState(userId, contextKey, d.place_id)
        : 'unreviewed';
      return state !== 'dismissed';
    });
  }, [discoveries, userId, contextKey]);

  // Get triage counts
  const triageCounts = userId
    ? getContextCounts(userId, contextKey)
    : { saved: 0, dismissed: 0, resurfaced: 0 };

  // Count reviewed items (saved or dismissed)
  const reviewedCount = triageCounts.saved + triageCounts.dismissed;

  return (
    <div className="place-grid-container">
      {userId && reviewedCount > 0 && (
        <div className="triage-summary">
          Saved ({triageCounts.saved}) · Dismissed ({triageCounts.dismissed})
        </div>
      )}
      <div className="grid grid-auto">
        {visibleDiscoveries.map((discovery) => (
          <PlaceCard
            key={discovery.id}
            discovery={discovery}
            contextKey={contextKey}
            userId={userId}
          />
        ))}
      </div>
      {visibleDiscoveries.length === 0 && (
        <div className="place-grid-empty">
          {discoveries.length === 0
            ? 'No discoveries yet'
            : 'All places have been dismissed'}
        </div>
      )}
    </div>
  );
}