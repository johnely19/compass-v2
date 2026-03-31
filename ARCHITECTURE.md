# Compass v2 — Architecture

> The travel intelligence app, rebuilt clean.

## What Compass Is

Compass is an **invite-only personal travel intelligence app**. It helps users discover, evaluate, and plan around places — restaurants, venues, experiences, accommodations. An AI concierge (Charlie) discovers places, and the user triages them: keep or dismiss.

It is **not** a social network or a content management system. Each user gets a deeply curated experience for their own city, taste profile, and trips — not a generic discovery feed.

**Google Maps is the foundation.** Every place in Compass is anchored to a **Google Place ID**. This is the primary key for everything: place cards, maps, photos, verification, deep-links. Compass is the intelligence and curation layer on top of Google's place graph. When you've decided you want to go somewhere, you tap "View in Maps" and Google takes over — directions, Street View, reviews, navigation. We curate. Google executes.

> Every place card with a `place_id` must show a **"View in Maps"** button that opens `https://www.google.com/maps/place/?q=place_id:{place_id}` — which opens the native Google Maps app on iOS/Android. This is not optional. It's the primary action after reading a Compass review.

**Phone-native first.** Compass is designed to be used standing on a street corner, with one thumb, with inconsistent cell signal. Every interaction must work at arm's length. Desktop is for planning sessions only — the primary experience is always mobile.

---

## Mobile Performance Contract

These are hard targets. Every PR that touches the homepage, place cards, or review pages must not regress them:

- **LCP (Largest Contentful Paint):** < 1.5s on 4G
- **INP:** < 100ms
- **CLS:** < 0.1 (no layout shift)
- **Homepage:** < 50KB HTML, < 100KB total JS (gzipped)
- **Place card:** renders useful content within 800ms
- **Images:** WebP only, lazy-loaded, explicit width/height (no reflow)
- **No blocking JS in `<head>`**
- **No layout shift on triage button press**
- **System fonts only:** `-apple-system, BlinkMacSystemFont, 'Segoe UI'` — no web font CDN calls
- **No component library dependencies** — hand-written CSS only (no shadcn, radix, headless UI)

---

## Place Review Philosophy

Every place description in Compass is written to this standard:

- **Second-person, evocative:** "You're going to walk in and smell the wood smoke before you see the room." Not "This is a well-regarded restaurant."
- **One specific detail** nobody else has — something you'd only know from being there or from deep research. The thing a friend who'd been there would tell you.
- **Honest about the one weakness** — the tables are close together, it gets loud after 8pm, reservations are required weeks out.
- **Ends with the handoff** — a "View in Maps" link so the user can navigate and go. Compass is the intelligence. Google is the execution.
- **Max 3 sentences.** Tight. No filler. No "this charming establishment."

---

---

## Core Concepts

### 1. Users
A user has a profile (name, city, invite code) and owns their data. One user is the **owner** (admin).

**Roles:**
There are exactly two roles:
- **User** — the standard experience. Sees their own contexts, discoveries, triage. Every person on Compass is a user.
- **Admin** — a user who also has access to `/admin` (user profiles, agent health, system monitoring). Admin is an elevation, not a separate identity.

John is a user. John also happens to be the admin. These are not conflated — the user experience is identical for John and everyone else. Admin access is additive.

**Testing plan:**
- John uses Compass as a regular user (with admin access for system oversight)
- Additional test accounts for QA (to verify the non-admin user experience)
- Post-V2: invite friends as real users for feedback on what has value

```
User {
  id: string           // Auto-generated sequential ID (e.g. "usr_001", "usr_002")
  name: string
  code: string         // URL-safe invite code (for sharing/onboarding)
  city: string         // home city (primary discovery radar)
  isOwner: boolean
  createdAt: ISO string
}
```

**Discovery Radar:**
Every user has a radar — the geographic focus for discovery. The radar fires based on:
1. **Home city** — always active, the default radar
2. **Active trip destinations** — when a user has an upcoming trip, that city becomes an additional radar target
3. **Outing locations** — if an outing specifies a different area, radar covers that too

Example: John lives in Toronto (always scanning). He has an NYC trip in April → NYC radar activates. The cottage search targets Lake Huron → that radar activates. Disco uses these radar targets to scope its research per user.

