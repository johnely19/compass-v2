# Compass Concierge — OpenClaw Configuration Guide

This document describes how to configure the OpenClaw "concierge" agent to serve as the Compass Concierge, replacing the in-app mini-concierge (Anthropic SDK direct calls) with the full OpenClaw agent runtime.

## Architecture Overview

```
Compass App (chat UI)
    │
    ▼ POST /v1/chat/completions (OpenAI-compatible)
OpenClaw Gateway (port 19001)
    │
    ▼ Routes to "concierge" agent
OpenClaw Agent Runtime
    ├── System prompt from SOUL.md + IDENTITY.md
    ├── Built-in tools: web_search, goplaces, web_fetch
    ├── Plugin tools: compass_add_discovery, compass_save_discovery,
    │                 compass_update_trip, compass_create_context
    └── Per-user session isolation via session key
    │
    ▼ Plugin calls Compass internal API
Compass App (Vercel)
    ├── /api/internal/discoveries  (add discoveries)
    ├── /api/internal/triage       (set triage state)
    └── /api/internal/context      (create/update contexts)
```

## 1. Agent Setup

The concierge agent already exists. Configure its workspace and identity:

```bash
# Set the workspace to the concierge config directory
# (contains SOUL.md, IDENTITY.md, and plugin config)
# This can be done via openclaw agents or by copying files to the agent workspace

# Copy workspace files to the concierge agent's workspace
mkdir -p ~/.openclaw/agents/concierge/workspace
cp openclaw/concierge/SOUL.md ~/.openclaw/agents/concierge/workspace/
cp openclaw/concierge/IDENTITY.md ~/.openclaw/agents/concierge/workspace/
```

## 2. Plugin Installation

The compass-tools plugin provides 4 Compass-specific tools:

| Tool | Description | Replaces |
|------|-------------|----------|
| `compass_add_discovery` | Push a discovery to user's Compass | `add_to_compass` |
| `compass_save_discovery` | Save + mark triage state | `save_discovery` |
| `compass_update_trip` | Update trip dates/accommodation/focus | `update_trip` |
| `compass_create_context` | Create trip/outing/radar | `create_context` |

Built-in OpenClaw tools replace the other 2:
- `web_search` → replaces Brave Search (uses OpenClaw's configured search provider)
- `goplaces` → replaces `lookup_place` (uses Google Places API via OpenClaw skill)

### Install the plugin:

```bash
# From the compass-v2 repo root:
openclaw plugins install ./openclaw/plugins/compass-tools

# Or add to openclaw.json config manually:
# plugins.entries.compass-tools.enabled = true
# plugins.entries.compass-tools.config.compassApiUrl = "https://compass-v2-lake.vercel.app"
# plugins.entries.compass-tools.config.compassApiKey = "<INTERNAL_API_KEY>"
```

### Environment variables (alternative to plugin config):

```bash
export COMPASS_API_URL="https://compass-v2-lake.vercel.app"
export COMPASS_INTERNAL_API_KEY="4f3e141330645145150e999e75b993185f26e4c519f97caa20b727fb74175f8c"
```

## 3. Per-User Session Isolation

When Compass sends chat requests to OpenClaw, it includes a session key that ensures each user gets their own persistent conversation:

**Session key format:** `compass:user:{userId}`

This is set via the `x-session-id` header or `sessionId` field in the request body from the Compass chat proxy (implemented in issue #191).

Each session:
- Has its own conversation history
- Persists across visits (OpenClaw manages session storage)
- Can be compacted independently when context fills up

## 4. User Context Injection

When a chat request arrives from Compass, user context is injected as a system message prefix. The Compass chat proxy (#191) includes this in the `messages` array or as part of the system prompt.

User context includes:
- **User code** and **home city**
- **Active contexts** (trips, outings, radars) with keys, dates, focus areas
- **User preferences** (interests, cuisines, vibes, avoidances)
- **Recent discoveries** (last 5 places added)

Format:
```
## USER CITY
User's home city: Toronto

## USER PREFERENCES (Layer 1)
Interests: architecture, jazz, natural wine
Cuisines: French, Japanese, Ethiopian
Vibes: intimate, lively

## ACTIVE CONTEXTS
- 🦞 Boston August 2026 (August 15–18, 2026) — Focus: food, architecture
  Key: trip:boston-august-2026
- 📡 Toronto Radar — Focus: restaurants, bars
  Key: radar:toronto-experiences

## RECENT DISCOVERIES
- Published on Main (restaurant) — Vancouver
- Canoe (restaurant) — Toronto
```

## 5. Internal API Endpoints

Three new internal API endpoints support the plugin tools:

### POST /api/internal/discoveries
Existing endpoint. Pushes discoveries to user's Blob storage.

### POST /api/internal/context (NEW)
Creates or updates contexts in user's manifest.
- `action: "create"` — Create a new trip/outing/radar
- `action: "update"` — Update an existing context's fields

### POST /api/internal/triage (NEW)
Sets triage state for a discovery (saved/dismissed).

All endpoints authenticated via `Authorization: Bearer <INTERNAL_API_KEY>`.

## 6. Migration Path

The migration from in-app concierge to OpenClaw concierge is:

1. ✅ **Issue #191**: Compass app proxies chat to OpenClaw gateway
2. ✅ **Issue #192** (this): Configure concierge agent with prompt + tools
3. **Issue #193** (next): Wire up the proxy, test end-to-end, deprecate direct Anthropic calls

During migration, both paths can coexist. The chat proxy (#191) can feature-flag between direct Anthropic calls and OpenClaw routing.
