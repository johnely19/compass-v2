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
  if (perWeek) parts.push(`CA$${perWeek.toLocaleString()}/week`);
  if (perNight) parts.push(`CA$${Math.round(perNight)}/night`);
  else if (perWeek) parts.push(`~CA$${Math.round(perWeek / 7)}/night`);
  return parts.join(' · ');
}

function formatPriceShort(perWeek?: number | null, perNight?: number | null): string | null {
  if (!perWeek && !perNight) return null;
  if (perNight) return `CA$${Math.round(perNight)}/night`;
  if (perWeek) return `~CA$${Math.round(perWeek / 7)}/night`;
  return null;
}

function swimIcon(swimType: string): string {
  const t = swimType.toLowerCase();
  if (t.includes('sandy')) return '🏖️';
  if (t.includes('dock')) return '⛵';
  if (t.includes('deep')) return '🤿';
  if (t.includes('rocky')) return '🪨';
  return '🌊';
}

function waterClarityFromVerdict(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v.includes('crystal') || v.includes('clear')) return 'Crystal clear';
  if (v.includes('clean')) return 'Clean';
  if (v.includes('murky') || v.includes('cloudy')) return 'Murky';
  if (v.includes('mucky') || v.includes('muddy')) return 'Mucky';
  return '';
}

function quietLabel(score: number | undefined): string {
  if (!score) return '';
  if (score >= 5) return 'Very remote — deep quiet';
  if (score >= 4) return 'Rural — peaceful';
  if (score >= 3) return 'Near-town — some activity';
  return 'Active area';
}

/* ---- Types ---- */
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

/* ---- Feature Callout Component ---- */
function AccommodationFeature({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="accom-feature">
      <span className="accom-feature-icon">{icon}</span>
      <div className="accom-feature-text">
        <span className="accom-feature-title">{title}</span>
        <span className="accom-feature-desc">{description}</span>
      </div>
    </div>
  );
}

