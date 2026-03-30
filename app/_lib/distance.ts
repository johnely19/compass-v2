// Geographic distance utilities

/**
 * Calculate the Haversine distance between two points
 * @returns distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Format distance for display
 * Walking speed: ~1.4m/s = 83m/min
 */
export function formatDistance(distanceM: number): string {
  const walkingMinutes = Math.round(distanceM / 83);

  if (walkingMinutes < 15) {
    return `${walkingMinutes} min walk`;
  } else if (distanceM < 1000) {
    return `${Math.round(distanceM)}m`;
  } else {
    return `${(distanceM / 1000).toFixed(1)}km`;
  }
}

/**
 * Check if a location is within walking distance
 */
export function isWalkable(distanceM: number, maxMeters: number): boolean {
  return distanceM <= maxMeters;
}
