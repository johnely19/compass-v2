'use client';

import { resolveImageUrlClient } from '../_lib/image-url';
import { getPlatformInfo } from '../_lib/platform';
import type { Discovery } from '../_lib/types';
import TriageWidget from './TriageWidget';
import ProvenanceSection from './ProvenanceSection';
import MapWidget from './widgets/MapWidget';

/* ---- Amenity icon map ---- */
const AMENITY_ICONS: Record<string, { icon: string; label: string }> = {
  wifi: { icon: '📶', label: 'WiFi' },
  kitchen: { icon: '🍳', label: 'Full Kitchen' },
  'full kitchen': { icon: '🍳', label: 'Full Kitchen' },
  washer: { icon: '🫧', label: 'Washer' },
  dryer: { icon: '🫧', label: 'Dryer' },
  'washer/dryer': { icon: '🫧', label: 'Washer/Dryer' },
  ac: { icon: '❄️', label: 'AC' },
  'air conditioning': { icon: '❄️', label: 'AC' },
  dock: { icon: '⛵', label: 'Dock' },
  'dock access': { icon: '⛵', label: 'Dock' },
  kayaks: { icon: '🛶', label: 'Kayaks' },
  paddleboard: { icon: '🏄', label: 'Paddleboard' },
  canoe: { icon: '🛶', label: 'Canoe' },
  'kayaks/canoe': { icon: '🛶', label: 'Kayaks/Canoe' },
  firepit: { icon: '🔥', label: 'Firepit' },
  fireplace: { icon: '🔥', label: 'Fireplace' },
  'fire pit': { icon: '🔥', label: 'Firepit' },
  'hot tub': { icon: '♨️', label: 'Hot Tub' },
  hottub: { icon: '♨️', label: 'Hot Tub' },
  'pet friendly': { icon: '🐾', label: 'Pet Friendly' },
  pets: { icon: '🐾', label: 'Pets OK' },
  parking: { icon: '🚗', label: 'Parking' },
  bbq: { icon: '🥩', label: 'BBQ' },
  dishwasher: { icon: '🍽️', label: 'Dishwasher' },
  'private beach': { icon: '🏖️', label: 'Private Beach' },
  'boat launch': { icon: '⛵', label: 'Boat Launch' },
  sauna: { icon: '🧖', label: 'Sauna' },
  games: { icon: '🎮', label: 'Games' },
  tv: { icon: '📺', label: 'Smart TV' },
  baby: { icon: '👶', label: 'Baby Gear' },
};

// Desired display order
const AMENITY_PRIORITY = [
  'dock', 'dock access', 'private beach', 'kayaks', 'paddleboard', 'canoe', 'kayaks/canoe',
  'wifi', 'kitchen', 'full kitchen', 'washer', 'dryer', 'washer/dryer',
  'dishwasher', 'bbq', 'firepit', 'fire pit', 'fireplace', 'hot tub', 'hottub', 'sauna',
  'ac', 'air conditioning', 'pet friendly', 'pets', 'parking', 'boat launch',
];

function sortAmenities(amenities: string[]): string[] {
  const priority = new Map(AMENITY_PRIORITY.map((a, i) => [a, i]));
  return [...amenities].sort((a, b) => {
    const ia = priority.get(a.toLowerCase()) ?? 99;
    const ib = priority.get(b.toLowerCase()) ?? 99;
    return ia - ib;
  });
}

function getAmenityDisplay(key: string) {
  return AMENITY_ICONS[key.toLowerCase()] || { icon: '✓', label: key };
}

function formatPrice(perWeek?: number | null, perNight?: number | null): string | null {
  if (!perWeek && !perNight) return null;
  const parts = [];
  if (perWeek) parts.push(`$${perWeek.toLocaleString()}/wk`);
  if (perNight) parts.push(`$${Math.round(perNight)}/night`);
  else if (perWeek) parts.push(`~$${Math.round(perWeek / 7)}/night`);
  return parts.join(' · ');
}

function swimIcon(swimType: string): string {
  const t = swimType.toLowerCase();
  if (t.includes('sandy')) return '🏖️';
  if (t.includes('dock')) return '⛵';
  if (t.includes('deep')) return '🤿';
  if (t.includes('rocky')) return '🪨';
  return '🌊';
}

function quietLabel(score: number | undefined): string {
  if (!score) return '';
  if (score >= 5) return 'Very remote — deep quiet';
  if (score >= 4) return 'Rural — peaceful';
  if (score >= 3) return 'Near-town — some activity';
  return 'Active area';
}

