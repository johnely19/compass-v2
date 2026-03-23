'use client';

import type { PlaceCard, DiscoveryType } from '../_lib/types';
import { getTypeMeta } from '../_lib/discovery-types';
import TriageWidget from './TriageWidget';
import RatingWidget from './widgets/RatingWidget';
import HoursWidget from './widgets/HoursWidget';
import MapWidget from './widgets/MapWidget';
import PhotoGallery from './widgets/PhotoGallery';
import MenuWidget from './widgets/MenuWidget';
import PricingWidget from './widgets/PricingWidget';
import AmenitiesWidget from './widgets/AmenitiesWidget';
import ExhibitionWidget from './widgets/ExhibitionWidget';
import StatusWidget from './widgets/StatusWidget';
import KeyDatesWidget from './widgets/KeyDatesWidget';

interface PlaceCardDetailProps {
  card: PlaceCard;
  userId?: string;
  contextKey?: string;
}

const TYPE_WIDGETS: Record<DiscoveryType, string[]> = {
  restaurant: ['RatingWidget', 'MenuWidget', 'HoursWidget', 'MapWidget', 'PhotoGallery'],
  bar: ['RatingWidget', 'MenuWidget', 'HoursWidget', 'MapWidget', 'PhotoGallery'],
  cafe: ['RatingWidget', 'HoursWidget', 'MapWidget'],
  gallery: ['ExhibitionWidget', 'HoursWidget', 'MapWidget', 'PhotoGallery'],
  museum: ['ExhibitionWidget', 'HoursWidget', 'MapWidget'],
  accommodation: ['AmenitiesWidget', 'PricingWidget', 'MapWidget', 'PhotoGallery'],
  hotel: ['RatingWidget', 'AmenitiesWidget', 'MapWidget'],
  grocery: ['RatingWidget', 'HoursWidget', 'MapWidget'],
  theatre: ['RatingWidget', 'HoursWidget', 'MapWidget'],
  'music-venue': ['RatingWidget', 'HoursWidget', 'MapWidget'],
  experience: ['RatingWidget', 'HoursWidget', 'MapWidget'],
  shop: ['RatingWidget', 'HoursWidget', 'MapWidget'],
  park: ['RatingWidget', 'MapWidget'],
  architecture: ['RatingWidget', 'MapWidget'],
  development: ['RatingWidget', 'MapWidget'],
  neighbourhood: ['MapWidget'],
};

const DEFAULT_WIDGETS = ['RatingWidget', 'HoursWidget', 'MapWidget'];

export default function PlaceCardDetail({ card, userId, contextKey }: PlaceCardDetailProps) {
  const typeMeta = getTypeMeta(card.type);
  const widgets = TYPE_WIDGETS[card.type] || DEFAULT_WIDGETS;

  const heroImage = card.data.images?.[0]?.path;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.name)}`;

  const renderWidget = (widgetName: string) => {
    switch (widgetName) {
      case 'RatingWidget':
        return (
          <RatingWidget
            key="rating"
            rating={card.data.rating as number | undefined}
            reviewCount={card.data.reviewCount as number | undefined}
          />
        );
      case 'HoursWidget':
        return card.data.hours ? (
          <HoursWidget key="hours" hours={card.data.hours} />
        ) : null;
      case 'MapWidget':
        return <MapWidget key="map" placeId={card.place_id} name={card.name} />;
      case 'PhotoGallery':
        return card.data.images && card.data.images.length > 0 ? (
          <PhotoGallery key="photos" images={card.data.images} />
        ) : null;
      case 'MenuWidget':
        return card.data.menu ? (
          <MenuWidget key="menu" menu={card.data.menu as any} />
        ) : null;
      case 'PricingWidget':
        return card.data.pricing ? (
          <PricingWidget key="pricing" pricing={card.data.pricing as any} />
        ) : null;
      case 'AmenitiesWidget':
        return card.data.amenities ? (
          <AmenitiesWidget key="amenities" amenities={card.data.amenities as any} />
        ) : null;
      case 'ExhibitionWidget':
        return card.data.exhibitions ? (
          <ExhibitionWidget key="exhibitions" exhibitions={card.data.exhibitions as any} />
        ) : null;
      case 'StatusWidget':
        return card.data.status ? (
          <StatusWidget key="status" status={card.data.status as string} />
        ) : null;
      case 'KeyDatesWidget':
        return card.data.dates ? (
          <KeyDatesWidget key="dates" dates={card.data.dates as any} />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="place-detail">
      {/* Hero Image */}
      <div
        className="place-detail-hero"
        style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}
      >
        {!heroImage && <div className="place-detail-hero-fallback" />}
      </div>

      {/* Header */}
      <div className="place-detail-header">
        <div className="place-detail-title-row">
          <h1 className="place-detail-name">{card.name}</h1>
          <span
            className="type-badge type-badge-md"
            style={{ '--type-color': typeMeta.color } as React.CSSProperties}
          >
            <span className="type-badge-icon">{typeMeta.icon}</span>
            {typeMeta.label}
          </span>
        </div>

        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary place-detail-maps-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Open in Google Maps
        </a>
      </div>

      {/* Description */}
      {card.data.description && (
        <div className="place-detail-description">
          <p>{card.data.description}</p>
        </div>
      )}

      {/* Highlights */}
      {card.data.highlights && card.data.highlights.length > 0 && (
        <div className="place-detail-highlights">
          <h3>Highlights</h3>
          <ul>
            {card.data.highlights.map((highlight, i) => (
              <li key={i}>{highlight}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Widgets */}
      <div className="place-detail-widgets">
        {widgets.map(renderWidget)}
      </div>

      {/* Triage Widget */}
      {userId && contextKey && (
        <div className="place-detail-triage">
          <TriageWidget
            userId={userId}
            contextKey={contextKey}
            contextLabel={contextKey}
            placeId={card.place_id}
          />
        </div>
      )}
    </div>
  );
}
