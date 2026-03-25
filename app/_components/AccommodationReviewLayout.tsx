'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { Discovery } from '../_lib/types';
import type { Context } from '../_lib/types';
import { getTriageState } from '../_lib/triage';
import TriageButtons from './TriageButtons';
import { resolveImageUrlClient } from '../_lib/image-url';

type Tab = 'unreviewed' | 'saved' | 'dismissed';

interface AccommodationReviewLayoutProps {
  userId: string;
  context: Context;
  discoveries: Discovery[];
  tab: Tab;
}

/* ---- Amenity icons (top 3) ---- */
const AMENITY_ICONS: Record<string, string> = {
  dock: '⛵', 'dock access': '⛵', kayaks: '🛶', paddleboard: '🏄',
  wifi: '📶', kitchen: '🍳', 'full kitchen': '🍳', bbq: '🥩',
  fireplace: '🔥', firepit: '🔥', 'hot tub': '♨️',
  'pet friendly': '🐾', washer: '🫧',
};
function getTopAmenities(amenities?: string[]): string[] {
  if (!amenities) return [];
  const icons: string[] = [];
  for (const a of amenities) {
    const icon = AMENITY_ICONS[a.toLowerCase()];
    if (icon && !icons.includes(icon)) icons.push(icon);
    if (icons.length >= 3) break;
  }
  return icons;
}

/* ---- July availability ---- */
function julyPill(available?: boolean): { label: string; cls: string } {
  if (available === true) return { label: '✅ July', cls: 'accomm-pill-green' };
  if (available === false) return { label: '❌ July', cls: 'accomm-pill-red' };
  return { label: '⚠️ Confirm', cls: 'accomm-pill-yellow' };
}

/* ---- Single accommodation card ---- */
function AccommodationCard({
  discovery, userId, contextKey,
}: { discovery: Discovery; userId: string; contextKey: string }) {
  const placeId = discovery.place_id ?? discovery.id;

  // Resolve hero image
  const hero = resolveImageUrlClient(discovery.heroImage) || null;

  // Extract cottage-specific fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cottage = (discovery as any)._cottage as Record<string, unknown> | undefined;
  const beds = cottage?.beds as number | undefined;
  const sleeps = cottage?.sleeps as number | undefined;
  const pricePerWeek = cottage?.pricePerWeek as number | null | undefined;
  const swimType = cottage?.swimType as string | undefined;
  const julyAvail = cottage?.july_available as boolean | undefined;
  const matchScore = discovery.rating; // reusing rating field for match score
  const amenities = cottage?.amenities as string[] | undefined;

  // Drive time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driveTimes = (discovery as any)._cottage?.driveTimes as Record<string, { minutes?: number }> | undefined;
  let driveTime: string | null = null;
  if (driveTimes?.dianaKlaus?.minutes) {
    const m = driveTimes.dianaKlaus.minutes;
    driveTime = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}m` : ''}`.trim() : `${m}min`;
  }

  const topAmenities = getTopAmenities(amenities);
  const july = julyPill(julyAvail);

  const GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';

  return (
    <div className="accomm-card">
      {/* Hero image */}
      <Link href={`/placecards/${placeId}?context=${encodeURIComponent(contextKey)}`} className="accomm-card-hero-link">
        <div
          className="accomm-card-hero"
          style={{
            background: hero
              ? `url(${hero}) center/cover no-repeat`
              : GRADIENT,
          }}
        />
      </Link>

      {/* Right content */}
      <div className="accomm-card-body">
        <div className="accomm-card-top">
          <Link href={`/placecards/${placeId}?context=${encodeURIComponent(contextKey)}`} className="accomm-card-name">
            {discovery.name}
          </Link>
          <div className="accomm-card-triage">
            <TriageButtons userId={userId} contextKey={contextKey} placeId={placeId} size="sm" />
          </div>
        </div>

        {/* Swim + tags */}
        {swimType && (
          <div className="accomm-card-tags">
            <span className="accomm-tag accomm-tag-swim">🏊 {swimType}</span>
            {topAmenities.map((icon, i) => (
              <span key={i} className="accomm-tag">{icon}</span>
            ))}
          </div>
        )}

        {/* Vitals */}
        <div className="accomm-card-vitals">
          {pricePerWeek ? (
            <span className="accomm-price">${pricePerWeek.toLocaleString()}/wk</span>
          ) : (
            <span className="accomm-price accomm-price-unknown">Price TBD</span>
          )}
          {(beds || sleeps) && (
            <span className="accomm-beds">
              {beds ? `${beds}BR` : ''}
              {beds && sleeps ? ' · ' : ''}
              {sleeps ? `sleeps ${sleeps}` : ''}
            </span>
          )}
          {driveTime && (
            <span className="accomm-drive">🚗 {driveTime}</span>
          )}
        </div>

        {/* Bottom row: July pill + match score */}
        <div className="accomm-card-bottom">
          <span className={`accomm-pill ${july.cls}`}>{july.label}</span>
          {matchScore != null && (
            <span className="accomm-match">⭐ {matchScore}/5</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Sidebar map ---- */
function AccommodationMapSidebar({ discoveries }: { discoveries: Discovery[] }) {
  // Build a search query with the base location
  const hasLocation = discoveries.some(d => d.address || d.city);
  if (!hasLocation) return null;

  // Use the first discovery's city/region as map center
  const firstAddr = discoveries[0]?.city || discoveries[0]?.address || 'Ontario, Canada';
  const query = encodeURIComponent(firstAddr);
  const iframeSrc = `https://maps.google.com/maps?q=${query}&output=embed&z=9`;

  return (
    <div className="accomm-map-sidebar">
      <div className="accomm-map-header">
        <span className="accomm-map-label">📍 All locations</span>
      </div>
      <iframe
        src={iframeSrc}
        width="100%"
        height="400"
        style={{ border: 0, display: 'block' }}
        loading="lazy"
        title="Cottage locations"
      />
    </div>
  );
}

/* ---- Main layout ---- */
export default function AccommodationReviewLayout({
  userId, context, discoveries, tab,
}: AccommodationReviewLayoutProps) {
  const [, setRefresh] = useState(0);
  useEffect(() => {
    const h = () => setRefresh(n => n + 1);
    window.addEventListener('triage-changed', h);
    return () => window.removeEventListener('triage-changed', h);
  }, []);

  const filtered = useMemo(() => {
    return discoveries.filter(d => {
      const placeId = d.place_id ?? d.id;
      const state = getTriageState(userId, context.key, placeId);
      if (tab === 'unreviewed') return state === 'unreviewed' || state === 'resurfaced';
      if (tab === 'saved') return state === 'saved';
      if (tab === 'dismissed') return state === 'dismissed';
      return false;
    });
  }, [discoveries, userId, context.key, tab]);

  return (
    <div className="accomm-review-layout">
      {/* Card list */}
      <div className="accomm-review-list">
        {filtered.map(d => (
          <AccommodationCard
            key={d.id}
            discovery={d}
            userId={userId}
            contextKey={context.key}
          />
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <p className="text-muted text-sm">
              {tab === 'unreviewed' ? 'All caught up!' : `No ${tab} cottages yet.`}
            </p>
          </div>
        )}
      </div>

      {/* Sticky map sidebar */}
      <div className="accomm-map-column">
        <AccommodationMapSidebar discoveries={discoveries} />
      </div>
    </div>
  );
}
