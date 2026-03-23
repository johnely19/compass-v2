'use client';

/* ============================================================
   Compass v2 — useTriage Hook
   React wrapper for the triage system
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import type { TriageState } from './types';
import {
  getTriageState,
  toggleTriage,
  getContextCounts,
} from './triage';

interface UseTriageResult {
  state: TriageState | 'unreviewed';
  isSaved: boolean;
  isDismissed: boolean;
  isUnreviewed: boolean;
  save: () => void;
  dismiss: () => void;
}

export function useTriage(
  userId: string | undefined,
  contextKey: string,
  placeId: string,
): UseTriageResult {
  const [state, setState] = useState<TriageState | 'unreviewed'>('unreviewed');

  const refresh = useCallback(() => {
    if (!userId) return;
    setState(getTriageState(userId, contextKey, placeId));
  }, [userId, contextKey, placeId]);

  useEffect(() => {
    refresh();

    const handler = () => refresh();
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, [refresh]);

  const save = useCallback(() => {
    if (!userId) return;
    toggleTriage(userId, contextKey, placeId, 'save');
    refresh();
  }, [userId, contextKey, placeId, refresh]);

  const dismiss = useCallback(() => {
    if (!userId) return;
    toggleTriage(userId, contextKey, placeId, 'dismiss');
    refresh();
  }, [userId, contextKey, placeId, refresh]);

  return {
    state,
    isSaved: state === 'saved',
    isDismissed: state === 'dismissed',
    isUnreviewed: state === 'unreviewed' || state === 'resurfaced',
    save,
    dismiss,
  };
}

interface UseTriageCountsResult {
  saved: number;
  dismissed: number;
  resurfaced: number;
}

export function useTriageCounts(
  userId: string | undefined,
  contextKey: string,
): UseTriageCountsResult {
  const [counts, setCounts] = useState({ saved: 0, dismissed: 0, resurfaced: 0 });

  const refresh = useCallback(() => {
    if (!userId) return;
    setCounts(getContextCounts(userId, contextKey));
  }, [userId, contextKey]);

  useEffect(() => {
    refresh();

    const handler = () => refresh();
    window.addEventListener('triage-changed', handler);
    return () => window.removeEventListener('triage-changed', handler);
  }, [refresh]);

  return counts;
}
