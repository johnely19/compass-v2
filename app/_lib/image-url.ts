/* ============================================================
   Compass v2 — Image URL Resolution
   Resolves relative /place-photos/... paths to Blob URLs
   ============================================================ */

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/**
 * Resolve an image path to a full URL.
 * - Already absolute (http/https) → return as-is
 * - Relative (/place-photos/...) → prefix with Blob base URL
 * - Falsy → return null
 */
export function resolveImageUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/') && BLOB_BASE) return `${BLOB_BASE}${path}`;
  return path; // return as-is if no Blob base configured
}

/**
 * Get the first image URL from a place card manifest.
 * Reads from data/placecards/{placeId}/manifest.json on the server side.
 */
export function getManifestHeroImage(placeId: string): string | null {
  // Only works server-side
  if (typeof window !== 'undefined') return null;

  try {
    // Dynamic require to avoid bundling fs in client
    const fs = require('fs');
    const path = require('path');
    const manifestPath = path.join(process.cwd(), 'data', 'placecards', placeId, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const images = manifest?.images;
    if (!Array.isArray(images) || images.length === 0) return null;
    return resolveImageUrl(images[0]?.path) || null;
  } catch {
    return null;
  }
}
