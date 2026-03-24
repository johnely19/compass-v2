'use client';

import Link from 'next/link';
import type { Discovery } from '../_lib/types';
import TypeBadge from './TypeBadge';
import TriageButtons from './TriageButtons';

interface PlaceCardProps {
  discovery: Discovery;
  contextKey: string;
  userId?: string;
}

export default function PlaceCard({ discovery, contextKey, userId }: PlaceCardProps) {
  const { id, place_id, name, type } = discovery;
  // Ensure rating is a number (V1 data may have strings like "4.5")
  const rating = discovery.rating != null ? Number(discovery.rating) : null;
  const safeRating = rating != null && !isNaN(rating) ? rating : null;

  // Resolve image URL — server already enriches, but handle edge cases
  const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';
  const rawImage = discovery.heroImage;
  const imageUrl = rawImage
    ? (rawImage.startsWith('http') ? rawImage : (rawImage.startsWith('/') && BLOB_BASE ? `${BLOB_BASE}${rawImage}` : rawImage))
    : null;

  // Generate fallback gradient based on type
  const gradientStyle = {
    background: imageUrl
      ? `url(${imageUrl}) center/cover`
      : `linear-gradient(135deg,
          color-mix(in srgb, var(--accent) 30%, var(--bg-secondary)),
          color-mix(in srgb, var(--accent) 10%, var(--bg-primary)))`,
  };

  const mapsUrl = place_id
    ? `https://www.google.com/maps/place/?q=place_id:${place_id}`
    : null;

  return (
    <Link href={`/placecards/${id}`} className="place-card">
      <div className="place-card-image" style={gradientStyle as React.CSSProperties}>
        {!imageUrl && <span className="place-card-image-fallback" />}
      </div>
      <div className="place-card-body">
        <div className="place-card-header">
          <h3 className="place-card-name">{name}</h3>
          <TypeBadge type={type} size="sm" />
        </div>
        <div className="place-card-rating">
          {safeRating != null ? (
            <>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={i < Math.floor(safeRating) ? 'star-filled' : 'star-empty'}>
                  ★
                </span>
              ))}
              <span className="rating-value">{safeRating.toFixed(1)}</span>
            </>
          ) : (
            <span className="rating-placeholder">&nbsp;</span>
          )}
        </div>
      </div>
      <div className="place-card-footer">
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="place-card-maps"
            onClick={(e) => e.stopPropagation()}
          >
            ↗ Maps
          </a>
        )}
        {userId && place_id && (
          <TriageButtons
            userId={userId}
            contextKey={contextKey}
            placeId={place_id}
            size="sm"
          />
        )}
      </div>
    </Link>
  );
}