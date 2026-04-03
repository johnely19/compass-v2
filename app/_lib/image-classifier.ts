/**
 * Image classification service for type-specific photo role assignment.
 * Uses position-based heuristics based on Google Places photo ordering.
 */
import type { ImageRole, DiscoveryType } from './types';

export interface ClassifiedImage {
  url: string;
  role: ImageRole;
  confidence: number; // 0-1
}

/**
 * Classify Google Places photos by role based on position and place type.
 * Google Places tends to order photos: storefront → interior → food/drinks
 */
export function classifyPhotos(
  photos: Array<{ url: string; source: string }>,
  placeType: DiscoveryType,
): ClassifiedImage[] {
  const results: ClassifiedImage[] = [];

  // Handle empty array
  if (photos.length === 0) {
    return results;
  }

  // Special handling for single photo
  if (photos.length === 1) {
    return [
      {
        url: photos[0]!.url,
        role: 'hero',
        confidence: 1,
      },
    ];
  }

  // Restaurant heuristic:
  // - Position 0 → exterior (0.7 confidence)
  // - Position 1 → interior (0.6 confidence)
  // - Position 2 → interior (0.5 confidence)
  // - Position 3+ → food (0.5 confidence)
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]!;
    let role: ImageRole;
    let confidence: number;

    switch (i) {
      case 0:
        role = 'exterior';
        confidence = 0.7;
        break;
      case 1:
        role = 'interior';
        confidence = 0.6;
        break;
      case 2:
        role = 'interior';
        confidence = 0.5;
        break;
      default:
        role = placeType === 'bar' || placeType === 'cafe' ? 'drink' : 'food';
        confidence = 0.5;
        break;
    }

    results.push({ url: photo.url, role, confidence });
  }

  return results;
}

/**
 * Get required image roles for a place type.
 */
export function getRequiredRoles(placeType: DiscoveryType): ImageRole[] {
  switch (placeType) {
    case 'restaurant':
    case 'bar':
    case 'cafe':
      return ['exterior', 'interior', 'food'];
    case 'hotel':
    case 'accommodation':
      return ['water', 'exterior', 'surroundings'];
    case 'development':
      return ['exterior', 'surroundings'];
    default:
      return ['hero'];
  }
}

/**
 * Select the best photo for each required role from classified images.
 * Returns a map of role -> best classified image.
 */
export function selectBestPhotos(
  classifiedImages: ClassifiedImage[],
  requiredRoles: ImageRole[],
): Map<ImageRole, ClassifiedImage> {
  const bestPhotos = new Map<ImageRole, ClassifiedImage>();

  // For each required role, find the highest confidence match
  for (const requiredRole of requiredRoles) {
    let best: ClassifiedImage | null = null;

    for (const classified of classifiedImages) {
      if (classified.role === requiredRole) {
        if (!best || classified.confidence > best.confidence) {
          best = classified;
        }
      }
    }

    if (best) {
      bestPhotos.set(requiredRole, best);
    }
  }

  return bestPhotos;
}