/**
 * Observation Significance Scoring
 *
 * Assigns an explainable significance level to each observation based on
 * the kinds of changes detected, their magnitude, and the monitoring context.
 *
 * Levels:
 *   critical  — requires attention now (closure, status change, major shift)
 *   notable   — worth surfacing soon (meaningful drift in rating, price, program)
 *   routine   — normal background change (small review count growth)
 *   noise     — no meaningful change detected
 *
 * Each scored observation gets:
 *   - a significance level
 *   - a numeric score (0–100) for sorting
 *   - a human-readable explanation of why it matters
 */

import type { MonitorChangeKind, MonitorObservation, ObservedState } from './monitor-inventory';

// ---- Public types ----

export type SignificanceLevel = 'critical' | 'notable' | 'routine' | 'noise';

export interface SignificanceResult {
  level: SignificanceLevel;
  score: number;
  reasons: string[];
  /** One-line summary suitable for UI badge text */
  summary: string;
}

// ---- Change weights ----

interface ChangeWeight {
  base: number;
  label: string;
  level: SignificanceLevel;
}

const CHANGE_WEIGHTS: Record<MonitorChangeKind, ChangeWeight> = {
  'closure-signal':       { base: 95, label: 'Closure detected', level: 'critical' },
  'operational-change':   { base: 80, label: 'Operational status changed', level: 'critical' },
  'price-changed':        { base: 55, label: 'Price level shifted', level: 'notable' },
  'rating-down':          { base: 60, label: 'Rating dropped', level: 'notable' },
  'rating-up':            { base: 45, label: 'Rating improved', level: 'notable' },
  'description-changed':  { base: 40, label: 'Description rewritten', level: 'notable' },
  'availability-changed': { base: 50, label: 'Availability changed', level: 'notable' },
  'construction-signal':  { base: 50, label: 'Construction progress', level: 'notable' },
  'sentiment-shift':      { base: 45, label: 'Review sentiment shifted', level: 'notable' },
  'hours-changed':        { base: 35, label: 'Hours updated', level: 'routine' },
  'review-count-up':      { base: 20, label: 'Review count growing', level: 'routine' },
  'review-count-down':    { base: 30, label: 'Reviews disappeared', level: 'routine' },
  'general-update':       { base: 15, label: 'General update', level: 'noise' },
};

// ---- Magnitude amplifiers ----

/**
 * Amplify score based on the magnitude of specific changes
 * between the previous and current observed states.
 */
function magnitudeAmplifier(
  change: MonitorChangeKind,
  prev: ObservedState | undefined,
  next: ObservedState,
): number {
  if (!prev) return 0;

  switch (change) {
    case 'rating-down': {
      if (prev.rating !== undefined && next.rating !== undefined) {
        const drop = prev.rating - next.rating;
        if (drop >= 0.5) return 20; // half-star drop is very significant
        if (drop >= 0.3) return 10;
      }
      return 0;
    }
    case 'rating-up': {
      if (prev.rating !== undefined && next.rating !== undefined) {
        const rise = next.rating - prev.rating;
        if (rise >= 0.5) return 15;
        if (rise >= 0.3) return 5;
      }
      return 0;
    }
    case 'review-count-up': {
      if (prev.reviewCount !== undefined && next.reviewCount !== undefined) {
        const growth = next.reviewCount - prev.reviewCount;
        if (growth >= 200) return 20; // viral-level growth
        if (growth >= 100) return 10;
      }
      return 0;
    }
    case 'closure-signal': {
      // Permanent closure is more significant than temporary
      if (next.operationalStatus === 'CLOSED_PERMANENTLY') return 10;
      return 0;
    }
    default:
      return 0;
  }
}

// ---- Context amplifiers ----

export interface SignificanceContext {
  /** Is this place on an active trip? */
  activeTripRelevant?: boolean;
  /** Monitor status: priority places amplify significance */
  monitorStatus?: string;
  /** Monitor type: helps weight type-specific changes */
  monitorType?: string;
}

function contextAmplifier(
  change: MonitorChangeKind,
  context: SignificanceContext,
): number {
  let amp = 0;

  // Active trip places: everything matters more
  if (context.activeTripRelevant) amp += 10;

  // Priority places get a slight boost
  if (context.monitorStatus === 'priority') amp += 5;

  // Type-specific relevance boosts
  if (context.monitorType === 'hospitality') {
    if (['closure-signal', 'hours-changed', 'price-changed'].includes(change)) amp += 10;
  }
  if (context.monitorType === 'stay') {
    if (['availability-changed', 'price-changed', 'closure-signal'].includes(change)) amp += 10;
  }
  if (context.monitorType === 'development') {
    if (['construction-signal', 'operational-change'].includes(change)) amp += 10;
  }
  if (context.monitorType === 'culture') {
    if (['description-changed', 'hours-changed'].includes(change)) amp += 5;
  }

  return amp;
}

// ---- Core scoring ----

/**
 * Score a single observation for significance.
 *
 * Takes the observation's detected changes and optionally the previous
 * observed state for magnitude analysis.
 */