/* ---- Grouped amenity sets ---- */
const OUTDOOR_AMENITIES = new Set(['dock', 'dock access', 'kayaks', 'paddleboard', 'canoe', 'kayaks/canoe', 'firepit', 'fire pit', 'bbq', 'boat launch', 'private beach', 'hot tub', 'hottub', 'sauna', 'pet friendly', 'pets', 'parking']);
const INDOOR_AMENITIES = new Set(['wifi', 'kitchen', 'full kitchen', 'washer', 'dryer', 'washer/dryer', 'dishwasher', 'ac', 'air conditioning', 'tv', 'baby', 'games', 'fireplace']);

interface AccommodationData {
  name?: string;
  description?: string;
  address?: string;
  city?: string;
  heroImage?: string | null;
  heroSource?: string;
  images?: Array<{ path: string; category: string }>;
  // Cottage-specific fields
  platform?: string;
  listing_url?: string;
  url?: string;
  region?: string;
  pricePerWeek?: number | null;
  price_per_week?: number | null;
  price_per_night?: number | null;
  beds?: number;
  bedrooms?: number;
  baths?: number;
  sleeps?: number;
  max_guests?: number;
  guests?: number;
  swimType?: string;
  swim_quality?: string;
  swimVerdict?: string;
  water_body?: string;
  amenities?: string[];
  scores?: Record<string, number>;
  driveTimes?: Record<string, { name?: string; minutes?: number }>;
  drive_from_toronto?: string;
  july_available?: boolean;
  notes?: string;
  match_score?: number;
  gates?: Record<string, boolean>;
  setting_tags?: string[];
  nearest_grocery?: string;
  nearest_town?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  // Solar, air quality, pollen data (enriched)
  solarPeakHrsJuly?: number;
  airQualityJuly?: { aqi: number; category: string };
  pollenJulyTree?: string;
  pollenJulyGrass?: string;
  // Aerial View drone video (enriched by enrich-aerial-view.mjs)
  aerialVideoUrl?: string | null;
  aerialVideoUrlWebm?: string | null;
}

interface AccommodationCardProps {
  data: AccommodationData;
  placeId: string;
  userId?: string;
  contextKey?: string;
  discovery?: Partial<Discovery>;
}

