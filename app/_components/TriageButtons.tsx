'use client';

import { useTriage } from '../_lib/useTriage';

interface TriageButtonsProps {
  userId: string;
  contextKey: string;
  placeId: string;
  size?: 'sm' | 'md';
}

export default function TriageButtons({
  userId,
  contextKey,
  placeId,
  size = 'sm',
}: TriageButtonsProps) {
  const { isSaved, isDismissed, save, dismiss } = useTriage(
    userId,
    contextKey,
    placeId,
  );

  return (
    <div className={`triage-buttons triage-buttons-${size}`}>
      <button
        className={`triage-btn triage-save ${isSaved ? 'triage-active' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); save(); }}
        aria-label="Save"
        title={isSaved ? 'Un-save' : 'Save'}
      >
        +
      </button>
      <button
        className={`triage-btn triage-dismiss ${isDismissed ? 'triage-active' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss"
        title={isDismissed ? 'Restore' : 'Dismiss'}
      >
        −
      </button>
    </div>
  );
}
