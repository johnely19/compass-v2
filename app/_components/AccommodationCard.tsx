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
  // Additional lake-specific fields
  vibeTags?: string[];
  dockType?: string;
  beachType?: string;
  waterEquipment?: string[];
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

/* ---- Feature callout component ---- */
function AccommodationFeature({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-xl shrink-0">{icon}</span>
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-sm text-gray-600">{description}</div>
      </div>
    </div>
  );
}

/* ---- Sleeping arrangement card ---- */
function SleepingCard({ label, details }: { label: string; details: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className="font-medium text-gray-900 text-sm">{label}</div>
      <div className="text-gray-600 text-xs mt-1">{details}</div>
    </div>
  );
}

/* ---- Sticky price card component (desktop) ---- */
function PriceCardDesktop({
  priceStr,
  perNight,
  beds,
  sleeps,
  julyAvailable,
  platformInfo,
  listingUrl,
  googleMapsUrl,
}: {
  priceStr: string | null;
  perNight: number | null;
  beds: number | undefined;
  sleeps: number | undefined;
  julyAvailable: boolean | undefined;
  platformInfo: { label: string; colour: string };
  listingUrl: string | null;
  googleMapsUrl: string | null;
}) {
  return (
    <div className="hidden md:block sticky top-20 bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      {/* Price */}
      <div className="mb-4">
        {priceStr && (
          <div className="text-2xl font-bold text-gray-900">
            {priceStr.split(' · ')[0]}
          </div>
        )}
        {perNight && (
          <div className="text-gray-500 text-sm">
            ~ ${perNight} / night
          </div>
        )}
      </div>

      {/* Specs */}
      <div className="text-gray-700 text-sm mb-4">
        {beds && `${beds} bed${beds !== 1 ? 's' : ''}`}
        {beds && sleeps && ' · '}
        {sleeps && `sleeps ${sleeps}`}
      </div>

      {/* July availability */}
      {julyAvailable !== undefined && (
        <div className="mb-4">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${
            julyAvailable ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {julyAvailable ? '✅ July Available' : '❌ July Unavailable'}
          </span>
        </div>
      )}

      {/* CTA Button */}
      {listingUrl && (
        <a
          href={listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
          style={{ background: platformInfo.colour }}
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
          className="flex items-center justify-center gap-2 mt-3 text-gray-600 hover:text-gray-900 text-sm"
        >
          📍 View in Maps →
        </a>
      )}

      {/* Trust badges */}
      <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>✓</span> <span>Verified listing</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>✓</span> <span>Direct booking</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>📞</span> <span>Contact owner</span>
        </div>
      </div>
    </div>
  );
}

/* ---- Mobile bottom bar component ---- */
function PriceBarMobile({
  priceStr,
  perNight,
  platformInfo,
  listingUrl,
}: {
  priceStr: string | null;
  perNight: number | null;
  platformInfo: { label: string; colour: string };
  listingUrl: string | null;
}) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
      <div className="flex items-center justify-between gap-4">
        <div>
          {priceStr && (
            <div className="font-bold text-gray-900">
              {priceStr.split(' · ')[0]}
            </div>
          )}
          {perNight && (
            <div className="text-gray-500 text-sm">
              ~${perNight}/night
            </div>
          )}
        </div>
        {listingUrl && (
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 rounded-lg text-white font-medium"
            style={{ background: platformInfo.colour }}
          >
            View
          </a>
        )}
      </div>
    </div>
  );
}

