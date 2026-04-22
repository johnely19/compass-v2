'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Discovery } from '../_lib/types';
import { getTriageState } from '../_lib/triage';
import PlaceCard from './PlaceCard';

interface PlaceGridProps {
  discoveries: Discovery[];
  contextKey: string;
  contextLabel?: string;
  contextEmoji?: string;
  contextType?: 'trip' | 'outing' | 'radar';
  userId?: string;
  showFilters?: boolean;
  layout?: 'grid' | 'carousel';
  trendSignals?: Record<string, { label: string; tone: 'critical' | 'notable' | 'routine' }>;
}

function TrendBadge({ signal }: { signal?: { label: string; tone: 'critical' | 'notable' | 'routine' } }) {
  if (!signal) return null;
  return (
    <div className="place-grid-trend-wrap">
      <span className={`place-card-trend-badge place-card-trend-${signal.tone}`}>
        {signal.label}
      </span>
    </div>
  );
}

/** Filter to only unreviewed/resurfaced discoveries */
function filterVisible(discoveries: Discovery[], userId: string | undefined, contextKey: string): Discovery[] {
  if (!userId) return discoveries;
  return discoveries.filter((d) => {
    const pid = d.place_id || d.id;
    if (!pid) return true;
    const state = getTriageState(userId, contextKey, pid);
    return state === 'unreviewed' || state === 'resurfaced';
  });
}

export default function PlaceGrid({
  discoveries,
  contextKey,
  contextLabel,
  contextEmoji,
  contextType,
  userId,
  layout = 'grid',
  trendSignals = {},
}: PlaceGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Visible discoveries — filtered by triage state
  // Start with ALL discoveries (matches server render) to avoid hydration mismatch.
  // Filter client-side after mount since getTriageState reads localStorage.
  const [visibleDiscoveries, setVisibleDiscoveries] = useState<Discovery[]>(discoveries);

  // Filter after mount + when discoveries/context changes
  useEffect(() => {
    setVisibleDiscoveries(filterVisible(discoveries, userId, contextKey));
  }, [discoveries, userId, contextKey]);

  // Re-filter immediately when triage state changes
  useEffect(() => {
    function handleTriageChange() {
      setVisibleDiscoveries(filterVisible(discoveries, userId, contextKey));
    }

    window.addEventListener('triage-changed', handleTriageChange);
    return () => window.removeEventListener('triage-changed', handleTriageChange);
  // Re-register listener when deps change so it captures latest values
  }, [discoveries, userId, contextKey]);

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
    requestAnimationFrame(updateScrollState);
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

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
            <div key={discovery.id} className="carousel-item place-grid-trend-card">
              <TrendBadge signal={trendSignals[discovery.place_id || discovery.id]} />
              <PlaceCard
                discovery={discovery}
                contextKey={contextKey}
                contextLabel={contextLabel}
                contextEmoji={contextEmoji}
                contextType={contextType}
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
          <div key={discovery.id} className="place-grid-trend-card">
            <TrendBadge signal={trendSignals[discovery.place_id || discovery.id]} />
            <PlaceCard
              discovery={discovery}
              contextKey={contextKey}
              contextLabel={contextLabel}
              contextEmoji={contextEmoji}
              contextType={contextType}
              userId={userId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
