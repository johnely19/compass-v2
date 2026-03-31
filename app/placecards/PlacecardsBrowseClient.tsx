'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { ALL_TYPES, getTypeMeta } from '../_lib/discovery-types';
import TypeBadge from '../_components/TypeBadge';
import TriageButtons from '../_components/TriageButtons';

export interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
  contextLabel: string;
  heroImage?: string;
}

export interface ContextOption {
  key: string;
  label: string;
}

export interface PlacecardsBrowseClientProps {
  cards: PlaceCardData[];
  availableTypes: DiscoveryType[];
  availableContexts: ContextOption[];
  userId?: string;
  isOwner?: boolean;
  adminCards?: PlaceCardData[];
}

type TriageFilter = 'all' | 'unreviewed' | 'saved' | 'dismissed';
type SortOption = 'name-asc' | 'name-desc' | 'type';
type ViewMode = 'my-places' | 'admin';

export default function PlacecardsBrowseClient({
  cards,
  availableTypes,
  availableContexts,
  userId,
  isOwner,
  adminCards,
}: PlacecardsBrowseClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [viewMode, setViewMode] = useState<ViewMode>('my-places');

  const toggleType = useCallback((type: DiscoveryType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTypes([]);
    setSelectedContext('');
    setMinRating(null);
    setSearchQuery('');
  }, []);

  const hasActiveFilters = selectedTypes.length > 0 || selectedContext !== '' || minRating !== null || searchQuery !== '';

  // Use admin cards when in admin view mode
  const activeCards = viewMode === 'admin' && adminCards ? adminCards : cards;

  const filteredCards = useMemo(() => {
    let result = activeCards;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((card) =>
        card.name.toLowerCase().includes(query) ||
        card.city.toLowerCase().includes(query)
      );
    }

    if (selectedContext) {
      result = result.filter((card) => card.contextKey === selectedContext);
    }

    if (selectedTypes.length > 0) {
      result = result.filter((card) => selectedTypes.includes(card.type));
    }

    if (minRating !== null) {
      result = result.filter((card) => card.rating !== null && card.rating >= minRating);
    }

    result = [...result].sort((a, b) => {
      switch (sortOption) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'type':
          return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [activeCards, searchQuery, selectedContext, selectedTypes, minRating, sortOption]);

  return (
    <main className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h1>{viewMode === 'admin' ? 'All Cards (Admin)' : 'My Places'}</h1>
          <span className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 400 }}>
            {filteredCards.length === activeCards.length
              ? `${activeCards.length} places`
              : `${filteredCards.length} of ${activeCards.length}`}
          </span>
          {isOwner && adminCards && (
            <button
              className="filter-chip"
              style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
              onClick={() => setViewMode(viewMode === 'my-places' ? 'admin' : 'my-places')}
            >
              {viewMode === 'my-places' ? '🔧 Admin view' : '← My Places'}
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="browse-controls">
        <div className="browse-search">
          <input
            type="text"
            className="browse-search-input"
            placeholder="Search places..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="browse-filters">
          {/* Context filter — only in my-places mode with multiple contexts */}
          {viewMode === 'my-places' && availableContexts.length > 1 && (
            <div className="filter-section filter-section-row">
              <div className="filter-group">
                <label className="filter-label">Context</label>
                <select
                  className="filter-select"
                  value={selectedContext}
                  onChange={(e) => setSelectedContext(e.target.value)}
                >
                  <option value="">All contexts</option>
                  {availableContexts.map((ctx) => (
                    <option key={ctx.key} value={ctx.key}>{ctx.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="filter-section">
            <div className="filter-label">Type</div>
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
          </div>

          <div className="filter-section filter-section-row">
            <div className="filter-group">
              <label className="filter-label">Rating</label>
              <select
                className="filter-select"
                value={minRating ?? ''}
                onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Any</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
                <option value="4.5">4.5+</option>
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label">Sort</label>
              <select
                className="filter-select"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
              >
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="type">Type</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button className="filter-clear" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-auto">
        {filteredCards.map((card) => (
          <div key={card.placeId} className="card place-browse-card" style={{ position: 'relative' }}>
            <Link href={`/placecards/${card.placeId}`} className="place-browse-card-link">
              <div className="card-body">
                <h3 className="place-browse-name">{card.name}</h3>
                <TypeBadge type={card.type} />
                {card.city && (
                  <span className="place-browse-city">{card.city}</span>
                )}
                {card.rating !== null && (
                  <span className="place-browse-rating">{card.rating.toFixed(1)}★</span>
                )}
                {viewMode === 'my-places' && card.contextLabel && (
                  <span className="place-browse-context text-muted" style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.25rem' }}>
                    {card.contextLabel}
                  </span>
                )}
              </div>
            </Link>
            {userId && card.contextKey && (
              <div className="place-browse-triage">
                <TriageButtons
                  userId={userId}
                  contextKey={card.contextKey}
                  placeId={card.placeId}
                  size="sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredCards.length === 0 && (
        <div className="place-grid-empty">
          {activeCards.length === 0 ? (
            <div>
              <p>No places discovered yet.</p>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                Chat with Compass to start discovering places — they'll appear here.
              </p>
            </div>
          ) : (
            <div>
              <p>No places match your filters.</p>
              <button className="filter-clear" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
