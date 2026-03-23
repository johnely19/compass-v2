'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import TypeBadge from '../_components/TypeBadge';

export interface HotPlaceCard {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  isNewOpening: boolean;
  addedAt: string | null;
}

export interface HotClientProps {
  cards: HotPlaceCard[];
  availableTypes: DiscoveryType[];
}

export default function HotClient({ cards, availableTypes }: HotClientProps) {
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);

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
    if (selectedTypes.length === 0) return cards;
    return cards.filter((card) => selectedTypes.includes(card.type));
  }, [cards, selectedTypes]);

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
  function renderCard(card: HotPlaceCard) {
    return (
      <Link
        key={card.placeId}
        href={`/placecards/${card.placeId}`}
        className="card place-browse-card"
      >
        <div className="card-body">
          <h3 className="place-browse-name">{card.name}</h3>
          <TypeBadge type={card.type} />
          {card.city && <span className="place-browse-city">{card.city}</span>}
          {card.isNewOpening && (
            <span className="place-browse-newopening">New Opening</span>
          )}
        </div>
      </Link>
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
