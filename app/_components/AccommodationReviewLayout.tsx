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

/* ---- Amenity icons (top 5) ---- */
const AMENITY_ICONS: Record<string, string> = {
  dock: '⛵', 'dock access': '⛵', kayaks: '🛶', paddleboard: '🏄',
  wifi: '📶', kitchen: '🍳', 'full kitchen': '🍳', bbq: '🥩',
  fireplace: '🔥', firepit: '🔥', 'hot tub': '♨️', canoe: '🛶',
  'kayaks/canoe': '🛶', 'pet friendly': '🐾', pets: '🐾',
  washer: '🫧', 'washer/dryer': '🫧', sauna: '🧖',
  ac: '❄️', 'air conditioning': '❄️', parking: '🚗',
};
function getTopAmenities(amenities?: string[]): string[] {
  if (!amenities) return [];
  const icons: string[] = [];
  for (const a of amenities) {
    const icon = AMENITY_ICONS[a.toLowerCase()];
    if (icon && !icons.includes(icon)) icons.push(icon);
    if (icons.length >= 5) break;
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

  // Extract cottage-specific fields (all from _cottage since migration update)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cottage = (discovery as any)._cottage as Record<string, unknown> | undefined;
  const beds = cottage?.beds as number | undefined;
  const sleeps = cottage?.sleeps as number | undefined;
  const pricePerWeek = cottage?.pricePerWeek as number | null | undefined;
  const swimType = cottage?.swimType as string | undefined;
  const amenities = cottage?.amenities as string[] | undefined;
  const driveTimes = cottage?.driveTimes as Record<string, { name?: string; minutes?: number }> | undefined;
  const scores = cottage?.scores as Record<string, number> | undefined;
  const gates = cottage?.gates as Record<string, boolean> | undefined;
  const notes = cottage?.notes as string | undefined;
  const vibeTags = cottage?.vibeTags as string[] | undefined;
  const swimVerdict = cottage?.swimVerdict as string | undefined;
  const priceEstimated = cottage?.priceEstimated as boolean | undefined;

  // Match score: average of scores, or fall back to discovery.rating
  const matchScore = scores
    ? Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length * 10) / 10
    : discovery.rating;

  // July availability: derive from gates.threeWeeks or discovery field
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const julyAvail: boolean | undefined = (discovery as any).july_available ??
    (gates?.threeWeeks === true ? true : undefined);

  // Drive time from Toronto - use explicit driveTimeLabel if available, fall back to dianaKlaus
  let driveTime: string | null = null;
  const driveTimeLabel = cottage?.driveTimeLabel as string | undefined;
  if (driveTimeLabel) {
    driveTime = driveTimeLabel;
  } else {
    const dkMins = driveTimes?.dianaKlaus?.minutes;
    if (dkMins) {
      driveTime = dkMins >= 60 ? `${Math.floor(dkMins / 60)}h ${dkMins % 60 > 0 ? `${dkMins % 60}m` : ''}`.trim() : `${dkMins}min`;
    }
  }

  // Nearest grocery / town
  const nearestGrocery = driveTimes?.groceries;
  const nearestTown = driveTimes?.restaurants;

  const topAmenities = getTopAmenities(amenities);
  const july = julyPill(julyAvail);
  const perNight = pricePerWeek ? Math.round(pricePerWeek / 7) : null;

  const GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';

  // Vibe tags - use enriched vibeTags if available, otherwise derive from fields
  const enrichedVibeTags = vibeTags && vibeTags.length > 0 ? vibeTags : [];
  const topVibeTags = enrichedVibeTags.slice(0, 4);

  // Shortened swimVerdict for potential tag (not currently used as a tag)
  const shortSwimVerdict = swimVerdict && swimVerdict.length > 40 ? swimVerdict.slice(0, 37) + '...' : swimVerdict;

  // Location: city · water body
  const city = (discovery as any).city as string | undefined;
  const waterBody = (discovery as any).water_body as string | undefined;
  const locationStr = [city, waterBody].filter(Boolean).join(' · ');

  return (
    <div className="accomm-card">
      {/* Hero image with match score overlay */}
      <Link href={`/placecards/${placeId}?context=${encodeURIComponent(contextKey)}`} className="accomm-card-hero-link">
        <div
          className="accomm-card-hero"
          style={hero ? {
            backgroundImage: `url(${hero})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {
            background: GRADIENT,
          }}
        >
          {matchScore != null && (
            <span className="accomm-hero-match">⭐ {matchScore}</span>
          )}
        </div>
      </Link>

      {/* Card body */}
      <div className="accomm-card-body">

        {/* Name + triage */}
        <div className="accomm-card-top">
          <Link href={`/placecards/${placeId}?context=${encodeURIComponent(contextKey)}`} className="accomm-card-name">
            {discovery.name}
          </Link>
          <div className="accomm-card-triage">
            <TriageButtons userId={userId} contextKey={contextKey} placeId={placeId} size="sm" />
          </div>
        </div>

        {/* Location */}
        {locationStr && (
          <div className="accomm-card-location">{locationStr}</div>
        )}

        {/* Vibe tags */}
        {topVibeTags.length > 0 && (
          <div className="accomm-vibe-tags">
            {topVibeTags.map((tag, i) => (
              <span key={i} className="accomm-vibe-tag">{tag}</span>
            ))}
          </div>
        )}

        {/* Swim verdict (if not Unconfirmed) */}
        {swimVerdict && !swimVerdict.includes('Unconfirmed') && (
          <div className="accomm-swim-verdict">
            🏊 {swimVerdict.length > 80 ? swimVerdict.slice(0, 77) + '...' : swimVerdict}
          </div>
        )}

        {/* Stats row: beds · sleeps · drive */}
        {(beds || sleeps || driveTime) && (
          <div className="accomm-stats-row">
            {beds && <span>{beds} beds</span>}
            {sleeps && <span>· sleeps {sleeps}</span>}
            {driveTime && <span>· {driveTime} from Toronto</span>}
          </div>
        )}

        {/* Amenity icons */}
        {topAmenities.length > 0 && (
          <div className="accomm-amenity-icons">{topAmenities.join(' ')}</div>
        )}

        {/* Price row + July pill */}
        <div className="accomm-price-row">
          {pricePerWeek ? (
            <>
              {priceEstimated && <span className="accomm-price-est">~est. </span>}
              <span className="accomm-price">CA${pricePerWeek.toLocaleString()}/wk</span>
              {perNight && <span className="accomm-price-per-night">~${perNight}/night</span>}
            </>
          ) : (
            <span className="accomm-price accomm-price-unknown">Price TBD</span>
          )}
          <span className={`accomm-pill ${july.cls}`}>{july.label}</span>
        </div>

        {/* Details pending badge */}
        {(!hero || !pricePerWeek) && (
          <span className="accomm-details-pending">Details pending</span>
        )}

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
    let result = discoveries.filter(d => {
      const placeId = d.place_id ?? d.id;
      const state = getTriageState(userId, context.key, placeId);
      if (tab === 'unreviewed') return state === 'unreviewed' || state === 'resurfaced';
      if (tab === 'saved') return state === 'saved';
      if (tab === 'dismissed') return state === 'dismissed';
      return false;
    });

    // Sort by bookability priority
    result = result.sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cottageA = (a as any)._cottage as Record<string, any> | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cottageB = (b as any)._cottage as Record<string, any> | undefined;

      const hasHeroA = !!resolveImageUrlClient(a.heroImage);
      const hasPriceA = cottageA?.pricePerWeek != null;
      const hasVibesA = cottageA?.vibeTags && cottageA.vibeTags.length > 0;
      const swimScoreA = cottageA?.scores?.swimming ?? 0;

      const hasHeroB = !!resolveImageUrlClient(b.heroImage);
      const hasPriceB = cottageB?.pricePerWeek != null;
      const hasVibesB = cottageB?.vibeTags && cottageB.vibeTags.length > 0;
      const swimScoreB = cottageB?.scores?.swimming ?? 0;

      // Priority groups
      const getPriority = (hasHero: boolean, hasPrice: boolean, hasVibes: boolean) => {
        if (hasHero && hasPrice && hasVibes) return 1;
        if (hasHero && hasPrice) return 2;
        if (hasHero) return 3;
        return 4;
      };

      const priorityA = getPriority(hasHeroA, hasPriceA, hasVibesA);
      const priorityB = getPriority(hasHeroB, hasPriceB, hasVibesB);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Within same group, sort by swim score (higher first)
      return swimScoreB - swimScoreA;
    });

    return result;
  }, [discoveries, userId, context.key, tab]);

  return (
    <div className="accomm-review-layout">
      {/* Card list */}
      <div className="accomm-review-list">
        {filtered.map((d, idx) => (
          <AccommodationCard
            key={`${d.id}-${idx}`}
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
