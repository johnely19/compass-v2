'use client';

import { useState, useCallback, useEffect } from 'react';
import type { DiscoveryType, Discovery } from '../_lib/types';
import { ALL_TYPES, getTypeMeta } from '../_lib/discovery-types';

export interface FilterState {
  types: DiscoveryType[];
  minRating: number | null;
  recency: 'all' | '24h' | 'week' | 'month';
}

interface FilterBarProps {
  types?: DiscoveryType[];
  onFilter: (filters: FilterState) => void;
  discoveries?: Discovery[];
}

// Parse discovery date for recency filtering
function getDiscoveryDate(discovery: Discovery): Date | null {
  return discovery.discoveredAt ? new Date(discovery.discoveredAt) : null;
}

// Check if discovery is within recency period
function isWithinRecency(discovery: Discovery, recency: FilterState['recency']): boolean {
  if (recency === 'all') return true;

  const date = getDiscoveryDate(discovery);
  if (!date) return true; // If no date, show it

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  switch (recency) {
    case '24h':
      return diffDays <= 1;
    case 'week':
      return diffDays <= 7;
    case 'month':
      return diffDays <= 30;
    default:
      return true;
  }
}

export function applyFilters(discoveries: Discovery[], filters: FilterState): Discovery[] {
  return discoveries.filter((d) => {
    // Type filter
    if (filters.types.length > 0 && !filters.types.includes(d.type)) {
      return false;
    }

    // Rating filter
    if (filters.minRating != null && (d.rating == null || d.rating < filters.minRating)) {
      return false;
    }

    // Recency filter
    if (!isWithinRecency(d, filters.recency)) {
      return false;
    }

    return true;
  });
}

export default function FilterBar({
  types = ALL_TYPES,
  onFilter,
  discoveries = [],
}: FilterBarProps) {
  const [selectedTypes, setSelectedTypes] = useState<DiscoveryType[]>([]);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [recency, setRecency] = useState<'all' | '24h' | 'week' | 'month'>('all');

  // Notify parent of filter changes
  useEffect(() => {
    onFilter({
      types: selectedTypes,
      minRating,
      recency,
    });
  }, [selectedTypes, minRating, recency, onFilter]);

  const toggleType = useCallback((type: DiscoveryType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTypes([]);
    setMinRating(null);
    setRecency('all');
  }, []);

  const hasActiveFilters = selectedTypes.length > 0 || minRating !== null || recency !== 'all';

  return (
    <div className="filter-bar">
      <div className="filter-section">
        <div className="filter-label">Type</div>
        <div className="filter-chips">
          {types.map((type) => {
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
          <label className="filter-label">When</label>
          <select
            className="filter-select"
            value={recency}
            onChange={(e) => setRecency(e.target.value as FilterState['recency'])}
          >
            <option value="all">All time</option>
            <option value="24h">Last 24h</option>
            <option value="week">Last week</option>
            <option value="month">Last month</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button className="filter-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}