interface RatingWidgetProps {
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
}

const PRICE_LABELS: Record<number, string> = {
  1: '$',
  2: '$$',
  3: '$$$',
  4: '$$$$',
};

function Stars({ rating }: { rating: number }) {
  // Render 5 stars with filled/half/empty using SVG-free approach
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const fill = rating >= i ? 'full' : rating >= i - 0.5 ? 'half' : 'empty';
    stars.push(
      <span key={i} className={`rw-star rw-star-${fill}`}>
        {fill === 'half' ? '★' : '★'}
      </span>
    );
  }
  return <span className="rw-stars">{stars}</span>;
}

export default function RatingWidget({ rating, reviewCount, priceLevel }: RatingWidgetProps) {
  const hasRating = rating !== undefined && rating !== null && rating > 0;
  const hasPrice = priceLevel !== undefined && priceLevel !== null && priceLevel > 0;

  if (!hasRating && !hasPrice) return null;

  return (
    <div className="rw-bar">
      {hasRating && (
        <div className="rw-rating">
          <Stars rating={rating!} />
          <span className="rw-score">{rating!.toFixed(1)}</span>
          {reviewCount !== undefined && reviewCount > 0 && (
            <span className="rw-count">({reviewCount.toLocaleString()})</span>
          )}
        </div>
      )}
      {hasRating && hasPrice && (
        <span className="rw-divider">·</span>
      )}
      {hasPrice && (
        <span className="rw-price" title={['', 'Inexpensive', 'Moderate', 'Expensive', 'Very Expensive'][priceLevel!]}>
          {PRICE_LABELS[priceLevel!]}
        </span>
      )}
    </div>
  );
}
