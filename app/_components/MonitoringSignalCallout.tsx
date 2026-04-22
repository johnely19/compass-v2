'use client';

import { getHotSignalLabel, type HotCardSignal, CHANGE_LABELS } from '../_lib/hot-intelligence';

interface MonitoringSignalCalloutProps {
  signal?: HotCardSignal;
}

function formatObservedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export default function MonitoringSignalCallout({ signal }: MonitoringSignalCalloutProps) {
  if (!signal?.significanceLevel) return null;

  const label = getHotSignalLabel(signal);
  const observedAt = formatObservedAt(signal.lastObservedAt);
  const changeLabels = (signal.detectedChanges ?? [])
    .slice(0, 3)
    .map((change) => CHANGE_LABELS[change] ?? 'Fresh signal');

  return (
    <section className="monitoring-signal-callout">
      <div className="monitoring-signal-callout-header">
        <span className="monitoring-note-kicker">Recent signal</span>
        <span className={`hot-place-card-signal hot-place-card-signal-${signal.significanceLevel}`}>
          {label}
        </span>
      </div>
      {signal.significanceSummary && (
        <p className="monitoring-note-body">{signal.significanceSummary}</p>
      )}
      {(observedAt || changeLabels.length > 0) && (
        <p className="monitoring-signal-callout-meta">
          {observedAt ? <span>Observed {observedAt}</span> : null}
          {observedAt && changeLabels.length > 0 ? <span>·</span> : null}
          {changeLabels.length > 0 ? <span>{changeLabels.join(' · ')}</span> : null}
        </p>
      )}
    </section>
  );
}
