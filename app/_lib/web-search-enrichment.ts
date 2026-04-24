/**
 * Web Search Enrichment for Monitoring
 *
 * Runs type-specific Brave searches for monitored places to detect signals
 * that Google Places API cannot surface: awards, buzz, construction milestones,
 * program changes, availability reports, and closure rumours.
 *
 * Maps search result text to MonitorChangeKind via keyword heuristics.
 * Returns null if no meaningful signals found (avoiding noise observations).
 *
 * Designed to be called AFTER the Places observation in run-observations.
 * Records a separate 'web-search' observation when signals are found.
 */

import type { MonitorChangeKind } from './monitor-inventory';

// ---- Types ----

export interface WebEnrichmentResult {
  /** Signals detected from web search */
  changes: MonitorChangeKind[];
  /** Human-readable digest of what was found, suitable for observation notes */
  notes: string;
  /** The search query used */
  query: string;
  /** Number of search results parsed */
  resultCount: number;
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

// ---- Keyword → change kind mappings ----

interface SignalRule {
  label: string;
  patterns: RegExp[];
  kind: MonitorChangeKind;
}

export interface SignalMatch {
  kind: MonitorChangeKind;
  label: string;
  title: string;
  description: string;
}

const BASE_SIGNAL_RULES: SignalRule[] = [
  {
    label: 'permanent closure language',
    patterns: [/\bclosed?\s+permanently\b/i, /\bhas\s+closed\b/i, /\bshutting\s+down\b/i, /\bout\s+of\s+business\b/i],
    kind: 'closure-signal',
  },
  {
    label: 'temporary closure or renovation language',
    patterns: [/\bclosed?\s+temporarily\b/i, /\bclosed?\s+for\s+renovations?\b/i, /\btemporarily\s+(closed?|shut)\b/i],
    kind: 'operational-change',
  },
];

const TYPE_SIGNAL_RULES: Record<MonitorType, SignalRule[]> = {
  hospitality: [
    {
      label: 'hours update language',
      patterns: [/\bnew\s+hours?\b/i, /\bextended\s+hours?\b/i, /\bopen\s+(late|earlier)\b/i, /\bclosed?\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i],
      kind: 'hours-changed',
    },
    {
      label: 'awards or critical recognition',
      patterns: [/\b(michelin|james\s+beard|zagat|eater|infatuation)\b/i, /\bbest\s+(restaurant|bar|hotel|new)\b/i, /\bawarded?\b/i, /\bcritically\s+acclaimed\b/i, /\bnamed\s+(one\s+of|a)\s+best\b/i],
      kind: 'sentiment-shift',
    },
    {
      label: 'negative press or inspection issue',
      patterns: [/\bhealth\s+(violation|inspection\s+fail)\b/i, /\bfood\s+safety\b/i, /\blawsuit\b/i, /\bbad\s+review\b/i, /\bcontrovers/i],
      kind: 'sentiment-shift',
    },
    {
      label: 'chef, menu, or concept change',
      patterns: [/\bnew\s+chef\b/i, /\bnew\s+menu\b/i, /\bconcept\s+change\b/i, /\bunder\s+new\s+(management|ownership)\b/i, /\breopened?\b/i],
      kind: 'description-changed',
    },
  ],
  stay: [
    {
      label: 'renovation or reopening language',
      patterns: [/\brenovation\b/i, /\breopened?\b/i, /\brefresh(ed)?\s+rooms?\b/i],
      kind: 'operational-change',
    },
    {
      label: 'rate change language',
      patterns: [/\bprice\s+(increase|hike|rise|drop|cut)\b/i, /\bnew\s+price(s|ing)?\b/i, /\brates?\s+(changed?|up|down)\b/i],
      kind: 'price-changed',
    },
    {
      label: 'availability or booking pressure',
      patterns: [/\bsold?\s+out\b/i, /\bfully?\s+booked?\b/i, /\bno\s+(availability|vacancies)\b/i, /\bwaitlist\b/i, /\bavailability\s+open\b/i],
      kind: 'availability-changed',
    },
  ],
  development: [
    {
      label: 'construction milestone language',
      patterns: [/\bunder\s+construction\b/i, /\bbreak\s*ground\b/i, /\bopening\s+soon\b/i, /\bpre.?sales?\s+(launch|open)/i, /\bconstruction\s+(started?|began|complete|progress)\b/i, /\bpermit\s+approved\b/i, /\btopping\s+out\b/i],
      kind: 'construction-signal',
    },
    {
      label: 'development pricing language',
      patterns: [/\bpre.?construction\s+price\b/i, /\bpricing\s+released\b/i, /\bprices?\s+from\s+\$?\d/i],
      kind: 'price-changed',
    },
    {
      label: 'inventory sell-through language',
      patterns: [/\bsold\s+out\b/i, /\bunits?\s+released\b/i, /\bwaitlist\b/i],
      kind: 'availability-changed',
    },
  ],
  culture: [
    {
      label: 'exhibition or program announcement',
      patterns: [/\bnew\s+exhibition\b/i, /\bprogram\s+announced\b/i, /\bseason\s+announcement\b/i, /\blineup\b/i, /\bretrospective\b/i],
      kind: 'description-changed',
    },
    {
      label: 'hours or access update',
      patterns: [/\bnew\s+hours?\b/i, /\bextended\s+hours?\b/i, /\bfree\s+admission\b/i, /\btimed\s+entry\b/i],
      kind: 'hours-changed',
    },
    {
      label: 'venue reopening or closure language',
      patterns: [/\breopened?\b/i, /\bclosed?\s+for\s+upgrades?\b/i],
      kind: 'operational-change',
    },
  ],
  general: [
    {
      label: 'general operating update',
      patterns: [/\bnow\s+open\b/i, /\brelocated\b/i, /\bexpanding\b/i, /\bgrand\s+opening\b/i, /\bnew\s+location\b/i],
      kind: 'general-update',
    },
    {
      label: 'general hours update',
      patterns: [/\bnew\s+hours?\b/i, /\bextended\s+hours?\b/i],
      kind: 'hours-changed',
    },
  ],
};

export function normalizeMonitorType(monitorType: string): MonitorType {
  switch (monitorType) {
    case 'hospitality':
    case 'stay':
    case 'development':
    case 'culture':
      return monitorType;
    default:
      return 'general';
  }
}

export function getSignalRulesForMonitorType(monitorType: string): SignalRule[] {
  const normalizedType = normalizeMonitorType(monitorType);
  return [...BASE_SIGNAL_RULES, ...TYPE_SIGNAL_RULES[normalizedType]];
}

// ---- Type-specific query builders ----

type MonitorType = 'hospitality' | 'stay' | 'development' | 'culture' | 'general';

/**
 * Build a targeted search query for a monitored place.
 *
 * Queries are intentionally narrow — we want signals, not tourism content.
 * Each type has a different "news angle" we're looking for.
 */
export function buildSearchQuery(params: {
  name: string;
  city: string;
  monitorType: MonitorType | string;
}): string {
  const { name, city, monitorType } = params;
  const base = `"${name}" ${city}`;

  switch (monitorType as MonitorType) {
    case 'hospitality':
      // Restaurants, bars — look for news, awards, closures, chef changes
      return `${base} restaurant news 2025 2026 OR award OR closed OR chef OR menu`;
    case 'stay':
      // Hotels, rentals — availability, rate changes, renovations
      return `${base} hotel news 2025 2026 OR renovation OR closed OR rates OR availability`;
    case 'development':
      // Under-construction buildings, pre-sale condos
      return `${base} development OR construction update 2025 2026 OR launched OR sold OR completed`;
    case 'culture':
      // Museums, galleries, venues — programs, exhibitions, closures
      return `${base} exhibition OR program OR events 2025 2026 OR closed OR new`;
    default:
      return `${base} news 2025 2026 OR closed OR update`;
  }
}

// ---- Keyword signal detection ----

/**
 * Parse Brave search results and map to MonitorChangeKind signals.
 * Returns deduplicated list of detected change kinds.
 */
export function detectSignalMatches(results: BraveWebResult[], monitorType: string): SignalMatch[] {
  const rules = getSignalRulesForMonitorType(monitorType);
  const matches: SignalMatch[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const text = `${result.title} ${result.description}`;

    for (const rule of rules) {
      if (!rule.patterns.some(pattern => pattern.test(text))) continue;

      const key = `${rule.kind}:${rule.label}`;
      if (seen.has(key)) break;

      seen.add(key);
      matches.push({
        kind: rule.kind,
        label: rule.label,
        title: result.title,
        description: result.description,
      });
      break;
    }
  }

  return matches;
}

export function parseSignals(results: BraveWebResult[], monitorType: string): MonitorChangeKind[] {
  return Array.from(new Set(detectSignalMatches(results, monitorType).map(match => match.kind)));
}

// ---- Summarize results into notes ----

export function buildNotes(results: BraveWebResult[], query: string, matches: SignalMatch[] = []): string {
  if (results.length === 0) return '';

  const reasons = matches.slice(0, 3).map(match => `${match.kind} (${match.label})`);
  const header = reasons.length > 0
    ? `Web search [${query.slice(0, 60)}...], matched ${reasons.join(', ')}:`
    : `Web search [${query.slice(0, 60)}...]:`;
  const lines = results.slice(0, 5).map(r => `• ${r.title}: ${r.description.slice(0, 150)}`);
  return `${header}\n${lines.join('\n')}`;
}

// ---- Main enrichment function ----

/**
 * Run a type-specific web search for a monitored place and detect signals.
 *
 * Returns null when:
 * - No BRAVE_SEARCH_API_KEY is configured
 * - Search fails
 * - No signals found (all-clear = no web observation needed)
 *
 * Returns WebEnrichmentResult when signals are found.
 */
export async function runWebEnrichment(params: {
  name: string;
  city: string;
  monitorType: string;
}): Promise<WebEnrichmentResult | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return null;

  const { name, city, monitorType } = params;
  const query = buildSearchQuery({ name, city, monitorType });

  let results: BraveWebResult[] = [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&freshness=pm`;
    const res = await fetch(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.error(`[web-enrichment] Brave search error ${res.status} for "${name}"`);
      return null;
    }
    const data = await res.json();
    results = (data.web?.results ?? []).slice(0, 5) as BraveWebResult[];
  } catch (err) {
    console.error(`[web-enrichment] Search failed for "${name}":`, err);
    return null;
  }

  if (results.length === 0) return null;

  const matches = detectSignalMatches(results, monitorType);
  const changes = Array.from(new Set(matches.map(match => match.kind)));

  // Only return enrichment if we found signals — no noise observations
  if (changes.length === 0) return null;

  const notes = buildNotes(results, query, matches);

  return {
    changes,
    notes,
    query,
    resultCount: results.length,
  };
}
