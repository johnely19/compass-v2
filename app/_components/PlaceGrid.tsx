'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { Discovery } from '../_lib/types';
import { getTriageState } from '../_lib/triage';
import PlaceCard from './PlaceCard';

interface PlaceGridProps {
  discoveries: Discovery[];
  contextKey: string;
  userId?: string;
  showFilters?: boolean;
  layout?: 'grid' | 'carousel';
}

export default function PlaceGrid({
  discoveries,
  contextKey,
  userId,
  layout = 'grid',
}: PlaceGridProps) {
  const [, setRefresh] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' });
  };

  if (visibleDiscoveries.length === 0) {
    return (
      <div className="place-grid-empty">
        {discoveries.length === 0
          ? 'No discoveries yet'
          : 'All places have been dismissed'}
      </div>
    );
  }

  if (layout === 'carousel') {
    return (
      <div className="carousel-container">
        <button className="carousel-arrow carousel-arrow-left" onClick={scrollLeft} aria-label="Scroll left">‹</button>
        <div className="carousel-track" ref={scrollRef}>
          {visibleDiscoveries.map((discovery) => (
            <div key={discovery.id} className="carousel-item">
              <PlaceCard
                discovery={discovery}
                contextKey={contextKey}
                userId={userId}
              />
            </div>
          ))}
        </div>
        <button className="carousel-arrow carousel-arrow-right" onClick={scrollRight} aria-label="Scroll right">›</button>
      </div>
    );
  }

  return (
    <div className="place-grid-container">
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
    </div>
  );
}