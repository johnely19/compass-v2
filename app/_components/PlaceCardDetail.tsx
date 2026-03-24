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
  restaurant:    'linear-gradient(135deg, #f59e0b 0%, #e11d48 100%)',
  bar:           'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
  cafe:          'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
  gallery:       'linear-gradient(135deg, #475569 0%, #3b82f6 100%)',
  museum:        'linear-gradient(135deg, #334155 0%, #6366f1 100%)',
  theatre:       'linear-gradient(135deg, #1e1b4b 0%, #9f1239 100%)',
  'music-venue': 'linear-gradient(135deg, #0f0a1e 0%, #581c87 100%)',
  grocery:       'linear-gradient(135deg, #16a34a 0%, #0d9488 100%)',
  shop:          'linear-gradient(135deg, #78716c 0%, #d97706 100%)',
  park:          'linear-gradient(135deg, #15803d 0%, #4ade80 100%)',
  architecture:  'linear-gradient(135deg, #475569 0%, #94a3b8 100%)',
  development:   'linear-gradient(135deg, #64748b 0%, #334155 100%)',
  hotel:         'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)',
  experience:    'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
  accommodation: 'linear-gradient(135deg, #2dd4bf 0%, #0ea5e9 100%)',
  neighbourhood: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
};

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #1e3a5f 0%, #3b82f6 100%)';
const DARK_TYPES = new Set(['music-venue', 'bar', 'theatre']);

/* ---- Price level dots ---- */
function PriceLevel({ level }: { level: number }) {
  return (
    <span className="price-level">
      {['$', '$$', '$$$', '$$$$'][level - 1] ?? ''}
    </span>
  );
}

/* ---- Block title normalizer ---- */
function normalizeBlockTitle(title: string): string {
  // Strip emoji, bold markers, location pins, dashes
  return title
    .replace(/^[\u{1F300}-\u{1FFFF}]/u, '')
    .replace(/[\uD835][\uDC00-\uDFFF]/g, c => {
      const cp = c.codePointAt(0);
      if (!cp) return c;
      if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65);
      if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97);
      return c;
    })
    .replace(/^[\s—\-📍]+/, '')
    .trim();
}

/* ---- Prose block renderer ---- */
function NarrativeBlock({ title, body }: { title: string; body: string }) {
  const label = normalizeBlockTitle(title);
  // Detect if this is "Travel Intel" type block
  const isTravelIntel = /travel.?intel/i.test(label);
  const isCheck = /check/i.test(label);

  return (
    <div className={`narrative-block ${isTravelIntel ? 'narrative-block-travel' : ''} ${isCheck ? 'narrative-block-check' : ''}`}>
      <h3 className="narrative-block-title">{label}</h3>
      <div className="narrative-block-body">
        {body.split('\n').map((line, i) => {
          if (!line.trim()) return <br key={i} />;
          // Detect review quotes (starts with ⭐)
          if (line.startsWith('⭐')) {
            return <blockquote key={i} className="narrative-quote">{line.replace(/^⭐+\s*/, '')}</blockquote>;
          }
          // Detect menu items (• name — price or • name — $XX)
          if (line.startsWith('•')) {
            const isHighlight = line.includes('⭐');
            return (
              <p key={i} className={`narrative-menu-item ${isHighlight ? 'narrative-menu-highlight' : ''}`}>
                {line}
              </p>
            );
          }
          // Bold section headers (all caps lines or bold markers)
          if (/^[A-Z\s]{4,}$/.test(line.trim()) || line.startsWith('**')) {
            return <p key={i} className="narrative-section-header">{line.replace(/\*\*/g, '')}</p>;
          }
          return <p key={i}>{line}</p>;
        })}
      </div>
    </div>
  );
}

interface PlaceCardDetailProps {
  card: PlaceCard;
  userId?: string;
  contextKey?: string;
}

