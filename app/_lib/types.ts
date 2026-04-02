/* ============================================================
   Compass v2 — Core Types
   Matches ARCHITECTURE.md exactly
   ============================================================ */

// ---- Users ----

export interface User {
  id: string;           // "usr_001", "usr_002", etc.
  name: string;
  code: string;         // URL-safe invite code
  city: string;         // home city (primary discovery radar)
  isOwner: boolean;
  createdAt: string;    // ISO string
}

export interface UsersIndex {
  users: Record<string, User>;
}

// ---- User Profile (stored in Blob) ----

export interface UserProfile {
  name: string;
  city: string;
  companions?: { name: string; relationship: string; details?: string }[];
  timezone?: string;
  location?: string;
}

// ---- Preferences (Layer 1) ----

export interface UserPreferences {
  interests: string[];          // "architecture", "jazz", "natural wine"
  cuisines?: string[];          // "French", "Japanese", "Ethiopian"
  vibes?: string[];             // "intimate", "lively", "cozy"
  avoidances?: string[];        // things they don't like
  updatedAt: string;
}

// ---- Contexts ----

export type ContextType = 'trip' | 'outing' | 'radar';

export type ContextStatus = 'active' | 'completed' | 'archived' | 'paused';

export interface ContextAnchor {
  lat: number;
  lng: number;
  label: string;
  radiusM: number;
}

export interface Context {
  key: string;          // "trip:slug", "outing:slug", "radar:slug"
  label: string;        // "NYC Solo Trip"
  emoji: string;        // "🗽"
  type: ContextType;
  city?: string;
  dates?: string;
  parentTrip?: string;  // for outings nested in a trip
  focus: string[];      // "food", "jazz", "architecture"
  active: boolean;
  status?: ContextStatus;  // defaults to 'active' if missing; overrides `active` when present
  anchor?: ContextAnchor;  // geographic anchor for proximity sorting
}

export interface UserManifest {
  contexts: Context[];
  updatedAt: string;
}

// ---- Discovery Types ----

export type DiscoveryType =
  | 'restaurant'
  | 'bar'
  | 'cafe'
  | 'grocery'
  | 'gallery'
  | 'museum'
  | 'theatre'
  | 'music-venue'
  | 'hotel'
  | 'experience'
  | 'shop'
  | 'park'
  | 'architecture'
  | 'development'
  | 'accommodation'
  | 'neighbourhood';

// ---- Discoveries ----

export type PlaceIdStatus = 'verified' | 'missing' | 'changed' | 'pending';

export interface Discovery {
  id: string;
  place_id?: string;
  name: string;
  address?: string;
  city: string;
  type: DiscoveryType;
  rating?: number;
  contextKey: string;
  source: string;       // "disco:evening", "chat:recommendation"
  discoveredAt: string;  // ISO string
  match?: number;        // 1-5 relevance score
  placeIdStatus: PlaceIdStatus;
  heroImage?: string;
  lat?: number;         // latitude for proximity sorting
  lng?: number;         // longitude for proximity sorting
  // Provenance fields
  sourceUrl?: string;   // URL to the article/source
  sourceName?: string;  // display name for source
  theme?: string;       // e.g. "New NYC Openings — Brooklyn Heights"
  verified?: boolean;    // verified via Google Places
  ratingCount?: number; // review count from Google Places
  description?: string; // Disco description
  savedAt?: string;     // ISO string — once set, this discovery is immutable (#204)
  why?: string;         // Why this place was recommended
}

export interface UserDiscoveries {
  discoveries: Discovery[];
  updatedAt: string;
}

// ---- Saved Places (canonical, append-only store — #204) ----

export interface SavedPlace {
  place_id?: string;
  name: string;
  address?: string;
  city: string;
  type: DiscoveryType;
  rating?: number;
  contextKey: string;
  savedAt: string;        // ISO string — when user saved this
  unsavedAt?: string;     // ISO string — when user unsaved (null = still saved)
  source: string;         // "triage:save", "chat:save"
  description?: string;
  why?: string;
  heroImage?: string;
  lat?: number;
  lng?: number;
  discoveryId?: string;   // link back to discovery record
  sourceUrl?: string;
  sourceName?: string;
  ratingCount?: number;
}

export interface SavedPlacesStore {
  saved: SavedPlace[];
  updatedAt: string;
}

// ---- Triage ----

export type TriageState = 'saved' | 'dismissed' | 'resurfaced';

export interface TriageEntry {
  state: TriageState;
  updatedAt: string;
  previousState?: 'saved' | 'dismissed';
  resurfaceReason?: string;
}

export interface SeenEntry {
  firstSeen: string;
  name: string;
  city: string;
  type: DiscoveryType;
}

export interface ContextTriage {
  triage: Record<string, TriageEntry>;
  seen: Record<string, SeenEntry>;
}

export type TriageStore = Record<string, ContextTriage>;

// ---- Place Cards ----

export interface PlaceCardImage {
  path: string;
  category: string;
}

export interface PlaceCard {
  place_id: string;
  name: string;
  type: DiscoveryType;
  data: {
    description: string;
    highlights: string[];
    hours?: Record<string, string> | string[];  // string[] from Google Places API
    images: PlaceCardImage[];
    [key: string]: unknown;  // type-specific data
  };
}

// ---- Chat ----

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface UserChat {
  messages: ChatMessage[];
  updatedAt: string;
}

// ---- User Document Types ----

export type UserDocType =
  | 'profile'
  | 'preferences'
  | 'manifest'
  | 'discoveries'
  | 'chat';

export type UserDocMap = {
  profile: UserProfile;
  preferences: UserPreferences;
  manifest: UserManifest;
  discoveries: UserDiscoveries;
  chat: UserChat;
};
