'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  const [triageVersion, setTriageVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Listen for triage changes — increment version to trigger re-filter
  useEffect(() => {
    const handler = () => setTriageVersion((v) => v + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  // Track scroll position for arrow visibility
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 5);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 5);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Initial check after render
    requestAnimationFrame(updateScrollState);
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  // Filter out dismissed places — re-runs when triage state changes
  const visibleDiscoveries = useMemo(() => {
    if (!userId) return discoveries;

    return discoveries.filter((d) => {
      const state = d.place_id
        ? getTriageState(userId, contextKey, d.place_id)
        : 'unreviewed';
      return state !== 'dismissed';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveries, userId, contextKey, triageVersion]);

  // Re-check scroll after content changes
  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  }, [visibleDiscoveries, updateScrollState]);

  const scrollLeftFn = () => {
    scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' });
  };

  const scrollRightFn = () => {
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
        {canScrollLeft && (
          <button className="carousel-arrow carousel-arrow-left" onClick={scrollLeftFn} aria-label="Scroll left">‹</button>
        )}
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
        {canScrollRight && (
          <button className="carousel-arrow carousel-arrow-right" onClick={scrollRightFn} aria-label="Scroll right">›</button>
        )}
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
