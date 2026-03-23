'use client';

import { useState, useEffect } from 'react';

interface BriefingHighlight {
  label: string;
  count?: number;
  contextKey?: string;
  emoji?: string;
}

interface Briefing {
  title: string;
  summary: string;
  highlights: BriefingHighlight[];
  deliveredAt: string;
}

interface BriefingBannerProps {
  userId: string;
}

export default function BriefingBanner({ userId }: BriefingBannerProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedKey = `compass-briefing-dismissed-${userId}`;
    const dismissedDate = localStorage.getItem(dismissedKey);
    const today = new Date().toISOString().slice(0, 10);
    if (dismissedDate === today) {
      setDismissed(true);
      return;
    }

    fetch(`/api/briefing-ingest?userId=${userId}`)
      .then((res) => res.json())
      .then((data: { briefing: Briefing | null }) => {
        if (data.briefing) {
          setBriefing(data.briefing);
        }
      })
      .catch(() => {
        // Silently fail — briefing is optional
      });
  }, [userId]);

  if (!briefing || dismissed) return null;

  const handleDismiss = () => {
    const dismissedKey = `compass-briefing-dismissed-${userId}`;
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(dismissedKey, today);
    setDismissed(true);
  };

  return (
    <div className="briefing-banner">
      <div className="briefing-banner-content">
        <div className="briefing-banner-header">
          <span className="briefing-banner-icon">☀️</span>
          <h3 className="briefing-banner-title">{briefing.title}</h3>
          <button
            className="briefing-banner-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss briefing"
          >
            ✕
          </button>
        </div>
        <p className="briefing-banner-summary">{briefing.summary}</p>
        {briefing.highlights.length > 0 && (
          <div className="briefing-banner-highlights">
            {briefing.highlights.map((h, i) => (
              <span key={i} className="briefing-highlight-chip">
                {h.emoji && <span>{h.emoji} </span>}
                {h.count != null ? `${h.count} ` : ''}
                {h.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
