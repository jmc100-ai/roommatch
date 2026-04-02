# RoomMatch — Project Context for Claude Code

## What This Is
RoomMatch is a hotel room visual search engine. Users describe their ideal hotel room in natural language ("modern bathroom with double sinks and soaking tub") and get back ranked hotel results with matching room photos.

Live at: **https://www.travelboop.com**
GitHub: **https://github.com/jmc100-ai/roommatch**
Render service: **https://roommatch-1fg5.onrender.com** (service ID: srv-d6s27b75r7bs738737fg)
Supabase project ID: **dmgxrcmdihgsffvqllms**

---

## Architecture

```
FRONTEND (client/index.html)
  → Express backend (server.js) on Render paid tier
  → Vector Search (only mode — LiteAPI room-search is broken)

VECTOR SEARCH PIPELINE:
  User query
  → HyDE: Gemini 2.5 Flash Lite generates a hypothetical room caption
  → gemini-embedding-001 embeds the HyDE caption (768 dims)
  → Phase A: score_room_types RPC scans room_types_index
      - If query triggers a feature flag (e.g. "double sinks"):
        → DB pre-filter: only room types with features @> {double_sinks:true}
      - Returns per-room-type similarity scores for all matching hotels
  → Phase B: fetch_hotel_photos RPC fetches photos for top hotels
  → Score remapping: raw similarity → 0-100% display score
  → Return ranked hotels with photos

INDEXING PIPELINE:
  POST /api/index-city → scripts/index-city.js
  LiteAPI /data/hotels → /data/hotel (photos + room IDs)
  → Gemini 2.5 Flash Lite (structured captions + photo_type classification)
  → extractFeatureSummary() → photo-type-filtered embedding text
  → extractFeatureFlags() → jsonb boolean flags (double_sinks, walk_in_shower, etc.)
  → gemini-embedding-001 → feature_embedding vector(768)
  → Upsert to room_embeddings (with feature_flags, feature_embedding)
  → After all hotels done: rebuild_room_types_index_city() auto-called

PRICING PIPELINE:
  Dates entered → POST /api/rates → LiteAPI /hotels/rates (batch, all city hotels)
  → roomPrices keyed by mappedRoomId (bridges rates API ↔ catalog API)
  → hotel-level cheapest price shown in card header
  → per-room price shown in room row (matched via room_type_id from DB)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js + Express, deployed on Render **paid tier** |
| Frontend | Single HTML file, vanilla JS |
| Hotel data | LiteAPI (production key) |
| Photo captioning | Gemini 2.5 Flash Lite (`gemini-2.5-flash-lite`) |
| Query expansion | HyDE via Gemini 2.5 Flash Lite (cached per query string) |
| Embeddings | Gemini `gemini-embedding-001` (3072 dims, truncated to 768) |
| Vector DB | Supabase pgvector |
| City autocomplete | Geoapify API |

---

## Environment Variables (Render)

```
LITEAPI_PROD_KEY       — LiteAPI production key (primary)
LITEAPI_KEY            — LiteAPI sandbox (fallback)
GEMINI_KEY             — Google AI Studio (captioning + embeddings)
SUPABASE_URL           — https://dmgxrcmdihgsffvqllms.supabase.co
SUPABASE_ANON_KEY      — public anon key
SUPABASE_SERVICE_KEY   — service role key (write access for indexer)
GEOAPIFY_KEY           — city autocomplete
RENDER_EXTERNAL_URL    — https://roommatch-1fg5.onrender.com (keepalive)
INDEX_SECRET           — roommatch-2026 (protects indexing + backfill endpoints)
UNSPLASH_KEY           — (not yet set) free key from unsplash.com/developers — needed for neighborhood card photos
SITE_PASSWORD          — (not yet set) simple password gate for the frontend; omit to disable gate (API routes never gated)
```

---

## File Structure

```
roommatch/
├── server.js                    — Express backend (all API endpoints)
├── package.json                 — deps: express, cors, dotenv, @supabase/supabase-js
├── render.yaml                  — Render deployment config
├── CLAUDE.md                    — this file
├── client/
│   └── index.html               — full frontend (single file, vanilla JS)
├── scripts/
│   ├── index-city.js            — batch indexing script (captions + embeddings + feature flags)
│   ├── backfill-room-ids.js     — backfill room_type_id for existing rows
│   └── test-search-quality.js  — automated search quality tests (7 tests, run with node)
└── supabase/
    ├── schema.sql               — full DB schema
    ├── migrate-768.sql          — 768-dim vectors + ivfflat + disable RLS
    ├── fix-permissions.sql      — grants permissions on all tables
    ├── add-hotel-name.sql       — adds hotel_name column
    ├── feature-flags.sql        — bulk UPDATE room_embeddings.feature_flags from feature_summary
    ├── rebuild-functions.sql    — CREATE OR REPLACE for rebuild_room_types_index_city,
    │                              score_room_types, fetch_hotel_photos
    └── migrate-3072.sql         — SUPERSEDED, do not use
