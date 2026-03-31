'use client';

import { resolveImageUrlClient } from '../_lib/image-url';
import { getPlatformInfo } from '../_lib/platform';
import type { Discovery } from '../_lib/types';
import TriageWidget from './TriageWidget';
import MapWidget from './widgets/MapWidget';
import ProvenanceSection from './ProvenanceSection';

/* ================================================================
   Amenity icon map
   ================================================================ */
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

function quietLabel(score: number | undefined): string {
  if (!score) return '';
  if (score >= 5) return 'No visible neighbours, deep quiet';
  if (score >= 4) return 'Rural setting, very peaceful';
  if (score >= 3) return 'Near-town, some road activity';
  return 'Active area';
}

/* ================================================================
   Feature Callout builder
   ================================================================ */
interface FeatureCallout {
  icon: string;
  title: string;
  desc: string;
}

function buildFeatureCallouts(data: AccommodationData): FeatureCallout[] {
  const callouts: FeatureCallout[] = [];

  // Swim verdict
  const swimVerdict = data.swimVerdict || '';
  const swimType = data.swimType || data.swim_quality || '';
  if (swimVerdict && !swimVerdict.toLowerCase().includes('unconfirmed')) {
    callouts.push({
      icon: '🏊',
      title: swimType || 'Swimming',
      desc: swimVerdict,
    });
  }

  // Drive time
  const driveTime = getDriveTime(data);
  if (driveTime) {
    callouts.push({
      icon: '🚗',
      title: `${driveTime} drive`,
      desc: 'From downtown Toronto',
    });
  }

  // Privacy / quiet
  const quietScore = data.scores?.quiet;
  if (quietScore && quietScore >= 4) {
    callouts.push({
      icon: '🌲',
      title: quietScore >= 5 ? 'Very private' : 'Peaceful & quiet',
      desc: quietLabel(quietScore),
    });
  }

  // Waterfront amenities
  const amenities = (data.amenities || []).map(a => a.toLowerCase());
  if (amenities.includes('dock') || amenities.includes('dock access')) {
    callouts.push({
      icon: '⛵',
      title: 'Dock included',
      desc: amenities.includes('kayaks') || amenities.includes('kayaks/canoe')
        ? 'Deep water access, kayaks available'
        : 'Direct water access from property',
    });
  } else if (amenities.includes('private beach')) {
    callouts.push({
      icon: '🏖️',
      title: 'Private beach',
      desc: 'Sandy shoreline on the property',
    });
  }

  // Water body
  if (data.water_body && callouts.length < 4) {
    callouts.push({
      icon: '🗺️',
      title: data.water_body,
      desc: 'Waterfront property',
    });
  }

  return callouts.slice(0, 4);
}

/* ================================================================
   Drive time helper
   ================================================================ */
function getDriveTime(data: AccommodationData): string | null {
  if (data.driveTimeLabel) return data.driveTimeLabel;
  if (data.drive_from_toronto) return data.drive_from_toronto;
  if (data.driveTimes?.dianaKlaus?.minutes) {
    const m = data.driveTimes.dianaKlaus.minutes;
    return m >= 60
      ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}min` : ''}`.trim()
      : `${m}min`;
  }
  return null;
}

/* ================================================================
   AI Guest Summary builder
   ================================================================ */
