interface AmenitiesWidgetProps {
  amenities?: string[];
}

export default function AmenitiesWidget({ amenities }: AmenitiesWidgetProps) {
  if (!amenities || amenities.length === 0) return null;

  return (
    <div className="widget">
      <h3 className="widget-title">Amenities</h3>
      <div className="amenities-chips">
        {amenities.map((amenity, i) => (
          <span key={i} className="amenity-chip">{amenity}</span>
        ))}
      </div>
    </div>
  );
}
