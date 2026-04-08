/**
 * Monitor Inventory
 *
 * Durable persistence layer for places promoted into monitoring.
 * Stored in Vercel Blob at: users/{userId}/monitor-inventory.json
 *
 * A MonitorEntry captures:
 * - the promoted place and its reasons
 * - the observed state at promotion time
 * - a time-series of observations for change detection
 *
 * This is the foundation for issue #260: durable monitoring with change detection.
 */

import { list, put } from '@vercel/blob';
import type { MonitorDimension, MonitorReason, MonitorStatus } from './types';
import { scoreObservation, summarizeEntrySignificance } from './observation-significance';
import type { SignificanceLevel, SignificanceContext, EntrySignificanceSummary } from './observation-significance';

const BLOB_PREFIX = 'users';

// ---- Types ----

export type MonitorChangeKind =
  | 'rating-up'
  | 'rating-down'
  | 'review-count-up'
  | 'review-count-down'
  | 'sentiment-shift'
  | 'hours-changed'
  | 'description-changed'
  | 'operational-change'
  | 'construction-signal'
  | 'closure-signal'
  | 'price-changed'
  | 'availability-changed'
  | 'general-update';

export interface ObservedState {
  /** ISO timestamp when this snapshot was taken */
  observedAt: string;
  /** Source of observation: 'google-places' | 'web-search' | 'manual' */
  source: string;
  rating?: number;
  reviewCount?: number;
  description?: string;
  /** Operational status: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' */
  operationalStatus?: string;
  businessStatus?: string;
  priceLevel?: number;
  /** Freeform notes from a manual check-in or web search */
  notes?: string;
}

export interface MonitorObservation {
  /** ISO timestamp of this observation run */
  observedAt: string;
  source: string;
  /** Detected changes relative to previous observation */
  changes: MonitorChangeKind[];
  /** Human-readable summary of changes */
  changeSummary?: string;
  /** Significance level: critical / notable / routine / noise */
  significanceLevel?: SignificanceLevel;
  /** Numeric significance score (0–100) for sorting */
  significanceScore?: number;
  /** One-line explanation of why this observation matters */
  significanceSummary?: string;
  /** New snapshot taken during this observation */
  state: ObservedState;
}

export interface MonitorEntry {
  /** Stable identifier: place_id when available, else discovery id */
  id: string;
  place_id?: string;
  discoveryId: string;
  name: string;
  city: string;
  address?: string;
  type: string;
  contextKey: string;
  /** Monitoring classification */
  monitorStatus: Exclude<MonitorStatus, 'none'>;
  monitorType: string;
  monitorReasons: MonitorReason[];
  monitorDimensions: MonitorDimension[];
  /** When this place was first promoted into the inventory */
  firstPromotedAt: string;
  /** When status was last updated (promotion or status change) */
  lastUpdatedAt: string;
  /** Most recent observation timestamp */
  lastObservedAt?: string;
  /** When the next check is due (computed from cadence) */
  nextCheckAt?: string;
  /** Baseline state snapshot taken at promotion time */
  baselineState?: ObservedState;
  /** Latest observed state */
  currentState?: ObservedState;
  /** Time-series of observations (newest first, capped at 20) */
  observations: MonitorObservation[];
  /** Summary of all detected changes across all observations */
  detectedChangeKinds: MonitorChangeKind[];
  /** Peak significance level across all observations */
  peakSignificanceLevel?: SignificanceLevel;
  /** Peak significance score across all observations */
  peakSignificanceScore?: number;
  /** Latest observation significance summary */
  latestSignificanceSummary?: string;
  /** Whether any critical observation has occurred */
  hasCriticalChange?: boolean;
}

export interface MonitorInventory {
  entries: MonitorEntry[];
  updatedAt: string;
}

// ---- Blob helpers ----

function inventoryPath(userId: string): string {
  return `${BLOB_PREFIX}/${userId}/monitor-inventory.json`;
}

export async function loadMonitorInventory(userId: string): Promise<MonitorInventory> {
  try {
    const { blobs } = await list({ prefix: inventoryPath(userId), limit: 1 });
    const blob = blobs[0];
    if (!blob) return { entries: [], updatedAt: '' };
    const res = await fetch(blob.url, { cache: 'no-store' });
    if (!res.ok) return { entries: [], updatedAt: '' };
    const data = await res.json() as Partial<MonitorInventory>;
    return { entries: data.entries ?? [], updatedAt: data.updatedAt ?? '' };
  } catch {
    return { entries: [], updatedAt: '' };
  }
}