function buildGuestSummary(data: AccommodationData): string | null {
  const parts: string[] = [];

  // Swimming/waterfront
  const swimVerdict = data.swimVerdict || '';
  const swimType = data.swimType || data.swim_quality || '';
  if (swimVerdict && !swimVerdict.toLowerCase().includes('unconfirmed')) {
    // Extract first sentence of swim verdict
    const firstSentence = swimVerdict.split(/[.!]/).filter(Boolean)[0]?.trim();
    if (firstSentence) parts.push(firstSentence + '.');
  } else if (swimType) {
    parts.push(`${swimType} waterfront access.`);
  }

  // Quiet/privacy
  const quietScore = data.scores?.quiet;
  if (quietScore && quietScore >= 5) {
    parts.push('Very private — no visible neighbours.');
  } else if (quietScore && quietScore >= 4) {
    parts.push('Peaceful rural setting.');
  }

  // Vibe tags
  const vibeTags = data.vibeTags || data.setting_tags || [];
  if (vibeTags.length > 0 && parts.length < 2) {
    parts.push(vibeTags.slice(0, 3).join(', ') + '.');
  }

  // Key amenity highlight
  const amenities = (data.amenities || []).map(a => a.toLowerCase());
  if (parts.length < 2) {
    const highlights: string[] = [];
    if (amenities.includes('dock') || amenities.includes('dock access')) highlights.push('dock access');
    if (amenities.includes('kayaks') || amenities.includes('kayaks/canoe')) highlights.push('kayaks included');
    if (amenities.includes('firepit') || amenities.includes('fire pit')) highlights.push('firepit');
    if (amenities.includes('hot tub') || amenities.includes('hottub')) highlights.push('hot tub');
    if (highlights.length > 0) {
      parts.push(`Includes ${highlights.join(', ')}.`);
    }
  }

  if (parts.length === 0) return null;
  return parts.slice(0, 2).join(' ');
}

/* ================================================================
   Lake-specific fields builder
   ================================================================ */
interface LakeField {
  icon: string;
  label: string;
  value: string;
}

function buildLakeFields(data: AccommodationData): LakeField[] {
  const fields: LakeField[] = [];
  const amenities = (data.amenities || []).map(a => a.toLowerCase());

  // Dock type
  if (amenities.includes('dock') || amenities.includes('dock access')) {
    fields.push({
      icon: '🚤',
      label: 'Dock',
      value: amenities.includes('boat launch') ? 'Deep water dock with launch' : 'Dock access',
    });
  }

  // Water equipment
  const waterGear: string[] = [];
  if (amenities.includes('kayaks') || amenities.includes('kayaks/canoe')) waterGear.push('Kayaks');
  if (amenities.includes('paddleboard')) waterGear.push('Paddleboard');
  if (amenities.includes('canoe')) waterGear.push('Canoe');
  if (waterGear.length > 0) {
    fields.push({
      icon: '🛶',
      label: 'Water equipment',
      value: waterGear.join(', ') + ' included',
    });
  }

  // Beach type
  const swimType = (data.swimType || data.swim_quality || '').toLowerCase();
  if (swimType) {
    let beachDesc = swimType;
    if (swimType.includes('sandy')) beachDesc = 'Sandy beach';
    else if (swimType.includes('rocky')) beachDesc = 'Rocky shoreline';
    else if (swimType.includes('dock')) beachDesc = 'Dock entry (deep water)';
    fields.push({
      icon: '🏊',
      label: 'Beach type',
      value: beachDesc.charAt(0).toUpperCase() + beachDesc.slice(1),
    });
  }

  // Water clarity / swim verdict summary
  const swimVerdict = data.swimVerdict || '';
  if (swimVerdict && !swimVerdict.toLowerCase().includes('unconfirmed')) {
    const clarity = swimVerdict.toLowerCase();
    let clarityLabel = 'Confirmed swimmable';
    if (clarity.includes('crystal clear') || clarity.includes('clean')) clarityLabel = 'Crystal clear — confirmed';
    else if (clarity.includes('sandy')) clarityLabel = 'Sandy bottom — confirmed';
    else if (clarity.includes('weeds')) clarityLabel = 'Some weeds noted';
    fields.push({
      icon: '🌊',
      label: 'Water clarity',
      value: clarityLabel,
    });
  }

  // Lake / water body name
  if (data.water_body) {
    fields.push({
      icon: '📍',
      label: 'Lake',
      value: data.water_body,
    });
  }

  return fields;
}

/* ================================================================
   Sleeping arrangements from notes
   ================================================================ */
