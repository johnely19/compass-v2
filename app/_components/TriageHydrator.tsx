'use client';

import { useEffect } from 'react';
import { hydrateFromServer } from '../_lib/triage';

/**
 * Hydrates triage state from Blob → localStorage on every page load.
 * Renders nothing — just runs the side effect once per mount.
 * Placed in root layout so it fires on ALL pages, not just Home.
 */
export default function TriageHydrator({ userId }: { userId: string }) {
  useEffect(() => {
    hydrateFromServer(userId).then(() => {
      // Signal all listening components to re-render with fresh triage data
      window.dispatchEvent(new CustomEvent('triage-changed', { detail: { userId } }));
    }).catch(() => {/* network errors are non-fatal */});
  }, [userId]);

  return null;
}
