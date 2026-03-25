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
}

export interface PlacecardsBrowseClientProps {
  cards: PlaceCardData[];
  availableTypes: DiscoveryType[];
  userId?: string;
}

type SortOption = 'name-asc' | 'name-desc' | 'type';

interface FilterState {
  types: DiscoveryType[];
  minRating: number | null;
}

export default function PlacecardsBrowseClient({
  cards, userId,
  availableTypes,
}: PlacecardsBrowseClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');

  const toggleType = useCallback((type: DiscoveryType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTypes([]);
    setMinRating(null);
    setSearchQuery('');
  }, []);

  const hasActiveFilters = selectedTypes.length > 0 || minRating !== null || searchQuery !== '';

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

    // Filter by rating
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
  }, [cards, searchQuery, selectedTypes, minRating, sortOption]);

  return (
    <main className="page">
      <div className="page-header">
        <h1>Places</h1>
        <p className="text-muted">
          {filteredCards.length === cards.length
            ? `${cards.length} place cards`
            : `${filteredCards.length} of ${cards.length} place cards`}
        </p>
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
              </div>
            </Link>
            {userId && (
              <div className="place-browse-triage">
                <TriageButtons
                  userId={userId}
                  contextKey="radar:toronto-experiences"
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
          <p>No places match your filters.</p>
          <button className="filter-clear" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
    </main>
  );
}
