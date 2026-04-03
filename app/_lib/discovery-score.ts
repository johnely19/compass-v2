import type { Discovery, PlaceImage } from './types';

export interface ScoreBreakdown {
  total: number;
  rating: number;
  photoQuality: number;
  freshness: number;
  editorial: number;
  nowSignal: number;
}

export function scoreDiscovery(discovery: Discovery): ScoreBreakdown {
  let rating = 0;
  let photoQuality = 0;
  let freshness = 0;
  let editorial = 0;
  let nowSignal = 0;

  // 1. Rating (0-20 points)
  if (discovery.rating) {
    rating = (discovery.rating / 5) * 20;
  }

  // 2. Photo quality (0-20 points)
  const images = discovery.images || [];
  if (discovery.heroImage) photoQuality += 8;
  if (images.length >= 3) photoQuality += 8;
  if (images.length >= 6) photoQuality += 4;
  // Bonus for classified roles (not just 'general')
  const classifiedCount = images.filter(i => i.role !== 'general' && i.role !== 'hero').length;
  if (classifiedCount >= 2) photoQuality += 4;

  // 3. Freshness (0-20 points)
  if (discovery.discoveredAt) {
    const ageMs = Date.now() - new Date(discovery.discoveredAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7) freshness = 20;       // less than a week old
    else if (ageDays < 14) freshness = 16;
    else if (ageDays < 30) freshness = 12;
    else if (ageDays < 90) freshness = 8;
    else freshness = 4;
  }

  // 4. Editorial signal (0-20 points)
  // Source quality — discoveries from Eater, Infatuation etc. are higher quality
  const source = (discovery.source || '').toLowerCase();
  if (source.includes('eater') || source.includes('infatuation')) editorial += 12;
  else if (source.includes('blogto') || source.includes('now toronto')) editorial += 8;
  else if (source.includes('chat:recommendation')) editorial += 6;
  // Trending/monitor signal
  const rec = discovery as unknown as Record<string, unknown>;
  if (rec.trending === true) editorial += 8;
  if (rec.monitorSignal) editorial += 4;

  // 5. Now Signal (0-20 points) — real-time relevance signals
  // Recently opened, seasonal, event-driven, or actively buzzing
  if (rec.isNewOpening === true) nowSignal += 10;
  if (rec.seasonalRelevance === true) nowSignal += 6;
  if (rec.eventDriven === true) nowSignal += 6;
  // Recency of source mention — if sourced in last 48h, it's "now"
  if (discovery.discoveredAt) {
    const ageMs = Date.now() - new Date(discovery.discoveredAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 48) nowSignal += 8;
    else if (ageHours < 168) nowSignal += 4; // within a week
  }
  nowSignal = Math.min(nowSignal, 20);

  const total = rating + photoQuality + freshness + editorial + nowSignal;
  return { total, rating, photoQuality, freshness, editorial, nowSignal };
}
