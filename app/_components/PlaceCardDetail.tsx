'use client';

import type { PlaceCard, DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import { resolveImageUrlClient } from '../_lib/image-url';
import TriageWidget from './TriageWidget';
import RatingWidget from './widgets/RatingWidget';
import HoursWidget from './widgets/HoursWidget';
import MapWidget from './widgets/MapWidget';
import PhotoGallery from './widgets/PhotoGallery';
import TravelIntelWidget from './widgets/TravelIntelWidget';

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

/* ---- Menu item parser ---- */
interface MenuItem {
  name: string;
  price: string;
  description: string;
  highlight: boolean;
}

function parseMenuLine(line: string): MenuItem | null {
  // Formats: "• Name — $XX ⭐", "⭐ Name — $XX", "• Name — $XX"
  const raw = line.replace(/^[•·]\s*/, '').trim();
  const isHighlight = raw.includes('⭐') || line.startsWith('⭐');
  const clean = raw.replace(/⭐/g, '').trim();

  // Match "Name — $XX" or "Name — XX" (dash variants)
  const priceMatch = clean.match(/^(.+?)\s+[—–-]+\s+(\$[\d,.]+(?:\s*[-–]\s*\$[\d,.]+)?|\$[\d,.]+)(.*)$/);
  if (!priceMatch) return null;

  return {
    name: priceMatch[1]?.trim() ?? clean,
    price: priceMatch[2]?.trim() ?? '',
    description: priceMatch[3]?.trim() ?? '',
    highlight: isHighlight,
  };
}

function MenuItemRow({ item, description }: { item: MenuItem; description?: string }) {
  const desc = description || item.description;
  return (
    <div className={`menu-item-row ${item.highlight ? 'menu-item-highlight' : ''}`}>
      <div className="menu-item-line">
        <span className="menu-item-name">{item.name}</span>
        <span className="menu-item-dots" aria-hidden="true" />
        <span className="menu-item-price">{item.price}</span>
      </div>
      {desc && <p className="menu-item-desc">{desc}</p>}
    </div>
  );
}

/* ---- Prose block renderer ---- */
function NarrativeBlock({ title, body }: { title: string; body: string }) {
  const label = normalizeBlockTitle(title);
  const isTravelIntel = /travel.?intel/i.test(label);
  const isCheck = /check/i.test(label);
  const isFood = /food|menu|drink/i.test(label);

  // For food/menu blocks, use the structured menu renderer
  if (isFood) {
    const lines = body.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (!trimmed) { i++; continue; }

      // Section header (ALL CAPS or **bold**)
      if (/^[A-Z][A-Z\s&()]{3,}$/.test(trimmed) || trimmed.startsWith('**')) {
        elements.push(
          <p key={i} className="narrative-section-header">{trimmed.replace(/\*\*/g, '')}</p>
        );
        i++; continue;
      }

      // Menu item line
      if (trimmed.startsWith('•') || trimmed.startsWith('⭐') || trimmed.startsWith('·')) {
        const item = parseMenuLine(trimmed);
        if (item) {
          // Peek at next line for description (indented or no bullet)
          const nextLine = lines[i + 1]?.trim() ?? '';
          const isNextDesc = nextLine && !nextLine.startsWith('•') && !nextLine.startsWith('⭐') &&
            !/^[A-Z][A-Z\s]{3,}$/.test(nextLine) && !nextLine.startsWith('**');
          const desc = isNextDesc ? nextLine : '';
          if (desc) i++;
          elements.push(<MenuItemRow key={i} item={item} description={desc} />);
          i++; continue;
        }
      }

      elements.push(<p key={i} className="narrative-prose">{trimmed}</p>);
      i++;
    }

    return (
      <div className={`narrative-block narrative-block-menu`}>
        <h3 className="narrative-block-title">{label}</h3>
        <div className="narrative-block-body menu-body">{elements}</div>
      </div>
    );
  }

  // Non-menu blocks — prose renderer
  return (
    <div className={`narrative-block ${isTravelIntel ? 'narrative-block-travel' : ''} ${isCheck ? 'narrative-block-check' : ''}`}>
      <h3 className="narrative-block-title">{label}</h3>
      <div className="narrative-block-body">
        {body.split('\n').map((line, i) => {
          if (!line.trim()) return <br key={i} />;
          if (line.trim().startsWith('⭐') && !line.trim().startsWith('⭐⭐')) {
            return <blockquote key={i} className="narrative-quote">{line.replace(/^⭐+\s*"?/, '').replace(/"$/, '')}</blockquote>;
          }
          if (/^[A-Z][A-Z\s&()]{3,}$/.test(line.trim()) || line.trim().startsWith('**')) {
            return <p key={i} className="narrative-section-header">{line.replace(/\*\*/g, '')}</p>;
          }
          return <p key={i} className="narrative-prose">{line}</p>;
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

        {/* Identity bar — rating + review count + price in one compact row */}
        {(rating || priceLevel) && (
          <RatingWidget rating={rating} reviewCount={reviewCount} priceLevel={priceLevel} />
        )}

        {/* Hours widget — shows today + expand for full week */}
        {data.hours && (Array.isArray(data.hours) ? data.hours.length > 0 : Object.keys(data.hours).length > 0) && (
          <HoursWidget hours={data.hours as string[] | Record<string, string>} />
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
        </div>

        {/* Travel intel — only for trip contexts */}
        {contextKey && contextKey.startsWith('trip:') && card.place_id && (
          <TravelIntelWidget placeId={card.place_id} contextKey={contextKey} />
        )}

        {/* Map — with directions from trip base if available */}
        <MapWidget
          placeId={card.place_id}
          name={card.name}
          fromAddress={contextKey === 'trip:nyc-april-2026' ? '126 Leonard St, Brooklyn, NY' : undefined}
        />

      </div>
    </div>
  );
}
