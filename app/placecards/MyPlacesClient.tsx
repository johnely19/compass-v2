'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import { getTriageState } from '../_lib/triage';
import TypeBadge from '../_components/TypeBadge';
import TriageButtons from '../_components/TriageButtons';
import type { MyPlaceCard } from './page';

interface ContextOption {
  key: string;
  label: string;
  emoji: string;
}

interface MyPlacesClientProps {
  cards: MyPlaceCard[];
  contextOptions: ContextOption[];
  userId: string;
  isOwner: boolean;
  totalDiscoveries: number;
}

type TriageFilter = 'all' | 'unreviewed' | 'saved' | 'dismissed';
type SortOption = 'name-asc' | 'name-desc' | 'rating' | 'context';

export default function MyPlacesClient({
  cards,
  contextOptions,
  userId,
  isOwner,
  totalDiscoveries,
}: MyPlacesClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const [triageFilter, setTriageFilter] = useState<TriageFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [, setRefresh] = useState(0);

  // Re-render on triage changes
  useEffect(() => {
    const handler = () => setRefresh(n => n + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedContext(null);
    setTriageFilter('all');
    setSearchQuery('');
  }, []);

  const hasActiveFilters = selectedContext !== null || triageFilter !== 'all' || searchQuery !== '';

  const filteredCards = useMemo(() => {
    let result = cards;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)
      );
    }

    // Context filter
    if (selectedContext) {
      result = result.filter(c => c.contextKey === selectedContext);
    }

    // Triage filter
    if (triageFilter !== 'all') {
      result = result.filter(c => {
        const state = getTriageState(userId, c.contextKey, c.placeId);
        if (triageFilter === 'unreviewed') return state === 'unreviewed' || state === 'resurfaced';
        return state === triageFilter;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortOption) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'rating':
          return (b.rating ?? 0) - (a.rating ?? 0);
        case 'context':
          return a.contextKey.localeCompare(b.contextKey) || a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [cards, searchQuery, selectedContext, triageFilter, sortOption, userId]);

  // Group by context for display
  const groupedByContext = useMemo(() => {
    if (sortOption !== 'context' && !selectedContext) return null;
    const groups = new Map<string, MyPlaceCard[]>();
    for (const card of filteredCards) {
      const existing = groups.get(card.contextKey) || [];
      existing.push(card);
      groups.set(card.contextKey, existing);
    }
    return groups;
  }, [filteredCards, sortOption, selectedContext]);

  const contextLabel = (key: string) => {
    const opt = contextOptions.find(c => c.key === key);
    return opt ? `${opt.emoji} ${opt.label}` : key;
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>My Places</h1>
        <p className="text-muted">
          {filteredCards.length === cards.length
            ? `${cards.length} discoveries`
            : `${filteredCards.length} of ${cards.length} discoveries`}
        </p>
      </div>

      {/* ── Filter Bar ── */}
      <div className="browse-controls">
        {/* Search */}
        <div className="browse-search">
          <input
            type="text"
            className="browse-search-input"
            placeholder="Search your places..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="browse-filters">
          {/* Context filter */}
          {contextOptions.length > 1 && (
            <div className="filter-section">
              <div className="filter-label">Context</div>
              <div className="filter-chips">
                {contextOptions.map(ctx => (
                  <button
                    key={ctx.key}
                    className={`filter-chip ${selectedContext === ctx.key ? 'filter-chip-active' : ''}`}
                    onClick={() => setSelectedContext(
                      selectedContext === ctx.key ? null : ctx.key
                    )}
                  >
                    <span className="filter-chip-icon">{ctx.emoji}</span>
                    <span className="filter-chip-label">{ctx.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Triage + Sort row */}
          <div className="filter-section filter-section-row">
            <div className="filter-group">
              <label className="filter-label">Status</label>
              <select
                className="filter-select"
                value={triageFilter}
                onChange={(e) => setTriageFilter(e.target.value as TriageFilter)}
              >
                <option value="all">All</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="saved">Saved</option>
                <option value="dismissed">Dismissed</option>
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
                <option value="rating">Rating</option>
                <option value="context">By Context</option>
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

      {/* ── Cards Grid ── */}
      {sortOption === 'context' && groupedByContext ? (
        // Grouped by context
        <div className="my-places-grouped">
          {[...groupedByContext.entries()].map(([ctxKey, ctxCards]) => (
            <div key={ctxKey} className="my-places-context-group">
              <h2 className="my-places-context-heading">{contextLabel(ctxKey)}</h2>
              <div className="grid grid-auto">
                {ctxCards.map(card => (
                  <PlaceCard key={`${card.placeId}-${card.contextKey}`} card={card} userId={userId} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat grid
        <div className="grid grid-auto">
          {filteredCards.map(card => (
            <PlaceCard key={`${card.placeId}-${card.contextKey}`} card={card} userId={userId} />
          ))}
        </div>
      )}

      {filteredCards.length === 0 && (
        <div className="place-grid-empty">
          <p>{hasActiveFilters ? 'No places match your filters.' : 'No discoveries yet.'}</p>
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

/* ── Individual Place Card ── */
function PlaceCard({ card, userId }: { card: MyPlaceCard; userId: string }) {
  const contextParam = encodeURIComponent(card.contextKey);

  return (
    <div className="card place-browse-card" style={{ position: 'relative' }}>
      {/* Hero image thumbnail */}
      {card.heroImage && (
        <Link
          href={`/placecards/${card.placeId}?context=${contextParam}`}
          className="place-browse-hero-link"
        >
          <div
            className="place-browse-hero"
            style={{
              backgroundImage: `url(${card.heroImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        </Link>
      )}

      <Link href={`/placecards/${card.placeId}?context=${contextParam}`} className="place-browse-card-link">
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

      <div className="place-browse-triage">
        <TriageButtons
          userId={userId}
          contextKey={card.contextKey}
          placeId={card.placeId}
          size="sm"
        />
      </div>
    </div>
  );
}