### 2. Contexts
A context is a bucket for discoveries. Every discovery belongs to a context. There are three types:

**Trip** — requires travel + accommodation. Has dates, has a destination city.
```
trip:nyc-april-2026     → NYC Solo Trip (April 27-30)
trip:cottage-july-2026  → Ontario Cottage (July 2026)
```

**Outing** — requires going somewhere, but no accommodation. You come home (or back to the hotel) after. Outings can be standalone (from home) or nested inside a trip.
```
outing:date-night-huzur          → Date Night with Huzur (standalone, Toronto)
outing:dinner-jackson             → Dinner with Jackson (standalone, Toronto)
outing:nyc:brooklyn-dinner        → Brooklyn dinner (nested in NYC trip)
```

**Radar** — an ongoing interest with no dates. Always active, always scanning. Replaces the old "section" concept.
```
radar:premium-grocery     → Exceptional produce shopping
radar:toronto-experiences → Local gems and discoveries
radar:developments        → Real estate projects and construction
```

```
Context {
  key: string          // "trip:slug", "outing:slug", "radar:slug"
  label: string        // "NYC Solo Trip"
  emoji: string        // "🗽"
  type: "trip" | "outing" | "radar"
  city?: string        // geographic scope (feeds the discovery radar)
  dates?: string       // "April 27-30, 2026" (trips and outings only)
  parentTrip?: string  // for outings nested in a trip (e.g. "trip:nyc-april-2026")
  focus: string[]      // "food", "jazz", "architecture"
  active: boolean
}
```

**Rules:**
- Context keys are simple: `trip:slug`, `outing:slug`, `radar:slug`
- No user prefix in context keys (user scoping is handled at the storage layer)
- Contexts are defined in the user's manifest
- Outings can reference a `parentTrip` — their city defaults to the trip's city
- Radars have no dates and are always active
- The discovery radar scans: home city + all active trip/outing cities

**Focus (what drives discovery):**

Focus determines what Disco looks for within a context. It comes from three layers:

**Layer 1: User preferences (per-user, global)**
The user's deep interests that apply across all contexts — their taste profile built over time through conversations, stated preferences, and onboarding. Examples: architecture, jazz, natural wine, contemporary art. These are always active as a background signal for every context.

```
User.preferences: string[]     // e.g. ["architecture", "jazz", "literary fiction", "wabi-sabi"]
```

**Layer 2: Context-specific focus (explicit)**
Set when a context is created — the primary filters for that context's radar. Can be set by the user, by Charlie, or through concierge chat.

```
Context.focus: string[]        // e.g. ["ramen", "galleries", "off-Broadway"]
```

Examples:
- NYC trip: `["Brooklyn food scene", "galleries", "off-Broadway"]`
- Date night: `["intimate", "wine bar", "French bistro"]`
- Cottage: `["waterfront", "swimming", "dock access"]`

**Layer 3: Learned from triage (implicit) — FUTURE ENHANCEMENT**
Over time, a user's save/dismiss patterns reveal preferences that sharpen focus automatically. If a user consistently saves ramen spots and dismisses Italian restaurants in their NYC context, the system learns to weight ramen higher.

```
Context.learned?: string[]     // Derived from triage patterns — V2+
```

This requires enough triage data to be statistically meaningful. Not in V2 launch scope, but the data model supports it — triage state is stored with timestamps, so pattern analysis can be built later.

**Layer 4: Cross-user trends (global) — FUTURE ENHANCEMENT**
After Compass has multiple active users, aggregate patterns emerge: places that many users save, categories that trend across users, seasonal patterns. This becomes a global signal layer that benefits all users — "people who liked X also saved Y."

```
Global.trends?: { category: string, signal: number }[]   // V3+
```

Not in V2 scope. Capture the per-user triage data cleanly now, and this becomes possible later without schema changes.

**How Disco uses focus:**
Disco combines layers when scanning: Layer 1 (user preferences) as background taste, Layer 2 (context focus) as primary filter. In V2, Layers 3 and 4 are not active but the data to power them is being collected.

### 3. Discoveries
A discovery is a place or experience that an agent (Disco) found for a user within a context. Discoveries arrive as **unreviewed**.

