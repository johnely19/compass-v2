/* ============================================================
   Compass v2 — Discovery Type Metadata
   Each type has a label, emoji icon, and accent color
   ============================================================ */

import type { DiscoveryType } from './types';

export interface TypeMeta {
  label: string;
  icon: string;   // emoji
  color: string;  // CSS color for badges/accents
}

export const TYPE_META: Record<DiscoveryType, TypeMeta> = {
  restaurant:    { label: 'Restaurant',     icon: '🍽️', color: '#e07a5f' },
  bar:           { label: 'Bar',            icon: '🍸', color: '#c084fc' },
  cafe:          { label: 'Café',           icon: '☕', color: '#a78bfa' },
  grocery:       { label: 'Grocery',        icon: '🛒', color: '#4ade80' },
  gallery:       { label: 'Gallery',        icon: '🎨', color: '#f472b6' },
  museum:        { label: 'Museum',         icon: '🏛️', color: '#818cf8' },
  theatre:       { label: 'Theatre',        icon: '🎭', color: '#fb923c' },
  'music-venue': { label: 'Music Venue',    icon: '🎵', color: '#38bdf8' },
  hotel:         { label: 'Hotel',          icon: '🏨', color: '#facc15' },
  experience:    { label: 'Experience',     icon: '✨', color: '#f97316' },
  shop:          { label: 'Shop',           icon: '🛍️', color: '#a3e635' },
  park:          { label: 'Park',           icon: '🌳', color: '#34d399' },
  architecture:  { label: 'Architecture',   icon: '🏗️', color: '#94a3b8' },
  development:   { label: 'Development',    icon: '🏗️', color: '#64748b' },
  accommodation: { label: 'Accommodation',  icon: '🏡', color: '#2dd4bf' },
  neighbourhood: { label: 'Neighbourhood',  icon: '📍', color: '#f59e0b' },
};

export const ALL_TYPES = Object.keys(TYPE_META) as DiscoveryType[];

const TYPE_ALIASES: Record<string, DiscoveryType> = {
  // Music venues
  'live-music': 'music-venue',
  'live_music': 'music-venue',
  'live music': 'music-venue',
  'jazz-club': 'music-venue',
  'live-music-bar': 'music-venue',
  'live_music_venue': 'music-venue',

  // Bars
  'wine-bar': 'bar',
  'wine_bar': 'bar',
  'wine-bar-restaurant': 'bar',
  'cocktail-bar': 'bar',
  'club-bar': 'bar',

  // Food/Drink
  'bakery': 'cafe',
  'butcher': 'grocery',
  'specialty-food': 'grocery',
  'specialty-shop': 'shop',
  'grocery_store': 'grocery',
  'bookstore': 'shop',
  'bookshop': 'shop',
  'bookshop-cafe': 'shop',

  // Entertainment/Events
  'comedy': 'theatre',
  'exhibition': 'gallery',
  'event': 'experience',
  'cultural-center': 'experience',

  // Other
  'restaurant-cluster': 'restaurant',
  'food-market': 'experience',
};

export function getTypeMeta(type: string): TypeMeta {
  const resolved = TYPE_META[type as DiscoveryType]
    || TYPE_META[TYPE_ALIASES[type] as DiscoveryType]
    || TYPE_META['experience']; // safe fallback
  return resolved;
}