export function scoreObservation(params: {
  observation: MonitorObservation;
  previousState?: ObservedState;
  context?: SignificanceContext;
}): SignificanceResult {
  const { observation, previousState, context = {} } = params;
  const { changes, state } = observation;

  if (!changes || changes.length === 0) {
    return {
      level: 'noise',
      score: 0,
      reasons: [],
      summary: 'No changes detected',
    };
  }

  let totalScore = 0;
  let highestLevel: SignificanceLevel = 'noise';
  const reasons: string[] = [];

  const levelRank: Record<SignificanceLevel, number> = {
    critical: 3,
    notable: 2,
    routine: 1,
    noise: 0,
  };

  for (const change of changes) {
    const weight = CHANGE_WEIGHTS[change];
    if (!weight) continue;

    let changeScore = weight.base;
    changeScore += magnitudeAmplifier(change, previousState, state);
    changeScore += contextAmplifier(change, context);

    totalScore = Math.max(totalScore, changeScore); // use peak, not sum
    reasons.push(weight.label);

    if (levelRank[weight.level] > levelRank[highestLevel]) {
      highestLevel = weight.level;
    }
  }

  // Multiple notable changes together can escalate to critical
  const notableCount = changes.filter(c => {
    const w = CHANGE_WEIGHTS[c];
    return w && w.level === 'notable';
  }).length;
  if (notableCount >= 3 && highestLevel === 'notable') {
    highestLevel = 'critical';
    totalScore = Math.max(totalScore, 75);
    reasons.push('Multiple significant changes at once');
  }

  // Cap at 100
  totalScore = Math.min(totalScore, 100);

  // Determine final level from score (override if score pushes higher)
  const scoreDerivedLevel = scoreToLevel(totalScore);
  if (levelRank[scoreDerivedLevel] > levelRank[highestLevel]) {
    highestLevel = scoreDerivedLevel;
  }

  return {
    level: highestLevel,
    score: totalScore,
    reasons,
    summary: buildSummary(highestLevel, reasons),
  };
}

function scoreToLevel(score: number): SignificanceLevel {
  if (score >= 75) return 'critical';
  if (score >= 40) return 'notable';
  if (score >= 15) return 'routine';
  return 'noise';
}

function buildSummary(level: SignificanceLevel, reasons: string[]): string {
  if (reasons.length === 0) return 'No changes detected';
  if (reasons.length === 1) return reasons[0] ?? 'Change detected';

  // Lead with the most impactful reason
  const primary = reasons[0] ?? 'Change detected';
  const more = reasons.length - 1;
  return `${primary} (+${more} more)`;
}

// ---- Batch scoring for an entry's full observation history ----

export interface EntrySignificanceSummary {
  /** Highest significance level across all observations */
  peakLevel: SignificanceLevel;
  /** Highest significance score across all observations */
  peakScore: number;
  /** Most recent observation's significance */
  latestLevel: SignificanceLevel;
  latestScore: number;
  latestSummary: string;
  /** Count of observations at each level */
  counts: Record<SignificanceLevel, number>;
  /** Whether any critical observation has occurred */
  hasCritical: boolean;
  /** Whether the most recent observation was significant (notable+) */
  recentlySignificant: boolean;
}

/**
 * Summarize significance across an entry's observation history.
 * Useful for sorting/filtering in the watching UI.
 */
export function summarizeEntrySignificance(params: {
  observations: MonitorObservation[];
  baselineState?: ObservedState;
  context?: SignificanceContext;
}): EntrySignificanceSummary {
  const { observations, baselineState, context } = params;

  const counts: Record<SignificanceLevel, number> = {
    critical: 0,
    notable: 0,
    routine: 0,
    noise: 0,
  };

  let peakLevel: SignificanceLevel = 'noise';
  let peakScore = 0;
  let latestLevel: SignificanceLevel = 'noise';
  let latestScore = 0;
  let latestSummary = 'No observations yet';

  const levelRank: Record<SignificanceLevel, number> = {
    critical: 3,
    notable: 2,
    routine: 1,
    noise: 0,
  };

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    // Previous state is the next observation's state (observations are newest-first)
    // or the baseline for the oldest observation
    const nextObs = i < observations.length - 1 ? observations[i + 1] : undefined;
    const prevState = nextObs?.state ?? baselineState;

    const obsForScoring = obs as MonitorObservation;
    const result = scoreObservation({
      observation: obsForScoring,
      previousState: prevState,
      context,
    });

    counts[result.level]++;

    if (result.score > peakScore) {
      peakScore = result.score;
      peakLevel = result.level;
    }

    // Latest = index 0 (newest first)
    if (i === 0) {
      latestLevel = result.level;
      latestScore = result.score;
      latestSummary = result.summary;
    }
  }

  return {
    peakLevel,
    peakScore,
    latestLevel,
    latestScore,
    latestSummary,
    counts,
    hasCritical: counts.critical > 0,
    recentlySignificant: levelRank[latestLevel] >= levelRank['notable'],
  };
}