interface BedroomInfo {
  name: string;
  beds: string;
}

function parseBedrooms(data: AccommodationData): BedroomInfo[] {
  const notes = data.notes || '';
  const bedrooms: BedroomInfo[] = [];

  // Try to extract bedroom info from notes (patterns like "BR1", "master", "bedroom")
  // Common patterns: "Queen bed (BR1)", "master (Q)", "2 singles", etc.
  const brPattern = /(?:(?:BR\d|Bedroom\s*\d|Master|Room\s*\d)[^.;,]*?(?:queen|king|double|single|twin|bunk)[^.;,]*)|(?:(?:queen|king|double|single|twin|bunk)[^.;,]*?(?:BR\d|bedroom|master|room))/gi;
  const matches = notes.match(brPattern);

  if (matches && matches.length > 0) {
    matches.forEach((m, i) => {
      const clean = m.trim();
      const name = clean.match(/master|BR\d|Bedroom\s*\d|Room\s*\d/i)?.[0] || `Bedroom ${i + 1}`;
      const bedType = clean.match(/(?:\d+\s*)?(?:queen|king|double|single|twin|bunk)(?:\s*bed)?s?/gi)?.join(', ') || clean;
      bedrooms.push({
        name: name.replace(/BR(\d)/, 'Bedroom $1'),
        beds: bedType.charAt(0).toUpperCase() + bedType.slice(1),
      });
    });
  }

  // Fallback: if no parsed bedrooms but we have a bed count, show generic
  if (bedrooms.length === 0 && data.beds) {
    for (let i = 1; i <= Math.min(data.beds, 4); i++) {
      bedrooms.push({
        name: `Bedroom ${i}`,
        beds: i === 1 ? '1 bed' : '1 bed',
      });
    }
  }

  return bedrooms;
}

/* ================================================================
   Google Maps URL builder
   ================================================================ */
