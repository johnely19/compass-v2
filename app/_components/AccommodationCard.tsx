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
  if (perWeek) parts.push(`$${perWeek.toLocaleString()}/week`);
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

/* ---- Grouped amenity sets (unused currently but kept for future) ---- */
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
  driveTimeLabel?: string;
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
  vibeTags?: string[];
  dockType?: string;
  beachType?: string;
  waterEquipment?: string[];
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

/* ---- Feature callout sub-component ---- */
function AccommodationFeature({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="ac-feature">
      <span className="ac-feature-icon">{icon}</span>
      <div className="ac-feature-text">
        <div className="ac-feature-title">{title}</div>
        <div className="ac-feature-desc">{description}</div>
      </div>
    </div>
  );
}

/* ---- Sleeping arrangement card ---- */
function SleepingCard({ label, details }: { label: string; details: string }) {
  return (
    <div className="ac-sleeping-card">
      <div className="ac-sleeping-label">{label}</div>
      <div className="ac-sleeping-details">{details}</div>
    </div>
  );
}

export default function AccommodationCard({ data, placeId, userId, contextKey, discovery }: AccommodationCardProps) {
  const name = data.name || 'Cottage';
  const region = data.region || data.address || data.city || '';
  const summary = data.description || '';

  // Resolve all images
  const allImages = data.images || [];
  const heroImg = allImages.find(i => ['exterior', 'water', 'general'].includes(i.category)) || allImages[0];
  const heroImage = data.heroImage
    ? resolveImageUrlClient(data.heroImage)
    : heroImg ? resolveImageUrlClient(heroImg.path) : null;

  // Build photo grid (up to 5)
  const photoGridImages = allImages.slice(0, 5).map(img => resolveImageUrlClient(img.path));
  if (heroImage && !photoGridImages.includes(heroImage)) {
    photoGridImages.unshift(heroImage);
  }
  const displayPhotos = photoGridImages.slice(0, 5);

  const LAKE_GRADIENT = 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)';
  const hasAerialVideo = !!data.aerialVideoUrl;

  // Vitals
  const pricePerWeek = data.pricePerWeek || data.price_per_week;
  const pricePerNight = data.price_per_night;
  const priceStr = formatPrice(pricePerWeek, pricePerNight);
  const perNight = pricePerWeek ? Math.round(pricePerWeek / 7) : (pricePerNight ? Math.round(pricePerNight) : null);
  const beds = data.beds || data.bedrooms;
  const sleeps = data.sleeps || data.max_guests || data.guests;

  // Drive time
  let driveTime: string | null = null;
  if (data.driveTimeLabel) {
    driveTime = data.driveTimeLabel;
  } else if (data.drive_from_toronto) {
    driveTime = data.drive_from_toronto;
  } else if (data.driveTimes?.dianaKlaus?.minutes) {
    const m = data.driveTimes.dianaKlaus.minutes;
    driveTime = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}min` : ''} from Toronto`.trim() : `${m}min from Toronto`;
  }

  // Swimming
  const swimType = data.swimType || data.swim_quality || '';
  const swimVerdict = data.swimVerdict || '';
  const waterBody = data.water_body || '';
  const beachType = data.beachType || '';
  const dockType = data.dockType || '';

  // Setting
  const settingTags = data.setting_tags || [];
  const vibeTags = data.vibeTags || [];

  // Amenities
  const amenities = sortAmenities(data.amenities || []);
  const waterEquipment = data.waterEquipment || [];
  const hasPets = amenities.some(a => a.toLowerCase() === 'pets' || a.toLowerCase() === 'pet friendly');

  // Nearby
  const nearestGrocery = data.nearest_grocery || data.driveTimes?.groceries?.name;
  const groceryMins = data.driveTimes?.groceries?.minutes;
  const nearestTown = data.nearest_town || data.driveTimes?.restaurants?.name;

  // Listing URL
  const listingUrl = (data.listing_url || data.url) ?? null;

  // Platform branding
  const platformInfo = getPlatformInfo(data.platform);

  // Google Maps deep-link
  const googleMapsUrl: string | null = placeId && placeId.startsWith('ChIJ')
    ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
    : null;

  // Google Maps photos URL
  const googleMapsPhotosUrl = placeId && placeId.startsWith('ChIJ')
    ? `https://www.google.com/maps/place/${placeId}/photos`
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

  // AI Guest Summary — synthesize from swimVerdict + vibeTags + notes
  const guestSummary = (() => {
    const parts: string[] = [];
    if (swimVerdict) parts.push(swimVerdict.split('.').slice(0, 2).join('.'));
    if (vibeTags.length > 0 && parts.length < 2) parts.push(vibeTags.slice(0, 3).join('. '));
    if (data.notes && parts.length < 2) {
      const noteSentence = data.notes.split('.')[0] || '';
      if (noteSentence.length < 150) parts.push(noteSentence);
    }
    return parts.join('. ').slice(0, 250);
  })();

  // Feature callouts — lake-specific as first-class UI (our differentiator)
  const features = (() => {
    const f: { icon: string; title: string; desc: string }[] = [];

    // Beach / swimming type
    if (beachType || swimType) {
      const st = beachType || swimType;
      f.push({
        icon: swimIcon(st),
        title: st.toLowerCase().includes('sandy') ? 'Sandy beach' : st.toLowerCase().includes('dock') ? 'Dock swimming' : st.toLowerCase().includes('rocky') ? 'Rocky shore' : 'Swimming',
        desc: swimVerdict ? (swimVerdict.split('.')[0] || st) : st,
      });
    }

    // Drive time
    if (driveTime) {
      f.push({
        icon: '🚗',
        title: driveTime,
        desc: 'From downtown Toronto',
      });
    }

    // Privacy/setting
    if (settingTags.some(t => t.toLowerCase().includes('private'))) {
      f.push({ icon: '🌲', title: 'Very private', desc: 'No visible neighbours' });
    } else if (vibeTags.some(t => ['secluded', 'remote', 'quiet'].includes(t.toLowerCase()))) {
      f.push({ icon: '🌲', title: 'Secluded', desc: vibeTags.slice(0, 2).join(', ') });
    }

    // Dock
    if (dockType || amenities.some(a => a.toLowerCase().includes('dock'))) {
      f.push({ icon: '⛵', title: dockType || 'Dock included', desc: 'Deep water access' });
    }

    // Water equipment
    const waterGear = waterEquipment.length > 0
      ? waterEquipment
      : amenities.filter(a => ['kayaks', 'paddleboard', 'canoe', 'kayaks/canoe'].includes(a.toLowerCase()));
    if (waterGear.length > 0) {
      f.push({
        icon: '🛶',
        title: waterGear.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', '),
        desc: 'Included with rental',
      });
    }

    // Lake name
    if (waterBody) {
      f.push({ icon: '🌊', title: waterBody, desc: 'Water body' });
    }

    return f.slice(0, 4);
  })();

  // Short description (2-3 sentences)
  const shortDescription = summary !== name ? summary.split('.').slice(0, 3).join('.').slice(0, 300) : '';

  // Title format: "Cottage in [Region]"
  const titleText = region ? `Cottage in ${region}` : name;

  return (
    <div className="ac-card">
      {/* ── Photo Grid ── */}
      <div className="ac-photo-section">
        {/* Desktop: Hipcamp-style 5-photo grid */}
        <div className="ac-photo-grid">
          {/* Hero: large left photo (~50% width, full height) */}
          <div className="ac-photo-hero">
            {hasAerialVideo ? (
              <>
                <video
                  autoPlay muted loop playsInline
                  poster={displayPhotos[0] || undefined}
                  className="ac-photo-img"
                >
                  {data.aerialVideoUrlWebm && <source src={data.aerialVideoUrlWebm} type="video/webm" />}
                  <source src={data.aerialVideoUrl!} type="video/mp4" />
                </video>
                <span className="ac-aerial-badge">🛸 Aerial view</span>
              </>
            ) : displayPhotos[0] ? (
              <img src={displayPhotos[0]} alt={`${name} - main photo`} className="ac-photo-img" />
            ) : (
              <div className="ac-photo-img" style={{ background: LAKE_GRADIENT }} />
            )}
          </div>
          {/* Right: 2x2 grid */}
          {[1, 2, 3, 4].map(idx => (
            <div key={idx} className={`ac-photo-small${idx === 4 ? ' ac-photo-last' : ''}`}>
              {displayPhotos[idx] ? (
                <img src={displayPhotos[idx]} alt={`${name} - photo ${idx + 1}`} className="ac-photo-img" />
              ) : (
                <div className="ac-photo-img ac-photo-placeholder" />
              )}
              {idx === 4 && googleMapsPhotosUrl && displayPhotos.length >= 3 && (
                <a href={googleMapsPhotosUrl} target="_blank" rel="noopener noreferrer" className="ac-view-photos-btn">
                  View {allImages.length || ''} photos ↗
                </a>
              )}
            </div>
          ))}
        </div>

        {/* Mobile: horizontal scroll strip */}
        <div className="ac-photo-strip">
          {displayPhotos.length > 0 ? displayPhotos.map((photo, idx) => (
            <div key={idx} className="ac-photo-strip-item">
              {photo ? (
                <img src={photo} alt={`${name} - photo ${idx + 1}`} className="ac-photo-img" />
              ) : (
                <div className="ac-photo-img" style={{ background: LAKE_GRADIENT }} />
              )}
            </div>
          )) : (
            <div className="ac-photo-strip-item">
              <div className="ac-photo-img" style={{ background: LAKE_GRADIENT }} />
            </div>
          )}
        </div>

        {/* Match score badge */}
        {matchScore && (
          <span className="ac-score-badge">⭐ {matchScore}/5</span>
        )}
      </div>

      {/* ── Two-Column Content ── */}
      <div className="ac-content">
        {/* Left Column */}
        <div className="ac-main">
          {/* Title */}
          <h1 className="ac-title">{titleText}</h1>
          {region && titleText !== `Cottage in ${region}` && (
            <p className="ac-subtitle">📍 {region}</p>
          )}
          {data.platform && (
            <p className="ac-platform-label">
              Listed on{' '}
              <span style={{ fontWeight: 600, color: platformInfo.colour }}>{platformInfo.label}</span>
            </p>
          )}

          {/* Quick specs icon row */}
          <div className="ac-specs-row">
            {sleeps && <span className="ac-spec">🧑‍🤝‍🧑 Sleeps {sleeps}</span>}
            {beds && <span className="ac-spec">🛏 {beds} bed{beds !== 1 ? 's' : ''}</span>}
            {data.baths && <span className="ac-spec">🚿 {data.baths} bath{data.baths !== 1 ? 's' : ''}</span>}
            {hasPets && <span className="ac-spec">🐾 Pets OK</span>}
          </div>

          {/* AI Guest Summary Box */}
          {guestSummary && (
            <div className="ac-guest-summary">
              <div className="ac-guest-summary-header">
                <span className="ac-guest-summary-star">⭐</span>
                <span className="ac-guest-summary-label">What guests say...</span>
              </div>
              <p className="ac-guest-summary-text">&ldquo;{guestSummary}&rdquo;</p>
            </div>
          )}

          {/* Feature Callouts (Hipcamp style) */}
          {features.length > 0 && (
            <div className="ac-features">
              {features.map((f, idx) => (
                <AccommodationFeature key={idx} icon={f.icon} title={f.title} description={f.desc} />
              ))}
            </div>
          )}

          {/* Description */}
          {shortDescription && (
            <div className="ac-description">
              <p>{shortDescription}</p>
            </div>
          )}

          {/* Sleeping Arrangements */}
          {beds && beds > 0 && (
            <div className="ac-sleeping-section">
              <h3 className="ac-section-heading">{beds} bedroom{beds !== 1 ? 's' : ''}</h3>
              <div className="ac-sleeping-grid">
                {Array.from({ length: Math.min(beds, 4) }).map((_, idx) => (
                  <SleepingCard
                    key={idx}
                    label={idx === 0 ? 'Master' : `Bedroom ${idx + 1}`}
                    details={idx === 0 ? '1 queen bed' : idx === 1 ? '2 twin beds' : '1 double bed'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Amenities Grid */}
          {amenities.length > 0 && (
            <div className="ac-amenities-section">
              <h3 className="ac-section-heading">Amenities</h3>
              <div className="ac-amenities-grid">
                {amenities.slice(0, 12).map(a => {
                  const { icon, label } = getAmenityDisplay(a);
                  return (
                    <div key={a} className="ac-amenity-item">
                      <span className="ac-amenity-icon">{icon}</span>
                      <span className="ac-amenity-label">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nearby */}
          {(nearestGrocery || nearestTown) && (
            <div className="ac-nearby-section">
              <h3 className="ac-section-heading">Nearby</h3>
              {nearestGrocery && (
                <div className="ac-nearby-row">
                  <span>🛒</span>
                  <span>{nearestGrocery}{groceryMins ? ` — ${groceryMins}min` : ''}</span>
                </div>
              )}
              {nearestTown && (
                <div className="ac-nearby-row">
                  <span>🏘️</span>
                  <span>Nearest town: {nearestTown}</span>
                </div>
              )}
            </div>
          )}

          {/* Environment widgets */}
          {(data.solarPeakHrsJuly || data.airQualityJuly || data.pollenJulyTree || data.pollenJulyGrass) && (
            <div className="ac-env-section">
              {data.solarPeakHrsJuly && (
                <div className="ac-env-row">
                  <span>☀️</span>
                  <span>
                    Sun exposure{' '}
                    {data.solarPeakHrsJuly < 4 ? 'Low' : data.solarPeakHrsJuly < 5 ? 'Moderate' : data.solarPeakHrsJuly < 6 ? 'Good' : 'High'}
                    {' · ~'}{data.solarPeakHrsJuly.toFixed(1)} peak hrs/day in July
                  </span>
                </div>
              )}
              {data.airQualityJuly && (
                <div className="ac-env-row">
                  <span>🌬️</span>
                  <span>Air quality {data.airQualityJuly.category} (AQI {data.airQualityJuly.aqi})</span>
                </div>
              )}
              {(data.pollenJulyTree || data.pollenJulyGrass) && (
                <div className="ac-env-row">
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

          {/* Provenance */}
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

          {/* Triage */}
          {userId && contextKey && (
            <div className="ac-triage">
              <TriageWidget userId={userId} contextKey={contextKey} contextLabel="" placeId={placeId} />
            </div>
          )}

          {/* Google Earth link */}
          {googleEarthUrl && (
            <div className="ac-earth-link">
              <a href={googleEarthUrl} target="_blank" rel="noopener noreferrer">
                🌍 View in Google Earth 3D →
              </a>
            </div>
          )}

          {/* Map */}
          <MapWidget
            placeId={placeId.startsWith('ChIJ') ? placeId : undefined}
            lat={data.lat || data.latitude}
            lng={data.lng || data.longitude}
            name={`${name}${region ? ', ' + region : ''}`}
          />
        </div>

        {/* Right Column: Sticky Price Card (desktop only) */}
        <aside className="ac-sidebar">
          <div className="ac-price-card">
            {/* Price */}
            {priceStr && (
              <div className="ac-price-main">
                {priceStr.split(' · ')[0]}
              </div>
            )}
            {perNight && (
              <div className="ac-price-secondary">~ ${perNight} / night</div>
            )}

            {/* Specs */}
            <div className="ac-price-specs">
              {beds && `${beds} bed${beds !== 1 ? 's' : ''}`}
              {beds && sleeps && ' · '}
              {sleeps && `sleeps ${sleeps}`}
            </div>

            {/* July availability */}
            {data.july_available !== undefined && (
              <div className="ac-price-availability">
                <span className={`ac-avail-badge ${data.july_available ? 'ac-avail-yes' : 'ac-avail-no'}`}>
                  {data.july_available ? '✅ July Available' : '❌ July Unavailable'}
                </span>
              </div>
            )}

            {/* CTA Button — platform-colored */}
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ac-price-cta"
                style={{ background: platformInfo.colour }}
              >
                View on {platformInfo.label} ↗
              </a>
            )}

            {/* Maps link */}
            {googleMapsUrl && (
              <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="ac-price-maps">
                📍 View in Maps →
              </a>
            )}

            {/* Trust badges */}
            <div className="ac-trust-badges">
              <div className="ac-trust-badge">✓ Verified listing</div>
              <div className="ac-trust-badge">✓ Direct booking</div>
              <div className="ac-trust-badge">📞 Contact owner</div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Mobile Bottom Price Bar ── */}
      <div className="ac-mobile-bar">
        <div className="ac-mobile-bar-price">
          {priceStr && <div className="ac-mobile-bar-amount">{priceStr.split(' · ')[0]}</div>}
          {perNight && <div className="ac-mobile-bar-night">~${perNight}/night</div>}
          {!priceStr && <div className="ac-mobile-bar-amount">{name}</div>}
        </div>
        {listingUrl && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ac-mobile-bar-cta"
            style={{ background: platformInfo.colour }}
          >
            View ↗
          </a>
        )}
      </div>
    </div>
  );
}