export default function AccommodationCard({ data, placeId, userId, contextKey, discovery }: AccommodationCardProps) {
  const name = data.name || 'Cottage';
  const region = data.region || data.address || data.city || '';
  const summary = data.description || '';

  // Resolve hero image
  const allImages = data.images || [];
  const heroImg = allImages.find(i => ['exterior', 'water', 'general'].includes(i.category)) || allImages[0];
  const heroImage = data.heroImage
    ? resolveImageUrlClient(data.heroImage)
    : heroImg ? resolveImageUrlClient(heroImg.path) : null;

  const LAKE_GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';

  const hasAerialVideo = !!data.aerialVideoUrl;

  // Vitals
  const pricePerWeek = data.pricePerWeek || data.price_per_week;
  const pricePerNight = data.price_per_night;
  const priceStr = formatPrice(pricePerWeek, pricePerNight);
  const perNight = pricePerWeek ? Math.round(pricePerWeek / 7) : null;
  const beds = data.beds || data.bedrooms;
  const sleeps = data.sleeps || data.max_guests || data.guests;

  // Drive time — handle string or object
  let driveTime: string | null = null;
  if (data.drive_from_toronto) {
    driveTime = data.drive_from_toronto;
  } else if (data.driveTimes?.dianaKlaus?.minutes) {
    const m = data.driveTimes.dianaKlaus.minutes;
    driveTime = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}min` : ''}from Toronto`.trim() : `${m}min from Toronto`;
  }

  // Swimming
  const swimType = data.swimType || data.swim_quality || '';
  const swimVerdict = data.swimVerdict || '';
  const waterBody = data.water_body || '';

  // Quiet/setting
  const quietScore = data.scores?.quiet;
  const settingTags = data.setting_tags || [];

  // Amenities
  const amenities = sortAmenities(data.amenities || []);

  // Nearby
  const nearestGrocery = data.nearest_grocery || data.driveTimes?.groceries?.name;
  const groceryMins = data.driveTimes?.groceries?.minutes;
  const nearestTown = data.nearest_town || data.driveTimes?.restaurants?.name;

  // Listing URL
  const listingUrl = data.listing_url || data.url;

  // Platform branding
  const platformInfo = getPlatformInfo(data.platform);

  // Google Maps deep-link (only when placeId looks like a Google Place ID)
  const googleMapsUrl = placeId && placeId.startsWith('ChIJ')
    ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
    : null;

  // Google Earth 3D link
  const googleEarthUrl = (name || region)
    ? `https://earth.google.com/web/search/${encodeURIComponent([name, region].filter(Boolean).join(' '))}`
    : null;

  // Match score
  const rawScores = data.scores as Record<string, number> | undefined;
  const matchScore = data.match_score ||
    (rawScores && Object.values(rawScores).length > 0
      ? Math.round(Object.values(rawScores).reduce((a, b) => a + b, 0) / Object.values(rawScores).length * 10) / 10
      : null);

  return (
    <div className="accommodation-card">
      {/* ── Hero ── */}
      <div
        className="accommodation-hero"
        style={{
          minHeight: 'min(45vw, 320px)',
          position: 'relative',
          background: hasAerialVideo
            ? undefined
            : heroImage
              ? `linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.75) 100%), url(${heroImage}) center/cover no-repeat`
              : LAKE_GRADIENT,
        }}
      >
        {/* Aerial drone video hero */}
        {hasAerialVideo && (
          <>
            <video
              autoPlay
              muted
              loop
              playsInline
              poster={heroImage || undefined}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                zIndex: 0,
              }}
            >
              {data.aerialVideoUrlWebm && (
                <source src={data.aerialVideoUrlWebm} type="video/webm" />
              )}
              <source src={data.aerialVideoUrl!} type="video/mp4" />
            </video>
            {/* Dark gradient overlay on top of video */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.75) 100%)',
                zIndex: 1,
              }}
            />
            {/* Aerial view badge */}
            <span
              style={{
                position: 'absolute',
                bottom: 52,
                left: 8,
                background: 'rgba(0,0,0,0.55)',
                color: 'white',
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: '12px',
                backdropFilter: 'blur(4px)',
                zIndex: 2,
              }}
            >
              🛸 Aerial view
            </span>
          </>
        )}

        {/* Street view badge (only when no aerial video) */}
        {data.heroSource === 'street-view' && !hasAerialVideo && (
          <span
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'rgba(0,0,0,0.55)',
              color: 'white',
              fontSize: '0.7rem',
              padding: '2px 8px',
              borderRadius: '12px',
              backdropFilter: 'blur(4px)',
            }}
          >
            📷 Street view
          </span>
        )}

        <div className="accommodation-hero-overlay" style={{ position: 'relative', zIndex: 2 }}>
          <div className="accommodation-hero-top">
            <span className="accommodation-type-badge">🏡 Cottage</span>
            {matchScore && (
              <span className="accommodation-match-badge">⭐ {matchScore}/5</span>
            )}
          </div>
          <h1 className="accommodation-name">{name}</h1>
          {region && <p className="accommodation-location">📍 {region}</p>}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="accommodation-body">

        {/* Vitals row */}
        <div className="accommodation-vitals">
          {priceStr && (
            <div className="accommodation-vital">
              <span className="accommodation-vital-icon">💰</span>
              <span>{priceStr}</span>
            </div>
          )}
          {(beds || sleeps) && (
            <div className="accommodation-vital">
              <span className="accommodation-vital-icon">🛏️</span>
              <span>
                {beds ? `${beds} bed${beds !== 1 ? 's' : ''}` : ''}
                {beds && sleeps ? ' · ' : ''}
                {sleeps ? `sleeps ${sleeps}` : ''}
              </span>
            </div>
          )}
          {data.july_available !== undefined && (
            <div className="accommodation-vital">
              <span className="accommodation-vital-icon">📅</span>
              <span>July {data.july_available ? '✅ available' : '❌ unavailable'}</span>
            </div>
          )}
          {driveTime && (
            <div className="accommodation-vital">
              <span className="accommodation-vital-icon">🚗</span>
              <span>{driveTime}</span>
            </div>
          )}
          {data.platform && (
            <div className="accommodation-vital">
              <span className="accommodation-vital-icon">🏷️</span>
              <span>
                Listed on{' '}
                <span
                  style={{
                    fontWeight: 600,
                    color: platformInfo.colour,
                  }}
                >
                  {platformInfo.label}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Summary prose */}
        {summary && (
          <div className="accommodation-narrative">
            <p>{summary}</p>
          </div>
        )}

        {/* Swimming & Setting */}
        {(swimType || swimVerdict || waterBody || quietScore || settingTags.length > 0 || data.notes) && (
          <div className="accommodation-section">
            <h3 className="accommodation-section-title">Swimming & Setting</h3>
            {swimType && (
              <div className="accommodation-setting-row">
                <span>{swimIcon(swimType)}</span>
                <span>{swimType}</span>
              </div>
            )}
            {swimVerdict && (
              <div className="accommodation-setting-row accommodation-setting-desc">
                <span>🌊</span>
                <span>{swimVerdict}</span>
              </div>
            )}
            {waterBody && (
              <div className="accommodation-setting-row">
                <span>🗺️</span>
                <span>{waterBody}</span>
              </div>
            )}
            {quietScore && (
              <div className="accommodation-setting-row">
                <span>🧘</span>
                <span>{quietLabel(quietScore)}</span>
              </div>
            )}
            {settingTags.length > 0 && (
              <div className="accommodation-setting-row">
                <span>🏞️</span>
                <span className="accommodation-setting-tags">{settingTags.join(' · ')}</span>
              </div>
            )}
            {data.notes && (
              <div className="accommodation-notes">
                <p>{data.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Amenities grid */}
        {amenities.length > 0 && (
          <div className="accommodation-section">
            <h3 className="accommodation-section-title">Amenities</h3>
            <div className="accommodation-amenities">
              {amenities.map(a => {
                const { icon, label } = getAmenityDisplay(a);
                return (
                  <div key={a} className="accommodation-amenity">
                    <span className="accommodation-amenity-icon">{icon}</span>
                    <span className="accommodation-amenity-label">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Nearby */}
        {(nearestGrocery || nearestTown) && (
          <div className="accommodation-section">
            <h3 className="accommodation-section-title">Nearby</h3>
            {nearestGrocery && (
              <div className="accommodation-nearby-row">
                <span>🛒</span>
                <span>
                  {nearestGrocery}
                  {groceryMins ? ` — ${groceryMins}min` : ''}
                </span>
              </div>
            )}
            {nearestTown && (
              <div className="accommodation-nearby-row">
                <span>🏘️</span>
                <span>Nearest town: {nearestTown}</span>
              </div>
            )}
          </div>
        )}

        {/* Solar, Air Quality, Pollen widgets */}
        {(data.solarPeakHrsJuly || data.airQualityJuly || data.pollenJulyTree || data.pollenJulyGrass) && (
          <div className="accommodation-section accommodation-environment">
            {/* Solar widget */}
            {data.solarPeakHrsJuly && (
              <div className="accommodation-env-row">
                <span>☀️</span>
                <span>
                  Sun exposure {' '}
                  {data.solarPeakHrsJuly < 4 ? 'Low' :
                   data.solarPeakHrsJuly < 5 ? 'Moderate' :
                   data.solarPeakHrsJuly < 6 ? 'Good' : 'High'}
                  {' · ~'}{data.solarPeakHrsJuly.toFixed(1)}{' peak hrs/day in July'}
                </span>
              </div>
            )}
            {/* Air Quality widget */}
            {data.airQualityJuly && (
              <div className="accommodation-env-row">
                <span>🌬️</span>
                <span>
                  Air quality {' '}{data.airQualityJuly.category}{' (AQI '}{data.airQualityJuly.aqi}{')'}
                </span>
              </div>
            )}
            {/* Pollen widget */}
            {(data.pollenJulyTree || data.pollenJulyGrass) && (
              <div className="accommodation-env-row">
                <span>🌿</span>
                <span>
                  Pollen {' '}
                  {data.pollenJulyTree && `Tree: ${data.pollenJulyTree}`}
                  {data.pollenJulyTree && data.pollenJulyGrass && ' · '}
                  {data.pollenJulyGrass && `Grass: ${data.pollenJulyGrass}`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Provenance section — why this place was recommended */}
        {(discovery?.source || data.platform) && (
          <ProvenanceSection
            source={discovery?.source || (data.platform ? `platform:${data.platform}` : 'disco:cottage-scan')}
            discoveredAt={discovery?.discoveredAt || new Date().toISOString()}
            sourceUrl={discovery?.sourceUrl || data.url || data.listing_url}
            sourceName={discovery?.sourceName || data.platform}
            theme={discovery?.theme}
            verified={discovery?.verified}
            rating={discovery?.rating || data.scores?.overall}
            ratingCount={discovery?.ratingCount}
            description={discovery?.description || data.description}
            contextKey={contextKey}
          />
        )}

        {/* Actions */}
        <div className="accommodation-actions">
          {listingUrl && (
            <a
              href={listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn accommodation-cta"
              style={{
                background: platformInfo.colour,
                color: 'white',
                borderColor: platformInfo.colour,
              }}
            >
              ● View on {platformInfo.label} ↗
            </a>
          )}
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="accommodation-maps-link"
            >
              View in Google Maps →
            </a>
          )}
          {userId && contextKey && (
            <div className="accommodation-triage-row">
              <TriageWidget
                userId={userId}
                contextKey={contextKey}
                contextLabel=""
                placeId={placeId}
              />
            </div>
          )}
        </div>

        {/* Google Earth 3D link */}
        {googleEarthUrl && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <a
              href={googleEarthUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="accommodation-maps-link"
            >
              🌍 View in Google Earth 3D →
            </a>
          </div>
        )}

        {/* Map — use address for non-Google-Places cottages */}
        <MapWidget
          placeId={placeId.startsWith('ChIJ') ? placeId : undefined}
          lat={data.lat || data.latitude}
          lng={data.lng || data.longitude}
          name={`${name}${region ? ', ' + region : ''}`}
        />

      </div>
    </div>
  );
}
