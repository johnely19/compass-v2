'use client';

import { useState } from 'react';
import type { PlaceCard, Discovery } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import { resolveImageUrlClient } from '../_lib/image-url';
import TriageWidget from './TriageWidget';
import ProvenanceSection from './ProvenanceSection';
import HoursWidget from './widgets/HoursWidget';
import MapWidget from './widgets/MapWidget';
import PhotoGallery from './widgets/PhotoGallery';
import TravelIntelWidget from './widgets/TravelIntelWidget';
import { scoreDiscovery } from '../_lib/discovery-score';
import type { ScoreBreakdown } from '../_lib/discovery-score';
import { getMonitoringExplanation, getMonitorStatusLabel } from '../_lib/discovery-monitoring';

/* ---- Share button ---- */
function ShareButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const text = `Check out ${name} on Compass`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: name, text, url });
        return;
      } catch { /* cancelled */ }
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <button className="place-detail-share-btn" onClick={handleShare} aria-label="Share this place">
      {copied ? '✅ Link copied' : '🔗 Share'}
    </button>
  );
}

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

// Types where food/drink photo strips make sense
const FOOD_STRIP_TYPES = new Set(['restaurant', 'bar', 'cafe', 'grocery', 'hotel']);

// Types where interior photo galleries make sense
const INTERIOR_GALLERY_TYPES = new Set(['restaurant', 'bar', 'cafe', 'gallery', 'museum', 'theatre', 'music-venue', 'live-music', 'hotel', 'shop', 'accommodation']);

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
function NarrativeBlock({ title, body, truncate }: { title: string; body: string; truncate?: number }) {
  const [expanded, setExpanded] = useState(false);
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
  const allLines = body.split('\n').filter(l => l.trim());
  const visibleLines = (truncate && !expanded) ? allLines.slice(0, truncate) : allLines;
  const hasMore = truncate && allLines.length > truncate && !expanded;

  const renderLine = (line: string, i: number) => {
    if (line.trim().startsWith('⭐') && !line.trim().startsWith('⭐⭐')) {
      return <blockquote key={i} className="narrative-quote">{line.replace(/^⭐+\s*"?/, '').replace(/"$/, '')}</blockquote>;
    }
    if (/^[A-Z][A-Z\s&()]{3,}$/.test(line.trim()) || line.trim().startsWith('**')) {
      return <p key={i} className="narrative-section-header">{line.replace(/\*\*/g, '')}</p>;
    }
    return <p key={i} className="narrative-prose">{line}</p>;
  };

  return (
    <div className={`narrative-block ${isTravelIntel ? 'narrative-block-travel' : ''} ${isCheck ? 'narrative-block-check' : ''}`}>
      <h3 className="narrative-block-title">{label}</h3>
      <div className="narrative-block-body">
        {visibleLines.map((line, i) => renderLine(line, i))}
        {hasMore && (
          <button className="narrative-show-more" onClick={() => setExpanded(true)}>
            ...show more
          </button>
        )}
        {expanded && truncate && (
          <button className="narrative-show-more" onClick={() => setExpanded(false)}>
            show less
          </button>
        )}
      </div>
    </div>
  );
}

interface PlaceCardDetailProps {
  card: PlaceCard;
  userId?: string;
  contextKey?: string;
  discovery?: Partial<Discovery>;
}

