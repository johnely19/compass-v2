'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import TypeBadge from '../_components/TypeBadge';
import TriageButtons from '../_components/TriageButtons';

export interface HotPlaceCard {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  isNewOpening: boolean;
  addedAt: string | null;
  heroImage?: string | null;
}

export interface HotClientProps {
  cards: HotPlaceCard[];
  availableTypes: DiscoveryType[];
  userId?: string;
}

export default function HotClient({ cards, availableTypes, userId }: HotClientProps) {
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [triageVersion, setTriageVersion] = useState(0);

  // Re-render when triage state changes (listens for storage events from TriageButtons)
  useEffect(() => {
    const handler = () => setTriageVersion(v => v + 1);
    window.addEventListener('storage', handler);
    // Also listen for custom triage events
    window.addEventListener('triage-updated', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('triage-updated', handler);
    };
  }, []);

  const toggleType = useCallback((type: DiscoveryType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTypes([]);
  }, []);

  const hasActiveFilters = selectedTypes.length > 0;

  // Filter cards by type
  const filteredCards = useMemo(() => {
    // Filter out dismissed cards using local triage state
    let result = cards;
    if (userId) {
      result = result.filter(card => {
        // Check localStorage for triage state
        try {
          const key = `compass-triage-${userId}`;
          const raw = localStorage.getItem(key);
          if (!raw) return true;
          const states = JSON.parse(raw) as Record<string, Record<string, { state: string }>>;
          // Check across all contexts
          for (const ctx of Object.values(states)) {
            const entry = ctx[card.placeId];
            if (entry?.state === 'dismissed') return false;
          }
        } catch { /* ignore */ }
        return true;
      });
    }
    if (selectedTypes.length > 0) {
      result = result.filter((card) => selectedTypes.includes(card.type));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, selectedTypes, userId, triageVersion]);

  // New Openings: cards with isNewOpening flag
  const newOpenings = useMemo(
    () => filteredCards.filter((c) => c.isNewOpening).slice(0, 12),
    [filteredCards]
  );

  // Recently Discovered: all cards sorted by addedAt descending
  const recentlyDiscovered = useMemo(
    () =>
      [...filteredCards].sort((a, b) => {
        if (!a.addedAt && !b.addedAt) return 0;
        if (!a.addedAt) return 1;
        if (!b.addedAt) return -1;
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      }),
    [filteredCards]
  );

  // Featured Types: types with many entries, rotated
  const typeCounts = useMemo(() => {
    const counts = new Map<DiscoveryType, number>();
    for (const card of filteredCards) {
      counts.set(card.type, (counts.get(card.type) || 0) + 1);
    }
    return counts;
  }, [filteredCards]);

  const featuredTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([type]) => type);
  }, [typeCounts]);

  // Render a card
  const TYPE_GRADIENTS: Record<string, string> = {
    restaurant: 'linear-gradient(135deg, #f59e0b 0%, #e11d48 100%)',
    bar: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
    cafe: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
    gallery: 'linear-gradient(135deg, #475569 0%, #3b82f6 100%)',
    museum: 'linear-gradient(135deg, #334155 0%, #6366f1 100%)',
    theatre: 'linear-gradient(135deg, #1e1b4b 0%, #9f1239 100%)',
    'music-venue': 'linear-gradient(135deg, #0f0a1e 0%, #581c87 100%)',
    grocery: 'linear-gradient(135deg, #16a34a 0%, #0d9488 100%)',
    shop: 'linear-gradient(135deg, #78716c 0%, #d97706 100%)',
    park: 'linear-gradient(135deg, #15803d 0%, #4ade80 100%)',
    development: 'linear-gradient(135deg, #64748b 0%, #334155 100%)',
    accommodation: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
  };

  function renderCard(card: HotPlaceCard) {
    const gradient = TYPE_GRADIENTS[card.type] || 'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)';
    const bgStyle = card.heroImage
      ? {
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.65) 100%), url(${card.heroImage})`,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }
      : gradient;

    return (
      <div key={card.placeId} className="hot-place-card" style={{ position: 'relative' }}>
        <Link href={`/placecards/${card.placeId}`} className="hot-place-card-link">
          <div className="hot-place-card-image" style={bgStyle as React.CSSProperties}>
            <div className="hot-place-card-overlay">
              <TypeBadge type={card.type} size="sm" />
              <h3 className="hot-place-card-name">{card.name}</h3>
              {card.city && <span className="hot-place-card-city">{card.city}</span>}
              {card.isNewOpening && (
                <span className="place-browse-newopening">New Opening</span>
              )}
            </div>
          </div>
        </Link>
        {userId && (
          <div className="hot-place-card-triage">
            <TriageButtons
              userId={userId}
              contextKey="radar:toronto-experiences"
              placeId={card.placeId}
              size="sm"
            />
          </div>
        )}
      </div>
    );
  }

  // Render a section
  function renderSection(title: string, sectionCards: HotPlaceCard[]) {
    if (sectionCards.length === 0) return null;
    return (
      <section className="hot-section">
        <h2 className="hot-section-title">{title}</h2>
        <div className="grid grid-auto">{sectionCards.map(renderCard)}</div>
      </section>
    );
  }

  // Render featured type section
  function renderFeaturedTypeSection(type: DiscoveryType) {
    const typeCards = filteredCards.filter((c) => c.type === type);
    if (typeCards.length === 0) return null;
    const meta = getTypeMeta(type);
    return (
      <section key={type} className="hot-section">
        <h2 className="hot-section-title">
          {meta.icon} {meta.label}
        </h2>
        <div className="grid grid-auto">{typeCards.map(renderCard)}</div>
      </section>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1>🔥 What&apos;s Hot</h1>
        <p className="text-muted">Trending and recently discovered places.</p>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="filter-section">
          <div className="filter-label">Filter by Type</div>
          <div className="filter-chips">
            {availableTypes.map((type) => {
              const meta = getTypeMeta(type);
              const isActive = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  className={`filter-chip ${isActive ? 'filter-chip-active' : ''}`}
                  onClick={() => toggleType(type)}
                  style={{ '--type-color': meta.color } as React.CSSProperties}
                >
                  <span className="filter-chip-icon">{meta.icon}</span>
                  <span className="filter-chip-label">{meta.label}</span>
                </button>
              );
            })}
          </div>
          {hasActiveFilters && (
            <button className="filter-clear" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Sections */}
      {renderSection('🆕 New Openings', newOpenings)}
      {renderSection('📍 Recently Discovered', recentlyDiscovered.slice(0, 24))}
      {featuredTypes.map(renderFeaturedTypeSection)}

      {filteredCards.length === 0 && (
        <div className="empty-state">
          <p className="text-muted">No places found.</p>
          {hasActiveFilters && (
            <button className="filter-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </main>
  );
}
