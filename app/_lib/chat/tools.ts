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
    description: 'Add a recommended place to the user\'s Compass app for review. Call this for EACH specific place you recommend after verifying it with lookup_place. The place will appear in the user\'s Compass immediately.',
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
];
