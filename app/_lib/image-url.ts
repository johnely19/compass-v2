/* ============================================================
   Compass v2 — Unified Image URL Resolution
   SINGLE source of truth for ALL image paths.
   
   ⚠️ This file is safe for client AND server components.
   Server-only functions (fs-dependent) are in image-url.server.ts
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
