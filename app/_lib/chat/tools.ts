/**
 * Tool definitions for Claude API in the Compass Concierge chat system.
 * These definitions describe the capabilities available to the AI assistant.
 */

import type { DiscoveryType } from '../types';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information about restaurants, events, travel destinations, openings, reviews, etc. Use this to find up-to-date information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_place',
    description: 'Look up a place on Google Maps/Places to get its rating, address, hours, reviews count, and operational status. Use place name + city. After confirming a place is good, ALWAYS call add_to_compass to save it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Place name and city, e.g. "Published on Main Vancouver"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_to_compass',
    description: 'Add a recommended place to the user\'s Compass app. ALWAYS include address, rating, and why — these are required for the place card to display properly. Include any data you found from web_search or lookup_place.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Place name' },
        city: { type: 'string' as const, description: 'City the place is in' },
        neighborhood: { type: 'string' as const, description: 'Neighborhood within the city' },
        category: {
          type: 'string' as const,
          enum: ['restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum', 'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park', 'architecture', 'development', 'accommodation', 'neighbourhood'] as DiscoveryType[],
          description: 'Place category (DiscoveryType enum)',
        },
        why: { type: 'string' as const, description: 'Why this place is worth visiting — a compelling one-liner' },
        place_id: { type: 'string' as const, description: 'Google Place ID if known from lookup_place' },
        rating: { type: 'number' as const, description: 'Rating from Google Places (e.g. 4.5)' },
        address: { type: 'string' as const, description: 'Full address' },
        contextKey: { type: 'string' as const, description: 'Context key, e.g. trip:vancouver-april-2026, outing:saturday-afternoon, radar:downtown. Use the appropriate key from the user\'s active contexts.' },
      },
      required: ['name', 'city', 'category', 'why'],
    },
  },
  {
    name: 'save_discovery',
    description: 'Save a specific place to the user\'s Compass AND mark it as saved in triage. Use this when the user explicitly asks to save a place (e.g. "save that", "add Legal Sea Foods to my Boston trip", "save this restaurant"). Also writes triage state = saved so it appears in their saved list immediately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Place name' },
        contextKey: { type: 'string' as const, description: 'Which context to save to, e.g. trip:boston-august-2026' },
        city: { type: 'string' as const, description: 'City the place is in' },
        type: {
          type: 'string' as const,
          enum: ['restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum', 'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park', 'architecture', 'development', 'accommodation', 'neighbourhood'] as DiscoveryType[],
          description: 'Place type',
        },
        address: { type: 'string' as const, description: 'Full address' },
        place_id: { type: 'string' as const, description: 'Google Place ID if known' },
        rating: { type: 'number' as const, description: 'Rating (e.g. 4.5)' },
        summary: { type: 'string' as const, description: 'Short reason for saving — why this place is great' },
      },
      required: ['name', 'contextKey', 'city'],
    },
  },
  {
    name: 'update_trip',
    description: 'Update trip details in the user\'s manifest. Use when the user shares trip dates, accommodation, focus areas, or other trip details. E.g. "my Boston trip is August 15–18" or "I\'m staying at The Liberty Hotel".',
    input_schema: {
      type: 'object' as const,
      properties: {
        contextKey: { type: 'string' as const, description: 'Context key to update, e.g. trip:boston-august-2026' },
        dates: { type: 'string' as const, description: 'Trip dates, e.g. "August 15–18, 2026"' },
        city: { type: 'string' as const, description: 'City for the trip' },
        label: { type: 'string' as const, description: 'New label/name for the context' },
        emoji: { type: 'string' as const, description: 'Emoji for the context' },
        focus: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Focus areas e.g. ["food", "history", "architecture"]',
        },
        accommodationName: { type: 'string' as const, description: 'Hotel or accommodation name' },
        accommodationAddress: { type: 'string' as const, description: 'Hotel address' },
        notes: { type: 'string' as const, description: 'Any other trip notes' },
      },
      required: ['contextKey'],
    },
  },
  {
    name: 'edit_discovery',
    description: 'Edit/update fields on an existing discovery in the user\'s Compass. Use when the user wants to correct a place\'s name, change its type, update the address, adjust the rating, move it to a different context, or add a description. E.g. "Change that to a bar" or "Actually the address is 123 Main St".',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Name of the discovery to edit (fuzzy-matched)' },
        contextKey: { type: 'string' as const, description: 'Context key to search within, e.g. trip:boston-august-2026' },
        updates: {
          type: 'object' as const,
          description: 'Fields to update on the discovery',
          properties: {
            name: { type: 'string' as const, description: 'New name for the place' },
            city: { type: 'string' as const, description: 'Corrected city' },
            type: {
              type: 'string' as const,
              enum: ['restaurant', 'bar', 'cafe', 'grocery', 'gallery', 'museum', 'theatre', 'music-venue', 'hotel', 'experience', 'shop', 'park', 'architecture', 'development', 'accommodation', 'neighbourhood'] as DiscoveryType[],
              description: 'Corrected place type',
            },
            address: { type: 'string' as const, description: 'Corrected address' },
            rating: { type: 'number' as const, description: 'Updated rating' },
            contextKey: { type: 'string' as const, description: 'Move to a different context key' },
            description: { type: 'string' as const, description: 'Updated description' },
          },
        },
      },
      required: ['name', 'contextKey', 'updates'],
    },
  },
  {
    name: 'remove_discovery',
    description: 'Remove a discovery from the user\'s Compass. Use when the user wants to drop, remove, or dismiss a specific place. E.g. "Remove that museum" or "Drop the hotel".',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Name of the discovery to remove (fuzzy-matched)' },
        contextKey: { type: 'string' as const, description: 'Context key to search within, e.g. trip:boston-august-2026' },
      },
      required: ['name', 'contextKey'],
    },
  },
  {
    name: 'set_active_context',
    description: 'Switch the homepage focus to a specific existing trip/outing/radar context. Call this whenever the conversation shifts to discuss a different context than the one the user is currently viewing — e.g. the user says "let\'s review the NYC trip" or "actually, what about Boston?". This does NOT create a new context (use create_context for that) and does NOT add or update discoveries — it just signals the app to switch the visible context. Use the exact context key from the KNOWN CONTEXTS list.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contextKey: { type: 'string' as const, description: 'The exact context key to focus, e.g. trip:nyc-solo-trip or trip:boston-august-2026. Must match one of the keys in KNOWN CONTEXTS.' },
      },
      required: ['contextKey'],
    },
  },
  {
    name: 'create_context',
    description: 'Create a new trip, outing, or radar context in the user\'s manifest. Use when the user says they\'re planning a new trip, want a new outing, or want to track a new city/radar. E.g. "I\'m planning a trip to Boston in August" or "set up a Boston trip for me".',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string' as const,
          enum: ['trip', 'outing', 'radar'],
          description: 'Context type: trip (multi-day travel), outing (single day/evening), radar (ongoing city monitor)',
        },
        label: { type: 'string' as const, description: 'Human-readable name, e.g. "Boston August 2026"' },
        emoji: { type: 'string' as const, description: 'Emoji for the context (optional — auto-selected if omitted)' },
        city: { type: 'string' as const, description: 'City for the context' },
        dates: { type: 'string' as const, description: 'Dates, e.g. "August 15–18, 2026"' },
        focus: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Focus areas e.g. ["food", "architecture", "jazz"]',
        },
        setActive: { type: 'boolean' as const, description: 'Whether to mark this context active (default: true)' },
      },
      required: ['type', 'label'],
    },
  },
];
