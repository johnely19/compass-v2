'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import TypeBadge from '../_components/TypeBadge';
import TriageButtons from '../_components/TriageButtons';

export interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  contextKey: string;
}

export interface PlacecardsBrowseClientProps {
  cards: PlaceCardData[];
  availableTypes: DiscoveryType[];
  contextKeys: string[];
  userId?: string;
  isOwner?: boolean;
}

type SortOption = 'name-asc' | 'name-desc' | 'type' | 'context';
type TriageFilter = 'all' | 'unreviewed' | 'saved' | 'dismissed';

/** Format a contextKey for display: "radar:toronto-experiences" → "Toronto Experiences" */
function formatContextLabel(key: string): string {
  const parts = key.split(':');
  const slug = parts[parts.length - 1] ?? key;
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format context prefix for grouping: "radar" → "Radar", "trip" → "Trip", "outing" → "Outing" */
function formatContextPrefix(key: string): string {
  const prefix = key.split(':')[0] ?? '';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export default function PlacecardsBrowseClient({
  cards,
  userId,
  availableTypes,
  contextKeys,
  isOwner = false,
}: PlacecardsBrowseClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [triageFilter] = useState<TriageFilter>('all');
  const [showAdminView, setShowAdminView] = useState(false);

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

    // Filter by search query (name)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((card) =>
        card.name.toLowerCase().includes(query)
      );
    }

    // Filter by type
    if (selectedTypes.length > 0) {
      result = result.filter((card) => selectedTypes.includes(card.type));
    }

    // Filter by context
    if (selectedContext) {
      result = result.filter((card) => card.contextKey === selectedContext);
    }

    // Filter by rating
    if (minRating !== null) {
      result = result.filter(
        (card) => card.rating !== null && card.rating >= minRating
      );
    }

    // Triage filter — localStorage-based; we just show all for now
    // (triage state is client-side only; skipped for SSR-rendered cards)
    void triageFilter;

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortOption) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'type':
          return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
        case 'context':
          return a.contextKey.localeCompare(b.contextKey) || a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [cards, searchQuery, selectedTypes, selectedContext, minRating, sortOption, triageFilter]);

  const pageTitle = isOwner && showAdminView ? 'All Cards (Admin)' : 'My Places';

  return (
    <main className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h1>{pageTitle}</h1>
          <span className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 400 }}>
            {filteredCards.length === cards.length
              ? `${cards.length} places`
              : `${filteredCards.length} of ${cards.length}`}
          </span>
          {isOwner && (
            <button
              className="filter-clear"
              style={{ marginLeft: '0.5rem', fontSize: '0.75rem', opacity: 0.6 }}
              onClick={() => setShowAdminView((v) => !v)}
            >
              {showAdminView ? 'My Places' : 'All Cards (admin)'}
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
          {/* Type filter */}
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
            {/* Context filter */}
            {contextKeys.length > 1 && (
              <div className="filter-group">
                <label className="filter-label">Context</label>
                <select
                  className="filter-select"
                  value={selectedContext}
                  onChange={(e) => setSelectedContext(e.target.value)}
                >
                  <option value="">All</option>
                  {contextKeys.map((key) => (
                    <option key={key} value={key}>
                      {formatContextPrefix(key)}: {formatContextLabel(key)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Rating filter */}
            <div className="filter-group">
              <label className="filter-label">Rating</label>
              <select
                className="filter-select"
                value={minRating ?? ''}
                onChange={(e) =>
                  setMinRating(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Any</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
                <option value="4.5">4.5+</option>
              </select>
            </div>

            {/* Sort */}
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
                <option value="context">Context</option>
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
          <div
            key={card.placeId}
            className="card place-browse-card"
            style={{ position: 'relative' }}
          >
            <Link
              href={`/placecards/${card.placeId}`}
              className="place-browse-card-link"
            >
              <div className="card-body">
                <h3 className="place-browse-name">{card.name}</h3>
                <TypeBadge type={card.type} />
                {card.city && (
                  <span className="place-browse-city">{card.city}</span>
                )}
                {card.rating !== null && (
                  <span className="place-browse-rating">
                    {card.rating.toFixed(1)}★
                  </span>
                )}
                {card.contextKey && (
                  <span
                    className="place-browse-context text-muted"
                    style={{ fontSize: '0.7rem', display: 'block', marginTop: '0.25rem' }}
                  >
                    {formatContextLabel(card.contextKey)}
                  </span>
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
        ))}
      </div>

      {filteredCards.length === 0 && cards.length === 0 && (
        <div className="place-grid-empty">
          <p>No discovered places yet.</p>
          <p className="text-muted" style={{ fontSize: '0.85rem' }}>
            Start a Disco session to discover places.
          </p>
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
