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

/** Build a geojson.io URL with all mappable discoveries as numbered markers */
function buildGeoJsonUrl(mappable: Discovery[]): string {
  const geojson = {
    type: 'FeatureCollection' as const,
    features: mappable.map((d, i) => {
      const c = getCoords(d)!;
      const label = LABELS[i] || String(i + 1);
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [c.lng, c.lat],
        },
        properties: {
          name: `${label} ${d.name}`,
          description: [d.address, d.description].filter(Boolean).join(' — '),
          'marker-symbol': String(i + 1),
          'marker-color': '#e74c3c',
          type: d.type,
        },
      };
    }),
  };
  return `https://geojson.io/#data=data:application/json,${encodeURIComponent(JSON.stringify(geojson))}`;
}

export default function ReviewMarkersMap({ discoveries, contextLabel, city }: ReviewMarkersMapProps) {
  // Only show places with coordinates
  const mappable = discoveries.filter(d => getCoords(d) !== null);

  // Static map limited to 26 labeled markers
  const staticMappable = mappable.slice(0, 26);

  if (staticMappable.length === 0) return null;

  // Build Static Maps URL with markers
  const coords = staticMappable.map(d => getCoords(d)!);

  // Calculate bounds for auto-zoom
  const lats = coords.map(c => c.lat);
  const lngs = coords.map(c => c.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  // Build marker params
  const markerParams = staticMappable.map((d, i) => {
    const c = getCoords(d)!;
    const label = LABELS[i] || String(i + 1);
    return `markers=color:red%7Clabel:${label}%7C${c.lat},${c.lng}`;
  }).join('&');

  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=800x640&scale=2&center=${centerLat},${centerLng}&${markerParams}&key=${MAPS_KEY}`;

  // Interactive map URL — geojson.io with ALL mappable discoveries
  const interactiveUrl = buildGeoJsonUrl(mappable);

  return (
    <div style={{ margin: '0 0 var(--space-md)' }}>
      <div style={{ borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
        <a href={interactiveUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
          <img
            src={staticMapUrl}
            alt={`Map of ${staticMappable.length} places to review`}
            style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 640, objectFit: 'cover' }}
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
      <div style={{
        textAlign: 'right',
        padding: '6px 4px 0',
      }}>
        <a
          href={interactiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-accent, #3b82f6)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          View all {mappable.length} on interactive map →
        </a>
      </div>
    </div>
  );
}