export default function PlaceCardDetail({ card, userId, contextKey }: PlaceCardDetailProps) {
  const typeMeta = getTypeMeta(card.type);
  const data = card.data ?? { description: '', highlights: [], images: [] };

  // Hero image — prefer interior_vibe category, then first available
  const allImages = (data.images ?? []) as Array<{ path: string; category: string }>;
  const heroImg = allImages.find(i => i.category === 'interior_vibe') || allImages[0];
  const heroImage = heroImg ? resolveImageUrlClient(heroImg.path) : null;
  const gradient = TYPE_GRADIENTS[card.type] || DEFAULT_GRADIENT;
  const isDark = DARK_TYPES.has(card.type);
  const isDevelopment = card.type === 'development';

  // Narrative blocks (rich prose)
  const narrativeBlocks = (data.narrativeBlocks ?? []) as Array<{ title: string; body: string }>;

  // Summary (fallback when no blocks)
  const summary = data.description as string | undefined;

  // Identity fields
  const address = (data.address as string | undefined) || '';
  const city = (data.city as string | undefined) || '';
  const phone = data.phone as string | undefined;
  const website = data.website as string | undefined;
  const menuLink = data.menu_link as string | undefined;
  const priceLevel = data.price_level as number | undefined;
  const rating = data.rating as number | undefined;
  const reviewCount = data.reviewCount as number | undefined;

  const googleMapsUrl = card.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${card.place_id}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.name + ' ' + address)}`;

  // Photo gallery — exclude hero, categorize
  const foodPhotos = allImages.filter(i => ['food', 'drinks'].includes(i.category) && i !== heroImg);
  const interiorPhotos = allImages.filter(i => ['interior_vibe', 'interior_detail'].includes(i.category) && i !== heroImg);
  const otherPhotos = allImages.filter(i => !['food', 'drinks', 'interior_vibe', 'interior_detail'].includes(i.category) && i !== heroImg);

  return (
    <div className={`place-detail-v2 ${isDark ? 'place-detail-dark' : ''}`}>

      {/* ── Hero ── */}
      <div
        className="place-detail-v2-hero"
        style={{
          background: heroImage
            ? `linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.75) 100%), url(${heroImage}) center/cover no-repeat`
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
          {(city || address) && (
            <p className="place-detail-v2-address-hero">
              {city && address ? `${city} · ${address.split(',')[0]}` : city || address.split(',')[0]}
            </p>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="place-detail-v2-body">

        {/* Identity bar — rating + price in one compact row */}
        {(rating || priceLevel) && (
          <div className="place-detail-v2-identity-bar">
            {rating && rating > 0 && (
              <RatingWidget rating={rating} reviewCount={reviewCount} />
            )}
            {priceLevel && <PriceLevel level={priceLevel} />}
          </div>
        )}

        {/* Food photos strip — right after identity, before prose */}
        {!isDevelopment && foodPhotos.length > 0 && (
          <div className="place-detail-v2-food-strip">
            <PhotoGallery images={foodPhotos} />
          </div>
        )}

        {/* ── Narrative blocks — the heart of the card ── */}
        {narrativeBlocks.length > 0 ? (
          <div className="place-detail-v2-narrative-blocks">
            {narrativeBlocks.map((block, i) => (
              <NarrativeBlock key={i} title={block.title} body={block.body} />
            ))}
          </div>
        ) : summary ? (
          <div className="place-detail-v2-narrative">
            <p>{summary}</p>
          </div>
        ) : null}

        {/* Interior gallery */}
        {!isDevelopment && (interiorPhotos.length > 0 || otherPhotos.length > 0) && (
          <div className="place-detail-v2-interior-gallery">
            <PhotoGallery images={[...interiorPhotos, ...otherPhotos]} />
          </div>
        )}

        {/* Development carousel */}
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

        {/* ── Practical info ── */}
        <div className="place-detail-v2-identity">
          {address && (
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="place-detail-v2-identity-row">
              <span className="place-detail-v2-identity-icon">📍</span>
              <span>{address}</span>
              <span className="place-detail-v2-identity-link">↗</span>
            </a>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="place-detail-v2-identity-row">
              <span className="place-detail-v2-identity-icon">📞</span>
              <span>{phone}</span>
            </a>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" className="place-detail-v2-identity-row">
              <span className="place-detail-v2-identity-icon">🌐</span>
              <span className="place-detail-v2-website-text">{website.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0]}</span>
              <span className="place-detail-v2-identity-link">↗</span>
            </a>
          )}
          {menuLink && (
            <a href={menuLink} target="_blank" rel="noopener noreferrer" className="place-detail-v2-identity-row">
              <span className="place-detail-v2-identity-icon">📋</span>
              <span>View Menu</span>
              <span className="place-detail-v2-identity-link">↗</span>
            </a>
          )}
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary place-detail-v2-maps-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            Open in Maps
          </a>
        </div>

        {/* Map */}
        <MapWidget placeId={card.place_id} name={card.name} />

      </div>
    </div>
  );
}