```
Discovery {
  id: string           // Internal discovery ID (auto-generated)
  place_id?: string    // Google Places ID (nullable — not all discoveries have one)
  name: string
  address?: string
  city: string
  type: DiscoveryType  // Categorized type (see below)
  rating?: number
  contextKey: string   // which context this belongs to
  source: string       // "disco:evening", "chat:recommendation"
  discoveredAt: ISO string
  match?: number       // 1-5 relevance score
  placeIdStatus: "verified" | "missing" | "changed" | "pending"
}
```

**Google Place ID — the foundation:**

Google Place ID is the primary key for linking discoveries to place cards, maps, reviews, and photos. However, not everything has one:

1. **Items without a Place ID** (`placeIdStatus: "missing"`)
   - Pop-ups, temporary events, new openings not yet on Google
   - Online-only businesses (specialty grocers with delivery only)
   - Areas/neighborhoods (not a single place)
   - These still get discovered and triaged — they just don't get a place card until a Place ID exists

2. **Place ID monitoring** (`placeIdStatus: "changed"`)
   - Google occasionally deprecates and replaces Place IDs
   - The system periodically re-verifies stored Place IDs against Google Places API
   - When a change is detected, the old ID maps to the new one and all references update

3. **Place ID resolution** (`placeIdStatus: "pending"` → `"verified"`)
   - Discoveries that initially lacked a Place ID get periodically re-checked
   - When Google indexes the place, the discovery upgrades from `"missing"` to `"verified"` and a place card can be built

**Discovery Types:**

The type determines how a discovery is displayed, what data is expected, and how it flows through the system.

| Type | Description | Examples |
|------|-------------|---------|
| `restaurant` | Sit-down dining | Bistros, fine dining, casual restaurants |
| `bar` | Drinks-focused venue | Wine bars, cocktail bars, pubs |
| `cafe` | Coffee, casual daytime | Coffee shops, bakery-cafes |
| `grocery` | Food shopping | Specialty grocers, markets, butchers |
| `gallery` | Visual art space | Art galleries, exhibition spaces |
| `museum` | Cultural institution | Museums, cultural centers |
| `theatre` | Live performance venue | Broadway, off-Broadway, dance, opera |
| `music-venue` | Live music | Jazz clubs, concert halls, music bars |
| `hotel` | Accommodation | Hotels, boutique stays |
| `experience` | Activity or event | Walking tours, classes, pop-ups, festivals |
| `shop` | Retail | Bookshops, design stores, specialty retail |
| `park` | Outdoor space | Parks, gardens, waterfronts |
| `architecture` | Notable building/structure | Landmark buildings, design-notable spaces |
| `development` | Real estate/construction | Condo projects, urban developments |
| `accommodation` | Non-hotel stays | Cottages, Airbnbs, vacation rentals |
| `neighbourhood` | Area recommendation | A district or neighbourhood to explore (no Place ID) |

**Rules:**
- Every discovery must have a type
- Type drives UI presentation (icon, card layout, expected fields)
- New types can be added but should be discussed — they ripple through the UI

### 4. Triage (The Core Loop)
Every discovery in every context has exactly one state:

```
unreviewed → saved      (user clicks +)
unreviewed → dismissed  (user clicks −)
saved → unreviewed      (user un-saves)
dismissed → unreviewed  (user restores)

saved → resurfaced      (system detects significant change)
dismissed → resurfaced  (system detects significant change)
resurfaced → saved      (user re-reviews, keeps)
resurfaced → dismissed  (user re-reviews, dismisses again)
```

**Resurfacing:** A previously reviewed place can be flagged for re-review when Disco detects a significant change:
- Restaurant reopens after closure
- New ownership or major renovation
- Menu overhaul or concept change
- Ratings shift significantly (e.g. 3.5 → 4.5)
- Seasonal relevance (a rooftop bar becomes relevant again in spring)

When resurfaced, the place appears in the "Needs Review" tab again with a badge explaining why (e.g. "Reopened", "New menu", "Rating changed"). The user's previous decision is preserved in history so they have context.

**One system. One storage location. No exceptions.**

