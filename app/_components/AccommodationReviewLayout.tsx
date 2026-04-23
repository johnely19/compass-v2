'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { Discovery } from '../_lib/types';
import type { Context } from '../_lib/types';
import { getTriageState } from '../_lib/triage';
import TriageButtons from './TriageButtons';
import { getDiscoveryPrimaryImageUrl } from '../_lib/image-url';
import { getPlatformInfo } from '../_lib/platform';
import { getHotSignalLabel, isRecentHotSignal, SIGNIFICANCE_RANK, type HotCardSignal } from '../_lib/hot-intelligence';

type Tab = 'unreviewed' | 'saved' | 'dismissed';

interface AccommodationReviewLayoutProps {
  userId: string;
  context: Context;
  discoveries: Discovery[];
  tab: Tab;
  signalByPlaceId?: Record<string, HotCardSignal>;
}

/* ---- Weighted preference score (module scope — used by sort AND card badge) ---- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preferenceScore(d: Discovery): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (d as any)._cottage as Record<string, any> | undefined;
  if (!c) return 0;

  const scores = (c.scores ?? {}) as Record<string, number>;
  const gates  = (c.gates  ?? {}) as Record<string, boolean>;
  const pricePerWeek = c.pricePerWeek as number | null | undefined;

  // Weighted components (Disco scores are 0–5 scale)
  const swimming  = (scores.swimming  ?? 0) * 5;   // 25 max — top priority
  const quiet     = (scores.quiet     ?? 0) * 4;   // 20 max
  const amenities = (scores.amenities ?? 0) * 3;   // 15 max
  const location  = (scores.location  ?? 0) * 3;   // 15 max

  // Budget score (0–10)
  let budgetScore = 5; // neutral if unknown
  if (pricePerWeek != null) {
    if (pricePerWeek <= 2500)      budgetScore = 10;
    else if (pricePerWeek <= 3500) budgetScore = 6;
    else if (pricePerWeek <= 5000) budgetScore = 3;
    else                           budgetScore = 0;
  }

  // Gate bonuses (0–15)
  const gateBonus =
    (gates.dockAccess  ? 8 : 0) +
    (gates.shoreline   ? 4 : 0) +
    (gates.private     ? 2 : 0) +
    (gates.threeWeeks  ? 1 : 0);

  return swimming + quiet + amenities + location + budgetScore + gateBonus;
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
  discovery, userId, contextKey, signal,
}: { discovery: Discovery; userId: string; contextKey: string; signal?: HotCardSignal }) {
  const placeId = discovery.place_id ?? discovery.id;

  // Resolve hero image
  const hero = getDiscoveryPrimaryImageUrl(discovery);

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
  const platform = cottage?.platform as string | undefined;
  const platformInfo = getPlatformInfo(platform);

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
  const signalLabel = signal ? getHotSignalLabel(signal) : null;

  const GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';

  // Vibe tags - use enriched vibeTags if available, otherwise derive from fields
  const enrichedVibeTags = vibeTags && vibeTags.length > 0 ? vibeTags : [];
  const topVibeTags = enrichedVibeTags.slice(0, 4);

  // Location: city · water body
  const discoveryRecord = discovery as unknown as Record<string, unknown>;
  const city = discoveryRecord.city as string | undefined;
  const waterBody = discoveryRecord.water_body as string | undefined;
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
          {/* Preference score badge */}
          {preferenceScore(discovery) > 0 && (
            <span className="accomm-hero-match" style={{ background: 'rgba(37,99,235,0.85)' }}>
              🎯 {Math.round(preferenceScore(discovery))}
            </span>
          )}
          {platform && (
            <span
              className="accomm-hero-platform"
              style={{ background: platformInfo.colour }}
            >
              {platformInfo.label}
            </span>
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

        {signal?.significanceLevel && signalLabel && (
          <div className="accomm-vibe-tags" style={{ marginTop: locationStr ? '0.4rem' : 0 }}>
            <span className={`hot-place-card-signal hot-place-card-signal-${signal.significanceLevel}`}>
              {signalLabel}
            </span>
          </div>
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
  userId, context, discoveries, tab, signalByPlaceId = {},
}: AccommodationReviewLayoutProps) {
  const [, setRefresh] = useState(0);
  const [showMap, setShowMap] = useState(false);
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

    // Sort by weighted preference score (module-level preferenceScore fn)
    result = result.sort((a, b) => {
      const signalA = signalByPlaceId[a.place_id ?? a.id];
      const signalB = signalByPlaceId[b.place_id ?? b.id];
      const recentSignalA = signalA && isRecentHotSignal(signalA) ? signalA : undefined;
      const recentSignalB = signalB && isRecentHotSignal(signalB) ? signalB : undefined;
      const sigDiff = (SIGNIFICANCE_RANK[recentSignalB?.significanceLevel ?? 'noise'] ?? 0) - (SIGNIFICANCE_RANK[recentSignalA?.significanceLevel ?? 'noise'] ?? 0);
      if (sigDiff !== 0) return sigDiff;
      const signalTimeA = recentSignalA?.lastObservedAt ? new Date(recentSignalA.lastObservedAt).getTime() : 0;
      const signalTimeB = recentSignalB?.lastObservedAt ? new Date(recentSignalB.lastObservedAt).getTime() : 0;
      if (signalTimeB !== signalTimeA) return signalTimeB - signalTimeA;

      const scoreA = preferenceScore(a);
      const scoreB = preferenceScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      // Tiebreak: cards with hero image first
      const hasHeroA = !!getDiscoveryPrimaryImageUrl(a);
      const hasHeroB = !!getDiscoveryPrimaryImageUrl(b);
      if (hasHeroA !== hasHeroB) return hasHeroA ? -1 : 1;
      return 0;
    });

    return result;
  }, [discoveries, userId, context.key, tab, signalByPlaceId]);

  return (
    <div className={`accomm-review-layout ${showMap ? 'accomm-review-layout--split' : ''}`}>
      {/* Map drawer handle — pinned to right edge, vertically centered */}
      <button
        className={`accomm-map-handle ${showMap ? 'accomm-map-handle--open' : ''}`}
        onClick={() => setShowMap(v => !v)}
        title={showMap ? 'Hide map' : 'Show map'}
        aria-label={showMap ? 'Hide map' : 'Show map'}
      >
        <span className="accomm-map-handle-icon">🗺</span>
        <span className="accomm-map-handle-label">{showMap ? '◀' : '▶'}</span>
      </button>

      {/* Card list */}
      <div className="accomm-review-list">

        {filtered.map((d, idx) => (
          <AccommodationCard
            key={`${d.id}-${idx}`}
            discovery={d}
            userId={userId}
            contextKey={context.key}
            signal={signalByPlaceId[d.place_id ?? d.id]}
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

      {/* Map panel — hidden until toggled */}
      {showMap && (
        <div className="accomm-map-column">
          <AccommodationMapSidebar discoveries={discoveries} />
        </div>
      )}
    </div>
  );
}
