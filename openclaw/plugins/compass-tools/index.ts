/**
 * Compass Concierge Tools — OpenClaw Plugin
 *
 * Registers 4 Compass-specific tools that write back to the Compass app
 * via its internal API. The 2 read-only tools (web_search, lookup_place)
 * are already provided by OpenClaw built-ins (web_search, goplaces).
 *
 * Tools registered:
 *   - compass_add_discovery   — Push a recommended place to user's Compass
 *   - compass_save_discovery  — Save a place + mark triage state = saved
 *   - compass_update_trip     — Update trip dates/accommodation/focus
 *   - compass_create_context  — Create a new trip/outing/radar
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

// --- Shared types ---

const DiscoveryTypeEnum = Type.Union([
  Type.Literal("restaurant"),
  Type.Literal("bar"),
  Type.Literal("cafe"),
  Type.Literal("grocery"),
  Type.Literal("gallery"),
  Type.Literal("museum"),
  Type.Literal("theatre"),
  Type.Literal("music-venue"),
  Type.Literal("hotel"),
  Type.Literal("experience"),
  Type.Literal("shop"),
  Type.Literal("park"),
  Type.Literal("architecture"),
  Type.Literal("development"),
  Type.Literal("accommodation"),
  Type.Literal("neighbourhood"),
]);

const ContextTypeEnum = Type.Union([
  Type.Literal("trip"),
  Type.Literal("outing"),
  Type.Literal("radar"),
]);

// --- Helper: call Compass internal API ---

async function compassApi(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data)}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// --- Plugin entry ---

export default definePluginEntry({
  id: "compass-tools",
  name: "Compass Concierge Tools",
  description:
    "Provides Compass-specific tools for the Concierge: add discoveries, save places, update trips, create contexts.",

  register(api) {
    // Read config
    const config = api.getConfig?.() as
      | { compassApiUrl?: string; compassApiKey?: string }
      | undefined;
    const COMPASS_URL =
      config?.compassApiUrl ||
      process.env.COMPASS_API_URL ||
      "https://compass-v2-lake.vercel.app";
    const COMPASS_KEY =
      config?.compassApiKey ||
      process.env.COMPASS_INTERNAL_API_KEY ||
      process.env.INTERNAL_API_KEY ||
      "";

    // ────────────────────────────────────────────
    // 1. compass_add_discovery
    // ────────────────────────────────────────────
    api.registerTool({
      name: "compass_add_discovery",
      description:
        'Add a recommended place to the user\'s Compass app. Call this for EACH specific place you recommend after verifying it with goplaces. The place appears in the user\'s Compass immediately for triage.',
      parameters: Type.Object({
        userId: Type.Optional(
          Type.String({ description: 'User ID (defaults to "john")' }),
        ),
        name: Type.String({ description: "Place name" }),
        city: Type.String({ description: "City the place is in" }),
        neighborhood: Type.Optional(
          Type.String({ description: "Neighborhood within the city" }),
        ),
        category: Type.Optional(
          Type.Union(
            [
              Type.Literal("restaurant"),
              Type.Literal("bar"),
              Type.Literal("cafe"),
              Type.Literal("grocery"),
              Type.Literal("gallery"),
              Type.Literal("museum"),
              Type.Literal("theatre"),
              Type.Literal("music-venue"),
              Type.Literal("hotel"),
              Type.Literal("experience"),
              Type.Literal("shop"),
              Type.Literal("park"),
              Type.Literal("architecture"),
              Type.Literal("development"),
              Type.Literal("accommodation"),
              Type.Literal("neighbourhood"),
            ],
            { description: "Place category" },
          ),
        ),
        why: Type.String({
          description: "Why this place is worth visiting — a compelling one-liner",
        }),
        place_id: Type.Optional(
          Type.String({ description: "Google Place ID from goplaces lookup" }),
        ),
        rating: Type.Optional(
          Type.Number({ description: "Rating from Google Places (e.g. 4.5)" }),
        ),
        address: Type.Optional(Type.String({ description: "Full address" })),
        contextKey: Type.Optional(
          Type.String({
            description:
              "Context key, e.g. trip:vancouver-april-2026, outing:saturday-afternoon",
          }),
        ),
      }),
      async execute(_id, params) {
        const userId = params.userId || "john";
        const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const discovery = {
          id: discoveryId,
          place_id: params.place_id,
          name: params.name,
          address: params.address,
          city: params.city,
          type: params.category || "restaurant",
          rating: params.rating,
          contextKey: params.contextKey || "",
          source: "openclaw:concierge",
          discoveredAt: new Date().toISOString(),
          placeIdStatus: params.place_id ? "verified" : "missing",
        };

        const result = await compassApi(COMPASS_URL, COMPASS_KEY, "/api/internal/discoveries", {
          userId,
          discoveries: [discovery],
        });

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `❌ Failed to add "${params.name}" to Compass: ${result.error}` }],
          };
        }

        const compassUrl = params.place_id
          ? `https://compass-v2-lake.vercel.app/placecards/${params.place_id}`
          : null;
        const mapsUrl = params.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${params.place_id}`
          : params.address
            ? `https://www.google.com/maps/search/${encodeURIComponent(params.name + " " + params.city)}`
            : null;

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Added "${params.name}" to Compass!\nCompass: ${compassUrl || "pending"}\nMaps: ${mapsUrl || "pending"}`,
            },
          ],
        };
      },
    });

    // ────────────────────────────────────────────
    // 2. compass_save_discovery
    // ────────────────────────────────────────────
    api.registerTool({
      name: "compass_save_discovery",
      description:
        'Save a specific place AND mark it as saved in triage. Use when the user explicitly says "save that", "add X to my Boston trip", etc.',
      parameters: Type.Object({
        userId: Type.Optional(
          Type.String({ description: 'User ID (defaults to "john")' }),
        ),
        name: Type.String({ description: "Place name" }),
        contextKey: Type.String({
          description: "Which context to save to, e.g. trip:boston-august-2026",
        }),
        city: Type.String({ description: "City the place is in" }),
        type: Type.Optional(
          Type.Union(
            [
              Type.Literal("restaurant"),
              Type.Literal("bar"),
              Type.Literal("cafe"),
              Type.Literal("grocery"),
              Type.Literal("gallery"),
              Type.Literal("museum"),
              Type.Literal("theatre"),
              Type.Literal("music-venue"),
              Type.Literal("hotel"),
              Type.Literal("experience"),
              Type.Literal("shop"),
              Type.Literal("park"),
              Type.Literal("architecture"),
              Type.Literal("development"),
              Type.Literal("accommodation"),
              Type.Literal("neighbourhood"),
            ],
            { description: "Place type" },
          ),
        ),
        address: Type.Optional(Type.String({ description: "Full address" })),
        place_id: Type.Optional(
          Type.String({ description: "Google Place ID" }),
        ),
        rating: Type.Optional(Type.Number({ description: "Rating (e.g. 4.5)" })),
        summary: Type.Optional(
          Type.String({ description: "Short reason for saving" }),
        ),
      }),
      async execute(_id, params) {
        const userId = params.userId || "john";
        const discoveryId = `disco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Step 1: Add as discovery
        const discovery = {
          id: discoveryId,
          place_id: params.place_id,
          name: params.name,
          address: params.address,
          city: params.city,
          type: params.type || "restaurant",
          rating: params.rating,
          contextKey: params.contextKey,
          source: "openclaw:concierge:save",
          discoveredAt: new Date().toISOString(),
          placeIdStatus: params.place_id ? "verified" : "missing",
        };

        const addResult = await compassApi(COMPASS_URL, COMPASS_KEY, "/api/internal/discoveries", {
          userId,
          discoveries: [discovery],
        });

        if (!addResult.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Failed to save "${params.name}": ${addResult.error}`,
              },
            ],
          };
        }

        // Step 2: Set triage state to "saved" via the internal triage API
        const triageResult = await compassApi(COMPASS_URL, COMPASS_KEY, "/api/internal/triage", {
          userId,
          discoveryId,
          contextKey: params.contextKey,
          state: "saved",
          name: params.name,
          city: params.city,
          type: params.type || "restaurant",
        });

        // Triage update is best-effort — the discovery is already saved
        const triageNote = triageResult.ok
          ? " (triage: saved ✓)"
          : " (discovery added, triage update pending)";

        const compassUrl = params.place_id
          ? `https://compass-v2-lake.vercel.app/placecards/${params.place_id}`
          : null;

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Saved "${params.name}" to ${params.contextKey}${triageNote}${compassUrl ? `\n${compassUrl}` : ""}`,
            },
          ],
        };
      },
    });

    // ────────────────────────────────────────────
    // 3. compass_update_trip
    // ────────────────────────────────────────────
    api.registerTool({
      name: "compass_update_trip",
      description:
        'Update trip details in the user\'s manifest. Use when they share dates, accommodation, focus areas.',
      parameters: Type.Object({
        userId: Type.Optional(
          Type.String({ description: 'User ID (defaults to "john")' }),
        ),
        contextKey: Type.String({
          description: "Context key to update, e.g. trip:boston-august-2026",
        }),
        dates: Type.Optional(
          Type.String({ description: 'Trip dates, e.g. "August 15–18, 2026"' }),
        ),
        city: Type.Optional(
          Type.String({ description: "City for the trip" }),
        ),
        label: Type.Optional(
          Type.String({ description: "New label/name for the context" }),
        ),
        emoji: Type.Optional(
          Type.String({ description: "Emoji for the context" }),
        ),
        focus: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Focus areas e.g. ["food", "history", "architecture"]',
          }),
        ),
        accommodationName: Type.Optional(
          Type.String({ description: "Hotel or accommodation name" }),
        ),
        accommodationAddress: Type.Optional(
          Type.String({ description: "Hotel address" }),
        ),
        notes: Type.Optional(
          Type.String({ description: "Any other trip notes" }),
        ),
      }),
      async execute(_id, params) {
        const userId = params.userId || "john";

        const result = await compassApi(
          COMPASS_URL,
          COMPASS_KEY,
          "/api/internal/context",
          {
            action: "update",
            userId,
            contextKey: params.contextKey,
            updates: {
              ...(params.dates && { dates: params.dates }),
              ...(params.city && { city: params.city }),
              ...(params.label && { label: params.label }),
              ...(params.emoji && { emoji: params.emoji }),
              ...(params.focus && { focus: params.focus }),
              ...(params.accommodationName && { accommodationName: params.accommodationName }),
              ...(params.accommodationAddress && { accommodationAddress: params.accommodationAddress }),
              ...(params.notes && { notes: params.notes }),
            },
          },
        );

        if (!result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Failed to update "${params.contextKey}": ${result.error}`,
              },
            ],
          };
        }

        const changes: string[] = [];
        if (params.dates) changes.push(`dates → ${params.dates}`);
        if (params.city) changes.push(`city → ${params.city}`);
        if (params.label) changes.push(`label → ${params.label}`);
        if (params.focus) changes.push(`focus → ${params.focus.join(", ")}`);
        if (params.accommodationName) changes.push(`accommodation → ${params.accommodationName}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Updated ${params.contextKey}: ${changes.join(", ") || "no changes"}`,
            },
          ],
        };
      },
    });

    // ────────────────────────────────────────────
    // 4. compass_create_context
    // ────────────────────────────────────────────
    api.registerTool({
      name: "compass_create_context",
      description:
        'Create a new trip, outing, or radar context. Use when the user says "I\'m planning a trip to Boston" or "set up a NYC radar".',
      parameters: Type.Object({
        userId: Type.Optional(
          Type.String({ description: 'User ID (defaults to "john")' }),
        ),
        type: Type.Union(
          [
            Type.Literal("trip"),
            Type.Literal("outing"),
            Type.Literal("radar"),
          ],
          {
            description:
              "Context type: trip (multi-day), outing (single day), radar (ongoing city monitor)",
          },
        ),
        label: Type.String({
          description: 'Human-readable name, e.g. "Boston August 2026"',
        }),
        emoji: Type.Optional(
          Type.String({ description: "Emoji for the context" }),
        ),
        city: Type.Optional(
          Type.String({ description: "City for the context" }),
        ),
        dates: Type.Optional(
          Type.String({ description: 'Dates, e.g. "August 15–18, 2026"' }),
        ),
        focus: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Focus areas e.g. ["food", "architecture", "jazz"]',
          }),
        ),
        setActive: Type.Optional(
          Type.Boolean({
            description: "Whether to mark this context active (default: true)",
          }),
        ),
      }),
      async execute(_id, params) {
        const userId = params.userId || "john";

        // Build slug from label
        const slug = params.label
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 40);
        const key = `${params.type}:${slug}`;

        const result = await compassApi(
          COMPASS_URL,
          COMPASS_KEY,
          "/api/internal/context",
          {
            action: "create",
            userId,
            context: {
              key,
              label: params.label,
              emoji: params.emoji || defaultEmoji(params.type, params.city),
              type: params.type,
              city: params.city,
              dates: params.dates,
              focus: params.focus || [],
              active: params.setActive !== false,
            },
          },
        );

        if (!result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Failed to create context: ${result.error}`,
              },
            ],
          };
        }

        const details: string[] = [];
        if (params.city) details.push(params.city);
        if (params.dates) details.push(params.dates);
        if (params.focus?.length) details.push(`focus: ${params.focus.join(", ")}`);

        const emoji = params.emoji || defaultEmoji(params.type, params.city);
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Created ${emoji} ${params.label} (${key})${details.length ? " — " + details.join(", ") : ""}`,
            },
          ],
        };
      },
    });
  },
});

// --- Helper: default emoji for context type ---

function defaultEmoji(type: string, city?: string): string {
  if (type === "radar") return "📡";
  if (type === "outing") return "🎭";
  const c = city?.toLowerCase() || "";
  if (c.includes("boston")) return "🦞";
  if (c.includes("nyc") || c.includes("new york")) return "🗽";
  if (c.includes("toronto")) return "🍁";
  if (c.includes("london")) return "🎡";
  if (c.includes("paris")) return "🗼";
  if (c.includes("tokyo")) return "🗾";
  if (c.includes("vancouver")) return "🏔️";
  if (c.includes("barcelona")) return "🏗️";
  if (c.includes("rome") || c.includes("roma")) return "🏛️";
  if (c.includes("istanbul")) return "🕌";
  return "✈️";
}