```
TriageStore {
  // localStorage key: "compass-triage-{userId}"
  [contextKey]: {
    triage: {
      [placeId]: {
        state: "saved" | "dismissed" | "resurfaced",
        updatedAt: ISO,
        previousState?: "saved" | "dismissed",    // what it was before resurfacing
        resurfaceReason?: string                   // "Reopened", "New menu", etc.
      }
    },
    seen: {
      [placeId]: { firstSeen: ISO, name, city, type }
    }
  }
}
```

**Display rules:**
- **Homepage:** Show `unreviewed` (and `resurfaced`) only. This is the inbox — what needs your attention. Saved and dismissed are not shown here.
- **Context detail page** (e.g. `/trip/nyc-april-2026`): Show `unreviewed` tab (default), `saved` tab, and a "Show dismissed" toggle. Full triage management happens here.
- **Place card detail:** Show exactly one set of triage buttons for the **current context** (determined by how the user navigated there). No generic/catch-all triage — always context-specific.

**Page filters:**
Any page that shows a list of places (homepage, context detail, review, placecards browse) should support filters to narrow what's visible:

- **By type** — show only restaurants, or only bars, or only galleries (uses DiscoveryType)
- **By rating** — minimum star rating threshold
- **By recency** — discovered in last 24h, last week, etc.

Filters are additive (AND logic). They're client-side UI controls — fast, no server round-trip. Filter state resets on page navigation (not persisted).

### 5. Place Cards
A place card is the rich detail view for a discovery. **Place card templates are driven by discovery type** — a restaurant card looks different from a gallery card, which looks different from a cottage card. Type is foundational to how place cards render.

```
PlaceCard {
  place_id: string
  name: string
  type: DiscoveryType         // Determines which template + widgets to use
  data: {
    description: string
    highlights: string[]
    hours?: Record<string, string>
    images: { path: string, category: string }[]
    // Type-specific data (see templates below)
  }
}
```

Storage: `data/placecards/{place_id}/` with `card.json` + `images/`

**Type-driven templates:**

Each discovery type has a template that defines which widgets appear and in what order:

| Type | Template includes |
|------|------------------|
| `restaurant` | Hero image, rating widget, menu widget, hours widget, map widget, photo gallery |
| `bar` | Hero image, rating widget, drinks/menu widget, hours widget, vibe description, map widget |
| `cafe` | Hero image, rating widget, hours widget, map widget |
| `gallery` | Hero image, current exhibition widget, hours widget, map widget, photo gallery |
| `museum` | Hero image, exhibitions widget, hours widget, admission widget, map widget |
| `theatre` | Hero image, current shows widget, seating/pricing widget, map widget |
| `music-venue` | Hero image, rating widget, upcoming shows widget, vibe description, map widget |
| `hotel` | Hero image, rating widget, room types widget, amenities widget, map widget |
| `accommodation` | Hero image, amenities widget, availability widget, pricing widget, map widget, photo gallery |
| `experience` | Hero image, description, dates/schedule widget, pricing widget, map widget |
| `development` | Rendering image, status widget, developer/architect info, key dates widget, map widget |
| `neighbourhood` | Hero image, description, highlights list, walking route widget, map widget |
| `grocery` | Hero image, rating widget, specialties widget, hours widget, map widget |
| `shop` | Hero image, rating widget, description, hours widget, map widget |
| `park` | Hero image, description, amenities widget, map widget |
| `architecture` | Hero image, description, architect/year widget, photo gallery, map widget |

**Widget System:**

Widgets are reusable graphical components shared across place card types. A widget renders the same way regardless of which type uses it — consistent look, consistent data contract.

**Core widgets:**

| Widget | Purpose | Used by |
|--------|---------|---------|
| `RatingWidget` | Star rating, review count, rating distribution | restaurant, bar, cafe, music-venue, hotel, grocery, shop |
| `HoursWidget` | Opening hours by day, highlights current day | restaurant, bar, cafe, gallery, museum, grocery, shop |
| `MapWidget` | Embedded map centered on the place | All types |
| `PhotoGallery` | Swipeable image gallery with categories | restaurant, bar, gallery, accommodation, architecture |
| `MenuWidget` | Categorized menu with items, prices, ⭐ highlights | restaurant, bar, cafe |
| `PricingWidget` | Cost information (per night, per ticket, etc.) | hotel, accommodation, experience, theatre |
| `StatusWidget` | Current status badge (open, closed, under construction) | development, accommodation |
| `KeyDatesWidget` | Timeline of important dates | development, experience |
| `AmenitiesWidget` | Feature list with icons | hotel, accommodation, park |
| `ExhibitionWidget` | Current/upcoming exhibitions or shows | gallery, museum, theatre, music-venue |
| `TriageWidget` | +/− buttons for current context | All types |

