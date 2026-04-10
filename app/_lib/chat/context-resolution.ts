import type { Context, UserManifest } from '../types';

type RichContext = Context & Record<string, unknown>;

export interface KnownContextDiscovery {
  contextKey: string;
  name: string;
  type?: string;
  city?: string;
  address?: string;
  discoveredAt?: string;
}

export interface ResolvedContextMatch {
  context: Context;
  score: number;
  matchedAliases: string[];
  matchedTokens: string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'around', 'at', 'for', 'from', 'i', 'im', 'in', 'into', 'is', 'it', 'lets', 'me', 'my',
  'of', 'on', 'our', 'please', 'review', 'show', 'switch', 'that', 'the', 'this', 'to', 'us', 'we', 'what', 'with',
  'your', 'about', 'actually', 'check', 'focus', 'look', 'plan', 'planning', 'saved', 'trip', 'outing', 'radar',
]);

function normalizeText(value: string | undefined | null): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string | undefined | null): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function pushUnique(target: string[], value: string | undefined | null): void {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return;
  if (!target.some((entry) => normalizeText(entry) === normalizeText(trimmed))) {
    target.push(trimmed);
  }
}

function getTypeWord(context: Context): string {
  return context.type === 'outing' ? 'outing' : context.type === 'radar' ? 'radar' : 'trip';
}

function getLabelKeywords(context: Context): string[] {
  return tokenize(context.label).filter((token) => !['solo', 'weekend', 'long'].includes(token));
}

function getDiscoveryNames(context: Context, discoveries: KnownContextDiscovery[] = [], limit = 2): string[] {
  return discoveries
    .filter((discovery) => discovery.contextKey === context.key)
    .sort((a, b) => new Date(b.discoveredAt || 0).getTime() - new Date(a.discoveredAt || 0).getTime())
    .slice(0, limit)
    .map((discovery) => discovery.name)
    .filter(Boolean);
}

function getAccommodationName(context: Context): string {
  const raw = context as RichContext;
  const accommodation = raw.accommodation;
  if (!accommodation || typeof accommodation !== 'object') return '';
  return typeof (accommodation as { name?: unknown }).name === 'string'
    ? ((accommodation as { name: string }).name || '').trim()
    : '';
}

function getPeopleNames(context: Context): string[] {
  const raw = context as RichContext;
  const people = Array.isArray(raw.people) ? raw.people : [];
  return people
    .map((person) => (person && typeof person === 'object' && typeof (person as { name?: unknown }).name === 'string')
      ? ((person as { name: string }).name || '').trim()
      : '')
    .filter(Boolean)
    .slice(0, 2);
}

export function buildContextAliases(
  context: Context,
  discoveries: KnownContextDiscovery[] = [],
  maxAliases = 6,
): string[] {
  const aliases: string[] = [];
  const typeWord = getTypeWord(context);
  const label = context.label?.trim() || '';
  const city = context.city?.trim() || '';
  const labelKeywords = getLabelKeywords(context);
  const labelTail = labelKeywords[labelKeywords.length - 1] || '';

  pushUnique(aliases, label);
  if (label && !normalizeText(label).includes(typeWord)) {
    pushUnique(aliases, `${label} ${typeWord}`);
  }

  if (city) {
    pushUnique(aliases, city);
  }

  if (labelTail && city && !normalizeText(city).includes(labelTail)) {
    pushUnique(aliases, `${city} ${labelTail} ${typeWord}`);
  }

  if (city) {
    pushUnique(aliases, `${city} ${typeWord}`);
  }

  if (labelTail) {
    pushUnique(aliases, `${labelTail} ${typeWord}`);
  }

  const accommodationName = getAccommodationName(context);
  pushUnique(aliases, accommodationName);

  for (const name of getPeopleNames(context)) {
    pushUnique(aliases, `${name} ${typeWord}`);
  }

  for (const discoveryName of getDiscoveryNames(context, discoveries)) {
    pushUnique(aliases, `${discoveryName} ${typeWord}`);
  }

  return aliases.slice(0, maxAliases);
}

function addWeightedTokens(target: Map<string, number>, value: string | undefined | null, weight: number): void {
  for (const token of tokenize(value)) {
    const current = target.get(token) || 0;
    if (weight > current) target.set(token, weight);
  }
}