export async function saveMonitorInventory(
  userId: string,
  inventory: MonitorInventory,
): Promise<void> {
  await put(inventoryPath(userId), JSON.stringify(inventory, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

// ---- Core operations ----

const MAX_OBSERVATIONS_PER_ENTRY = 20;

/**
 * Promote a place into the durable monitor inventory.
 * If the entry already exists, updates its status and reasons (idempotent).
 */
export async function promoteToInventory(params: {
  userId: string;
  entry: Omit<MonitorEntry, 'firstPromotedAt' | 'lastUpdatedAt' | 'observations' | 'detectedChangeKinds'> & {
    firstPromotedAt?: string;
    baselineState?: ObservedState;
  };
}): Promise<MonitorEntry> {
  const { userId, entry } = params;
  const inventory = await loadMonitorInventory(userId);
  const now = new Date().toISOString();

  const existing = inventory.entries.find(e =>
    (entry.place_id && e.place_id === entry.place_id) ||
    e.discoveryId === entry.discoveryId,
  );

  if (existing) {
    // Update status and reasons; preserve history
    existing.monitorStatus = entry.monitorStatus;
    existing.monitorReasons = entry.monitorReasons;
    existing.monitorDimensions = entry.monitorDimensions;
    existing.lastUpdatedAt = now;
    if (entry.baselineState && !existing.baselineState) {
      existing.baselineState = entry.baselineState;
    }
    inventory.updatedAt = now;
    await saveMonitorInventory(userId, inventory);
    return existing;
  }

  const newEntry: MonitorEntry = {
    ...entry,
    firstPromotedAt: entry.firstPromotedAt ?? now,
    lastUpdatedAt: now,
    observations: [],
    detectedChangeKinds: [],
  };

  inventory.entries.push(newEntry);
  inventory.updatedAt = now;
  await saveMonitorInventory(userId, inventory);
  return newEntry;
}

/**
 * Record a new observation for a monitored place.
 * Detects changes by comparing to the most recent state, updates currentState.
 */
export async function recordObservation(params: {
  userId: string;
  entryId: string;
  observation: Omit<MonitorObservation, 'changes'> & { changes?: MonitorChangeKind[] };
  nextCheckAt?: string;
}): Promise<MonitorEntry | null> {
  const { userId, entryId, observation, nextCheckAt } = params;
  const inventory = await loadMonitorInventory(userId);

  const entry = inventory.entries.find(e => e.id === entryId || e.discoveryId === entryId);
  if (!entry) return null;

  const now = new Date().toISOString();

  // Detect changes between current and new state
  const changes: MonitorChangeKind[] = observation.changes ?? detectChanges(entry.currentState, observation.state);

  // Score significance before building the full observation
  const sigContext: SignificanceContext = {
    monitorStatus: entry.monitorStatus,
    monitorType: entry.monitorType,
  };
  const significance = scoreObservation({
    observation: { ...observation, changes, state: observation.state, observedAt: observation.observedAt, source: observation.source },
    previousState: entry.currentState,
    context: sigContext,
  });

  const fullObservation: MonitorObservation = {
    ...observation,
    changes,
    significanceLevel: significance.level,
    significanceScore: significance.score,
    significanceSummary: significance.summary,
  };

  // Prepend (newest first), cap at limit
  entry.observations = [fullObservation, ...entry.observations].slice(0, MAX_OBSERVATIONS_PER_ENTRY);
  entry.currentState = observation.state;
  entry.lastObservedAt = observation.observedAt;
  entry.lastUpdatedAt = now;

  // Accumulate unique detected change kinds
  const allChanges = new Set([...entry.detectedChangeKinds, ...changes]);
  entry.detectedChangeKinds = Array.from(allChanges);

  // Recompute entry-level significance summary
  const entrySig = summarizeEntrySignificance({
    observations: entry.observations,
    baselineState: entry.baselineState,
    context: sigContext,
  });
  entry.peakSignificanceLevel = entrySig.peakLevel;
  entry.peakSignificanceScore = entrySig.peakScore;
  entry.latestSignificanceSummary = entrySig.latestSummary;
  entry.hasCriticalChange = entrySig.hasCritical;

  // Optionally set next check time
  if (nextCheckAt) {
    entry.nextCheckAt = nextCheckAt;
  }

  inventory.updatedAt = now;
  await saveMonitorInventory(userId, inventory);
  return entry;
}

/**
 * Detect meaningful changes between two observed states.
 */
function detectChanges(
  prev: ObservedState | undefined,
  next: ObservedState,
): MonitorChangeKind[] {
  if (!prev) return [];
  const changes: MonitorChangeKind[] = [];

  // Rating shift
  if (prev.rating !== undefined && next.rating !== undefined) {
    const delta = next.rating - prev.rating;
    if (delta >= 0.2) changes.push('rating-up');
    else if (delta <= -0.2) changes.push('rating-down');
  }

  // Review count
  if (prev.reviewCount !== undefined && next.reviewCount !== undefined) {
    const delta = next.reviewCount - prev.reviewCount;
    if (delta >= 50) changes.push('review-count-up');
    else if (delta <= -10) changes.push('review-count-down');
  }

  // Operational status
  if (prev.operationalStatus && next.operationalStatus && prev.operationalStatus !== next.operationalStatus) {
    const closureSignals = ['CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'];
    if (closureSignals.includes(next.operationalStatus)) {
      changes.push('closure-signal');
    } else {
      changes.push('operational-change');
    }
  }

  // Price level
  if (prev.priceLevel !== undefined && next.priceLevel !== undefined && prev.priceLevel !== next.priceLevel) {
    changes.push('price-changed');
  }

  // Description changed (significant rewrite)
  if (prev.description && next.description && prev.description !== next.description) {
    const prevLen = prev.description.length;
    const nextLen = next.description.length;
    if (Math.abs(nextLen - prevLen) > 50 || !next.description.includes(prev.description.slice(0, 30))) {
      changes.push('description-changed');
    }
  }

  return changes;
}

/**
 * Bulk-promote annotated discoveries into the inventory.
 * Only promotes places with monitorStatus 'active' or 'priority'.
 * Safe to call on every homepage render — idempotent for existing entries.
 * Uses a fire-and-forget write with a 10s timeout to avoid blocking renders.
 */
export function bulkPromoteFromAnnotated(
  userId: string,
  discoveries: Array<{
    id: string;
    place_id?: string;
    name: string;
    city: string;
    address?: string;
    type: string;
    contextKey: string;
    monitorStatus?: string;
    monitorType?: string;
    monitorReasons?: MonitorReason[];
    monitorDimensions?: MonitorDimension[];
    rating?: number;
    discoveredAt?: string;
  }>,
): void {
  const candidates = discoveries.filter(
    d => d.monitorStatus === 'active' || d.monitorStatus === 'priority',
  );
  if (candidates.length === 0) return;

  // Fire and forget — don't block homepage render
  const run = async () => {
    const inventory = await loadMonitorInventory(userId);
    const existingIds = new Set(inventory.entries.map(e => e.id));
    const existingDiscoveryIds = new Set(inventory.entries.map(e => e.discoveryId));
    const now = new Date().toISOString();

    let changed = false;
    for (const d of candidates) {
      const entryId = d.place_id ?? d.id;
      if (existingIds.has(entryId) || existingDiscoveryIds.has(d.id)) continue;

      const newEntry: MonitorEntry = {
        id: entryId,
        place_id: d.place_id,
        discoveryId: d.id,
        name: d.name,
        city: d.city,
        address: d.address,
        type: d.type,
        contextKey: d.contextKey,
        monitorStatus: d.monitorStatus as Exclude<MonitorStatus, 'none'>,
        monitorType: d.monitorType ?? 'general',
        monitorReasons: d.monitorReasons ?? [],
        monitorDimensions: d.monitorDimensions ?? [],
        firstPromotedAt: now,
        lastUpdatedAt: now,
        observations: [],
        detectedChangeKinds: [],
        baselineState: d.rating != null ? {
          observedAt: d.discoveredAt ?? now,
          source: 'discovery',
          rating: d.rating,
        } : undefined,
      };
      inventory.entries.push(newEntry);
      existingIds.add(entryId);
      existingDiscoveryIds.add(d.id);
      changed = true;
    }

    if (changed) {
      inventory.updatedAt = now;
      await saveMonitorInventory(userId, inventory);
    }
  };

  const timeout = new Promise<void>(resolve => setTimeout(resolve, 10_000));
  Promise.race([run(), timeout]).catch(() => {});
}

/**
 * Remove a place from the inventory (e.g. trip completed, user dismissed).
 */
export async function removeFromInventory(params: {
  userId: string;
  entryId: string;
}): Promise<void> {
  const { userId, entryId } = params;
  const inventory = await loadMonitorInventory(userId);
  inventory.entries = inventory.entries.filter(
    e => e.id !== entryId && e.discoveryId !== entryId,
  );
  inventory.updatedAt = new Date().toISOString();
  await saveMonitorInventory(userId, inventory);
}

/**
 * Get entries due for a check (lastObservedAt older than cadence, or never observed).
 */
export function getDueEntries(
  inventory: MonitorInventory,
  now: Date = new Date(),
): MonitorEntry[] {
  return inventory.entries.filter(entry => {
    if (!entry.nextCheckAt) return true; // never computed → due
    return new Date(entry.nextCheckAt) <= now;
  });
}