**Rules:**
- Every place card must declare its `type`
- The type selects the template, which determines widget composition
- Widgets are self-contained components with a defined data contract
- New widgets can be added without changing existing templates
- New types require a new template definition but reuse existing widgets
- Widget rendering is identical across all types that use it (e.g. RatingWidget looks the same on a restaurant and a bar)

### 6. Chat (Concierge)
The AI concierge lives in a chat widget. It can:
- Search the web
- Look up places on Google Maps
- Add places to the user's Compass (creates a discovery)
- Extract preferences from conversation
- Create and update contexts (trips, outings, radars)

Chat is **per-user**, persisted in Vercel Blob.

**Conversational Data Extraction:**

The concierge treats every conversation as a potential data source. Users should never need to fill out forms or explicitly declare "this is a new trip." The concierge intuits structure from natural conversation.

**What it listens for:**

| Signal | Example | Action |
|--------|---------|--------|
| Trip | "We're going to Paris in September" | Create `trip:paris-september-2026`, set city/dates/companions |
| Outing | "I want to take Huzur somewhere nice for dinner" | Create `outing:date-night-huzur`, set focus |
| Preference | "I've been really into natural wine lately" | Add "natural wine" to Layer 1 preferences |
| Preference removal | "Actually I don't like sushi" | Remove from preferences |
| Context update | "The trip is pushed to October" | Update trip dates |
| Context cancel | "We cancelled the Paris trip" | Deactivate context |
| Radar | "I'm always looking for great bookshops" | Create `radar:bookshops` |
| Companion | "My daughter Dessa lives in Brooklyn" | Add to user profile |

**How it works:**
1. **Extract** — Concierge detects structured data in natural conversation
2. **Confirm lightly** — "Paris in September — amazing. I'll start finding places for you." (not "Would you like me to create a trip context?")
3. **Write** — Updates the user's manifest/preferences via API
4. **Source tag** — Every auto-extracted update is tagged `source: "chat:extraction"` for audit

**What the concierge writes:**

| Document | What concierge can update |
|----------|--------------------------|
| `manifest.json` | Create/update/deactivate contexts, update focus areas |
| `preferences.json` | Add/remove interests, cuisine preferences, vibes |
| `profile.json` | Update city, add companions |
| `discoveries.json` | Add places recommended in chat |
| `chat.json` | Conversation history (automatic) |

**What only admin can do:**
- Delete a user
- Change `isOwner` status
- Override any document directly (for corrections)

**The principle:** Extract, confirm lightly, never require forms. The app learns by listening.

### 7. Context Lifecycle

Contexts are not permanent — they have a lifecycle.

**Trips:**
```
active → completed → archived
```
- **Active:** Radar is firing, discoveries flowing, shows on homepage
- **Completed:** Trip end date + 7 day grace period passes → auto-completes
- **Archived:** Concierge prompts "How was your trip?" to capture feedback, then context moves to archive. Discoveries remain accessible in review but off the homepage.

**Outings:**
Outings have two layers — the **occasion** (recurring) and the **instance** (specific).

```
Occasion: "Date Night with Huzur" → stays active (recurring)
Instance: "L'Avenue, March 6" → completed → archived after the date
```

- The occasion (`outing:date-night-huzur`) is ongoing — it represents a recurring need. Disco keeps scanning for it.
- Each specific instance (a particular restaurant on a particular date) gets archived after it happens.
- Concierge prompts: "How was L'Avenue?" → captures feedback (great, meh, never again) → informs future discovery focus.
- The saved places from past instances become part of the user's history — "proven winners" that inform future recommendations.

