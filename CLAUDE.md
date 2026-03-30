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

## Known Issues & Next Steps

1. **Index London and NYC** — same flow as KL: trigger index-city, auto-rebuild happens after
   ```powershell
   Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/index-city" -Method POST -ContentType "application/json" -Body '{"city":"London","limit":200,"secret":"roommatch-2026"}'
   ```

2. **Neighborhood/Borough Search** — store lat/lng in hotels_cache, use Geoapify bbox for geo filtering.
   - Add `lat FLOAT, lng FLOAT` to hotels_cache
   - Store coordinates from LiteAPI during indexing
   - Update /api/vsearch to accept optional `bbox` and filter hotels_cache

3. **Update test-search-quality.js expected counts** after re-indexing any city.

4. **Consider Supabase logging table** to avoid parsing Render logs for analytics.

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