```

---

## Supabase Database

**Project ID:** dmgxrcmdihgsffvqllms — Region: us-west-2

### Tables

**indexed_cities** — tracks indexing status per city
- city, country_code, status (pending|indexing|complete|failed|cancelled), hotel_count, photo_count, started_at, completed_at, last_error, stop_requested

**hotels_cache** — hotel metadata cache
- hotel_id (PK), city, country_code, name, address, star_rating, guest_rating, main_photo, cached_at

**room_embeddings** — core table, one row per photo
- id, hotel_id, city, country_code, hotel_name, room_name, room_type_id (TEXT, LiteAPI integer)
- photo_type (bedroom|bathroom|living|view|other) — Gemini self-classifies
- caption, feature_summary (cleaned caption text used for embedding), feature_embedding vector(768)
- feature_flags jsonb — boolean flags parsed from feature_summary (e.g. `{"double_sinks":true}`)
- embedding vector(768), star_rating, guest_rating, created_at
- UNIQUE(hotel_id, photo_url)

**room_types_index** — aggregated per (hotel_id, room_name, photo_type), rebuilt after indexing
- id, hotel_id, city, country_code, room_name, photo_type
- embedding vector(768) — avg of feature_embeddings for the group
- features jsonb — confirmed feature flags for the room type (multi-photo confirmed)
- updated_at

### Key SQL functions

**`score_room_types(query_embedding vector, search_city text, required_features jsonb DEFAULT NULL, hotel_ids text[] DEFAULT NULL)`**
- Scans `room_types_index` for the city
- If `required_features` provided: `WHERE features @> required_features` pre-filter
- Returns hotel_id, room_name, photo_type, similarity (cosine)

**`rebuild_room_types_index_city(p_city text)`**
- Rebuilds `room_types_index` from `room_embeddings` for a city
- Confirmation rules for high-risk flags (double_sinks, walk_in_shower, rainfall_shower):
  - Primary: room type has ≥2 photos with the flag
  - Fallback: hotel has ≥2 total photos with the flag across ANY room types
    (LiteAPI often indexes 1 bathroom photo per room type at luxury hotels)
- All other flags: ≥2 photos OR single-photo group
- AUTO-CALLED by indexCity() after completing — no manual step needed

**`fetch_hotel_photos(hotel_ids text[], max_per_hotel int DEFAULT 40)`**
- Returns photo rows for a list of hotel IDs (up to max_per_hotel each)
- SET LOCAL statement_timeout = '30000' inside function

### PostgREST config (do not revert)
```sql
ALTER ROLE authenticator SET pgrst.db_max_rows = '10000';
NOTIFY pgrst, 'reload config';
```

### Current Index Status
- **Paris: 999 hotels, ~60,000+ photos** (full city indexed, structured captions, feature flags populated)
- **Kuala Lumpur: 200 hotels, 9,258 photos** (indexed March 2026)
- London, NYC: not yet indexed

### Feature flag counts (as of March 2026)
| Feature | Paris hotels | KL hotels |
|---|---|---|
| double_sinks | 159 | 33 |
| rainfall_shower | 384 | 40 |
| walk_in_shower | 748 | 157 |
| soaking_tub | 50 | 19 |
| bathtub | 677 | 87 |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| GET /api/vsearch?query&city | Vector search (main mode) |
| GET /api/rates?city&checkin&checkout | Batch hotel+room pricing from LiteAPI |
| GET /api/index-status?city | Check indexing status |
| POST /api/index-city | Trigger indexing (requires INDEX_SECRET in body) |
| POST /api/backfill-feature-embeddings | Re-embed feature_summary + re-extract feature_flags for a city |
| POST /api/backfill-room-ids | Backfill room_type_id for existing rows (requires INDEX_SECRET) |
| GET /api/debug-city?city | LiteAPI coverage analysis |
| GET /api/debug-gemini | Test available Gemini model names |
| GET /api/debug-photos?hotelId | Show raw LiteAPI photo fields |
| GET /api/health | Health check |

---

## Indexer (scripts/index-city.js)

Triggered via: `POST /api/index-city {"city":"Kuala Lumpur","limit":200,"secret":"roommatch-2026"}`

**Flow:**
1. Fetch hotels sorted by star rating (best hotels first)
2. 20 hotels concurrent: fetch room detail → collect photos (max 10/room type, 60/hotel)
3. Per photo: caption → `extractFeatureSummary(caption, photoType)` → `extractFeatureFlags(summary)` → embed → upsert
4. Upsert to `room_embeddings` with `feature_flags`, `feature_embedding`, `feature_summary`
5. DB_CONCURRENCY=3 semaphore prevents connection pool exhaustion
6. After all hotels done: **auto-calls `rebuild_room_types_index_city(city)`**
7. Rate limits: 500 caption/min, 1000 embed/min (paid Gemini tier). ~20–30 min for 200 hotels.

**CRITICAL: geminiCaption signature:**
```javascript
geminiCaption(imageUrl, photoContext = {type, roomName}, retries = 3)
```
photoContext MUST be passed. If omitted: "photo is not defined" error on every call.

**Feature flag extraction:**
- `extractFeatureSummary(caption, photoType)` — cleans caption, filters to photo-type-relevant sections only (bathroom photos only embed bathroom sections, etc.)
- `extractFeatureFlags(featureSummary)` — regex-parses summary into `{flag: true}` jsonb (must stay in sync between server.js and index-city.js)
- Both functions exist identically in `server.js` and `scripts/index-city.js`

---

## Search Design (/api/vsearch)

### Phase A — Room-type scoring
1. **HyDE**: Gemini 2.5 Flash Lite generates a hypothetical caption from the user query (cached by query string, skipped on hit)
2. Embed HyDE caption with `gemini-embedding-001` (768 dims)
3. Detect FEATURE_FLAGS from query text (e.g. "double sinks" → `{double_sinks: true}`)
4. Call `score_room_types` with `required_features` if flags detected → DB pre-filter returns only matching room types
5. Build `hotelSimMap` (hotel → max similarity) and `roomTypeSimMap` (hotel::room → similarity)

### Phase B — Photo fetch
6. Fetch photos for top GALLERY_LIMIT (250) hotels via `fetch_hotel_photos`
7. Assign photo similarity from `roomTypeSimMap`; rooms not in map get similarity=0 for feature queries

### Score remapping
- `rawScore = max room-type similarity for hotel`
- `score = (rawScore - SIM_MIN) / (SIM_MAX - SIM_MIN) * 100`
- SIM_MIN/SIM_MAX computed adaptively from the result set each query

### Feature flags in FEATURE_FLAGS array (server.js)
Each entry has: `label`, `flag` (DB key), `queryMatch` (regex to detect in query), optional `intentType`.
Examples: double sinks, soaking tub, bathtub, walk-in shower, rainfall shower, balcony, fireplace, in-room hot tub, etc. (~32 flags total)

### Availability filter (client-side)
- "Available rooms only" toggle: shows only hotels where LiteAPI confirmed pricing
- Hotels with no rate data from LiteAPI are **hidden entirely** (not shown at 0%) when filter is active
- `hotelPassesAvailFilter(h)` checks `h.price != null` OR has per-room pricing matches

---

## Scoring Display

### hotelEffectiveScore (client-side)
```
if "available rooms only" active AND dates entered AND prices loaded:
  if any room has a price AND a roomType sim → return max of those
  if hotel has a price but no room match → return h.vectorScore
  else → return 0 (filtered out by hotelPassesAvailFilter)
