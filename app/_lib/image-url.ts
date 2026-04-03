/* ============================================================
   Compass v2 — Client-safe Image URL Resolution
   SINGLE source of truth for ALL image paths.
   
   This file is safe to import from 'use client' components.
   For server-only helpers (getHeroImage, getManifestHeroImage),
   import from './image-url.server' instead.
   
   Handles:
   - Blob URLs (https://...blob.vercel-storage.com/...)
   - Relative place-photos (/place-photos/ChIJ.../photos/1.jpg)
   - Relative cottage images (/cottages/the-lookout/photo_1.jpg)
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
