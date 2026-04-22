'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import type { MonitorChangeKind } from '../_lib/monitor-inventory';
import { SIGNIFICANCE_RANK, getHotSignalLabel } from '../_lib/hot-intelligence';
import TypeBadge from '../_components/TypeBadge';
import TriageButtons from '../_components/TriageButtons';

function PlaceCardImage({ src }: { src: string | null }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (!src) return null;

  return (
    <div
      className="place-card-image"
      style={{
        aspectRatio: '3/2',
        background: imgLoaded
          ? 'transparent'
          : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        overflow: 'hidden',
      }}
    >
      {!imgError && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        />
      )}
    </div>
  );
}

export interface PlaceCardData {
  placeId: string;
  name: string;
  type: DiscoveryType;
  city: string;
  rating: number | null;
  heroImage: string | null;
  monitorStatus?: string;
  significanceLevel?: 'critical' | 'notable' | 'routine' | 'noise';
  significanceSummary?: string;
  detectedChanges?: MonitorChangeKind[];
  lastObservedAt?: string;
  hasRecentSignal: boolean;
}

export interface PlacecardsBrowseClientProps {
  cards: PlaceCardData[];
  availableTypes: DiscoveryType[];
  userId?: string;
}

type SortOption = 'signals' | 'name-asc' | 'name-desc' | 'type';

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

  const recentSignals = useMemo(
    () =>
      cards
        .filter((card) => card.hasRecentSignal)
        .sort((a, b) => {
          const sigDiff = (SIGNIFICANCE_RANK[b.significanceLevel ?? 'noise'] ?? 0) - (SIGNIFICANCE_RANK[a.significanceLevel ?? 'noise'] ?? 0);
          if (sigDiff !== 0) return sigDiff;
          return new Date(b.lastObservedAt ?? 0).getTime() - new Date(a.lastObservedAt ?? 0).getTime();
        })
        .slice(0, 6),
    [cards]
  );

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
        case 'signals': {
          const sigDiff = (SIGNIFICANCE_RANK[b.significanceLevel ?? 'noise'] ?? 0) - (SIGNIFICANCE_RANK[a.significanceLevel ?? 'noise'] ?? 0);
          if (sigDiff !== 0) return sigDiff;
          const timeDiff = new Date(b.lastObservedAt ?? 0).getTime() - new Date(a.lastObservedAt ?? 0).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.name.localeCompare(b.name);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [cards, searchQuery, selectedTypes, minRating, sortOption]);

  return (
    <main className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
          <h1>Places</h1>
          <span className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 400 }}>
            {filteredCards.length === cards.length
              ? `${cards.length} place cards`
              : `${filteredCards.length} of ${cards.length}`}
          </span>
        </div>
        {recentSignals.length > 0 && (
          <p className="text-muted" style={{ marginTop: '0.4rem' }}>
            {recentSignals.length} places have fresh notable monitoring signals.
          </p>
        )}
      </div>

      {recentSignals.length > 0 && (
        <section className="place-browse-signals-strip">
          <div className="place-browse-signals-header">
            <h2 className="hot-section-title">📡 Recent Signals</h2>
            <button className="filter-clear" onClick={() => setSortOption('signals')}>
              Sort by signals
            </button>
          </div>
          <div className="place-browse-signals-list">
            {recentSignals.map((card) => (
              <Link key={card.placeId} href={`/placecards/${card.placeId}`} className="place-browse-signal-pill">
                <span className="place-browse-signal-pill-name">{card.name}</span>
                {card.city && <span className="place-browse-signal-pill-city">{card.city}</span>}
                {card.significanceLevel && (
                  <span className={`hot-place-card-signal hot-place-card-signal-${card.significanceLevel}`}>
                    {getHotSignalLabel(card)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

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
                <option value="signals">Recent signals</option>
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
              <PlaceCardImage key={card.heroImage ?? card.placeId} src={card.heroImage} />
              <div className="card-body">
                <h3 className="place-browse-name">{card.name}</h3>
                <TypeBadge type={card.type} />
                {card.hasRecentSignal && card.significanceLevel && (
                  <div className="place-browse-signal-row">
                    <span className={`hot-place-card-signal hot-place-card-signal-${card.significanceLevel}`}>
                      {getHotSignalLabel(card)}
                    </span>
                  </div>
                )}
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
