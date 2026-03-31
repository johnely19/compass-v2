/**
 * Platform branding info for cottage listing sources.
 */

export interface PlatformInfo {
  /** Display label for this platform */
  label: string;
  /** Brand colour as a CSS hex string */
  colour: string;
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  airbnb: { label: 'Airbnb', colour: '#FF5A5F' },
  vrbo: { label: 'VRBO', colour: '#3D6EE1' },
  'vrbo-apify': { label: 'VRBO', colour: '#3D6EE1' },
  cottagestays: { label: 'CottageStays', colour: '#2E7D32' },
  cottagesincanada: { label: 'Cottages in Canada', colour: '#E65100' },
  'cottages-in-canada': { label: 'Cottages in Canada', colour: '#E65100' },
  'cottage.ca': { label: 'Cottage.ca', colour: '#6A1B9A' },
  'cottagevacations': { label: 'Cottage Vacations', colour: '#00838F' },
  'cottage-vacations': { label: 'Cottage Vacations', colour: '#00838F' },
  'saublebeach': { label: 'Sauble Beach', colour: '#558B2F' },
  'sauble-beach': { label: 'Sauble Beach', colour: '#558B2F' },
  'sauble beach cottage rentals': { label: 'Sauble Beach', colour: '#558B2F' },
  'huronshores': { label: 'Direct', colour: '#4527A0' },
  'huron-shores': { label: 'Direct', colour: '#4527A0' },
  'huronbeaches': { label: 'Direct', colour: '#4527A0' },
  'huron-beaches': { label: 'Direct', colour: '#4527A0' },
  direct: { label: 'Direct', colour: '#4527A0' },
};

const FALLBACK: PlatformInfo = { label: 'View Listing', colour: '#78909C' };

/**
 * Return display label and brand colour for a cottage platform string.
 * The raw platform value from data is normalised to lowercase for matching.
 */
export function getPlatformInfo(platform?: string | null): PlatformInfo {
  if (!platform) return FALLBACK;
  const key = platform.trim().toLowerCase();
  return PLATFORM_MAP[key] ?? FALLBACK;
}