export default function AccommodationCard({ data, placeId, userId, contextKey, discovery }: AccommodationCardProps) {
  const name = data.name || 'Cottage';
  const region = data.address || data.city || data.region || '';
  const summary = data.description || data.notes || '';

  // Resolve images for grid
  const allImages = data.images || [];
  const heroImg = allImages.find(i => ['exterior', 'water', 'general'].includes(i.category)) || allImages[0];
  const heroImage = data.heroImage
    ? resolveImageUrlClient(data.heroImage)
    : heroImg ? resolveImageUrlClient(heroImg.path) : null;

  const LAKE_GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';
  const hasAerialVideo = !!data.aerialVideoUrl;

  // Get secondary photos (up to 4)
  const secondaryImages = allImages.slice(1, 5).map(img => resolveImageUrlClient(img.path));
  const hasMultipleImages = secondaryImages.length > 0 || heroImage;

  // Vitals
  const pricePerWeek = data.pricePerWeek || data.price_per_week;
  const pricePerNight = data.price_per_night;
  const priceStr = formatPrice(pricePerWeek, pricePerNight);
  const priceStrShort = formatPriceShort(pricePerWeek, pricePerNight);
  const perNight = pricePerWeek ? Math.round(pricePerWeek / 7) : null;
  const beds = data.beds || data.bedrooms;
  const baths = data.baths;
  const sleeps = data.sleeps || data.max_guests || data.guests;
  const bedrooms = data.bedrooms || beds;

  // Drive time
  let driveTime: string | null = null;
  let driveTimeLabel: string | null = null;
  if (data.drive_from_toronto) {
    driveTime = data.drive_from_toronto;
    driveTimeLabel = 'From Toronto';
  } else if (data.driveTimes?.dianaKlaus?.minutes) {
    const m = data.driveTimes.dianaKlaus.minutes;
    driveTime = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}min` : ''}`.trim() : `${m}min`;
    driveTimeLabel = 'From Toronto';
  }

  // Swimming
  const swimType = data.swimType || data.swim_quality || '';
  const swimVerdict = data.swimVerdict || '';
  const waterBody = data.water_body || '';
  const waterClarity = swimVerdict ? waterClarityFromVerdict(swimVerdict) : '';

  // Quiet/setting
  const quietScore = data.scores?.quiet;
  const settingTags = data.setting_tags || [];

  // Amenities
  const amenities = sortAmenities(data.amenities || []);
  const amenitySet = new Set(amenities.map(a => a.toLowerCase()));

  // Nearby
  const nearestGrocery = data.nearest_grocery || data.driveTimes?.groceries?.name;
  const groceryMins = data.driveTimes?.groceries?.minutes;
  const nearestTown = data.nearest_town || data.driveTimes?.restaurants?.name;

  // Listing URL
  const listingUrl = data.listing_url || data.url;

  // Platform branding
  const platformInfo = getPlatformInfo(data.platform);

  // Google Maps deep-link
  const googleMapsUrl = placeId && placeId.startsWith('ChIJ')
    ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
    : null;

  // Google Earth 3D link
  const googleEarthUrl = (name || region)
    ? `https://earth.google.com/web/search/${encodeURIComponent([name, region].filter(Boolean).join(' '))}`
    : null;

  // Match score / rating
  const rawScores = data.scores as Record<string, number> | undefined;
  const avgScore = rawScores && Object.values(rawScores).length > 0
    ? Math.round(Object.values(rawScores).reduce((a, b) => a + b, 0) / Object.values(rawScores).length * 10) / 10
    : null;

  // Determine property type for title
  const propertyType = 'Cottage';

  /* ---- Feature callouts ---- */
  const features: { icon: string; title: string; description: string }[] = [];

  // Swimming feature
  if (swimType) {
    const swimTitle = swimType.includes('sandy') ? 'Sandy beach' : swimType.includes('dock') ? 'Dock access' : swimType.includes('rocky') ? 'Rocky shoreline' : 'Swimming';
    const swimDesc = swimVerdict.split('.')[0] || '';
    features.push({ icon: swimIcon(swimType), title: swimTitle, description: swimDesc });
  }

  // Drive time feature
  if (driveTime && driveTimeLabel) {
    features.push({ icon: '🚗', title: driveTime, description: driveTimeLabel });
  }

  // Privacy/quiet feature
  if (quietScore && quietScore >= 4) {
    features.push({ icon: '🌲', title: 'Very private', description: quietScore >= 5 ? 'No visible neighbours' : 'Secluded setting' });
  }

  // Dock feature
  if (amenitySet.has('dock') || amenitySet.has('dock access')) {
    features.push({ icon: '⛵', title: 'Dock included', description: 'Deep water access' });
  }

  // Water equipment feature
  if (amenitySet.has('kayaks') || amenitySet.has('paddleboard') || amenitySet.has('canoe') || amenitySet.has('kayaks/canoe')) {
    const parts = [];
    if (amenitySet.has('kayaks')) parts.push('Kayaks');
    if (amenitySet.has('paddleboard')) parts.push('Paddleboard');
    if (amenitySet.has('canoe')) parts.push('Canoe');
    features.push({ icon: '🛶', title: parts.join(' & '), description: 'Included' });
  }

  // Private beach feature
  if (amenitySet.has('private beach') || swimType.toLowerCase().includes('beach')) {
    features.push({ icon: '🏖️', title: 'Private beach', description: 'Sandy shoreline' });
  }

  /* ---- Lake-specific fields ---- */
  const lakeItems: { icon: string; label: string; value: string }[] = [];

  if (swimType) {
    lakeItems.push({ icon: '🏖️', label: 'Beach type', value: swimType });
  }
  if (waterClarity) {
    lakeItems.push({ icon: '🌊', label: 'Water clarity', value: waterClarity });
  }
  if (amenitySet.has('dock') || amenitySet.has('dock access')) {
    lakeItems.push({ icon: '⛵', label: 'Dock', value: 'Included' });
  }
  if (amenitySet.has('kayaks') || amenitySet.has('paddleboard') || amenitySet.has('canoe')) {
    const parts = [];
    if (amenitySet.has('kayaks')) parts.push('Kayaks');
    if (amenitySet.has('paddleboard')) parts.push('Paddleboard');
    if (amenitySet.has('canoe')) parts.push('Canoe');
    lakeItems.push({ icon: '🛶', label: 'Water equipment', value: parts.join(', ') });
  }
  if (waterBody) {
    lakeItems.push({ icon: '🗺️', label: 'Water body', value: waterBody });
  }
  if (amenitySet.has('boat launch')) {
    lakeItems.push({ icon: '⛵', label: 'Boat launch', value: 'Nearby' });
  }

  /* ---- AI Guest Summary ---- */
  const hasGuestSummary = swimVerdict || summary;

  return (
    <div className="accommodation-card">
      {/* ── Photo Grid ── */}
      <div className="accom-photo-grid">
        {/* Hero photo (left 50%) */}
        <div className="accom-photo-hero">
          {hasAerialVideo ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              poster={heroImage || undefined}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            >
              {data.aerialVideoUrlWebm && <source src={data.aerialVideoUrlWebm} type="video/webm" />}
              <source src={data.aerialVideoUrl!} type="video/mp4" />
            </video>
          ) : heroImage ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                background: `url(${heroImage}) center/cover no-repeat`,
              }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: LAKE_GRADIENT }} />
          )}
          {/* Aerial view badge */}
          {hasAerialVideo && (
            <span className="accom-aerial-badge">🛸 Aerial view</span>
          )}
        </div>

        {/* Secondary photos (right 2x2) */}
        <div className="accom-photo-grid-secondary">
          {secondaryImages.slice(0, 4).map((img, idx) => (
            <div key={idx} className="accom-photo-secondary">
              {img ? (
                <div style={{ width: '100%', height: '100%', background: `url(${img}) center/cover no-repeat` }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: LAKE_GRADIENT }} />
              )}
            </div>
          ))}
          {/* View all overlay */}
          {allImages.length > 5 && (
            <button className="accom-photo-viewall">
              View all {allImages.length} photos ↗
            </button>
          )}
        </div>
      </div>

      {/* ── Two-Column Layout ── */}
      <div className="accom-two-col">
        {/* Left Content Column */}
        <div className="accom-content">
          {/* Title: Vacasa style "Cottage in [Region]" */}
          <div className="accom-header">
            <span className="accom-title-type">{propertyType} in {region}</span>
            <h1 className="accom-title-name">{name}</h1>
          </div>

          {/* Quick specs row (Vacasa style) */}
          <div className="accom-specs-row">
            {sleeps && <><span>🧑‍🤝‍🧑</span> Sleeps {sleeps}</>}
            {beds && beds !== sleeps && <><span>·</span> <span>🛏</span> {beds} beds</>}
            {baths && <><span>·</span> <span>🚿</span> {baths} baths</>}
            {(amenitySet.has('pet friendly') || amenitySet.has('pets')) && <><span>·</span> <span>🐾</span> Pets OK</>}
          </div>

          {/* AI Guest Summary (Airbnb style) */}
          {hasGuestSummary && avgScore && (
            <div className="accom-ai-summary">
              <div className="accom-ai-header">
                <span className="accom-ai-rating">⭐ {avgScore}</span>
                <span className="accom-ai-label">What guests say...</span>
              </div>
              <p className="accom-ai-text">
                {swimVerdict || summary.substring(0, 200)}
              </p>
            </div>
          )}

          {/* Feature Callouts (Hipcamp style) */}
          {features.length > 0 && (
            <div className="accom-features">
              {features.slice(0, 4).map((f, idx) => (
                <AccommodationFeature key={idx} icon={f.icon} title={f.title} description={f.description} />
              ))}
            </div>
          )}

          {/* Lake-specific fields (first class) */}
          {lakeItems.length > 0 && (
            <div className="accom-lake-section">
              <h3 className="accom-lake-title">🏊 Water Experience</h3>
              <div className="accom-lake-grid">
                {lakeItems.map((item, idx) => (
                  <div key={idx} className="accom-lake-item">
                    <span className="accom-lake-icon">{item.icon}</span>
                    <div className="accom-lake-content">
                      <span className="accom-lake-label">{item.label}</span>
                      <span className="accom-lake-value">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sleeping arrangements (Vacasa style) */}
          {beds && (
            <div className="accom-bedrooms">
              <h3 className="accom-bedrooms-title">🛏️ Sleeping</h3>
              <div className="accom-bedroom-cards">
                <div className="accom-bedroom-card">
                  <span className="accom-bedroom-name">Bedroom</span>
                  <span className="accom-bedroom-type">{beds} {beds === 1 ? 'bed' : 'beds'}</span>
                </div>
                {sleeps && (
                  <div className="accom-bedroom-card">
                    <span className="accom-bedroom-name">Sleeps</span>
                    <span className="accom-bedroom-type">{sleeps} guests</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description prose */}
          {summary && (
            <div className="accom-description">
              <h3 className="accom-description-title">About this place</h3>
              <p className="accom-description-text">{summary}</p>
            </div>
          )}

          {/* Amenities grid */}
          {amenities.length > 0 && (
            <div className="accom-amenities-section">
              <h3 className="accom-amenities-title">Amenities</h3>
              <div className="accom-amenities-grid">
                {amenities.map(a => {
                  const { icon, label } = getAmenityDisplay(a);
                  return (
                    <div key={a} className="accom-amenity-item">
                      <span className="accom-amenity-item-icon">{icon}</span>
                      <span className="accom-amenity-item-label">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nearby */}
          {(nearestGrocery || nearestTown) && (
            <div className="accom-nearby">
              <h3 className="accom-nearby-title">Nearby</h3>
              {nearestGrocery && (
                <div className="accom-nearby-row">
                  <span>🛒</span>
                  <span>{nearestGrocery}{groceryMins ? ` — ${groceryMins}min` : ''}</span>
                </div>
              )}
              {nearestTown && (
                <div className="accom-nearby-row">
                  <span>🏘️</span>
                  <span>Nearest town: {nearestTown}</span>
                </div>
              )}
            </div>
          )}

          {/* Solar, Air Quality, Pollen widgets */}
          {(data.solarPeakHrsJuly || data.airQualityJuly || data.pollenJulyTree || data.pollenJulyGrass) && (
            <div className="accom-environment">
              {data.solarPeakHrsJuly && (
                <div className="accom-env-row">
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
              {data.airQualityJuly && (
                <div className="accom-env-row">
                  <span>🌬️</span>
                  <span>Air quality {' '}{data.airQualityJuly.category}{' (AQI '}{data.airQualityJuly.aqi}{')'}</span>
                </div>
              )}
              {(data.pollenJulyTree || data.pollenJulyGrass) && (
                <div className="accom-env-row">
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

          {/* Provenance section */}
          {(discovery?.source || data.platform) && (
            <ProvenanceSection
              source={discovery?.source || (data.platform ? `platform:${data.platform}` : 'disco:cottage-scan')}
              discoveredAt={discovery?.discoveredAt || undefined}
              sourceUrl={discovery?.sourceUrl || data.url || data.listing_url}
              sourceName={discovery?.sourceName || data.platform}
              theme={discovery?.theme}
              verified={discovery?.verified}
              rating={discovery?.rating || data.scores?.overall}
              ratingCount={discovery?.ratingCount}
              description={discovery?.description || data.description}
              placeName={name}
            />
          )}

          {/* Map */}
          <MapWidget
            placeId={placeId.startsWith('ChIJ') ? placeId : undefined}
            lat={data.lat || data.latitude}
            lng={data.lng || data.longitude}
            name={`${name}${region ? ', ' + region : ''}`}
          />

          {/* Triage */}
          {userId && contextKey && (
            <div className="accom-triage">
              <TriageWidget
                userId={userId}
                contextKey={contextKey}
                contextLabel=""
                placeId={placeId}
              />
            </div>
          )}
        </div>

        {/* Right Sticky Price Card */}
        <div className="accom-price-card">
          {/* Main price */}
          <div className="accom-price-main">
            {priceStr && <span>{priceStr}</span>}
            {priceStrShort && priceStr !== priceStrShort && <span className="accom-price-night">{priceStrShort}</span>}
          </div>

          {/* Details row */}
          <div className="accom-price-details">
            {beds && <span>{beds} beds</span>}
            {sleeps && <span> · sleeps {sleeps}</span>}
          </div>

          {/* Availability */}
          {data.july_available !== undefined && (
            <div className="accom-price-avail">
              July {data.july_available ? '✅ Available' : '❌ Unavailable'}
            </div>
          )}

          {/* Platform CTA */}
          {listingUrl && (
            <a
              href={listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="accom-price-cta"
              style={{ background: platformInfo.colour, borderColor: platformInfo.colour }}
            >
              View on {platformInfo.label} ↗
            </a>
          )}

          {/* Maps link */}
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="accom-price-maps"
            >
              📍 View in Maps →
            </a>
          )}

          {/* Google Earth link */}
          {googleEarthUrl && (
            <a
              href={googleEarthUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="accom-price-earth"
            >
              🌍 View in Google Earth 3D →
            </a>
          )}

          {/* Trust badges */}
          <div className="accom-trust-badges">
            <span className="accom-trust-badge">✓ Verified listing</span>
            {listingUrl && <span className="accom-trust-badge">✓ Direct booking</span>}
            {listingUrl && <span className="accom-trust-badge">📞 Contact owner</span>}
          </div>
        </div>
      </div>

      {/* Mobile sticky price bar */}
      <div className="accom-mobile-bar">
        {priceStrShort && <span className="accom-mobile-price">{priceStrShort}</span>}
        {listingUrl && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="accom-mobile-cta"
            style={{ background: platformInfo.colour }}
          >
            View on {platformInfo.label} ↗
          </a>
        )}
      </div>
    </div>
  );
}