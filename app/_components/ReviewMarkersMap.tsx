'use client';

import type { Discovery } from '../_lib/types';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || 'AIzaSyCp9YqbC3QoNS3DCG4FzNChAgUgMPWD6pw';

// Label characters for markers (A-Z then numbers)
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

interface ReviewMarkersMapProps {
  discoveries: Discovery[];
  contextLabel: string;
  city?: string;
}

function getCoords(d: Discovery): { lat: number; lng: number } | null {
  const rec = d as unknown as Record<string, unknown>;
  const lat = (rec.lat ?? rec.latitude) as number | undefined;
  const lng = (rec.lng ?? rec.longitude) as number | undefined;
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) return { lat, lng };
  return null;
}

export default function ReviewMarkersMap({ discoveries, contextLabel, city }: ReviewMarkersMapProps) {
  // Only show unreviewed places with coordinates
  const mappable = discoveries
    .filter(d => getCoords(d) !== null)
    .slice(0, 26); // Static Maps supports up to 26 labeled markers

  if (mappable.length === 0) return null;

  // Build Static Maps URL with markers
  const coords = mappable.map(d => getCoords(d)!);

  // Calculate bounds for auto-zoom
  const lats = coords.map(c => c.lat);
  const lngs = coords.map(c => c.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  // Build marker params
  const markerParams = mappable.map((d, i) => {
    const c = getCoords(d)!;
    const label = LABELS[i] || String(i + 1);
    return `markers=color:red%7Clabel:${label}%7C${c.lat},${c.lng}`;
  }).join('&');

  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=800x320&scale=2&center=${centerLat},${centerLng}&${markerParams}&key=${MAPS_KEY}`;

  // Google Maps URL — open centered on midpoint at the right zoom
  // Best native experience: each place links individually from its card.
  // This map click opens Google Maps centered on the cluster so user can explore.
  const mapsUrl = `https://www.google.com/maps/@${centerLat},${centerLng},13z`;

  return (
    <div style={{ margin: '0 0 var(--space-md)', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
        <img
          src={staticMapUrl}
          alt={`Map of ${mappable.length} places to review`}
          style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 320, objectFit: 'cover' }}
        />
      </a>
      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        background: 'rgba(0,0,0,0.65)',
        color: 'white',
        fontSize: '0.75rem',
        padding: '4px 10px',
        borderRadius: 20,
        backdropFilter: 'blur(4px)',
      }}>
        📍 {mappable.length} place{mappable.length !== 1 ? 's' : ''} to review
        {discoveries.length > mappable.length ? ` · ${discoveries.length - mappable.length} without location` : ''}
      </div>
    </div>
  );
}
