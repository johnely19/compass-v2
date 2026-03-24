'use client';

import type { PlaceCard, DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import { resolveImageUrlClient } from '../_lib/image-url';
import TriageWidget from './TriageWidget';
import RatingWidget from './widgets/RatingWidget';
import MapWidget from './widgets/MapWidget';
import PhotoGallery from './widgets/PhotoGallery';

/* ---- Type-specific hero gradients ---- */
const TYPE_GRADIENTS: Record<string, string> = {
  restaurant:   'linear-gradient(135deg, #f59e0b 0%, #e11d48 100%)',
  bar:          'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
  cafe:         'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
  gallery:      'linear-gradient(135deg, #475569 0%, #3b82f6 100%)',
  museum:       'linear-gradient(135deg, #334155 0%, #6366f1 100%)',
  theatre:      'linear-gradient(135deg, #1e1b4b 0%, #9f1239 100%)',
  'music-venue':'linear-gradient(135deg, #0f0a1e 0%, #581c87 100%)',
  grocery:      'linear-gradient(135deg, #16a34a 0%, #0d9488 100%)',
  shop:         'linear-gradient(135deg, #78716c 0%, #d97706 100%)',
  park:         'linear-gradient(135deg, #15803d 0%, #4ade80 100%)',
  architecture: 'linear-gradient(135deg, #475569 0%, #94a3b8 100%)',
  development:  'linear-gradient(135deg, #64748b 0%, #334155 100%)',
  hotel:        'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)',
  experience:   'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
  accommodation:'linear-gradient(135deg, #2dd4bf 0%, #0ea5e9 100%)',
  neighbourhood:'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
};

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)';

/* ---- Dark types (nightlife) ---- */
const DARK_TYPES = new Set(['music-venue', 'bar', 'theatre']);

/* ---- Helpers ---- */

function extractRating(text: string | undefined): { rating: number; count: number } | null {
  if (!text) return null;
  const m = text.match(/(\d+\.?\d*)\s*[★⭐]\s*(?:\((\d+)\s*reviews?\))?/);
  if (!m || !m[1]) return null;
  return { rating: parseFloat(m[1]), count: m[2] ? parseInt(m[2]) : 0 };
}

function extractWebsite(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s,)]+/);
  return m ? m[0] : null;
}

interface PlaceCardDetailProps {
  card: PlaceCard;
  userId?: string;
  contextKey?: string;
}

export default function PlaceCardDetail({ card, userId, contextKey }: PlaceCardDetailProps) {
  const typeMeta = getTypeMeta(card.type);
  const data = card.data ?? { description: '', highlights: [], images: [] };

  // Hero image — use first available
  const heroImage = resolveImageUrlClient(data.images?.[0]?.path);
  const gradient = TYPE_GRADIENTS[card.type] || DEFAULT_GRADIENT;
  const isDark = DARK_TYPES.has(card.type);

  // Extract structured data from narrative
  const narrative = data.description as string | undefined;
  const ratingData = extractRating(narrative) ||
    (data.rating ? { rating: data.rating as number, count: (data.reviewCount as number) || 0 } : null);
  const website = extractWebsite(narrative);

  // Address & maps
  const address = (data.address as string | undefined) || '';
  const googleMapsUrl = card.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${card.place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.name + ' ' + address)}`;

  // Photos — exclude hero (already shown), show rest in gallery
  const galleryImages = data.images && data.images.length > 1 ? data.images.slice(1) : [];

  // Development-specific: show all images as carousel
  const isDevelopment = card.type === 'development';
  const allImages = data.images ?? [];

  return (
    <div className={`place-detail-v2 ${isDark ? 'place-detail-dark' : ''}`}>

      {/* ── Hero ── */}
      <div
        className="place-detail-v2-hero"
        style={{
          background: heroImage
            ? `linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.7) 100%), url(${heroImage}) center/cover`
            : gradient,
        }}
      >
        <div className="place-detail-v2-hero-overlay">
          <div className="place-detail-v2-type-row">
            <span
              className="type-badge type-badge-md"
              style={{ '--type-color': typeMeta.color } as React.CSSProperties}
            >
              <span className="type-badge-icon">{typeMeta.icon}</span>
              {typeMeta.label}
            </span>
            {userId && contextKey && card.place_id && (
              <div className="place-detail-v2-hero-triage">
                <TriageWidget
                  userId={userId}
                  contextKey={contextKey}
                  contextLabel=""
                  placeId={card.place_id}
                />
              </div>
            )}
          </div>
          <h1 className="place-detail-v2-name">{card.name}</h1>
          {address && (
            <p className="place-detail-v2-address-hero">{address}</p>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="place-detail-v2-body">

        {/* Rating (only when present) */}
        {ratingData && ratingData.rating > 0 && (
          <RatingWidget rating={ratingData.rating} reviewCount={ratingData.count || undefined} />
        )}

        {/* Narrative — the heart of the card */}
        {narrative && (
          <div className="place-detail-v2-narrative">
            <p>{narrative}</p>
          </div>
        )}

        {/* Identity row — address, website, maps */}
        <div className="place-detail-v2-identity">
          {address && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="place-detail-v2-identity-row"
            >
              <span className="place-detail-v2-identity-icon">📍</span>
              <span>{address}</span>
              <span className="place-detail-v2-identity-link">↗</span>
            </a>
          )}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="place-detail-v2-identity-row"
            >
              <span className="place-detail-v2-identity-icon">🌐</span>
              <span className="place-detail-v2-website-text">{website.replace(/^https?:\/\//, '').split('/')[0]}</span>
              <span className="place-detail-v2-identity-link">↗</span>
            </a>
          )}
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary place-detail-v2-maps-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            Open in Maps
          </a>
        </div>

        {/* Development: full carousel */}
        {isDevelopment && allImages.length > 0 && (
          <div className="place-detail-v2-dev-gallery">
            <div className="place-detail-v2-dev-track">
              {allImages.map((img, i) => (
                <img
                  key={i}
                  src={resolveImageUrlClient(img.path) || ''}
                  alt={img.category || `Rendering ${i + 1}`}
                  className="place-detail-v2-dev-img"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Photo gallery (non-development) */}
        {!isDevelopment && galleryImages.length > 0 && (
          <PhotoGallery images={galleryImages} />
        )}

        {/* Map */}
        <MapWidget placeId={card.place_id} name={card.name} />

        {/* Triage (fallback if not in hero) */}
        {userId && contextKey && card.place_id && !heroImage && (
          <div className="place-detail-triage" style={{ marginTop: 'var(--space-xl)' }}>
            <TriageWidget
              userId={userId}
              contextKey={contextKey}
              contextLabel={contextKey}
              placeId={card.place_id}
            />
          </div>
        )}

      </div>
    </div>
  );
}