**Radars:**
```
active → paused → active (toggle)
```
- Radars don't end — they're always-on interests
- User can pause a radar ("stop looking for grocery stores for now")
- Pausing stops Disco from scanning but preserves all data

### 8. Notifications & Delivery

**The app is pull-only.** Compass does not have an in-app notification system in V2.

**External delivery (Telegram/Discord) is a teaser:**
- Morning briefings are sent via Telegram/Discord as a short summary with a link to the app
- The teaser answers: "Why should you open Compass right now?" (new discoveries, resurfaced places, trip reminders)
- The full experience happens in the app — the teaser drives you there

**Example teaser:**
> ☀️ Good morning — 4 new places for your NYC trip, 2 for date night. A dismissed spot reopened with a new chef.
> 🧭 compass-ai-agent.vercel.app

### 9. Triage Storage

**V2: localStorage (client-side)**
- Instant, no API calls, no latency
- Key: `compass-triage-{userId}`
- Per-device (phone and desktop are separate)

**Known limitations:**
- Lost if browser data is cleared
- Doesn't sync across devices

**Future: Server sync (V2+)**
Add triage sync to Vercel Blob so triage state persists across devices and survives browser clears. localStorage remains the fast local cache, with periodic sync to server. Capture this as a future enhancement.

| Enhancement | Target | Description |
|------------|--------|-------------|
| Triage server sync | V2+ | Sync triage state to Vercel Blob for cross-device persistence |
| In-app notifications | V3+ | Native notification feed inside the app |

---

## Pages

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Homepage — active contexts showing unreviewed discoveries | Public (user-scoped) |
| `/placecards` | **My Places** — browse the current user's own discovered places (filtered by their contexts and triage state). NOT a global card library. Owner admin toggle shows full index. | User-scoped |
| `/placecards/[placeId]` | Place card detail — type-driven template with widgets | Public |
| `/review` | Review hub — all contexts with triage counts | Public (user-scoped) |
| `/review/[contextKey]` | Per-context review — unreviewed/saved/dismissed tabs | Public (user-scoped) |
| `/hot` | What's Hot — trending/new discoveries | Public |
| `/admin` | Admin dashboard — users, agent health, cron monitor, token usage | Owner only |