else:
  return h.vectorScore
```

---

## Pricing (/api/rates)

**Flow:**
1. Fetch all hotel_ids for city from hotels_cache
2. POST to LiteAPI `/hotels/rates` with all IDs, `maxRatesPerHotel:10`, `roomMapping:true`
3. Key: `rates[0].mappedRoomId` = integer matching `room_type_id` in DB (USE THIS, not `roomTypeId`)
4. Returns `prices` (hotel_id → cheapest/night) and `roomPrices` (hotel_id → {room_type_id → $/night})

**IMPORTANT — LiteAPI ID mismatch:**
- `/hotels/rates` `roomTypeId` = encoded base64 string — useless for matching
- `/hotels/rates` `rates[0].mappedRoomId` = integer matching `/data/hotel` IDs → USE THIS
- `rates[0].name` ≠ `/data/hotel` `roomName` — do NOT match by name

---

## Automated Tests

Run the full test suite against the live server:
```bash
node scripts/test-search-quality.js
# or against localhost:
node scripts/test-search-quality.js --base-url=http://localhost:3000
```

7 tests covering KL feature flags (double sinks, rainfall shower, soaking tub, walk-in shower), semantic search, and Paris. All should pass with exact hotel counts matching the DB.

**Update expected counts in the script after re-indexing.**

---

## Debugging History — Key Issues

### score_room_types overload ambiguity (2026-03-30)
- Two versions of `score_room_types` left in DB after feature flags migration: old 3-arg and new 4-arg
- PostgREST error: "Could not choose the best candidate function between..."
- Fix: `DROP FUNCTION IF EXISTS public.score_room_types(vector, text, text[]);`
- Only keep the 4-arg version with `required_features jsonb DEFAULT NULL`

### room_types_index not rebuilt after new city indexing (2026-03-30)
- `rebuild_room_types_index_city` was only called from `backfill-feature-embeddings` endpoint
- KL was indexed but `room_types_index.features` was all empty → feature searches returned 0 hotels
- Fix: `indexCity()` now auto-calls `rebuild_room_types_index_city(city)` after completing

### Feature flag threshold too strict for luxury hotels (2026-03-30)
- Initial rule: room type needed ≥2 photos with flag. LiteAPI indexes 1 bathroom photo per room type at luxury hotels.
- Four Seasons KL had 5 double_sinks photos across 5 different room types → none passed ≥2 rule
- Fix: hotel-level fallback — if hotel has ≥2 total photos with flag across any room types, all those room types confirmed
- Result: KL double_sinks went from 13 → 33 confirmed hotels

### hotelEffectiveScore using wrong property (2026-03-30)
- `hotelEffectiveScore` returned `h.score || 0` as fallback when price present but no room match
- Server returns `vectorScore`, not `score` → always returned 0 → no match badge with "available rooms only" on
- Fix: changed to `h.vectorScore || 0`

### Hotels with no rate data showing in "available rooms only" filter (2026-03-30)
- Hotels not in LiteAPI inventory had `h.price = null` → hotelEffectiveScore returned 0 → showed with no badge
- Fix: `hotelPassesAvailFilter(h)` filters them out entirely before rendering when the toggle is active

### Per-room pricing (2026-03-21)
- LiteAPI `/hotels/rates` `roomTypeId` is encoded, incompatible with catalog IDs
- Fix: `roomMapping:true` in request → `rates[0].mappedRoomId` = integer matching catalog IDs

### Supabase statement_timeout (2026-03-20 through March 2026)
- PostgREST `authenticator` role has 8s timeout, overrides SET LOCAL in functions
- Fix: `SET LOCAL statement_timeout = '300000'` inside function definition
- `fetch_hotel_photos` also got `SET LOCAL statement_timeout = '30000'`

### Connection pool exhaustion (2026-03-20)
- Concurrent indexer runs caused Supabase to get stuck PAUSING
- Fix: DB_CONCURRENCY=3 semaphore in index-city.js

---

## Data Source Licensing — MUST READ BEFORE BUILDING

### LiteAPI Terms (Updated September 2025)
LiteAPI's terms **prohibit**:
- Storing, copying, or creating databases from LiteAPI data outside the permitted scope
- Building, training, or enriching third-party datasets or machine learning models
- Mapping LiteAPI data to third-party sources

The permitted scope is narrowly: browsing properties, displaying rates, enabling bookings.

**What this means for our architecture:**

| What we store | Status |
|---|---|
| `hotels_cache` (names, ratings, photo URLs) | Likely violates — explicit database of LiteAPI data |
| `room_embeddings.photo_url` | Likely violates — bulk copy of their content identifiers |
| Gemini-generated captions (from LiteAPI photos) | Gray area — transformed output but derived from their photos |
| Vector embeddings (768 floats) | Gray area — two degrees removed from LiteAPI data |
| Neighborhood vibes (pure Gemini, no LiteAPI data) | Clean — no LiteAPI data involved |

**Gemini API terms:** Clean. Generated content (captions, embeddings, neighborhood text) belongs to us. Storing it is not restricted.

**Unsplash terms:** Clean. Attribution required (planned). Hotlinking allowed. No bulk download.

### Decision Tree — Before Building the Neighborhood Feature

```
STEP 1: Email LiteAPI (hello@nuitee.com)
  → Explain: precomputing visual search embeddings from hotel photos
    for a room recommendation product
  → Ask for written permission or enterprise agreement

  If YES (permission granted):
    → Proceed with current architecture as planned
    → Keep hotels_cache + room_embeddings exactly as-is

  If NO or no response in 1 week:
    → Use "embeddings-only" architecture (see below)
    → OR apply to Hotelbeds (explicit Cache API, weeks to onboard)
