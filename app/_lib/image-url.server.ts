import 'server-only';
/* ============================================================
   Compass v2 — Server-only Image URL helpers (fs-dependent)
   
   These functions use Node.js `fs` to read manifest files and
   the image index. They must ONLY be imported from Server
   Components or Route Handlers — never from 'use client' files.
   ============================================================ */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { resolveImageUrl } from './image-url';

// Re-export client-safe helpers so server code can import everything from one place
export { resolveImageUrl, resolveImageUrlClient } from './image-url';

// Pre-built image index — populated at build time from manifest.json files
let _imageIndex: Record<string, string> | null = null;

function loadImageIndex(): Record<string, string> {
  if (_imageIndex) return _imageIndex;
  try {
    const indexPath = path.join(process.cwd(), 'data', 'image-index.json');
    if (existsSync(indexPath)) {
      _imageIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
      return _imageIndex!;
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * Get the first image URL from a place card manifest.
 * Uses pre-built index (data/image-index.json) for reliability on Vercel.
 * Falls back to direct manifest read.
 */
export function getManifestHeroImage(placeId: string): string | null {
  // Try pre-built index first (fast, reliable on Vercel)
  const index = loadImageIndex();
  if (index[placeId]) return resolveImageUrl(index[placeId]);

  // Fallback: direct manifest read
  try {
    const manifestPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'manifest.json');
    if (!existsSync(manifestPath)) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const images = manifest?.images;
    if (!Array.isArray(images) || images.length === 0) return null;
    const hero = images.find((i: { category?: string }) => i.category !== 'map') || images[0];
    return resolveImageUrl(hero?.path) || null;
  } catch {
    return null;
  }
}

/**
 * Get hero image URL for a place card, trying multiple sources.
 * Server-side only (uses fs).
 * 
 * Priority:
 * 1. Provided heroImage (already resolved)
 * 2. Manifest.json first image
 * 3. null (caller should show placeholder)
 */
export function getHeroImage(
  placeId: string | undefined | null,
  heroImage?: string | null,
): string | null {
  // 1. Use provided heroImage if available
  const resolved = resolveImageUrl(heroImage);
  if (resolved) return resolved;

  // 2. Try manifest
  if (placeId) return getManifestHeroImage(placeId);

  return null;
}
