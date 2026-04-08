'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Discovery } from '../_lib/types';
import { dispatchChatTarget } from '../_lib/chat-target';
import TypeBadge from './TypeBadge';
import TriageButtons from './TriageButtons';
import { resolveImageUrlClient } from '../_lib/image-url';
import { getMonitoringExplanation, getMonitorStatusLabel } from '../_lib/discovery-monitoring';

interface PlaceCardProps {
  discovery: Discovery;
  contextKey: string;
  contextLabel?: string;
  contextEmoji?: string;
  contextType?: 'trip' | 'outing' | 'radar';
  userId?: string;
}

export default function PlaceCard({ discovery, contextKey, contextLabel, contextEmoji, contextType, userId }: PlaceCardProps) {
  const { id, place_id, name, type } = discovery;
  // Ensure rating is a number (V1 data may have strings like "4.5")
  const rating = discovery.rating != null ? Number(discovery.rating) : null;
  const safeRating = rating != null && !isNaN(rating) ? rating : null;

  // Resolve image URL — prioritize new images array, then legacy heroImage
  const rawImage = discovery.images?.[0]?.url || discovery.heroImage;
  const imageUrl = resolveImageUrlClient(rawImage);

  // Fix #211: onError recovery - if image fails to load, trigger fetch from API
  const [fetchedImageUrl, setFetchedImageUrl] = useState<string | null>(null);
  const [hasTriedFetch, setHasTriedFetch] = useState(false);

  // Final URL: prioritize fetched image (from onError recovery), then original
  const finalImageUrl = fetchedImageUrl || imageUrl;

  const handleImageError = async () => {
    if (!place_id || hasTriedFetch) return;
    setHasTriedFetch(true);

    try {
      const res = await fetch('/api/internal/fetch-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: place_id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photoUrl) {
          setFetchedImageUrl(data.photoUrl);
        }
      }
    } catch (e) {
      console.error('[PlaceCard] Failed to fetch photo:', e);
    }
  };

  // Generate fallback gradient based on type
  // NOTE: Use separate properties instead of `background` shorthand.
  // The shorthand `url(...) center/cover` is parsed differently by
  // server (Node CSS) vs browser, causing hydration mismatches.
  const gradientStyle = finalImageUrl
    ? {
        backgroundImage: `url(${finalImageUrl})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : {
        background: `linear-gradient(135deg,
          color-mix(in srgb, var(--accent) 30%, var(--bg-secondary)),
          color-mix(in srgb, var(--accent) 10%, var(--bg-primary)))`,
      };

  const mapsUrl = place_id
    ? `https://www.google.com/maps/place/?q=place_id:${place_id}`
    : null;
  const monitorExplanation = getMonitoringExplanation(discovery);

  // Track whether this card is the active chat target (for halo effect)
  const [isChatTarget, setIsChatTarget] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ placeId: string | null }>).detail;
      setIsChatTarget(detail?.placeId === place_id && !!place_id);
    };
    window.addEventListener('compass-place-halo', handler);
    return () => window.removeEventListener('compass-place-halo', handler);
  }, [place_id]);

  const handleChatAbout = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!place_id) return;

    // Dispatch full ChatTarget with card-level info via existing infrastructure
    dispatchChatTarget({
      contextKey,
      contextLabel: contextLabel || contextKey,
      contextEmoji,
      contextType,
      card: {
        id: id,
        name,
        type,
        placeId: place_id,
      },
    });

    // Broadcast halo event (distinct from compass-chat-target to avoid collision)
    window.dispatchEvent(new CustomEvent('compass-place-halo', {
      detail: { placeId: place_id },
    }));
  }, [contextKey, contextLabel, contextEmoji, contextType, id, name, type, place_id]);

  return (
    <div style={{ position: 'relative' }} className={isChatTarget ? 'place-card-chat-active' : ''}>
      <Link href={`/placecards/${place_id || id}?context=${encodeURIComponent(contextKey)}`} className="place-card">
        <div className="place-card-image" style={gradientStyle as React.CSSProperties}>
          {!finalImageUrl && <span className="place-card-image-fallback" />}
          {/* Hidden img for onError detection - triggers on load failure */}
          {place_id && imageUrl && (
            <img
              src={imageUrl}
              alt=""
              style={{ display: 'none' }}
              onError={handleImageError}
            />
          )}
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
          {discovery.rankingExplanation && (
            <div className="place-card-explanation">Why now: {discovery.rankingExplanation}</div>
          )}
          {discovery.monitorStatus && discovery.monitorStatus !== 'none' && (
            <div className="place-card-monitoring">
              Monitoring: {getMonitorStatusLabel(discovery.monitorStatus)}
            </div>
          )}
        </div>
      </Link>
      {mapsUrl && (
        <div className="place-card-footer">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="place-card-maps"
            onClick={(e) => e.stopPropagation()}>View in Google Maps →</a>
        </div>
      )}
      {userId && place_id && (
        <div className="place-card-triage-overlay">
          <TriageButtons userId={userId} contextKey={contextKey} placeId={place_id} size="sm" />
        </div>
      )}
      {place_id && (
        <button
          className={`place-card-chat-btn${isChatTarget ? ' place-card-chat-btn-active' : ''}`}
          onClick={handleChatAbout}
          aria-label={`Chat about ${name}`}
          title={`Chat about ${name}`}
        >
          💬
        </button>
      )}
    </div>
  );
}