function buildGoogleMapsUrl(data: AccommodationData, placeId: string): string {
  if (placeId.startsWith('ChIJ')) {
    return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
  }
  const query = [data.name, data.region || data.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildGoogleMapsPhotosUrl(data: AccommodationData, placeId: string): string {
  if (placeId.startsWith('ChIJ')) {
    return `https://www.google.com/maps/place/?q=place_id:${placeId}#photos`;
  }
  const query = [data.name, data.region || data.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/* ================================================================
   Types
   ================================================================ */
interface AccommodationData {
  name?: string;
  description?: string;
  address?: string;
  city?: string;
  heroImage?: string | null;
  heroSource?: string;
  images?: Array<{ path: string; category: string }>;
  platform?: string;
  listing_url?: string;
  url?: string;
  region?: string;
  pricePerWeek?: number | null;
  price_per_week?: number | null;
  price_per_night?: number | null;
  pricePerNight?: number | null;
  priceEstimated?: boolean;
  driveTimeLabel?: string;
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
  vibeTags?: string[];
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
  solarPeakHrsJuly?: number;
  airQualityJuly?: { aqi: number; category: string };
  pollenJulyTree?: string;
  pollenJulyGrass?: string;
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

/* ================================================================
   AccommodationFeature sub-component
   ================================================================ */
function AccommodationFeature({ icon, title, desc }: FeatureCallout) {
  return (
    <div className="hc-feature">
      <span className="hc-feature-icon">{icon}</span>
      <div className="hc-feature-text">
        <span className="hc-feature-title">{title}</span>
        <span className="hc-feature-desc">{desc}</span>
      </div>
    </div>
  );
}

/* ================================================================
   Main Component
   ================================================================ */
export default function AccommodationCard({ data, placeId, userId, contextKey, discovery }: AccommodationCardProps) {
  const name = data.name || 'Cottage';
  const region = data.region || data.address || data.city || '';

  // ── Resolve all photo URLs ──
  const rawImages = data.images || [];
  const allPhotoUrls: string[] = rawImages
    .map(img => resolveImageUrlClient(typeof img === 'string' ? img : img.path))
    .filter(Boolean) as string[];
  const heroUrl = data.heroImage ? resolveImageUrlClient(data.heroImage) : allPhotoUrls[0] || null;
  const galleryPhotos: string[] = [];
  if (heroUrl) galleryPhotos.push(heroUrl);
  for (const url of allPhotoUrls) {
    if (!galleryPhotos.includes(url)) galleryPhotos.push(url);
  }

  const LAKE_GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';

  // ── Vitals ──
  const pricePerWeek = data.pricePerWeek || data.price_per_week;
  const pricePerNight = data.pricePerNight || data.price_per_night || (pricePerWeek ? Math.round(pricePerWeek / 7) : null);
  const priceEstimated = data.priceEstimated;
  const beds = data.beds || data.bedrooms;
  const baths = data.baths;
  const sleeps = data.sleeps || data.max_guests || data.guests;
  const threeWeekTotal = pricePerWeek ? pricePerWeek * 3 : null;

  // ── Platform branding ──
  const platformInfo = getPlatformInfo(data.platform);
  const listingUrl = data.listing_url || data.url;

  // ── Pets OK? ──
  const amenities = data.amenities || [];
  const amenitiesLower = amenities.map(a => a.toLowerCase());
  const petsOk = amenitiesLower.includes('pet friendly') || amenitiesLower.includes('pets');

  // ── Google Maps URLs ──
  const mapsUrl = buildGoogleMapsUrl(data, placeId);
  const mapsPhotosUrl = buildGoogleMapsPhotosUrl(data, placeId);

  // ── Match score ──
  const rawScores = data.scores as Record<string, number> | undefined;
  const matchScore = data.match_score ||
    (rawScores && Object.values(rawScores).length > 0
      ? Math.round(Object.values(rawScores).reduce((a, b) => a + b, 0) / Object.values(rawScores).length * 10) / 10
      : null);

  // ── Feature callouts ──
  const features = buildFeatureCallouts(data);

  // ── AI guest summary ──
  const guestSummary = buildGuestSummary(data);

  // ── Lake-specific fields ──
  const lakeFields = buildLakeFields(data);

  // ── Sleeping arrangements ──
  const bedrooms = parseBedrooms(data);

  // ── Sorted amenities (excluding lake-specific ones already shown) ──
  const lakeAmenityKeys = new Set(['dock', 'dock access', 'kayaks', 'paddleboard', 'canoe', 'kayaks/canoe', 'private beach', 'boat launch']);
  const nonLakeAmenities = sortAmenities(amenities.filter(a => !lakeAmenityKeys.has(a.toLowerCase())));

  // ── Nearby ──
  const nearestGrocery = data.nearest_grocery || data.driveTimes?.groceries?.name;
  const groceryMins = data.driveTimes?.groceries?.minutes;
  const nearestTown = data.nearest_town || data.driveTimes?.restaurants?.name;

  // ── Google Earth 3D ──
  const googleEarthUrl = (name || region)
    ? `https://earth.google.com/web/search/${encodeURIComponent([name, region].filter(Boolean).join(' '))}`
    : null;

  // ── Vacasa-style title ──
  const waterBody = data.water_body;
  let titleLine: string;
  if (waterBody) {
    titleLine = `Waterfront Cottage near ${region}`;
  } else {
    titleLine = `Cottage in ${region}`;
  }
  // Use name if different from generic description
  const showName = name !== data.description && name !== 'Cottage';

  // ── Quick specs for icon row ──
  const quickSpecs: Array<{ icon: string; text: string }> = [];
  if (sleeps) quickSpecs.push({ icon: '🧑‍🤝‍🧑', text: `Sleeps ${sleeps}` });
  if (beds) quickSpecs.push({ icon: '🛏', text: `${beds} bed${beds !== 1 ? 's' : ''}` });
  if (baths) quickSpecs.push({ icon: '🚿', text: `${baths} bath${baths !== 1 ? 's' : ''}` });
  if (petsOk) quickSpecs.push({ icon: '🐾', text: 'Pets OK' });

  return (
    <div className="hc-card">

      {/* ════════════════════════════════════════════
          1. PHOTO GRID (desktop: hero + 2×2, mobile: scroll strip)
          ════════════════════════════════════════════ */}
      {galleryPhotos.length > 0 ? (
        <div className="hc-photo-grid">
          {/* Desktop grid layout */}
          <div className="hc-photo-grid-desktop">
            <div className="hc-photo-hero">
              <img
                src={galleryPhotos[0]}
                alt={`${name} — main photo`}
                width={600}
                height={400}
                className="hc-photo-img"
              />
            </div>
            <div className="hc-photo-small-grid">
              {galleryPhotos.slice(1, 5).map((url, i) => (
                <div key={i} className="hc-photo-small">
                  <img
                    src={url}
                    alt={`${name} photo ${i + 2}`}
                    width={300}
                    height={200}
                    loading="lazy"
                    className="hc-photo-img"
                  />
                  {i === Math.min(galleryPhotos.length - 2, 3) && (
                    <a
                      href={mapsPhotosUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hc-photo-view-all"
                    >
                      View {galleryPhotos.length} photo{galleryPhotos.length !== 1 ? 's' : ''} ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Mobile horizontal scroll strip */}
          <div className="hc-photo-scroll-mobile">
            {galleryPhotos.map((url, i) => (
              <div key={i} className="hc-photo-scroll-item">
                <img
                  src={url}
                  alt={`${name} photo ${i + 1}`}
                  width={320}
                  height={240}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="hc-photo-img"
                />
              </div>
            ))}
          </div>

          {matchScore != null && (
            <span className="hc-photo-badge">⭐ {matchScore}/5</span>
          )}
        </div>
      ) : (
        <div className="hc-photo-empty" style={{ background: LAKE_GRADIENT }}>
          <span style={{ fontSize: '3rem' }}>🏡</span>
        </div>
      )}

      {/* ════════════════════════════════════════════
          2. TWO-COLUMN CONTENT
          ════════════════════════════════════════════ */}
      <div className="hc-content">

        {/* ── LEFT COLUMN ── */}
        <div className="hc-main">

          {/* Vacasa-style title: "Cottage in Region" */}
          <div className="hc-header">
            <p className="hc-type-line">{titleLine}</p>
            {showName && <h1 className="hc-name">{name}</h1>}
            {data.platform && (
              <p className="hc-subline">
                Listed on{' '}
                <span style={{ color: platformInfo.colour, fontWeight: 600 }}>
                  {platformInfo.label}
                </span>
              </p>
            )}
          </div>

          {/* Quick specs icon row */}
          {quickSpecs.length > 0 && (
            <div className="hc-quick-specs">
              {quickSpecs.map((spec, i) => (
                <span key={i} className="hc-quick-spec">
                  <span className="hc-quick-spec-icon">{spec.icon}</span>
                  {spec.text}
                </span>
              ))}
            </div>
          )}

          {/* AI Guest Summary */}
          {guestSummary && (
            <div className="hc-guest-summary">
              {matchScore != null && (
                <span className="hc-guest-summary-score">⭐ {matchScore}</span>
              )}
              <span className="hc-guest-summary-label">What we know</span>
              <p className="hc-guest-summary-text">&ldquo;{guestSummary}&rdquo;</p>
            </div>
          )}

          {/* Lake-specific fields — our competitive advantage */}
          {lakeFields.length > 0 && (
            <div className="hc-lake-section">
              <h3 className="hc-section-title">Waterfront Details</h3>
              <div className="hc-lake-grid">
                {lakeFields.map((field, i) => (
                  <div key={i} className="hc-lake-field">
                    <span className="hc-lake-field-icon">{field.icon}</span>
                    <div className="hc-lake-field-text">
                      <span className="hc-lake-field-label">{field.label}</span>
                      <span className="hc-lake-field-value">{field.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Callouts */}
          {features.length > 0 && (
            <div className="hc-features">
              {features.map((f, i) => (
                <AccommodationFeature key={i} {...f} />
              ))}
            </div>
          )}

          {/* Sleeping Arrangements */}
          {bedrooms.length > 0 && (
            <div className="hc-bedrooms-section">
              <h3 className="hc-section-title">Sleeping Arrangements</h3>
              <div className="hc-bedrooms-scroll">
                {bedrooms.map((br, i) => (
                  <div key={i} className="hc-bedroom-card">
                    <span className="hc-bedroom-icon">🛏</span>
                    <span className="hc-bedroom-name">{br.name}</span>
                    <span className="hc-bedroom-beds">{br.beds}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes (property details) */}
          {data.notes && (
            <div className="hc-notes">
              <p>{data.notes}</p>
            </div>
          )}

          {/* Amenities grid (non-lake amenities — lake ones shown in Waterfront section) */}
          {nonLakeAmenities.length > 0 && (
            <div className="hc-amenities-section">
              <h3 className="hc-section-title">Amenities</h3>
              <div className="hc-amenities-grid">
                {nonLakeAmenities.map(a => {
                  const { icon, label } = getAmenityDisplay(a);
                  return (
                    <div key={a} className="hc-amenity">
                      <span className="hc-amenity-icon">{icon}</span>
                      <span className="hc-amenity-label">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nearby */}
          {(nearestGrocery || nearestTown) && (
            <div className="hc-nearby-section">
              <h3 className="hc-section-title">Nearby</h3>
              {nearestGrocery && (
                <div className="hc-nearby-row">
                  <span>🛒</span>
                  <span>{nearestGrocery}{groceryMins ? ` — ${groceryMins}min` : ''}</span>
                </div>
              )}
              {nearestTown && (
                <div className="hc-nearby-row">
                  <span>🏘️</span>
                  <span>Nearest town: {nearestTown}</span>
                </div>
              )}
            </div>
          )}

          {/* Environment (solar, air, pollen) */}
          {(data.solarPeakHrsJuly || data.airQualityJuly || data.pollenJulyTree || data.pollenJulyGrass) && (
            <div className="hc-environment">
              <h3 className="hc-section-title">Environment — July</h3>
              {data.solarPeakHrsJuly && (
                <div className="hc-env-row">
                  <span>☀️</span>
                  <span>
                    Sun exposure{' '}
                    {data.solarPeakHrsJuly < 4 ? 'Low' :
                     data.solarPeakHrsJuly < 5 ? 'Moderate' :
                     data.solarPeakHrsJuly < 6 ? 'Good' : 'High'}
                    {' · ~'}{data.solarPeakHrsJuly.toFixed(1)} peak hrs/day
                  </span>
                </div>
              )}
              {data.airQualityJuly && (
                <div className="hc-env-row">
                  <span>🌬️</span>
                  <span>Air quality {data.airQualityJuly.category} (AQI {data.airQualityJuly.aqi})</span>
                </div>
              )}
              {(data.pollenJulyTree || data.pollenJulyGrass) && (
                <div className="hc-env-row">
                  <span>🌿</span>
                  <span>
                    Pollen{' '}
                    {data.pollenJulyTree && `Tree: ${data.pollenJulyTree}`}
                    {data.pollenJulyTree && data.pollenJulyGrass && ' · '}
                    {data.pollenJulyGrass && `Grass: ${data.pollenJulyGrass}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Provenance — why this place was recommended */}
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
        </div>

        {/* ── RIGHT COLUMN: Sticky Price Card (desktop) ── */}
        <div className="hc-sidebar">
          <div className="hc-price-card">
            {/* Price headline */}
            {pricePerWeek ? (
              <div className="hc-price-headline">
                {priceEstimated && <span className="hc-price-est">~est. </span>}
                <span className="hc-price-from">from </span>
                <span className="hc-price-amount">CA${pricePerWeek.toLocaleString()}</span>
                <span className="hc-price-period"> / week</span>
                {pricePerNight && (
                  <div className="hc-price-nightly">~${pricePerNight}/night</div>
                )}
              </div>
            ) : (
              <div className="hc-price-headline">
                <span className="hc-price-amount">Price TBD</span>
              </div>
            )}

            {/* 3-week total estimate */}
            {threeWeekTotal && (
              <div className="hc-price-total">
                3 weeks: ~CA${threeWeekTotal.toLocaleString()}
                <span className="hc-price-total-note"> · See listing for fees</span>
              </div>
            )}

            {/* Stats */}
            <div className="hc-price-stats">
              {beds && <span>{beds} bed{beds !== 1 ? 's' : ''}</span>}
              {beds && sleeps && <span> · </span>}
              {sleeps && <span>{sleeps} guests</span>}
            </div>

            {/* July availability */}
            {data.july_available !== undefined && (
              <div className={`hc-price-avail ${data.july_available ? 'hc-avail-yes' : 'hc-avail-no'}`}>
                July {data.july_available ? '✅ Available' : '❌ Unavailable'}
              </div>
            )}

            {/* CTA: View Listing (platform-branded) */}
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hc-cta-primary"
                style={{ background: platformInfo.colour, borderColor: platformInfo.colour }}
              >
                View on {platformInfo.label} ↗
              </a>
            )}

            {/* Trust badges */}
            <div className="hc-trust-badges">
              {data.platform && <span className="hc-trust-badge">✓ Verified listing</span>}
              {listingUrl && !listingUrl.includes('airbnb') && <span className="hc-trust-badge">✓ Direct booking</span>}
              {listingUrl && <span className="hc-trust-badge">📞 Contact owner</span>}
            </div>

            {/* CTA: Google Maps */}
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hc-cta-secondary"
            >
              📍 View in Google Maps →
            </a>

            {/* Google Earth */}
            {googleEarthUrl && (
              <a
                href={googleEarthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hc-cta-tertiary"
              >
                🌍 Google Earth 3D →
              </a>
            )}

            {/* Aerial video link */}
            {data.aerialVideoUrl && (
              <a
                href={data.aerialVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hc-cta-tertiary"
              >
                🛸 Aerial View →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          3. MOBILE BOTTOM PRICE BAR
          ════════════════════════════════════════════ */}
      <div className="hc-mobile-bar">
        <div className="hc-mobile-bar-price">
          {pricePerWeek ? (
            <>
              <span className="hc-mobile-bar-amount">CA${pricePerWeek.toLocaleString()}/wk</span>
              {pricePerNight && <span className="hc-mobile-bar-nightly">~${pricePerNight}/night</span>}
            </>
          ) : (
            <span className="hc-mobile-bar-amount">Price TBD</span>
          )}
        </div>
        {listingUrl && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hc-mobile-bar-cta"
            style={{ background: platformInfo.colour, borderColor: platformInfo.colour }}
          >
            View Listing ↗
          </a>
        )}
      </div>

      {/* ════════════════════════════════════════════
          4. MAP + TRIAGE (below fold, full width)
          ════════════════════════════════════════════ */}
      <div className="hc-below-fold">
        <MapWidget
          placeId={placeId.startsWith('ChIJ') ? placeId : undefined}
          lat={data.lat || data.latitude}
          lng={data.lng || data.longitude}
          name={`${name}${region ? ', ' + region : ''}`}
        />

        {userId && contextKey && (
          <div className="hc-triage-row">
            <TriageWidget
              userId={userId}
              contextKey={contextKey}
              contextLabel=""
              placeId={placeId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
