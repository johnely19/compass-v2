'use client';

interface MapWidgetProps {
  placeId?: string;
  name: string;
  /** If provided, shows directions FROM this address */
  fromAddress?: string;
}

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

export default function MapWidget({ placeId, name, fromAddress }: MapWidgetProps) {
  // Destination: prefer place_id, fall back to name search
  const destination = placeId ? `place_id:${placeId}` : name;
  const destinationEncoded = encodeURIComponent(destination);

  // Build embed URL
  let embedUrl: string;
  if (fromAddress) {
    // Directions embed: origin → destination
    const originEncoded = encodeURIComponent(fromAddress);
    embedUrl = `https://www.google.com/maps/embed/v1/directions?key=${MAPS_API_KEY}&origin=${originEncoded}&destination=${destinationEncoded}&mode=walking`;
  } else if (placeId) {
    // Place embed
    embedUrl = `https://www.google.com/maps/embed/v1/place?key=${MAPS_API_KEY}&q=${destinationEncoded}`;
  } else {
    // Search embed
    embedUrl = `https://www.google.com/maps/embed/v1/search?key=${MAPS_API_KEY}&q=${destinationEncoded}`;
  }

  // Fallback link for "open in maps"
  const mapsLink = fromAddress
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromAddress)}&destination=${destinationEncoded}`
    : placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

  if (!MAPS_API_KEY) {
    // No API key — just show a link
    return (
      <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="place-detail-v2-identity-row">
        <span className="place-detail-v2-identity-icon">📍</span>
        <span>Open in Maps</span>
        <span className="place-detail-v2-identity-link">↗</span>
      </a>
    );
  }

  return (
    <div className="map-widget">
      {fromAddress && (
        <p className="map-widget-label">
          From <strong>{fromAddress.split(',')[0]}</strong>
        </p>
      )}
      <div className="map-widget-frame">
        <iframe
          src={embedUrl}
          width="100%"
          height="260"
          style={{ border: 0, borderRadius: 8 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={fromAddress ? `Directions to ${name}` : name}
        />
      </div>
      <a
        href={mapsLink}
        target="_blank"
        rel="noopener noreferrer"
        className="map-widget-open-link"
      >
        Open in Google Maps ↗
      </a>
    </div>
  );
}
