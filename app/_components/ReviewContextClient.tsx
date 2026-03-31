'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { Context, Discovery, TriageState } from '../_lib/types';
import { getTriageState, getTriageEntry } from '../_lib/triage';
import { haversineDistance, formatDistance, isWalkable } from '../_lib/distance';
import TypeBadge from './TypeBadge';
import TriageButtons from './TriageButtons';
import TripRouteMap from './TripRouteMap';
import AccommodationReviewLayout from './AccommodationReviewLayout';
import ReviewMapPanel from './ReviewMapPanel';

type Tab = 'unreviewed' | 'saved' | 'dismissed' | 'map';

interface ReviewContextClientProps {
  userId: string;
  context: Context;
  discoveries: Discovery[];
}

// Cache for place card coordinates (loaded lazily)
const _placeCardCoordsCache: Record<string, { lat: number; lng: number }> = {};

async function loadPlaceCardCoords(placeId: string): Promise<{ lat: number; lng: number } | null> {
  if (_placeCardCoordsCache[placeId]) return _placeCardCoordsCache[placeId];
  try {
    const res = await fetch(`/placecards/${placeId}/card.json`);
    if (!res.ok) return null;
    const card = await res.json();
    const lat = card.identity?.lat ?? (card as Record<string, unknown>).lat;
    const lng = card.identity?.lng ?? (card as Record<string, unknown>).lng;
    if (lat && lng) {
      _placeCardCoordsCache[placeId] = { lat, lng };
      return { lat, lng };
    }
  } catch { /* ignore */ }
  return null;
}

