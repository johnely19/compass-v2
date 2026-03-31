'use client';

import type { Discovery } from '../_lib/types';

interface MappablePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  index: number; // 1-based label matching card list order
}

interface ReviewMapPanelProps {
  discoveries: Discovery[];
  /** Pre-loaded place coords keyed by place_id */
  placeCoords: Record<string, { lat: number; lng: number }>;
  /** City / context label for fallback embed search */
  contextLabel?: string;
  city?: string;
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

/** Auto-detect zoom based on marker spread (lat/lng span) */
function calcZoom(places: MappablePlace[]): number {
  if (places.length === 0) return 13;
  const lats = places.map(p => p.lat);
  const lngs = places.map(p => p.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const span = Math.max(latSpan, lngSpan);
  if (span > 5) return 6;   // province-wide (cottages)
  if (span > 2) return 8;
  if (span > 0.5) return 11;
  if (span > 0.1) return 13;
  return 15;
}

/** Build Static Maps URL with numbered markers */
function buildStaticMapUrl(places: MappablePlace[], size = '600x500'): string {
  if (!MAPS_KEY || places.length === 0) return '';
  const base = 'https://maps.googleapis.com/maps/api/staticmap';
  const params = new URLSearchParams({ size, scale: '2', maptype: 'roadmap', key: MAPS_KEY });
  // Static Maps supports label A–Z only, so we use letters for first 26
  const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const markerParams: string[] = [];
  for (const p of places) {
    const label = p.index <= 26 ? LABELS[p.index - 1] : '+';
    markerParams.push(`color:red|label:${label}|${p.lat},${p.lng}`);
  }
  // URLSearchParams doesn't support duplicate keys well, build manually
  const markerStr = markerParams.map(m => `markers=${encodeURIComponent(m)}`).join('&');
  return `${base}?${params.toString()}&${markerStr}`;
}

/** Google Maps link centered on the spread of markers */
function buildGoogleMapsUrl(places: MappablePlace[], contextLabel = ''): string {
  if (places.length === 0) return 'https://maps.google.com';
  if (places.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${places[0]!.lat},${places[0]!.lng}`;
  }
  // Link to a Maps search for the context label
  const q = encodeURIComponent(contextLabel || 'places');
  return `https://www.google.com/maps/search/${q}/`;
}

export default function ReviewMapPanel({ discoveries, placeCoords, contextLabel, city }: ReviewMapPanelProps) {
  // Build list of mappable places in card-list order
  const mappable: MappablePlace[] = [];
  let labelIndex = 1;
  for (const d of discoveries) {
    const lat = d.lat ?? (placeCoords[d.place_id ?? '']?.lat);
    const lng = d.lng ?? (placeCoords[d.place_id ?? '']?.lng);
    if (lat !== undefined && lng !== undefined) {
      mappable.push({ id: d.id, name: d.name ?? '', lat, lng, index: labelIndex });
    }
    labelIndex++;
  }

  const unmappedCount = discoveries.length - mappable.length;
  const zoom = calcZoom(mappable);
  const mapUrl = buildStaticMapUrl(mappable);
  const mapsLink = buildGoogleMapsUrl(mappable, contextLabel || city);

  if (!MAPS_KEY) {
    return (
      <div className="review-map-panel review-map-panel-empty">
        <p className="text-muted text-sm">Map unavailable — no API key configured.</p>
      </div>
    );
  }

  return (
    <div className="review-map-panel">
      {/* Header */}
      <div className="review-map-header">
        <span className="review-map-count">
          {mappable.length} place{mappable.length !== 1 ? 's' : ''} on map
        </span>
        {unmappedCount > 0 && (
          <span className="review-map-unmapped text-muted text-xs">
            · {unmappedCount} couldn&apos;t be mapped
          </span>
        )}
      </div>

      {/* Static map image */}
      {mappable.length > 0 && mapUrl ? (
        <a
          href={mapsLink}
          target="_blank"
          rel="noopener noreferrer"
          className="review-map-link"
          title="Open in Google Maps"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mapUrl}
            alt={`Map of ${mappable.length} places`}
            className="review-map-img"
            loading="lazy"
          />
        </a>
      ) : (
        <div className="review-map-panel-empty">
          <p className="text-muted text-sm">No coordinates available for these places.</p>
        </div>
      )}

      {/* Legend: place labels */}
      {mappable.length > 0 && (
        <div className="review-map-legend">
          {mappable.map((p) => {
            const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const label = p.index <= 26 ? LABELS[p.index - 1] : '•';
            return (
              <div key={p.id} className="review-map-legend-item">
                <span className="review-map-legend-label">{label}</span>
                <span className="review-map-legend-name">{p.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
