'use client';

import { useState, useEffect } from 'react';

interface PlaceStop {
  name: string;
  address: string;
  type: string;
}

interface RouteMapData {
  origin: string;
  originLabel: string;
  mapsUrl: string;
  places: PlaceStop[];
  totalPlaces: number;
  zone: string;
}

interface TripRouteMapProps {
  contextKey: string;
}

export default function TripRouteMap({ contextKey }: TripRouteMapProps) {
  const [data, setData] = useState<RouteMapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/trip/route-map?contextKey=${encodeURIComponent(contextKey)}`
        );
        if (!res.ok) { setLoading(false); return; }
        setData(await res.json());
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    }
    load();
  }, [contextKey]);

  if (loading) return (
    <div className="trip-route-map-loading">
      <div className="trip-route-map-placeholder" />
    </div>
  );

  if (!data) return null;

  // Build iframe-compatible maps URL
  // Use Google Maps embed with a search for the origin to show a map
  // The directions link opens in Maps app; iframe shows the starting area
  const iframeSrc = `https://maps.google.com/maps?q=${encodeURIComponent(data.origin)}&output=embed&z=13`;

  return (
    <div className="trip-route-map">
      <div className="trip-route-map-header">
        <div className="trip-route-map-info">
          <span className="trip-route-map-icon">🗺️</span>
          <div>
            <span className="trip-route-map-title">Walking route</span>
            <span className="trip-route-map-meta">
              {data.totalPlaces} places · starting from {data.originLabel}
            </span>
          </div>
        </div>
        <a
          href={data.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="trip-route-map-open"
        >
          Open in Maps ↗
        </a>
      </div>

      {/* Map iframe — shows the base area */}
      <div className="trip-route-map-embed">
        <iframe
          src={iframeSrc}
          width="100%"
          height="320"
          style={{ border: 0 }}
          allowFullScreen={false}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Trip route map"
        />
      </div>

      {/* Route zone hint */}
      <div className="trip-route-map-footer">
        <span className="trip-route-map-zone">📍 {data.zone}</span>
        <a
          href={data.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="trip-route-map-directions"
        >
          Get full directions with all {data.totalPlaces} stops →
        </a>
      </div>
    </div>
  );
}