```

### Embeddings-Only Architecture (LiteAPI fallback)
If LiteAPI denies permission, change what we persist:
- **Keep:** `hotel_id` + `room_name` + `embedding` vector (mathematical derivative, strong legal argument)
- **Remove from DB:** `photo_url`, captions, hotel metadata from hotels_cache
- **At search time:** fetch photo URLs + hotel names live from LiteAPI using ranked hotel_ids
- **Tradeoff:** +150-250ms per search. Photo URLs must be fetched fresh — old embeddings remain valid.

### Alternative Data Sources (if moving off LiteAPI entirely)

| Option | Photos | Caching | Access | Cost | Timeline |
|---|---|---|---|---|---|
| LiteAPI + permission | Yes | Permitted | Self-service | Low | Days |
| Embeddings-only (no LiteAPI data stored) | Live fetch | n/a | Self-service | Low | 1 day rework |
| **Hotelbeds** | Yes (room codes) | **Explicitly permitted via Cache API** | Application required | Higher | Weeks |
| SerpApi Google Hotels Photos | Yes (basic categories) | Unknown | Self-service | ~$50/mo | Days |
| Amadeus | **No photos in v3** | n/a | Self-service | Free sandbox | Ruled out |

**Hotelbeds** is the best long-term commercial option — they have a dedicated Cache API explicitly designed for "getting their portfolio into YOUR local system." Requires commercial agreement.

### Hotelbeds vs LiteAPI — Product Quality Comparison

| Dimension | LiteAPI | Hotelbeds |
|---|---|---|
| Hotel coverage | 2M+ (aggregated) | 250K (directly contracted) |
| Photo quality | Good, varies by source | GIATA standard — consistent |
| Room type linkage | roomName + room_type_id | roomCode (e.g. DBT.DX) |
| Caching | Prohibited | Explicitly permitted via Cache API |
| Pricing | Dynamic | Wholesale (negotiated, hourly cache) |
| Access | Self-service today | Commercial agreement + certification (weeks) |
| Cost | $3/booking + 2.5% order | Commission on margin |
| Developer experience | Modern, REST, MCP-native | B2B, older patterns |

**Verdict:** Hotelbeds produces marginally better/more consistent data (GIATA is the industry standard photo source LiteAPI also draws from), and has **explicit caching permission** — the decisive legal advantage. LiteAPI has 8x more hotels and is far simpler to use today. At commercial scale, Hotelbeds is the right long-term partner. Also worth evaluating: **GIATA direct** (1.4M+ properties mapped, addresses + geocodes + photos + room types — the source Hotelbeds uses).

### GATE: Do not start building the neighborhood feature until LiteAPI response is received or a data source decision is made. Ask the user to confirm before proceeding.

---

## Known Issues & Next Steps

1. **Index London and NYC** — same flow as KL: trigger index-city, auto-rebuild happens after
   ```powershell
   Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/index-city" -Method POST -ContentType "application/json" -Body '{"city":"London","limit":200,"secret":"roommatch-2026"}'
   ```

2. **Neighborhood Vibe + Visual Search** — full plan below in "VIBE PLAN" section
   - **GATE**: resolve LiteAPI licensing FIRST (see "Data Source Licensing" above). Do NOT build until resolved.
   - When user says **"go build vibe plan"**, work through the phases in order, confirming the gate first.

3. **Update test-search-quality.js expected counts** after re-indexing any city.

4. **Consider Supabase logging table** to avoid parsing Render logs for analytics.

---

## VIBE PLAN — Neighborhood Vibe + Visual Room Search

**TRIGGER PHRASE:** When user says "go build vibe plan", start at Phase 0 (licensing gate check), then proceed phase by phase.

### Product Vision
3-step search flow replacing the current single search box:
1. **City** — user types/selects a city (existing autocomplete)
2. **Neighborhood** — Gemini-generated neighborhood cards with vibe descriptions + Unsplash photos; user picks one (or skips to see all)
3. **Room** — current vector search, now geo-filtered to the chosen neighborhood bounding box + optional photo-tap vibe presets

### PHASE 0 — Licensing Gate (MUST DO FIRST)
Before writing any code:
- Check whether LiteAPI permission has been received (email hello@nuitee.com)
- If YES: proceed with current architecture (hotels_cache, photo_url, all as-is)
- If NO/no response after 1 week: use embeddings-only architecture (see "Data Source Licensing" section) OR switch to Hotelbeds
- **Ask user explicitly before proceeding past this gate**

---

### PHASE 1 — Lat/Lng + Bbox Filter (backend only, no UI change)

**Goal:** Store hotel coordinates; filter vector search results by bounding box.

#### 1a. Verify LiteAPI lat/lng availability
Check `LiteAPI /data/hotel/{id}` response shape for `location.latitude` / `location.longitude`.
If present: use directly. If missing: fall back to Geoapify geocoding of `hotel.address`.

#### 1b. DB migration — `supabase/add-latlng.sql` (NEW file)
```sql
ALTER TABLE hotels_cache ADD COLUMN IF NOT EXISTS lat FLOAT;
ALTER TABLE hotels_cache ADD COLUMN IF NOT EXISTS lng FLOAT;
CREATE INDEX IF NOT EXISTS hotels_cache_coords ON hotels_cache (city, lat, lng);
```
Run in Supabase SQL editor. Do NOT use schema.sql for migrations.

#### 1c. Update `scripts/index-city.js`
In the `hotels_cache` upsert block, add lat/lng:
```javascript
// Primary: LiteAPI location fields
lat: hotel.location?.latitude ?? hotel.location?.lat ?? null,
lng: hotel.location?.longitude ?? hotel.location?.lng ?? null,
// Fallback if null: geocode hotel.address via Geoapify /geocode/search
// (implement geocodeAddress(address, geoapifyKey) helper that returns {lat, lng})
```

#### 1d. New script — `scripts/backfill-latlng.js`
One-time Node script to backfill lat/lng for all existing Paris + KL hotels_cache rows:
```javascript
// For each hotels_cache row where lat IS NULL:
//   1. Try LiteAPI /data/hotel/{hotel_id} for location coords
//   2. If still null, call Geoapify /geocode/search?text={address}&apiKey=...
//   3. UPDATE hotels_cache SET lat=..., lng=... WHERE hotel_id=...
// Run via: node scripts/backfill-latlng.js --secret=roommatch-2026
```
Also expose as `POST /api/backfill-latlng` endpoint (requires INDEX_SECRET).

#### 1e. Update `/api/vsearch` in `server.js`
Add optional `bbox` query param (format: `lat_min,lat_max,lon_min,lon_max`):
```javascript
// If bbox provided:
//   SELECT hotel_id FROM hotels_cache
//   WHERE city = $city AND lat BETWEEN lat_min AND lat_max AND lng BETWEEN lon_min AND lon_max
// Pass resulting hotel_ids array into score_room_types RPC
// (hotel_ids param already exists in the RPC — it's currently NOT being passed in server.js, FIX THIS)
```
**NOTE:** `score_room_types` already accepts `hotel_ids text[]` but the current JS call does NOT pass it. This is a bug to fix regardless.

---

### PHASE 2 — Neighborhood Generation (new backend module + DB table)

**Goal:** Gemini generates top 5-8 neighborhoods per city with vibes + bounding boxes; Unsplash provides card photos; results cached in new `neighborhoods` DB table.

#### 2a. DB migration — `supabase/add-neighborhoods.sql` (NEW file)
```sql
CREATE TABLE IF NOT EXISTS neighborhoods (
  id            SERIAL PRIMARY KEY,
  city          TEXT NOT NULL,
  name          TEXT NOT NULL,
  bbox          JSONB,          -- {lat_min, lat_max, lon_min, lon_max}
  vibe_short    TEXT,           -- max 6 words, e.g. "Artsy, walkable, café culture"
  vibe_long     TEXT,           -- 2-3 sentence description
  tags          TEXT[],         -- ["first-timers", "walkable", "nightlife"]
  visitor_type  TEXT,           -- "first-timers" | "returning" | "both"
  attributes    JSONB,          -- {nightlife:7, walkability:9, luxury:3, culture:8, nature:2, business:4}
  photo_url     TEXT,           -- Unsplash photo URL (hotlink)
  photo_credit  JSONB,          -- {photographer, photographer_url, unsplash_url}
  hotel_count   INT DEFAULT 0,  -- hotels within bbox, refreshed after rebuild_room_types_index_city
  manual_override BOOLEAN DEFAULT FALSE, -- if true, skip Gemini regeneration
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city, name)
);