function getWeightedContextTokens(context: Context, discoveries: KnownContextDiscovery[] = []): Map<string, number> {
  const raw = context as RichContext;
  const weighted = new Map<string, number>();

  addWeightedTokens(weighted, context.label, 8);
  addWeightedTokens(weighted, context.city, 7);
  addWeightedTokens(weighted, context.dates, 3);

  for (const focus of context.focus || []) addWeightedTokens(weighted, focus, 4);
  for (const alias of buildContextAliases(context, discoveries, 8)) addWeightedTokens(weighted, alias, 7);

  addWeightedTokens(weighted, typeof raw.purpose === 'string' ? raw.purpose : '', 5);
  addWeightedTokens(weighted, typeof raw.notes === 'string' ? raw.notes : '', 2);
  addWeightedTokens(weighted, getAccommodationName(context), 6);

  const accommodation = raw.accommodation;
  if (accommodation && typeof accommodation === 'object') {
    addWeightedTokens(weighted, typeof (accommodation as { address?: unknown }).address === 'string'
      ? (accommodation as { address: string }).address
      : '', 4);
  }

  const base = raw.base;
  if (base && typeof base === 'object') {
    addWeightedTokens(weighted, typeof (base as { address?: unknown }).address === 'string' ? (base as { address: string }).address : '', 4);
    addWeightedTokens(weighted, typeof (base as { host?: unknown }).host === 'string' ? (base as { host: string }).host : '', 4);
    addWeightedTokens(weighted, typeof (base as { zone?: unknown }).zone === 'string' ? (base as { zone: string }).zone : '', 3);
  }

  const anchor = raw.anchor;
  if (anchor && typeof anchor === 'object') {
    addWeightedTokens(weighted, typeof (anchor as { label?: unknown }).label === 'string' ? (anchor as { label: string }).label : '', 4);
  }

  const listFields = ['priorities', 'mustDo'] as const;
  for (const field of listFields) {
    const values = Array.isArray(raw[field]) ? raw[field] : [];
    for (const value of values) {
      if (typeof value === 'string') addWeightedTokens(weighted, value, 3);
    }
  }

  const people = Array.isArray(raw.people) ? raw.people : [];
  for (const person of people) {
    if (!person || typeof person !== 'object') continue;
    addWeightedTokens(weighted, typeof (person as { name?: unknown }).name === 'string' ? (person as { name: string }).name : '', 5);
    addWeightedTokens(weighted, typeof (person as { relation?: unknown }).relation === 'string' ? (person as { relation: string }).relation : '', 2);
    addWeightedTokens(weighted, typeof (person as { base?: unknown }).base === 'string' ? (person as { base: string }).base : '', 3);
    addWeightedTokens(weighted, typeof (person as { note?: unknown }).note === 'string' ? (person as { note: string }).note : '', 2);
  }

  for (const discovery of discoveries) {
    if (discovery.contextKey !== context.key) continue;
    addWeightedTokens(weighted, discovery.name, 5);
    addWeightedTokens(weighted, discovery.city, 3);
    addWeightedTokens(weighted, discovery.address, 3);
  }

  return weighted;
}

function getKeyVariants(rawValue: string): string[] {
  const normalized = normalizeText(rawValue);
  if (!normalized) return [];
  const variants = [normalized];
  const rawSlug = rawValue.includes(':') ? rawValue.split(':').slice(1).join(':') : rawValue;
  const slugNorm = normalizeText(rawSlug.replace(/-\d{4}$/, ''));
  if (slugNorm && !variants.includes(slugNorm)) variants.push(slugNorm);
  return variants;
}

function scoreAlias(messageNorm: string, messageTokens: string[], alias: string): number {
  const aliasNorm = normalizeText(alias);
  if (!aliasNorm) return 0;
  const aliasTokenCount = tokenize(alias).length;
  if (messageNorm === aliasNorm) return 24 + aliasTokenCount;
  if (messageNorm.includes(aliasNorm)) return 18 + aliasTokenCount;
  if (messageTokens.length >= 2 && aliasNorm.includes(messageNorm)) return 14 + messageTokens.length;
  return 0;
}

export function resolveContextReference(
  rawValue: string | undefined | null,
  manifest: UserManifest | null | undefined,
  discoveries: KnownContextDiscovery[] = [],
): ResolvedContextMatch | null {
  if (!rawValue || !manifest?.contexts?.length) return null;

  const messageNorm = normalizeText(rawValue);
  const messageTokens = tokenize(rawValue);
  const keyVariants = getKeyVariants(rawValue);
  if (!messageNorm) return null;

  let best: ResolvedContextMatch | null = null;
  let secondBestScore = 0;

  for (const context of manifest.contexts) {
    const aliases = buildContextAliases(context, discoveries, 8);
    const matchedAliases = aliases
      .map((alias) => ({ alias, score: scoreAlias(messageNorm, messageTokens, alias) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    let score = matchedAliases.reduce((sum, entry) => sum + entry.score, 0);

    const keyNorm = normalizeText(context.key);
    const keyBaseNorm = normalizeText(context.key.split(':').slice(1).join(':').replace(/-\d{4}$/, ''));
    if (keyVariants.includes(keyNorm)) score += 30;
    else if (keyBaseNorm && keyVariants.includes(keyBaseNorm)) score += 22;

    const tokenWeights = getWeightedContextTokens(context, discoveries);
    const matchedTokens = [...new Set(messageTokens.filter((token) => tokenWeights.has(token)))];
    score += matchedTokens.reduce((sum, token) => sum + (tokenWeights.get(token) || 0), 0);
    if (matchedTokens.length >= 2) score += matchedTokens.length * 2;

    const candidate: ResolvedContextMatch = {
      context,
      score,
      matchedAliases: matchedAliases.map((entry) => entry.alias).slice(0, 3),
      matchedTokens: matchedTokens.slice(0, 6),
    };

    if (!best || candidate.score > best.score) {
      secondBestScore = best?.score || secondBestScore;
      best = candidate;
    } else if (candidate.score > secondBestScore) {
      secondBestScore = candidate.score;
    }
  }

  if (!best) return null;

  const hasStrongAlias = best.matchedAliases.length > 0;
  const hasStrongTokenOverlap = best.matchedTokens.length >= 2;
  const margin = best.score - secondBestScore;
  if (!hasStrongAlias && !hasStrongTokenOverlap) return null;
  if (best.score < 14) return null;
  if (margin < 4 && best.score < 24) return null;

  return best;
}

export function resolveContextKey(
  rawContextKey: string | undefined | null,
  manifest: UserManifest | null | undefined,
  discoveries: KnownContextDiscovery[] = [],
): string | null {
  const resolved = resolveContextReference(rawContextKey, manifest, discoveries);
  return resolved?.context.key || null;
}
