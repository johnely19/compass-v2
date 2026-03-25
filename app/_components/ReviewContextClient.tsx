'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { Context, Discovery, TriageState } from '../_lib/types';
import { getTriageState, getTriageEntry } from '../_lib/triage';
import TypeBadge from './TypeBadge';
import TriageButtons from './TriageButtons';
import TripRouteMap from './TripRouteMap';
import AccommodationReviewLayout from './AccommodationReviewLayout';

type Tab = 'unreviewed' | 'saved' | 'dismissed';

interface ReviewContextClientProps {
  userId: string;
  context: Context;
  discoveries: Discovery[];
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
  const [, setRefresh] = useState(0);

  useEffect(() => {
    const handler = () => setRefresh(n => n + 1);
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
    return discoveries
      .filter(d => {
        const placeId = d.place_id ?? d.id;
        const state = getTriageState(userId, context.key, placeId);
        if (tab === 'unreviewed') return state === 'unreviewed' || state === 'resurfaced';
        if (tab === 'saved') return state === 'saved';
        if (tab === 'dismissed') return state === 'dismissed';
        return false;
      })
      .sort((a, b) => {
        const na = getNeighbourhood((a as unknown as Record<string,string>).address);
        const nb = getNeighbourhood((b as unknown as Record<string,string>).address);
        return na.rank - nb.rank || (a.name ?? '').localeCompare(b.name ?? '');
      });
  }, [discoveries, userId, context.key, tab]);

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
  }, [discoveries, userId, context.key]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'unreviewed', label: 'Needs Review', count: counts.unreviewed },
    { key: 'saved', label: 'Saved', count: counts.saved },
    { key: 'dismissed', label: 'Dismissed', count: counts.dismissed },
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
          tab={tab}
        />
      ) : (
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
                  return (
                    <div key={d.id} className="review-item card">
                      <div className="card-body flex items-center justify-between">
                        <div className="review-item-info">
                          <Link href={`/placecards/${placeId}`} className="review-item-name">
                            {d.name}
                          </Link>
                          <div className="flex items-center gap-sm">
                            <TypeBadge type={d.type} />
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
                        <TriageButtons userId={userId} contextKey={context.key} placeId={placeId} />
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
      )}
    </main>
  );
}