**Admin page sections:**
- **User Management + Profiles** — for each user, a detailed view showing:
  - Stored preferences (Layer 1 — full list, editable)
  - Active contexts (trips, outings, radars — with focus areas, dates, cities)
  - Triage summary (saved/dismissed counts per context)
  - Discovery stats (how many received, triage rate)
  - Onboarding status (complete, partial, what's missing)
  - This is the **source of truth audit** — verify that the system's understanding of the user matches reality. Catch mistakes, fill gaps, correct drift.
- **Agent Health Dashboard** (live agent status, model, tokens, last activity)
- **Cron Job Monitor** (job health, schedules, errors)
- **Token Usage Dashboard** (hourly bars, 5-min intervals, per-agent breakdown)

**Removed:** `/drift`, `/pulse`, `/rezo`, `/wander`, `/zine`, `/work`, `/examples`, `/mission`, `/cottages` — experiments and special-case pages. Cottages are a trip type, not a separate page. Mission Control is replaced by the Agent Health Dashboard on `/admin`.

---

## API Routes

| Route | Purpose |
|-------|---------|
| `GET /api/auth` | Current user from cookie |
| `POST /api/chat` | Chat with concierge (streaming) |
| `GET /api/user/discoveries` | User's discoveries |
| `POST /api/user/discoveries` | Add discoveries (from Disco agent) |
| `GET /api/users/[code]` | User profile |
| `GET /api/users/[code]/chat-context` | Chat history for user |
| `POST /api/briefing-ingest` | Receive morning briefing from Charlie |
| `GET /api/admin/tokens` | Token usage data (owner only) |
| `GET /api/admin/user` | User management (owner only) |

**Removed:** Anything redundant or unused.

---

## Data Flow

### Onboarding (new user)

Before Disco can discover anything, it needs to know the user. Onboarding is the first interaction — proactive, conversational, and thorough.

```
New user arrives (via invite code)
         │
         ▼
┌─────────────────────────┐
│   Concierge Onboarding  │
│                         │
│  1. Welcome + intro     │
│  2. Where do you live?  │  → sets home city (primary radar)
│  3. What are you into?  │  → sets Layer 1 preferences
│     (food, art, music,  │     (interests, cuisines, vibes)
│      architecture, etc) │
│  4. Any upcoming trips? │  → creates trip contexts
│     Where? When? Focus? │     (with dates, cities, focus)
│  5. Regular outings?    │  → creates outing contexts
│     Date nights, family │     (type, frequency, preferences)
│     dinners, etc.       │
│  6. Ongoing interests?  │  → creates radar contexts
│     Grocery, local gems │     (always-on discovery targets)
│                         │
│  Suggest setup:         │
│  "Based on what you've  │
│   told me, here's what  │
│   I've set up for you.  │
│   Anything to add?"     │
│                         │
└─────────┬───────────────┘
          │
          ▼
   User manifest created
   (contexts + preferences)
          │
          ▼
   Disco starts scanning
   (radar targets active)
```

**Onboarding rules:**
- Concierge drives the conversation — proactive, not passive
- Collect enough to create at least one context and meaningful preferences
- Don't overwhelm — get the essentials, then refine over time through conversation
- Every piece of information maps to the data model: preferences, contexts, focus areas
- Onboarding can be resumed — if the user drops off, pick up where they left off
- After onboarding, Disco has everything it needs to start discovering immediately

**Minimum viable profile:**
- Home city (required)
- At least 3 interests/preferences
- At least 1 context (trip, outing, or radar)

---

### Discovery flow (ongoing)

```
                    ┌──────────┐
                    │  Disco   │ (discovers places)
                    └────┬─────┘
                         │ POST /api/user/discoveries
                         ▼
              ┌─────────────────────┐
              │   Vercel Blob       │
              │   users/{id}/       │
              │     discoveries.json│
              │     manifest.json   │
              │     profile.json    │
              │     chat.json       │
              └─────────┬───────────┘
                        │ read at render time
                        ▼
              ┌─────────────────────┐
              │   Homepage (SSR)    │
              │   Shows discoveries │
              │   per context       │
              └─────────┬───────────┘
                        │ hydrate
                        ▼
              ┌─────────────────────┐
              │   Client (Browser)  │
              │   localStorage:     │
              │   compass-triage-{id}│
              │                     │
              │   Triage buttons    │
              │   filter dismissed  │
              │   from view         │
              └─────────────────────┘
```

**Key decision: Server renders all discoveries. Client filters dismissed.**

This means:
- Server doesn't need to know triage state
- Triage is instant (no API call)
- But homepage must hydrate and filter client-side after initial render
- A brief flash of dismissed items is acceptable (or use CSS `visibility: hidden` until hydrated)

---

## Storage

| What | Where | Why |
|------|-------|-----|
| User data (profile, discoveries, chat, manifest) | Vercel Blob | Per-user, persistent, server-accessible |
| Place cards | `data/placecards/` (filesystem) | Large, static, git-tracked |
| Accommodation data | `data/placecards/` (filesystem) | Cottages are place cards of type `accommodation` |
| Triage state | `localStorage` (browser) | Instant, per-device, no API needed |
| Compass manifest | `data/compass-manifest.json` | Global context definitions |
| Users index | `data/users.json` | User registry |

**No dual storage systems.** Each piece of data has exactly one home.

**Place cards are a render layer, not a content collection.** A place card exists because a discovery needed it. The filesystem card data is a lookup cache — accessed through the discovery pipeline, not browsed independently. The flow is always: User → Context → Discovery → Place Card. There is no global place card library visible to users.

---

## Auth

Simple cookie-based. No passwords, no OAuth.

- User visits `/u/{code}` → sets `compass-user={userId}` cookie (code maps to userId)
- All pages read the cookie to determine current user
- Owner check: `users.json[userId].isOwner === true`
- No cookie = anonymous browsing (limited functionality)

---

## Component Architecture

### Core Components
```
Layout
├── Nav (top bar, user avatar)
├── ChatWidget (floating, per-user)
├── FilterBar (type, rating, recency — shared across list pages)
└── Page content

PlaceGrid (reusable card grid)
├── PlaceCard (single card with image, name, type icon, triage buttons)
│   └── TriageButtons (+/−, single system, context-specific)
└── Triage summary (Saved X, Dismissed Y → link to context detail)

PlaceDetail (full place card view — type-driven template)
├── Widgets (composed per type — see Widget System)
└── TriageWidget (same triage system, current context only)
```

### Rules
- **One triage component:** `TriageButtons` / `TriageWidget`. No alternatives, no duplicates.
- **One image component:** Standardized image loading with fallbacks.
- **Context key is always:** `trip:slug`, `outing:slug`, or `radar:slug` — no user prefix.
- **Type is always visible:** Every place card shows its type (icon + label) so users know what they're looking at.
- **Google Maps link on every place:** Every place with a Place ID links to Google Maps.

---

## Agent Integration

| Agent | Interaction with Compass |
|-------|------------------------|
| **Disco** | Pushes discoveries via `POST /api/user/discoveries` |
| **Charlie** | Sends morning briefings via `POST /api/briefing-ingest` |
| **Chat (Concierge)** | Powers `/api/chat` — runs in-app |
| **DevClaw** | Develops and deploys Compass code |

Agents write data. Compass reads and displays it. Users triage it.

---

## Tech Stack

- **Framework:** Next.js 16 (App Router, Server Components)
- **Language:** TypeScript (strict mode, no `any`)
- **Styling:** CSS (no Tailwind, no CSS-in-JS — plain CSS with BEM-ish classes)
- **Storage:** Vercel Blob (user data) + filesystem (place cards, static data)
- **Hosting:** Vercel (production) + localhost:3001 (development)
- **Chat AI:** Anthropic Claude via Vercel AI SDK
- **Place data:** Google Places API (via goplaces CLI)

---

## What We're NOT Building

- ❌ User authentication (OAuth, passwords, sessions)
- ❌ Real-time collaboration
- ❌ Social features (sharing, comments, followers)
- ❌ Payment/booking integration
- ❌ Desktop-first features — anything that requires a keyboard, large screen, or mouse as primary interaction
- ❌ Multiple homepage experiments (one design, done well)
- ❌ CMS or content editing UI
- ❌ Native iOS app (on hold — charlie-ios exists but Compass is Google Place ID-based and the web PWA is the primary surface)
- ❌ Apple Maps integration (we are a Google Maps app)

---

## Migration Plan

### Phase 1: Foundation
- New repo, clean Next.js 16 project
- TypeScript strict from day one
- Port CSS/design tokens from current app
- Set up Vercel project + Blob storage connection
- Basic layout, nav, auth (cookie)

### Phase 2: Core Pages
- Homepage with contexts + discovery cards + triage
- Place cards listing + detail pages
- Review page with triage tabs
- Port 408 existing place cards (data copy)

### Phase 3: Features
- Chat widget + concierge API (including onboarding flow)
- What's Hot page
- Admin dashboard (user profiles, agent health, cron monitor, token usage)
- Morning briefing ingest
- Page filters (by type, rating, recency)

### Phase 4: Agent Wiring
- Disco → discovery push API
- Charlie → briefing ingest
- DevClaw → owns the new repo
- Verify all agent integrations end-to-end

---

## Future Enhancements (Post-V2)

Captured here so nothing gets forgotten. These are explicitly **not in V2 scope** but the V2 data model is designed to support them without schema changes.

| Enhancement | Target | Description |
|------------|--------|-------------|
| Booking functionality | V2+ | Full booking integration (restaurants, hotels, tickets) within the concierge flow |
| Learned focus from triage | V2+ | Analyze save/dismiss patterns per user per context to auto-sharpen discovery focus |
| Triage server sync | V2+ | Sync triage state to Vercel Blob for cross-device persistence; localStorage as fast cache |
| Cross-user trends | V3+ | Aggregate patterns across users — "people who saved X also saved Y", seasonal trends, category popularity |
| In-app notifications | V3+ | Native notification feed inside the app, replacing external teasers |

During the V2 build, each future enhancement also gets created as a **GitHub issue** labeled `future` in the compass-v2 repo. The table here is the quick reference; the issues are the actionable backlog.

---

*This is the blueprint. No code until we agree on every section.*