function timeAgo(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const ms = Date.now() - date.getTime();
  // If timestamp is within last 60 seconds of page load, it's likely a default — skip
  if (ms < 60000) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ReviewContextClient({
  userId,
  context,
  discoveries,
}: ReviewContextClientProps) {
  const [tab, setTab] = useState<Tab>('unreviewed');
  // triageKey changes when triage state changes — forces memo/state recompute
  const [triageKey, setTriageKey] = useState(0);
  // Coordinates for place cards (for anchor-based sorting)
  const [placeCoords, setPlaceCoords] = useState<Record<string, { lat: number; lng: number }>>({});

  // Load coordinates for discoveries when context has anchor
  useEffect(() => {
    if (!context.anchor) return;
    const placeIds = discoveries
      .map(d => d.place_id)
      .filter((id): id is string => !!id);
    Promise.all(placeIds.map(async (placeId) => {
      const coords = await loadPlaceCardCoords(placeId);
      return coords ? { placeId, coords } : null;
    })).then(results => {
      const newCoords: Record<string, { lat: number; lng: number }> = {};
      for (const r of results) {
        if (r) newCoords[r.placeId] = r.coords;
      }
      setPlaceCoords(prev => ({ ...prev, ...newCoords }));
    });
  }, [context.anchor, discoveries.map(d => d.place_id ?? d.id).join(',')]);

  useEffect(() => {
    const handler = () => setTriageKey(k => k + 1);
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, []);

  // Toronto neighbourhood classifier — returns neighbourhood name + proximity rank from Yonge & St Clair
  function getNeighbourhood(address: string | undefined | null): { name: string; rank: number } {
    if (!address) return { name: 'Toronto', rank: 99 };
    const a = address.toLowerCase();
    // Order by proximity to Yonge & St Clair
    if (/yonge|st clair|davenport|summerhill|rosedale/.test(a)) return { name: 'Midtown', rank: 1 };
    if (/avenue|bedford|annex|bloor.*west|spadina.*bloor/.test(a)) return { name: 'Annex', rank: 2 };
    if (/harbord|wales|brunswick|borden/.test(a)) return { name: 'Harbord Village', rank: 3 };
    if (/college.*spadina|kensington|augusta|crawford|clinton/.test(a)) return { name: 'Kensington / Little Italy', rank: 4 };
    if (/college.*east|palmerston|ossington.*college/.test(a)) return { name: 'Little Italy', rank: 4 };
    if (/bayview|leaside|mount pleasant/.test(a)) return { name: 'Leaside / Bayview', rank: 5 };
    if (/ossington|queen.*west|trinity bellwoods|gore vale|dufferin.*queen/.test(a)) return { name: 'Queen West', rank: 6 };
    if (/dundas.*west|parkdale/.test(a)) return { name: 'Parkdale', rank: 7 };
    if (/queen.*east|leslieville|broadview/.test(a)) return { name: 'East End', rank: 8 };
    return { name: 'Toronto', rank: 99 };
  }

  const filtered = useMemo(() => {
    const anchor = context.anchor;
    return discoveries
      .filter(d => {
        const placeId = d.place_id ?? d.id;
        const state = getTriageState(userId, context.key, placeId);
        if (tab === 'unreviewed') return state === 'unreviewed' || state === 'resurfaced';
        if (tab === 'saved') return state === 'saved';
        if (tab === 'dismissed') return state === 'dismissed';
        return false;
      })
      .map(d => {
        // Calculate distance if anchor exists and we have coordinates
        let distanceM: number | undefined;
        if (anchor) {
          const coords = placeCoords[d.place_id ?? ''];
          if (coords) {
            distanceM = haversineDistance(anchor.lat, anchor.lng, coords.lat, coords.lng);
          }
        }
        return { ...d, distanceM };
      })
      .sort((a, b) => {
        // If anchor exists, sort by distance (walkable first, then by proximity)
        if (anchor) {
          const aWalkable = a.distanceM !== undefined && isWalkable(a.distanceM, anchor.radiusM);
          const bWalkable = b.distanceM !== undefined && isWalkable(b.distanceM, anchor.radiusM);
          // Non-walkable goes to bottom
          if (aWalkable && !bWalkable) return -1;
          if (!aWalkable && bWalkable) return 1;
          // Both walkable or both non-walkable: sort by distance
          if (a.distanceM !== undefined && b.distanceM !== undefined) {
            return a.distanceM - b.distanceM;
          }
          if (a.distanceM !== undefined) return -1;
          if (b.distanceM !== undefined) return 1;
        }
        // Fallback to neighbourhood sorting
        const na = getNeighbourhood((a as unknown as Record<string,string>).address);
        const nb = getNeighbourhood((b as unknown as Record<string,string>).address);
        return na.rank - nb.rank || (a.name ?? '').localeCompare(b.name ?? '');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveries, userId, context.key, tab, triageKey, context.anchor, placeCoords]);

  const counts = useMemo(() => {
    let unreviewed = 0, saved = 0, dismissed = 0;
    for (const d of discoveries) {
      const placeId = d.place_id ?? d.id;
      const state = getTriageState(userId, context.key, placeId);
      if (state === 'unreviewed' || state === 'resurfaced') unreviewed++;
      else if (state === 'saved') saved++;
      else if (state === 'dismissed') dismissed++;
    }
    return { unreviewed, saved, dismissed };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveries, userId, context.key, triageKey]);

  // Count mappable unreviewed places for Map tab badge
  const mappableCount = useMemo(() => {
    return discoveries.filter(d => {
      const state = getTriageState(userId, context.key, d.place_id ?? d.id);
      if (state !== 'unreviewed' && state !== 'resurfaced') return false;
      return !!(d.lat ?? placeCoords[d.place_id ?? '']?.lat);
    }).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveries, userId, context.key, triageKey, placeCoords]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'unreviewed', label: 'Needs Review', count: counts.unreviewed },
    { key: 'saved', label: 'Saved', count: counts.saved },
    { key: 'dismissed', label: 'Dismissed', count: counts.dismissed },
    { key: 'map', label: '🗺 Map', count: mappableCount },
  ];

  // Detect if >50% accommodation type → use rich layout
  const accommodationFraction = discoveries.length > 0
    ? discoveries.filter(d => d.type === 'accommodation').length / discoveries.length
    : 0;
  const useAccommodationLayout = accommodationFraction > 0.5;

  return (
    <main className="page">
      <div className="page-header">
        <h1>{context.emoji} {context.label}</h1>
        {context.dates && <p className="text-muted">{context.dates}</p>}
        {context.anchor && (
          <p className="text-sm" style={{ marginTop: '4px' }}>
            📍 Near {context.anchor.label} · {filtered.filter(d => {
              const walkable = d.distanceM !== undefined && isWalkable(d.distanceM, context.anchor!.radiusM);
              return walkable;
            }).length} places within {context.anchor.radiusM}m
          </p>
        )}
      </div>

      {/* Route map — only for non-accommodation trip contexts */}
      {context.type === 'trip' && !useAccommodationLayout && (
        <TripRouteMap contextKey={context.key} />
      )}

      <div className="review-tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`review-tab ${tab === t.key ? 'review-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {useAccommodationLayout ? (
        /* Rich accommodation card layout with sidebar map */
        <AccommodationReviewLayout
          userId={userId}
          context={context}
          discoveries={discoveries}
          tab={(tab === 'map' ? 'unreviewed' : tab) as 'unreviewed' | 'saved' | 'dismissed'}
        />
      ) : tab === 'map' ? (
        /* ── Map-only view (mobile full-screen, or desktop standalone) ── */
        <ReviewMapPanel
          discoveries={filtered}
          placeCoords={placeCoords}
          contextLabel={context.label}
          city={context.city}
        />
      ) : (
        /* ── Desktop: list + sticky map side-by-side; mobile: list only ── */
        <div className="review-list-map-layout">
          <div className="review-list">
          {(() => {
            // Group by neighbourhood
            const groups: { name: string; items: typeof filtered }[] = [];
            let lastNeighbourhood = '';
            for (const d of filtered) {
              const hood = getNeighbourhood((d as unknown as Record<string,string>).address).name;
              if (hood !== lastNeighbourhood) {
                groups.push({ name: hood, items: [] });
                lastNeighbourhood = hood;
              }
              groups[groups.length - 1]!.items.push(d);
            }
            return groups.map(group => (
              <div key={group.name} className="review-neighbourhood-group">
                {groups.length > 1 && (
                  <div className="review-neighbourhood-label">{group.name}</div>
                )}
                {group.items.map(d => {
                  const placeId = d.place_id ?? d.id;
                  const entry = getTriageEntry(userId, context.key, placeId);
                  const heroImage = (d as unknown as Record<string,string>).heroImage;
                  const resolvedHero = heroImage
                    ? (heroImage.startsWith('http') ? heroImage
                      : heroImage.startsWith('/cottages/') || heroImage.startsWith('/developments/') ? heroImage
                      : `${process.env.NEXT_PUBLIC_BLOB_BASE_URL || ''}${heroImage}`)
                    : null;
                  // Distance badge for anchor contexts
                  const distanceM = (d as unknown as { distanceM?: number }).distanceM;
                  const walkable = context.anchor && distanceM !== undefined
                    ? isWalkable(distanceM, context.anchor.radiusM)
                    : undefined;
                  return (
                    <div key={d.id} className="review-item card review-item-with-photo">
                      {resolvedHero && (
                        <div className="review-item-thumb" style={{ backgroundImage: `url(${resolvedHero})` }} />
                      )}
                      <div className="card-body flex items-center justify-between" style={{ flex: 1 }}>
                        <div className="review-item-info">
                          <Link href={`/placecards/${placeId}?context=${encodeURIComponent(context.key)}`} className="review-item-name">
                            {d.name}
                          </Link>
                          <div className="flex items-center gap-sm">
                            <TypeBadge type={d.type} />
                            {/* Distance badge for anchor contexts */}
                            {context.anchor && distanceM !== undefined && (
                              walkable ? (
                                <span className="badge badge-info">{formatDistance(distanceM)}</span>
                              ) : (
                                <span className="badge badge-muted">Not walkable from {context.anchor.label}</span>
                              )
                            )}
                            {(d as unknown as Record<string,string>).city && (
                              <span className="text-xs text-muted">{(d as unknown as Record<string,string>).city}</span>
                            )}
                            {(() => {
                              const ts = tab === 'unreviewed' ? d.discoveredAt : entry?.updatedAt;
                              const ago = timeAgo(ts);
                              return ago ? <span className="text-xs text-muted">{ago}</span> : null;
                            })()}
                            {entry?.state === 'resurfaced' && entry.resurfaceReason && (
                              <span className="badge badge-warning">{entry.resurfaceReason}</span>
                            )}
                          </div>
                        </div>
                        <div className="review-item-actions">
                          <TriageButtons userId={userId} contextKey={context.key} placeId={placeId} />
                          {d.place_id && (
                            <a
                              href={`https://www.google.com/maps/place/?q=place_id:${d.place_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="review-item-maps-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View in Google Maps →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}

          {filtered.length === 0 && (
            <div className="empty-state">
              <p className="text-muted text-sm">
                {tab === 'unreviewed'
                  ? 'All caught up — nothing to review!'
                  : `No ${tab} places yet.`}
              </p>
            </div>
          )}
          </div>

          {/* Desktop sticky map panel — hidden on mobile */}
          <div className="review-map-sidebar">
            <ReviewMapPanel
              discoveries={filtered}
              placeCoords={placeCoords}
              contextLabel={context.label}
              city={context.city}
            />
          </div>
        </div>
      )}
    </main>
  );
}
