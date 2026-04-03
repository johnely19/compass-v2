/* ============================================================
   Server-only image utilities — uses fs, must NOT be imported
   by client components.
   ============================================================ */
import 'server-only';
import { resolveImageUrl } from './image-url';
import * as fs from 'fs';
import * as path from 'path';

// Pre-built image index — populated at build time from manifest.json files
let _imageIndex: Record<string, string> | null = null;

function loadImageIndex(): Record<string, string> {
  if (_imageIndex) return _imageIndex;
  try {
    const indexPath = path.join(process.cwd(), 'data', 'image-index.json');
    if (fs.existsSync(indexPath)) {
      _imageIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
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
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
 */
export function getHeroImage(
  placeId: string | undefined | null,
  heroImage?: string | null,
): string | null {
  const resolved = resolveImageUrl(heroImage);
  if (resolved) return resolved;
  if (placeId) return getManifestHeroImage(placeId);
  return null;
}
