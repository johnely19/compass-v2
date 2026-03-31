'use client';

import type { Discovery } from '../_lib/types';

interface ProvenanceProps {
  source: string;
  discoveredAt: string;
  sourceUrl?: string;
  sourceName?: string;
  theme?: string;
  verified?: boolean;
  rating?: number;
  ratingCount?: number;
  description?: string;
  contextKey?: string;
}

/** Map source strings to display names */
function getSourceDisplayName(source: string, sourceName?: string): string {
  if (sourceName) return sourceName;

  // Known source mappings
  const sourceMap: Record<string, string> = {
    'disco:evening': 'Disco',
    'disco:hourly': 'Disco',
    'disco:cottage-scan': 'Disco',
    'disco:development-scan': 'Disco',
    'chat:recommendation': 'Chat recommendation',
  };

  if (sourceMap[source]) return sourceMap[source];

  // Default: capitalize the source string
  return source.replace(/^disco:/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Format a date nicely */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

/** Build the "why" explanation text */
function buildWhyText(props: ProvenanceProps): string {
  const { description, source, discoveredAt, theme, sourceName } = props;

  if (description) {
    // Trim description to roughly 2-3 sentences (200 chars)
    const trimmed = description.length > 200
      ? description.slice(0, 200).split(' ').slice(0, -1).join(' ') + '...'
      : description;
    return trimmed;
  }

  // Construct the explanation
  const sourceDisplay = getSourceDisplayName(source, sourceName);
  const dateStr = formatDate(discoveredAt);
  let text = `Discovered via ${sourceDisplay} on ${dateStr}`;

  if (theme) {
    text += ` — ${theme}.`;
  } else {
    text += '.';
  }

  return text;
}

export default function ProvenanceSection(props: ProvenanceProps) {
  const {
    source,
    discoveredAt,
    sourceUrl,
    sourceName,
    theme,
    verified,
    rating,
    ratingCount,
    description,
    contextKey,
  } = props;

  const sourceDisplay = getSourceDisplayName(source, sourceName);
  const whyText = buildWhyText(props);
  const formattedDate = formatDate(discoveredAt);

  return (
    <div className="provenance-section">
      <h3 className="provenance-title">🔍 Why this place?</h3>

      <p className="provenance-why">{whyText}</p>

      <div className="provenance-meta">
        <span className="provenance-date">Found {formattedDate}</span>
        {verified && <span className="provenance-verified"> · ✅ Verified via Google Places</span>}
        {rating && (
          <span className="provenance-rating">
            {' · ⭐ '}{rating.toFixed(1)}
            {ratingCount && ` (${ratingCount.toLocaleString()})`}
          </span>
        )}
      </div>

      <div className="provenance-sources">
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="provenance-source-pill"
          >
            {sourceDisplay} ↗
          </a>
        ) : (
          <span className="provenance-source-pill provenance-source-text">
            {sourceDisplay}
          </span>
        )}
        {verified && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contextKey || '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="provenance-source-pill"
          >
            Google Places ↗
          </a>
        )}
      </div>
    </div>
  );
}
