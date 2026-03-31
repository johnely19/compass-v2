'use client';

import { useState } from 'react';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || 'AIzaSyCp9YqbC3QoNS3DCG4FzNChAgUgMPWD6pw';

interface MapWidgetProps {
  placeId?: string;
  lat?: number;
  lng?: number;
  name: string;
  /** If provided, shows directions FROM this address */
  fromAddress?: string;
  /** Label for the from address (e.g. "Arnold's") */
  fromLabel?: string;
  /** Height of the map iframe in pixels (default: 280) */
  height?: number;
}

export default function MapWidget({ placeId, lat, lng, name, fromAddress, fromLabel, height = 280 }: MapWidgetProps) {
  const [embedFailed, setEmbedFailed] = useState(false);

  const destination = placeId ? `place_id:${placeId}` : name;
  const destinationEncoded = encodeURIComponent(destination);

  // Direct link to Google Maps (opens native app on mobile)
  const mapsLink = fromAddress
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromAddress)}&destination=${destinationEncoded}&travelmode=walking`
    : placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

  // Static map image (fallback — Maps Static API, always works)
  const center = lat && lng ? `${lat},${lng}` : encodeURIComponent(name);
  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=13&size=600x${height}&scale=2&markers=color:red%7C${center}&key=${MAPS_KEY}`;

  // Embed iframe src
  let iframeSrc: string;
  if (lat && lng) {
    iframeSrc = `https://www.google.com/maps/embed/v1/view?key=${MAPS_KEY}&center=${lat},${lng}&zoom=12`;
  } else if (fromAddress) {
    const origin = encodeURIComponent(fromAddress);
    const dest = placeId ? `place_id%3A${placeId}` : encodeURIComponent(name);
    iframeSrc = `https://www.google.com/maps/embed/v1/directions?key=${MAPS_KEY}&origin=${origin}&destination=${dest}&mode=walking`;
  } else if (placeId) {
    iframeSrc = `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=place_id:${placeId}&zoom=16`;
  } else {
    iframeSrc = `https://www.google.com/maps/embed/v1/search?key=${MAPS_KEY}&q=${encodeURIComponent(name)}`;
  }

  const label = fromLabel || (fromAddress ? fromAddress.split(',')[0] : null);

  return (
    <div className="map-widget">
      {label && (
        <p className="map-widget-label">
          Walking from <strong>{label}</strong>
        </p>
      )}
      <div className="map-widget-frame">
        {embedFailed ? (
          // Static map fallback — clickable, opens Google Maps
          <a href={mapsLink} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
            <img
              src={staticMapUrl}
              alt={`Map of ${name}`}
              width="100%"
              height={height}
              style={{ borderRadius: 8, display: 'block', objectFit: 'cover', cursor: 'pointer' }}
            />
          </a>
        ) : (
          <iframe
            src={iframeSrc}
            width="100%"
            height={height}
            style={{ border: 0, borderRadius: 8, display: 'block' }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={fromAddress ? `Walking directions to ${name}` : name}
            onError={() => setEmbedFailed(true)}
          />
        )}
      </div>
      <a
        href={mapsLink}
        target="_blank"
        rel="noopener noreferrer"
        className="map-widget-open-link"
      >
        View in Google Maps →
      </a>
    </div>
  );
}