export default function PlaceCardDetail({ card, userId, contextKey, discovery }: PlaceCardDetailProps) {
  const typeMeta = getTypeMeta(card.type);
  const data = card.data ?? { description: '', highlights: [], images: [] };

  // Hero image — prefer interior_vibe category, then first available
  const allImages = (data.images ?? []) as Array<{ path: string; category: string }>;
  const heroImg = allImages.find(i => i.category === 'interior_vibe') || allImages[0];
  const heroImage = heroImg ? resolveImageUrlClient(heroImg.path) : null;
  const gradient = TYPE_GRADIENTS[card.type] || DEFAULT_GRADIENT;
  const isDark = DARK_TYPES.has(card.type);
  const isDevelopment = card.type === 'development';
  const hasFoodStrip = FOOD_STRIP_TYPES.has(card.type);
  const hasInteriorGallery = INTERIOR_GALLERY_TYPES.has(card.type);

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
    : null;
  const monitoringExplanation = discovery ? getMonitoringExplanation(discovery) : null;

  // Google Earth 3D link — useful for spatial context on outdoor/area types
  const EARTH_TYPES = new Set(['accommodation', 'neighbourhood', 'park', 'architecture', 'experience', 'development']);
  const googleEarthUrl = EARTH_TYPES.has(card.type)
    ? `https://earth.google.com/web/search/${encodeURIComponent([card.name, city || address?.split(',').slice(-2, -1)[0]?.trim()].filter(Boolean).join(' '))}`
    : null;

  // Photo gallery — exclude hero, categorize
  const foodPhotos = allImages.filter(i => ['food', 'drinks'].includes(i.category) && i !== heroImg);
  const interiorPhotos = allImages.filter(i => ['interior_vibe', 'interior_detail'].includes(i.category) && i !== heroImg);
  const otherPhotos = allImages.filter(i => !['food', 'drinks', 'interior_vibe', 'interior_detail'].includes(i.category) && i !== heroImg);

  return (
    <div className={`place-detail-v2 ${isDark ? 'place-detail-dark' : ''}`}>

      {/* ── Discovery Score (above hero) ── */}
      {discovery && <ScoreBreakdownSection discovery={discovery} />}

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
          </div>
          <h1 className="place-detail-v2-name">{card.name}</h1>
          {(rating || priceLevel) && (
            <div className="place-detail-v2-hero-rating">
              {rating && <span>⭐ {rating.toFixed(1)}</span>}
              {reviewCount && <span className="place-detail-v2-hero-review-count"> ({reviewCount.toLocaleString()})</span>}
              {priceLevel && <span className="place-detail-v2-hero-price"> · {'$'.repeat(priceLevel)}</span>}
            </div>
          )}
          {(city || address) && (
            <p className="place-detail-v2-address-hero">
              {city && address ? `${city} · ${address.split(',')[0]}` : city || address.split(',')[0]}
            </p>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="place-detail-v2-body">

        {/* Google Maps CTA removed — single link lives in the actions row below the map */}

        {/* ── ABOVE THE FOLD: hours first, then food strip, identity, narrative ── */}

        {/* ── Hours + Go When (FIRST in body) ── */}
        {(() => {
          const goWhen = narrativeBlocks.find(b => /go.?when/i.test(normalizeBlockTitle(b.title)));
          const hasHours = data.hours && (Array.isArray(data.hours) ? (data.hours as string[]).length > 0 : Object.keys(data.hours as Record<string,string>).length > 0);
          if (!hasHours && !goWhen) return null;
          return (
            <div className="place-detail-v2-hours-section">
              {hasHours && <HoursWidget hours={data.hours as string[] | Record<string, string>} />}
              {goWhen && (
                <div className="narrative-block narrative-go-when">
                  <h3 className="narrative-block-title">Go When</h3>
                  <div className="narrative-block-body">
                    {goWhen.body.split('\n').filter(l => l.trim()).slice(0, 2).map((line, idx) => (
                      <p key={idx} className="narrative-prose">{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Food photos strip — only for food/drink venues */}
        {hasFoodStrip && foodPhotos.length > 0 && (
          <div className="place-detail-v2-food-strip">
            <PhotoGallery images={foodPhotos} />
          </div>
        )}

        {/* Practical info — address, website, menu */}
        <div className="place-detail-v2-identity">
          {address && (
            googleMapsUrl ? (
              <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="place-detail-v2-identity-row place-detail-v2-identity-link-row">
                <span className="place-detail-v2-identity-icon">📍</span>
                <span>{address}</span>
                <span className="place-detail-v2-identity-link">View in Google Maps ↗</span>
              </a>
            ) : (
              <div className="place-detail-v2-identity-row">
                <span className="place-detail-v2-identity-icon">📍</span>
                <span>{address}</span>
              </div>
            )
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

        {/* ── NARRATIVE — truncated blocks ── */}
        {narrativeBlocks.length > 0 ? (
          <div className="place-detail-v2-narrative-blocks">
            {narrativeBlocks.filter(b => {
              const label = normalizeBlockTitle(b.title);
              // Move "Go When" to hours section — skip here
              return !/go.?when/i.test(label) && !/vibe|review/i.test(label);
            }).map((block, i) => (
              <NarrativeBlock key={i} title={block.title} body={block.body} truncate={2} />
            ))}
          </div>
        ) : summary ? (
          <div className="place-detail-v2-narrative">
            <p>{summary}</p>
          </div>
        ) : null}

        {/* Reviews / Vibe — collapsed */}
        {narrativeBlocks.filter(b => /vibe|review/i.test(normalizeBlockTitle(b.title))).map((block, i) => (
          <NarrativeBlock key={`vibe-${i}`} title={block.title} body={block.body} truncate={2} />
        ))}

        {discovery?.monitorStatus && discovery.monitorStatus !== 'none' && monitoringExplanation && (
          <section className="monitoring-note">
            <div className="monitoring-note-header">
              <span className="monitoring-note-kicker">Monitoring</span>
              <span className={`monitoring-note-status monitoring-note-status-${discovery.monitorStatus}`}>
                {getMonitorStatusLabel(discovery.monitorStatus)}
              </span>
            </div>
            <p className="monitoring-note-body">{monitoringExplanation}</p>
            {discovery.monitorDimensions && discovery.monitorDimensions.length > 0 && (
              <ul className="monitoring-note-list">
                {discovery.monitorDimensions.slice(0, 4).map((dimension) => (
                  <li key={dimension.key}>
                    <strong>{dimension.label}:</strong> {dimension.description}
                    {dimension.trigger && (
                      <span className="monitoring-note-trigger"> Trigger: {dimension.trigger}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Provenance section — why this place was recommended */}
        {discovery && discovery.source && (
          <ProvenanceSection
            source={discovery.source}
            discoveredAt={discovery.discoveredAt || undefined}
            sourceUrl={discovery.sourceUrl}
            sourceName={discovery.sourceName}
            theme={discovery.theme}
            verified={discovery.verified}
            rating={discovery.rating}
            ratingCount={discovery.ratingCount}
            description={discovery.description}
            placeName={card.name}
          />
        )}

        {/* Interior gallery — below fold, for applicable types */}
        {hasInteriorGallery && (interiorPhotos.length > 0 || otherPhotos.length > 0) && (
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
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Travel intel — only for trip contexts */}
        {contextKey && contextKey.startsWith('trip:') && card.place_id && (
          <TravelIntelWidget placeId={card.place_id} contextKey={contextKey} />
        )}

        {/* ── Compact actions row ── */}
        <div className="place-detail-actions-row">
          {/* Maps link moved to address row above */}
          {googleEarthUrl && (
            <a href={googleEarthUrl} target="_blank" rel="noopener noreferrer"
               className="place-detail-action-btn">
              🌍 Google Earth 3D →
            </a>
          )}
          <ShareButton name={card.name} />
          {userId && contextKey && card.place_id && (
            <TriageWidget
              userId={userId}
              contextKey={contextKey}
              contextLabel=""
              placeId={card.place_id}
            />
          )}
        </div>

        {/* Map (compact 200px) */}
        <div className="place-detail-map-compact">
          <MapWidget placeId={card.place_id} name={card.name} height={200} />
        </div>

      </div>
    </div>
  );
}

/* ---- Score Breakdown Section (collapsible) ---- */
function ScoreBreakdownSection({ discovery }: { discovery: Partial<Discovery> }) {
  const [expanded, setExpanded] = useState(false);
  const score = scoreDiscovery(discovery as Discovery);
  const dimensions: Array<{ label: string; key: keyof ScoreBreakdown; icon: string; max: number }> = [
    { label: 'Rating', key: 'rating', icon: '⭐', max: 20 },
    { label: 'Photo Quality', key: 'photoQuality', icon: '📸', max: 20 },
    { label: 'Freshness', key: 'freshness', icon: '🕐', max: 20 },
    { label: 'Editorial', key: 'editorial', icon: '📰', max: 20 },
    { label: 'Now Signal', key: 'nowSignal', icon: '⚡', max: 20 },
  ];

  return (
    <div
      className={`score-breakdown-section ${expanded ? 'score-breakdown-expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
    >
      <div className="score-breakdown-header">
        <span className="score-breakdown-title">Discovery Score</span>
        <span className="score-breakdown-summary">{score.total} out of 100</span>
        <span className={`score-breakdown-chevron ${expanded ? 'score-breakdown-chevron-open' : ''}`}>›</span>
      </div>
      {expanded && (
        <div className="score-breakdown-detail">
          <div className="score-breakdown-bars">
            {dimensions.map(dim => {
              const value = score[dim.key];
              const pct = Math.round((value / dim.max) * 100);
              return (
                <div key={dim.key} className="score-breakdown-row">
                  <span className="score-breakdown-label">
                    <span className="score-breakdown-icon">{dim.icon}</span>
                    {dim.label}
                  </span>
                  <div className="score-breakdown-bar-track">
                    <div
                      className="score-breakdown-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="score-breakdown-value">{value}/{dim.max}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
