/* ============================================================
   Compass v2 — Unified Image URL Resolution
   SINGLE source of truth for ALL image paths.
   
   Handles:
   - Blob URLs (https://...blob.vercel-storage.com/...)
   - Relative place-photos (/place-photos/ChIJ.../photos/1.jpg)
   - Relative cottage images (/cottages/the-lookout/photo_1.jpg)
   - Manifest.json fallback (data/placecards/{id}/manifest.json)
   - Cottage data heroImage field
   ============================================================ */

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/**
 * Resolve any image path to a full URL.
 * - Already absolute (http/https) → return as-is
 * - Relative path starting with / → prefix with Blob base URL
 * - Falsy → return null
 */
export function resolveImageUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  // Local public assets — serve directly, don't prefix with Blob URL
  if (path.startsWith('/developments/') || path.startsWith('/cottages/')) return path;
  // Place photos — prefix with Blob base URL
  if (path.startsWith('/') && BLOB_BASE) return `${BLOB_BASE}${path}`;
  if (BLOB_BASE && !path.startsWith('.')) return `${BLOB_BASE}/${path}`;
  return path;
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

/**
 * Get the first image URL from a place card manifest.
 * Server-side only.
 */
export function getManifestHeroImage(placeId: string): string | null {
  if (typeof window !== 'undefined') return null;

  try {
    const fs = require('fs');
    const pathMod = require('path');
    const manifestPath = pathMod.join(process.cwd(), 'data', 'placecards', placeId, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const images = manifest?.images;
    if (!Array.isArray(images) || images.length === 0) return null;
    return resolveImageUrl(images[0]?.path) || null;
  } catch {
    return null;
  }
}

/**
 * Client-side image URL resolution.
 * Use this in 'use client' components where fs isn't available.
 */
export function resolveImageUrlClient(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  // Local public assets — serve directly without Blob prefix
  if (path.startsWith('/cottages/') || path.startsWith('/developments/')) return path;
  const base = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_BLOB_BASE_URL || '')
    : BLOB_BASE;
  if (path.startsWith('/') && base) return `${base}${path}`;
  return path;
}