CREATE TABLE IF NOT EXISTS vibe_presets (
  id          SERIAL PRIMARY KEY,
  city        TEXT NOT NULL,
  style_label TEXT NOT NULL,   -- "Bright & Airy", "Dark & Moody", etc.
  query_text  TEXT NOT NULL,   -- the vsearch query used to generate this
  photo_url   TEXT,
  caption     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city, style_label)
);
```

#### 2b. New shared module — `scripts/neighborhood-generator.js`
**CRITICAL: Must be a shared module, not inline in server.js, to avoid circular dependency with index-city.js.**

Exports:
```javascript
// Generate neighborhoods for a city; upserts to neighborhoods table
async function generateNeighborhoods(city, db, geminiKey, unsplashKey)

// Refresh hotel_count for all neighborhoods of a city
async function refreshHotelCounts(city, db)
```

**Gemini prompt for neighborhood generation:**
```
You are a travel expert. For {city}, list the top 5-8 distinct neighborhoods a hotel guest would care about.
For each neighborhood return JSON with these exact fields:
- name: neighborhood name
- bbox: approximate bounding box {lat_min, lat_max, lon_min, lon_max} (±0.01° precision OK)
- vibe_short: max 6 words capturing the vibe
- vibe_long: 2-3 sentences for someone choosing where to stay
- tags: array of 3-5 strings from: [first-timers, returning, business, nightlife, culture, romantic, family, walkable, budget, luxury, nature, beach, shopping]
- visitor_type: "first-timers" | "returning" | "both"
- attributes: scores 1-10 for: {nightlife, walkability, luxury, culture, nature, business}

