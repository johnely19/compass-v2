'use client';

import { useState, useEffect } from 'react';

interface TravelMode {
  duration: string;
  distance: string;
}

interface TravelIntelData {
  fromLabel: string;
  toAddress: string;
  modes: {
    walking?: TravelMode;
    transit?: TravelMode;
    driving?: TravelMode;
  };
  best: 'walking' | 'transit' | 'driving';
  bestReason: string;
  _mock?: boolean;
}

interface TravelIntelWidgetProps {
  placeId: string;
  contextKey: string;
}

const MODE_ICONS: Record<string, string> = {
  walking: '🚶',
  transit: '🚇',
  driving: '🚗',
};

const MODE_LABELS: Record<string, string> = {
  walking: 'Walk',
  transit: 'Transit',
  driving: 'Drive',
};

export default function TravelIntelWidget({ placeId, contextKey }: TravelIntelWidgetProps) {
  const [data, setData] = useState<TravelIntelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/travel-intel?placeId=${encodeURIComponent(placeId)}&contextKey=${encodeURIComponent(contextKey)}`
        );
        if (!res.ok) { setLoading(false); return; }
        const d = await res.json();
        setData(d);
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    }
    load();
  }, [placeId, contextKey]);

  if (loading || !data) return null;

  const modes = Object.entries(data.modes) as Array<[string, TravelMode]>;
  if (modes.length === 0) return null;

  return (
    <div className="travel-intel-widget">
      <div className="travel-intel-from">
        <span className="travel-intel-label">From your base</span>
        <span className="travel-intel-from-name">{data.fromLabel}</span>
      </div>

      <div className="travel-intel-modes">
        {modes.map(([mode, info]) => (
          <div
            key={mode}
            className={`travel-intel-mode ${mode === data.best ? 'travel-intel-mode-best' : ''}`}
          >
            <span className="travel-intel-mode-icon">{MODE_ICONS[mode] || '🗺️'}</span>
            <div className="travel-intel-mode-info">
              <span className="travel-intel-mode-label">{MODE_LABELS[mode] || mode}</span>
              <span className="travel-intel-mode-duration">{info.duration}</span>
            </div>
            {mode === data.best && (
              <span className="travel-intel-best-badge">Best</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
