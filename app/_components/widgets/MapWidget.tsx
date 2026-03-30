'use client';

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
  const destination = placeId
    ? `place_id:${placeId}`
    : name;
  const destinationEncoded = encodeURIComponent(destination);

  // Direct link to Google Maps
  const mapsLink = fromAddress
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromAddress)}&destination=${destinationEncoded}&travelmode=walking`
    : placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;

  // Build iframe src — use Google Maps embed API (no key needed for basic embeds)
  let iframeSrc: string;
  if (lat && lng) {
    // Use view embed centered on coords at zoom 10
    iframeSrc = `https://www.google.com/maps/embed/v1/view?key=AIzaSyCp9YqbC3QoNS3DCG4FzNChAg&center=${lat},${lng}&zoom=10`;
  } else if (fromAddress) {
    // Directions embed with walking mode
    const origin = encodeURIComponent(fromAddress);
    const dest = placeId
      ? `place_id%3A${placeId}`
      : encodeURIComponent(name);
    iframeSrc = `https://www.google.com/maps/embed/v1/directions?key=AIzaSyCp9YqbC3QoNS3DCG4FzNChAg&origin=${origin}&destination=${dest}&mode=walking`;
  } else if (placeId) {
    // Use Maps Embed API with place_id (most reliable zoom)
    iframeSrc = `https://www.google.com/maps/embed/v1/place?key=AIzaSyCp9YqbC3QoNS3DCG4FzNChAg&q=place_id:${placeId}&zoom=16`;
  } else {
    // Name-based search embed
    iframeSrc = `https://www.google.com/maps/embed/v1/search?key=AIzaSyCp9YqbC3QoNS3DCG4FzNChAg&q=${encodeURIComponent(name)}`;
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
        <iframe
          src={iframeSrc}
          width="100%"
          height={height}
          style={{ border: 0, borderRadius: 8, display: 'block' }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={fromAddress ? `Walking directions to ${name}` : name}
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
