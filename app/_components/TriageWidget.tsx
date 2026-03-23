'use client';

import { useTriage } from '../_lib/useTriage';

interface TriageWidgetProps {
  userId: string;
  contextKey: string;
  contextLabel: string;
  placeId: string;
}

export default function TriageWidget({
  userId,
  contextKey,
  contextLabel,
  placeId,
}: TriageWidgetProps) {
  const { state, isSaved, isDismissed, save, dismiss } = useTriage(
    userId,
    contextKey,
    placeId,
  );

  return (
    <div className="triage-widget">
      <div className="triage-widget-context">
        <span className="text-xs text-muted">Reviewing for:</span>
        <span className="text-sm">{contextLabel}</span>
      </div>
      <div className="triage-widget-actions">
        <button
          className={`triage-widget-btn triage-widget-save ${isSaved ? 'triage-active' : ''}`}
          onClick={save}
        >
          {isSaved ? '✓ Saved' : '+ Save'}
        </button>
        <button
          className={`triage-widget-btn triage-widget-dismiss ${isDismissed ? 'triage-active' : ''}`}
          onClick={dismiss}
        >
          {isDismissed ? '✗ Dismissed' : '− Dismiss'}
        </button>
      </div>
      {state === 'resurfaced' && (
        <p className="triage-resurface-note text-xs text-muted">
          This place was resurfaced for re-review
        </p>
      )}
    </div>
  );
}
