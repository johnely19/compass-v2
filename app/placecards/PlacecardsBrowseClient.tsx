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
  heroImage?: string | null;
}

export interface ContextItem {
  key: string;
  label: string;
}

export interface PlacecardsBrowseClientProps {
  cards: PlaceCardData[];
  availableTypes: DiscoveryType[];
  availableContexts?: ContextItem[];
  contextLabels?: Record<string, string>;
  userId?: string;
  isOwner?: boolean;
  adminViewAll?: boolean;
}

type SortOption = 'name-asc' | 'name-desc' | 'type';

export default function PlacecardsBrowseClient({
  cards,
  userId,
  availableTypes,
  availableContexts = [],
  contextLabels = {},
  isOwner = false,
  adminViewAll = false,
}: PlacecardsBrowseClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const viewMode = adminViewAll ? 'all' : 'mine';

  const toggleType = useCallback((type: DiscoveryType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTypes([]);
    setMinRating(null);
    setSearchQuery('');
    setSelectedContext('');
  }, []);

  const hasActiveFilters =
    selectedTypes.length > 0 ||
    minRating !== null ||
    searchQuery !== '' ||
    selectedContext !== '';

  const filteredCards = useMemo(() => {
    let result = cards;

    // Context filter
    if (selectedContext) {
      result = result.filter((card) => card.contextKey === selectedContext);
    }

    // Search query (name)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((card) =>
        card.name.toLowerCase().includes(query)
      );
    }

    // Type filter
    if (selectedTypes.length > 0) {
      result = result.filter((card) => selectedTypes.includes(card.type));
    }

    // Rating filter
    if (minRating !== null) {
      result = result.filter((card) => card.rating !== null && card.rating >= minRating);
    }

    // Sort
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
  }, [cards, searchQuery, selectedTypes, minRating, sortOption, selectedContext]);

  const countLabel =
    filteredCards.length === cards.length
      ? `${cards.length} place${cards.length === 1 ? '' : 's'}`
      : `${filteredCards.length} of ${cards.length} places`;

  return (
    <main className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1>{adminViewAll ? 'All Cards (admin)' : 'My Places'}</h1>
          {isOwner && (
            <div className="admin-view-toggle">
              <Link
                href="/placecards"
                className={`admin-toggle-btn ${viewMode === 'mine' ? 'active' : ''}`}
              >
                My Places
              </Link>
              <Link
                href="/placecards?view=all"
                className={`admin-toggle-btn ${viewMode === 'all' ? 'active' : ''}`}
              >
                All Cards (admin)
              </Link>
            </div>
          )}
        </div>
        <p className="text-muted">{countLabel}</p>
      </div>

      {/* Context filter pills */}
      {availableContexts.length > 0 && (
        <div className="context-filter-bar">
          <button
            className={`context-pill ${selectedContext === '' ? 'context-pill-active' : ''}`}
            onClick={() => setSelectedContext('')}
          >
            All contexts
          </button>
          {availableContexts.map((ctx) => (
            <button
              key={ctx.key}
              className={`context-pill ${selectedContext === ctx.key ? 'context-pill-active' : ''}`}
              onClick={() => setSelectedContext(ctx.key === selectedContext ? '' : ctx.key)}
            >
              {ctx.label}
            </button>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="browse-controls">
        <div className="browse-search">
          <input
            type="text"
            className="browse-search-input"
            placeholder="Search my places..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="browse-filters">
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
        {filteredCards.map((card) => {
          const ctxLabel = contextLabels[card.contextKey];
          return (
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
                  {ctxLabel && !selectedContext && (
                    <span className="place-browse-context">{ctxLabel}</span>
                  )}
                </div>
              </Link>
              {userId && (
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
          );
        })}
      </div>

      {filteredCards.length === 0 && cards.length === 0 && (
        <div className="place-grid-empty">
          <p>You haven&apos;t discovered any places yet.</p>
          <p className="text-muted">Start a chat to explore places and they&apos;ll appear here.</p>
        </div>
      )}

      {filteredCards.length === 0 && cards.length > 0 && (
        <div className="place-grid-empty">
          <p>No places match your filters.</p>
          <button className="filter-clear" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
    </main>
  );
}