export default function AccommodationCard({ data, placeId, userId, contextKey, discovery }: AccommodationCardProps) {
  const name = data.name || 'Cottage';
  const region = data.address || data.city || '';
  const summary = data.description || '';

  // Resolve all images
  const allImages = data.images || [];
  const heroImg = allImages.find(i => ['exterior', 'water', 'general'].includes(i.category)) || allImages[0];
  const heroImage = data.heroImage
    ? resolveImageUrlClient(data.heroImage)
    : heroImg ? resolveImageUrlClient(heroImg.path) : null;

  // Get up to 5 images for photo grid
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
  const perNight = pricePerWeek ? Math.round(pricePerWeek / 7) : null;
  const beds = data.beds || data.bedrooms;
  const sleeps = data.sleeps || data.max_guests || data.guests;

  // Drive time — handle string, driveTimeLabel, or object
  let driveTime: string | null = null;
  if (data.driveTimeLabel) {
    driveTime = data.driveTimeLabel;
  } else if (data.drive_from_toronto) {
    driveTime = data.drive_from_toronto;
  } else if (data.driveTimes?.dianaKlaus?.minutes) {
    const m = data.driveTimes.dianaKlaus.minutes;
    driveTime = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}min` : ''}from Toronto`.trim() : `${m}min from Toronto`;
  }

  // Swimming
  const swimType = data.swimType || data.swim_quality || '';
  const swimVerdict = data.swimVerdict || '';
  const waterBody = data.water_body || '';
  const beachType = data.beachType || '';
  const dockType = data.dockType || '';

  // Quiet/setting
  const quietScore = data.scores?.quiet;
  const settingTags = data.setting_tags || [];
  const vibeTags = data.vibeTags || [];

  // Amenities
  const amenities = sortAmenities(data.amenities || []);
  const waterEquipment = data.waterEquipment || [];

  // Nearby
  const nearestGrocery = data.nearest_grocery || data.driveTimes?.groceries?.name;
  const groceryMins = data.driveTimes?.groceries?.minutes;
  const nearestTown = data.nearest_town || data.driveTimes?.restaurants?.name;

  // Listing URL
  const listingUrl = (data.listing_url || data.url) ?? null;

  // Platform branding
  const platformInfo = getPlatformInfo(data.platform);

  // Google Maps deep-link (only when placeId looks like a Google Place ID)
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

  // AI Guest Summary - build from swimVerdict + vibeTags + notes
  const guestSummary = (() => {
    const parts: string[] = [];
    if (swimVerdict) parts.push(swimVerdict);
    if (vibeTags.length > 0 && parts.length < 2) parts.push(vibeTags.slice(0, 2).join(' · '));
    if (data.notes && parts.length < 2) {
      const noteSentence = data.notes.split('.')[0] || '';
      if (noteSentence.length < 150) parts.push(noteSentence);
    }
    return parts.join('. ').slice(0, 200);
  })();

  // Feature callouts - lake-specific as first-class UI
  const features = (() => {
    const f: { icon: string; title: string; desc: string }[] = [];

    // Beach type
    if (beachType) {
      f.push({
        icon: '🏖️',
        title: beachType.includes('sandy') ? 'Sandy beach' : beachType.includes('rocky') ? 'Rocky shore' : 'Beach',
        desc: beachType,
      });
    } else if (swimType) {
      f.push({
        icon: swimIcon(swimType),
        title: swimType.includes('sandy') ? 'Sandy beach' : swimType.includes('dock') ? 'Dock swimming' : swimType.includes('rocky') ? 'Rocky shore' : 'Swimming',
        desc: swimType,
      });
    }

    // Drive time
    if (driveTime) {
      f.push({
        icon: '🚗',
        title: driveTime.includes('h') ? driveTime.split(' ')[0] + 'h drive' : driveTime,
        desc: 'From downtown Toronto',
      });
    }

    // Privacy/setting
    if (settingTags.includes('private') || settingTags.includes('very private')) {
      f.push({
        icon: '🌲',
        title: 'Very private',
        desc: 'No visible neighbours, crown land border',
      });
    } else if (vibeTags.includes('secluded') || vibeTags.includes('remote')) {
      f.push({
        icon: '🌲',
        title: 'Secluded',
        desc: vibeTags.join(', '),
      });
    }

    // Dock
    if (dockType || amenities.some(a => a.toLowerCase().includes('dock'))) {
      f.push({
        icon: '⛵',
        title: dockType || 'Dock included',
        desc: 'Deep water access',
      });
    }

    // Water equipment
    if (waterEquipment.length > 0 || amenities.some(a => ['kayaks', 'paddleboard', 'canoe', 'kayaks/canoe'].includes(a.toLowerCase()))) {
      const equip = waterEquipment.length > 0 ? waterEquipment : amenities.filter(a => ['kayaks', 'paddleboard', 'canoe', 'kayaks/canoe'].includes(a.toLowerCase()));
      f.push({
        icon: '🛶',
        title: (equip[0] || 'Water equipment').charAt(0).toUpperCase() + (equip[0] || 'water equipment').slice(1),
        desc: equip.join(', '),
      });
    }

    // Lake name
    if (waterBody) {
      f.push({
        icon: '🌊',
        title: waterBody,
        desc: 'Water body',
      });
    }

    return f.slice(0, 4);
  })();

  // Description - 2-3 sentences
  const shortDescription = summary.split('.').slice(0, 2).join('.').slice(0, 300);

  return (
    <div className="accommodation-card pb-20 md:pb-0">
      {/* ── Photo Grid ── */}
      <div className="relative">
        {/* Desktop: 5-photo grid */}
        <div className="hidden md:grid grid-cols-5 gap-0.5 h-[350px] overflow-hidden rounded-t-xl">
          {/* Hero: 50% width, full height */}
          <div className="col-span-2 row-span-2 relative">
            {displayPhotos[0] ? (
              <img
                src={displayPhotos[0]}
                alt={`${name} - main photo`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full" style={{ background: LAKE_GRADIENT }} />
            )}
          </div>
          {/* 2x2 grid of smaller photos */}
          {[1, 2, 3, 4].map(idx => (
            <div key={idx} className="relative">
              {displayPhotos[idx] ? (
                <img
                  src={displayPhotos[idx]}
                  alt={`${name} - photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
            </div>
          ))}
        </div>

        {/* View all photos overlay */}
        {googleMapsPhotosUrl && displayPhotos.length >= 5 && (
          <a
            href={googleMapsPhotosUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg text-sm font-medium text-gray-800 hover:bg-white transition-colors items-center gap-1"
          >
            View all photos ↗
          </a>
        )}

        {/* Mobile: horizontal scrollable strip */}
        <div className="md:hidden flex gap-1 overflow-x-auto snap-x snap-mandatory h-[200px] pb-2">
          {displayPhotos.length > 0 ? (
            displayPhotos.map((photo, idx) => (
              <div key={idx} className="shrink-0 w-full h-full snap-center relative">
                {photo ? (
                  <img
                    src={photo}
                    alt={`${name} - photo ${idx + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <div className="w-full h-full rounded-lg" style={{ background: LAKE_GRADIENT }} />
                )}
              </div>
            ))
          ) : (
            <div className="shrink-0 w-full h-full rounded-lg" style={{ background: LAKE_GRADIENT }} />
          )}
        </div>

        {/* Match score badge */}
        {matchScore && (
          <span className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm text-white text-sm px-2.5 py-1 rounded-full">
            ⭐ {matchScore}/5
          </span>
        )}
      </div>

      {/* ── Two-Column Content ── */}
      <div className="md:grid md:grid-cols-[1fr_320px] md:gap-8 p-4 md:p-6">

        {/* Left Column: Main Content */}
        <div className="space-y-6">
          {/* Title */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Cottage in {region || 'Ontario'}
            </h1>
          </div>

          {/* Quick specs row */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-700">
            {sleeps && (
              <span>🧑‍🤝‍🧑 Sleeps {sleeps}</span>
            )}
            {beds && (
              <span>🛏 {beds} bed{beds !== 1 ? 's' : ''}</span>
            )}
            {data.baths && (
              <span>🚿 {data.baths} bath{data.baths !== 1 ? 's' : ''}</span>
            )}
            {amenities.includes('pets') || amenities.includes('pet friendly') && (
              <span>🐾 Pets OK</span>
            )}
          </div>

          {/* AI Guest Summary Box */}
          {guestSummary && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-500">⭐</span>
                <span className="font-medium text-gray-900">What guests say...</span>
              </div>
              <p className="text-gray-700 text-sm italic">"{guestSummary}"</p>
            </div>
          )}

          {/* Feature Callouts */}
          {features.length > 0 && (
            <div className="space-y-3">
              {features.map((f, idx) => (
                <AccommodationFeature key={idx} icon={f.icon} title={f.title} description={f.desc} />
              ))}
            </div>
          )}

          {/* Description */}
          {shortDescription && (
            <div>
              <p className="text-gray-600 text-sm leading-relaxed">{shortDescription}</p>
            </div>
          )}

          {/* Sleeping Arrangements */}
          {beds && beds > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">{beds} bedroom{beds !== 1 ? 's' : ''}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Array.from({ length: Math.min(beds, 4) }).map((_, idx) => (
                  <SleepingCard
                    key={idx}
                    label={`Bedroom ${idx + 1}`}
                    details={idx === 0 ? '1 queen bed' : idx === 1 ? '2 twin beds' : '1 double bed'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Amenities Grid */}
          {amenities.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Amenities</h3>
              <div className="grid grid-cols-2 gap-2">
                {amenities.slice(0, 12).map(a => {
                  const { icon, label } = getAmenityDisplay(a);
                  return (
                    <div key={a} className="flex items-center gap-2 text-sm text-gray-700">
                      <span>{icon}</span>
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions row (mobile-friendly) */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-100">
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
                style={{ background: platformInfo.colour }}
              >
                View on {platformInfo.label} ↗
              </a>
            )}
            {googleMapsUrl && (
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                📍 View in Maps →
              </a>
            )}
          </div>

          {/* Triage widget */}
          {userId && contextKey && (
            <div className="pt-4 border-t border-gray-100">
              <TriageWidget
                userId={userId}
                contextKey={contextKey}
                contextLabel=""
                placeId={placeId}
              />
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

          {/* Google Earth 3D link */}
          {googleEarthUrl && (
            <div>
              <a
                href={googleEarthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-gray-900 text-sm"
              >
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

          {/* Environment widgets (Solar, Air Quality, Pollen) */}
          {(data.solarPeakHrsJuly || data.airQualityJuly || data.pollenJulyTree || data.pollenJulyGrass) && (
            <div className="space-y-3 pt-4 border-t border-gray-100">
              {data.solarPeakHrsJuly && (
                <div className="flex items-start gap-2 text-sm">
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
                <div className="flex items-start gap-2 text-sm">
                  <span>🌬️</span>
                  <span>
                    Air quality {' '}{data.airQualityJuly.category}{' (AQI '}{data.airQualityJuly.aqi}{')'}
                  </span>
                </div>
              )}
              {(data.pollenJulyTree || data.pollenJulyGrass) && (
                <div className="flex items-start gap-2 text-sm">
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
        </div>

        {/* Right Column: Sticky Price Card (desktop only) */}
        <div className="hidden md:block">
          <PriceCardDesktop
            priceStr={priceStr}
            perNight={perNight}
            beds={beds}
            sleeps={sleeps}
            julyAvailable={data.july_available}
            platformInfo={platformInfo}
            listingUrl={listingUrl}
            googleMapsUrl={googleMapsUrl}
          />
        </div>
      </div>

      {/* Mobile bottom price bar */}
      <PriceBarMobile
        priceStr={priceStr}
        perNight={perNight}
        platformInfo={platformInfo}
        listingUrl={listingUrl}
      />
    </div>
  );
}