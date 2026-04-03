import type { Discovery, PlaceImage } from './types';

interface ScoreBreakdown {
  total: number;
  rating: number;
  photoQuality: number;
  freshness: number;
  editorial: number;
}

export function scoreDiscovery(discovery: Discovery): ScoreBreakdown {
  let rating = 0;
  let photoQuality = 0;
  let freshness = 0;
  let editorial = 0;

  // 1. Rating (0-25 points)
  if (discovery.rating) {
    rating = (discovery.rating / 5) * 25;
  }

  // 2. Photo quality (0-25 points)
  const images = discovery.images || [];
  if (discovery.heroImage) photoQuality += 10;
  if (images.length >= 3) photoQuality += 10;
  if (images.length >= 6) photoQuality += 5;
  // Bonus for classified roles (not just 'general')
  const classifiedCount = images.filter(i => i.role !== 'general' && i.role !== 'hero').length;
  if (classifiedCount >= 2) photoQuality += 5;

  // 3. Freshness (0-25 points)
  if (discovery.discoveredAt) {
    const ageMs = Date.now() - new Date(discovery.discoveredAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7) freshness = 25;       // less than a week old
    else if (ageDays < 14) freshness = 20;
    else if (ageDays < 30) freshness = 15;
    else if (ageDays < 90) freshness = 10;
    else freshness = 5;
  }

  // 4. Editorial signal (0-25 points)
  // Source quality — discoveries from Eater, Infatuation etc. are higher quality
  const source = (discovery.source || '').toLowerCase();
  if (source.includes('eater') || source.includes('infatuation')) editorial += 15;
  else if (source.includes('blogto') || source.includes('now toronto')) editorial += 10;
  else if (source.includes('chat:recommendation')) editorial += 8;
  // Trending/monitor signal
  const rec = discovery as unknown as Record<string, unknown>;
  if (rec.trending === true) editorial += 10;
  if (rec.monitorSignal) editorial += 5;

  const total = rating + photoQuality + freshness + editorial;
  return { total, rating, photoQuality, freshness, editorial };
}