Return a JSON array only, no prose. Use your knowledge of {city} as of 2024.
```

**Unsplash photo fetch (`fetchNeighborhoodPhoto(name, city, unsplashKey)`):**
```javascript
// GET https://api.unsplash.com/search/photos?query={name}+{city}+neighborhood&per_page=1
// Authorization: Client-ID {unsplashKey}
// Returns: {photo_url: results[0].urls.regular, photo_credit: {photographer, photographer_url, unsplash_url}}
// Fallback if no result: query hotels_cache WHERE city=city ORDER BY guest_rating DESC LIMIT 1 → main_photo
```
**Attribution required:** Unsplash requires displaying photographer credit. Store in `photo_credit` JSONB and render on card.

**`refreshHotelCounts(city, db)`:**
```javascript
// For each neighborhood in city:
//   SELECT COUNT(*) FROM hotels_cache
//   WHERE city=city AND lat BETWEEN bbox.lat_min AND bbox.lat_max AND lng BETWEEN bbox.lon_min AND lon_max
//   UPDATE neighborhoods SET hotel_count=count WHERE city=city AND name=name
```

#### 2c. New endpoint — `GET /api/neighborhoods?city=Paris`
```javascript
// 1. Check indexed_cities WHERE city=city AND status='complete' — if not found, return 404
// 2. Check neighborhoods table for existing rows — if found and not expired (7 days), return cached
// 3. If missing/expired and manual_override=false: call generateNeighborhoods(city, ...)
// 4. Return array of neighborhood objects
```
Auto-trigger after indexing: at end of `indexCity()`, after `rebuild_room_types_index_city`, call `generateNeighborhoods` if neighborhoods table has no rows for the city.

#### 2d. Rebuild hook
Add `refreshHotelCounts(city, db)` as final step of `rebuild_room_types_index_city` (or call from `indexCity()` after the rebuild call).

---

### PHASE 3 — Frontend 3-Step Flow

**Goal:** Replace single search box with city → neighborhood → room UX.

#### Step layout
```
[Step 1: City]          — existing autocomplete input, unchanged
[Step 2: Neighborhood]  — card grid, generated by /api/neighborhoods
[Step 3: Room Search]   — existing search box + results, now with active bbox
```

#### Step 2 UI details
- Show loading skeleton (3 card placeholders) while /api/neighborhoods fetches
- Each card: neighborhood photo (full bleed), name, vibe_short, tags as pills, hotel count
- Photo attribution (photographer name, small link) overlaid on bottom of photo
- "Show all neighborhoods" option → skip step 2, search whole city (no bbox)
- Back button returns to step 1
- Unsplash hotlink (no download), attribution displayed per their guidelines
- `hotel_count = 0` → show "–" not "0 hotels"
- Mobile: single-column card stack; desktop: 2-3 column grid

#### Step 3 additions
- Active neighborhood shown as a dismissable chip above search box ("Searching in: Le Marais ×")
- Dismissing chip clears bbox and searches whole city
- Photo-tap row (Phase 4) appears below active neighborhood chip

---

### PHASE 4 — Photo-Tap Vibe Matching

**Goal:** Show 6-8 room style photos; user taps one → auto-runs vector search with that style.

#### Vibe preset generation — `GET /api/vibe-presets?city=Paris`
Canonical style queries to run (these are the 6-8 presets):
```
"bright airy room large windows"
"dark moody romantic room"
"minimalist modern design"
"cozy warm traditional room"
"luxury suite marble bathroom"
"loft industrial exposed brick"
"colourful eclectic boutique room"
"panoramic view city lights"
```
For each query: run `/api/vsearch?query=...&city=...`, take `photos[0]` from top result.
Cache in `vibe_presets` table: `style_label`, `query_text`, `photo_url`, `caption`.

#### Photo-tap UI
- Horizontal scroll row of ~6 room photos (square thumbnails)
- Below the active-neighborhood chip, above the text search box
- Tap a photo → populates search box with `query_text` → triggers `startVectorSearch()` with active bbox
- Loading state: skeleton placeholders while presets load

---

### PHASE 5 — Dynamic Country Code (cleanup)

**Goal:** Eliminate hardcoded `CC_MAP` and `CITY_COORDS` fallback maps; derive from Geoapify.

#### Fix `/api/places` mapper in `server.js`
Current bug: Geoapify returns `country_code` in results but the mapper drops it.
```javascript
// Before (broken):
results.map(r => ({ city: r.properties.city || r.properties.name, ... }))
// After (fixed):
results.map(r => ({
  city: r.properties.city || r.properties.name,
  country_code: r.properties.country_code?.toUpperCase() || null,
  bbox: r.bbox || null,   // [lon_min, lat_min, lon_max, lat_max] — Geoapify format
  // Convert to our format: {lat_min, lat_max, lon_min, lon_max}
}))
```
Frontend: on `selectCity()`, store `{city, country_code, bbox}` in state.
Pass `country_code` to `/api/vsearch`. Keep `CC_MAP` + `CITY_COORDS` as fallbacks for hand-typed cities.

---

### PHASE 6 — New City Self-Service

**Goal:** Any new city indexes and gets neighborhood cards with zero manual steps.

After Phase 1–5 are complete, adding a new city just requires:
```
POST /api/index-city {"city":"Mexico City","limit":200,"secret":"..."}
```
This auto-triggers (in order): caption → embed → feature flags → rebuild_room_types_index → generateNeighborhoods → refreshHotelCounts → generate vibe_presets.

No `CC_MAP` entries, no `CITY_COORDS` entries, no manual SQL needed.

---

### Vibe Plan — File Changes Summary

| File | Change |
|---|---|
| `supabase/add-latlng.sql` | NEW — lat/lng columns + index on hotels_cache |
| `supabase/add-neighborhoods.sql` | NEW — neighborhoods + vibe_presets tables |
| `scripts/neighborhood-generator.js` | NEW — generateNeighborhoods + refreshHotelCounts |
| `scripts/backfill-latlng.js` | NEW — one-time backfill lat/lng for existing hotels |
| `scripts/index-city.js` | Add lat/lng to upsert; call generateNeighborhoods + refreshHotelCounts after rebuild |
| `server.js` | Add bbox param to /api/vsearch; pass hotel_ids to score_room_types (bug fix); add /api/neighborhoods; add /api/vibe-presets; add /api/backfill-latlng; fix /api/places country_code mapper |
| `client/index.html` | 3-step flow; neighborhood card grid; photo-tap row; bbox chip; loading skeletons; back navigation; Unsplash attribution |

### Vibe Plan — Environment Variables Needed
```
UNSPLASH_KEY    — get free key at unsplash.com/developers (50 req/hr free tier)
```
All others already exist.

---

## Workflow

**Trigger indexing (new city or re-index):**
```powershell
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/index-city" -Method POST -ContentType "application/json" -Body '{"city":"Kuala Lumpur","limit":200,"secret":"roommatch-2026"}'
```
- Room_types_index is automatically rebuilt after indexing completes (no manual step needed)

**Check indexing progress:**
```sql
SELECT city, status, hotel_count, photo_count, started_at FROM indexed_cities;
SELECT COUNT(*), COUNT(DISTINCT hotel_id) FROM room_embeddings WHERE city = 'Kuala Lumpur';
```

**Manually rebuild room_types_index (if needed):**
```sql
SELECT rebuild_room_types_index_city('Kuala Lumpur');
-- Check results:
SELECT COUNT(DISTINCT hotel_id) FROM room_types_index WHERE city = 'Kuala Lumpur' AND features @> '{"double_sinks": true}';
```

**Drop duplicate SQL function overloads (if overload error occurs):**
```sql
DROP FUNCTION IF EXISTS public.score_room_types(vector, text, text[]);
-- Keep only: score_room_types(vector, text, jsonb, text[])
```

**Run search quality tests:**
```bash
node scripts/test-search-quality.js
```

**View Render logs via MCP:**
Use `list_logs` tool with `resource: ["srv-d6s27b75r7bs738737fg"]` (Render MCP connected in Cursor).

**Debug endpoints:**
- /api/debug-gemini — test which Gemini models work
- /api/debug-city?city=Paris — LiteAPI coverage
- /api/debug-photos?hotelId=lp1beec — raw photo metadata

---

## MCP Connections
- **Supabase MCP** — `user-supabase`, project ID dmgxrcmdihgsffvqllms
- **Render MCP** — `user-render`, service ID srv-d6s27b75r7bs738737fg
