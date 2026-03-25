'use client';

interface MapWidgetProps {
  placeId?: string;
  name: string;
  /** If provided, shows directions FROM this address */
  fromAddress?: string;
  /** Label for the from address (e.g. "Arnold's") */
  fromLabel?: string;
}

export default function MapWidget({ placeId, name, fromAddress, fromLabel }: MapWidgetProps) {
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

  // Iframe src — no API key needed for this basic embed format
  // directions mode: /maps/embed?pb=... is complex; use the public /maps/dir embed
  // Best no-key approach: use the standard Google Maps iframe share link
  let iframeSrc: string;
  if (fromAddress) {
    iframeSrc = `https://maps.google.com/maps?saddr=${encodeURIComponent(fromAddress)}&daddr=${encodeURIComponent(placeId ? name : name)}&dirflg=w&output=embed`;
  } else {
    iframeSrc = placeId
      ? `https://maps.google.com/maps?q=place_id:${placeId}&output=embed`
      : `https://maps.google.com/maps?q=${encodeURIComponent(name)}&output=embed`;
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
          height="280"
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
