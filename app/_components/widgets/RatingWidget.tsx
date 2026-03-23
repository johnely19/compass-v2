interface RatingWidgetProps {
  rating?: number;
  reviewCount?: number;
}

export default function RatingWidget({ rating, reviewCount }: RatingWidgetProps) {
  if (rating === undefined || rating === null) return null;

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return (
    <div className="widget">
      <h3 className="widget-title">Rating</h3>
      <div className="rating-display">
        <div className="rating-stars">
          {[...Array(fullStars)].map((_, i) => (
            <span key={`full-${i}`} className="star-filled">★</span>
          ))}
          {hasHalfStar && <span className="star-half">★</span>}
          {[...Array(emptyStars)].map((_, i) => (
            <span key={`empty-${i}`} className="star-empty">★</span>
          ))}
        </div>
        <span className="rating-value">{rating.toFixed(1)}</span>
        {reviewCount !== undefined && (
          <span className="rating-count">({reviewCount} reviews)</span>
        )}
      </div>
    </div>
  );
}
