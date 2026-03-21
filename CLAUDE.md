# RoomMatch — Project Context for Claude Code

## What This Is
RoomMatch is a hotel room visual search engine. Users describe their ideal hotel room in natural language ("modern bathroom with double sinks and soaking tub") and get back ranked hotel results with matching room photos.

Live at: **https://www.travelboop.com**
GitHub: **https://github.com/jmc100-ai/roommatch**
Render service: **https://roommatch-1fg5.onrender.com**
Supabase project ID: **dmgxrcmdihgsffvqllms**

---

## Architecture

```
FRONTEND (client/index.html)
  → Express backend (server.js) on Render (paid tier)
  → Vector Search (main and only working mode)

VECTOR SEARCH PIPELINE:
  LiteAPI /data/hotels (up to 7,221 Paris hotels)
  → /data/hotel (room photos + room_type_id per hotel)
  → Gemini 2.5 Flash Lite (structured photo captions)
  → gemini-embedding-001 (768-dim truncated embeddings)
  → Supabase pgvector (full city scan via score_city_photos RPC)
  → Live search: embed query → score ALL city photos → rank + filter → return all hotels

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
| Photo captioning | Gemini 2.5 Flash Lite (gemini-2.5-flash-lite) |
| Embeddings | Gemini gemini-embedding-001 (3072 dims, truncated to 768) |
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
│   ├── index-city.js            — batch indexing script
│   └── backfill-room-ids.js     — backfill room_type_id for existing rows
└── supabase/
    ├── schema.sql               — full DB schema
    ├── add-room-type-id.sql     — adds room_type_id column + updates score_city_photos RPC
    ├── migrate-768.sql          — 768-dim vectors + ivfflat + disable RLS
    ├── fix-permissions.sql      — grants permissions on all tables
    ├── add-hotel-name.sql       — adds hotel_name column
    └── migrate-3072.sql         — SUPERSEDED, do not use
```

---

## Supabase Database

**Project ID:** dmgxrcmdihgsffvqllms — Region: us-west-2

### Tables

**indexed_cities** — tracks indexing status per city
- city, country_code, status (pending|indexing|complete|failed), hotel_count, photo_count, started_at, completed_at, last_error, stop_requested

**hotels_cache** — hotel metadata cache
- hotel_id (PK), city, country_code, name, address, star_rating, guest_rating, main_photo, cached_at

**room_embeddings** — core table, one row per photo
- id, hotel_id, city, country_code, hotel_name, room_name, **room_type_id** (TEXT, LiteAPI integer ID)
- photo_type (bedroom|bathroom|living|view|other) — Gemini self-classifies
- caption (hybrid: structured Gemini output + room metadata)
- embedding vector(768), star_rating, guest_rating, created_at
- UNIQUE(hotel_id, photo_url)

### Key SQL functions

**`score_city_photos(query_embedding vector(768), search_city TEXT)`** — primary search function
```sql
-- Full scan of ALL photos in a city, returns every photo with similarity score.
-- No match_count cap — every hotel gets a real score.
-- Returns: hotel_id, hotel_name, room_name, room_type_id, photo_url, photo_type, caption,
--          star_rating, guest_rating, similarity
-- Ordered by similarity DESC.
-- Run with service role to avoid 3s anon timeout.
```

### PostgREST row limit fix (required — do not revert)
```sql
ALTER ROLE authenticator SET pgrst.db_max_rows = '10000';
NOTIFY pgrst, 'reload config';
```
Default was 1000, which silently capped all queries. Paris has 4,699 photos — without this fix, only 1,000 returned.

### Current Index Status
- **Paris: 140 hotels, 4,699 photos** (indexed with structured caption format, room_type_id backfilled for all rows)

---

## API Endpoints

| Endpoint | Description |
|---|---|
| GET /api/vsearch?query&city | Vector search (main mode) |
| GET /api/rates?city&checkin&checkout | Batch hotel+room pricing from LiteAPI |
| GET /api/index-status?city | Check indexing status |
| POST /api/index-city | Trigger indexing (requires INDEX_SECRET in body) |
| POST /api/backfill-room-ids | Backfill room_type_id for existing rows (requires INDEX_SECRET) |
| GET /api/debug-city?city | LiteAPI coverage analysis |
| GET /api/debug-gemini | Test available Gemini model names |
| GET /api/debug-photos?hotelId | Show raw LiteAPI photo fields |
| GET /api/health | Health check |

---

## Indexer (scripts/index-city.js)

Triggered via: `POST /api/index-city {"city":"Paris","limit":200,"secret":"roommatch-2026"}`

**Flow:**
1. Fetch hotels sorted by star rating (best hotels first)
2. 20 hotels concurrent: fetch room detail → collect photos (max 10/room type, 60/hotel)
3. **Captures `room_type_id`** from LiteAPI room objects (`room.id || room.roomId || room.roomTypeId`)
4. Per photo: caption → embed → upsert to Supabase (with room_type_id)
5. Rate limits: 500 caption/min, 1000 embed/min (paid Gemini tier)
6. Idempotent: UNIQUE(hotel_id, photo_url) prevents duplicates
7. DB_CONCURRENCY=3 semaphore prevents connection pool exhaustion

**CRITICAL: geminiCaption signature:**
```javascript
geminiCaption(imageUrl, photoContext = {type, roomName}, retries = 3)
```
photoContext MUST be passed. If omitted: "photo is not defined" error on every call.

**Structured caption prompt fields:**
- PHOTO TYPE — Gemini self-classifies (bedroom/bathroom/living area/view/other)
- BATHROOM: sinks count, counter space (no/small/large/very large), bathtub type, shower type, bidet, separate toilet
- BEDROOM: bed type, walk-in closet
- VIEWS & LIGHT: natural light, windows, view, balcony
- SPACE & LAYOUT: size impression, ceiling height, separate living area
- FLOORING & DECOR: flooring material+colour, wall colour, style 1+2 (Modern/Art Deco/Mid-Century/etc), color mood
- FURNITURE: sofa, armchair, chaise lounge, desk size, dining table
- NOTABLE FEATURES: fireplace, coffee machine, TV, in-room hot tub, distinctive features
- maxOutputTokens: 400 (must be this high or response gets truncated)

**Hybrid embedding text format:**
```
PHOTO TYPE: bathroom | ROOM: Junior Suite
[full structured caption]
Room type: Junior Suite. Size: 45sqm. Beds: 1x King. Amenities: minibar, soaking tub...
```

---

## Backfill Script (scripts/backfill-room-ids.js)

Backfills `room_type_id` for existing rows that predate the per-room pricing feature.
For each hotel, calls LiteAPI `/data/hotel`, matches `room_name` to LiteAPI room names, and UPDATEs matching rows.

**Paris backfill completed 2026-03-21: 1,213 rows updated, 0 unmatched.**

**To re-run (e.g. after new indexing):**
```bash
# Via server endpoint (recommended):
POST /api/backfill-room-ids {"city":"Paris","secret":"roommatch-2026"}

# Or locally:
node scripts/backfill-room-ids.js --city Paris --dry-run
node scripts/backfill-room-ids.js --city Paris
```

---

## Pricing (/api/rates)

**Request:** `GET /api/rates?city=Paris&checkin=2026-03-23&checkout=2026-03-26`

**Flow:**
1. Fetch all hotel_ids for city from hotels_cache
2. POST to LiteAPI `/hotels/rates` with all IDs, `maxRatesPerHotel:10`, `roomMapping:true`
3. Parse `hotel.roomTypes[i].rates[0]` for each offer:
   - `rates[0].name` = room name (supplier name, differs from catalog name — do NOT use for matching)
   - `rates[0].mappedRoomId` = integer room ID matching `/data/hotel` IDs (i.e. `room_type_id` in DB)
   - `retailRate.total[0].amount` = total for stay (divide by nights for per-night)
4. Returns `prices` (hotel_id → cheapest/night) and `roomPrices` (hotel_id → {room_type_id → $/night})

**IMPORTANT — LiteAPI ID mismatch:**
- `/hotels/rates` `roomTypeId` field = encoded base64-style string (e.g. "GMYTSLJRG...") — useless for matching
- `/hotels/rates` `rates[0].mappedRoomId` = integer matching `/data/hotel` room IDs — USE THIS
- `/data/hotel` room `id`/`roomId` = integer — stored in `room_embeddings.room_type_id`
- `rates[0].name` ≠ `/data/hotel` `roomName` — supplier names differ from catalog names, do NOT match by name

**Current results:** ~78-93/140 Paris hotels priced per search (not all hotels have availability on all dates).

---

## Search Design (current — /api/vsearch)

### Overview
Returns ALL hotels in the city index, sorted by match score. Every hotel is scored. No hard filtering — low-scoring hotels appear at the bottom with their score.

### Scoring pipeline
1. Embed the user's query with `gemini-embedding-001`, truncate to 768 dims
2. Call `score_city_photos` RPC — full scan of all ~4,699 Paris photos
3. Group photos by hotel. For each hotel, compute `rawScore` = avg of top-3 intent-matching photo similarities
   - `intentType` detection: bathroom query → use only bathroom photos; bedroom query → bedroom only
4. **Rescale**: `score = (rawScore - 0.40) / (0.72 - 0.40) * 100` → display percentage 0–100%
   - SIM_MIN=0.40 (noise floor), SIM_MAX=0.72 (realistic ceiling for top matches)
5. **Structural feature penalty**: apply `score × 0.45` per missing feature (on rescaled score, not raw)
6. Sort all hotels descending by final score

### Per-room scoring
Each room type also gets its own score (avg top-3 similarities for that room's photos, same rescaling + penalty). Shown as `X% match` badge inline in the room header row, visible before expanding.

### Structural feature detection (`STRUCTURAL_FEATURES` in server.js)
Penalty is `0.45×` per unconfirmed feature (applied after rescaling):
- **double sinks**: confirm `/\b(two|double|dual|twin|2)\s*sinks?\b|\bsinks?\s*(?:count)?[:\s]+([2-9]|two|double...)/`
- **soaking tub**: confirm `/\b(soaking|freestanding|clawfoot|japanese)\s*(tub|bath)\b|\bbathtub\s*(?:type)?[:\s]+.../`
- **balcony**: confirm `/\bbalcon(y|ies)\b/`
- **fireplace**: confirm `/\bfireplace\b/`
- **large windows**: confirm `/\b(large|floor.to.ceiling|panoramic|huge|oversized|expansive)\s*windows?\b.../`

### Room type ordering within hotel
Rooms sorted by **count of detected features confirmed in their captions** (descending), similarity as tiebreaker. Ensures the room with e.g. two sinks appears first, not the room whose name contains "double".

### Client-side sort options
- **Best Match** (default) — vectorScore descending
- **Match + Price** — tier-based: High (40%+) → Mid (15–39%) → Low (<15%), cheapest-first within tier, unpriced to bottom
- **Best Price** — price ascending, unpriced to bottom
- **Guest Rating** — guest score descending
- **Stars** — star rating descending

---

## Frontend Features (client/index.html)

### Search bar
- Hero state (large, centered) before first search
- Compact sticky state after search
- City autocomplete via Geoapify
- Date pickers — triggers live pricing from LiteAPI when both filled
- 5 sort buttons: Best Match, Match+Price, Best Price, Guest Rating, Stars
- Price buttons show spinner while rates fetch; enabled immediately if no dates entered

### Hotel cards
- Hotel name, stars, location, guest score, "Find & Book" link (Google search)
- Hotel-level price (cheapest available rate) next to Find & Book button
- Room type rows — collapsible, first room open by default
- Room header: **Room Name → €X/night (if available) → X% match badge → · → beds/size → ▼**
- Per-room match badge: gold for score ≥20%, muted grey for <20%, "browse" only in Match sort for score=0
- Horizontal photo strip per room, scrollable, up to 10 photos
- Per-photo match badge on first photo of each room (overlay on photo)
- Infinite scroll: 10 hotels initially, +10 on scroll via IntersectionObserver

### Lightbox gallery
- Click any photo → floating panel (62vw) centered on dark backdrop
- Room name + match % badge at top of panel
- ← → navigation; keyboard arrow keys; Escape to close
- Thumbnail strip at bottom; active thumbnail highlighted gold
- Photo counter (e.g. "3 / 5") above thumbnails
- Click dark background to close

---

## Key Decisions & Why

**Why not LiteAPI room-search?**
Returns 9 hotels globally regardless of city — geo filtering broken.

**Why not HuggingFace CLIP?**
Three blockers: api-inference deprecated, CLIP not on free tier, 200 req/5min exhausted instantly.

**Why Gemini over OpenAI?**
10x cheaper. gemini-2.5-flash-lite + gemini-embedding-001 confirmed working.

**Why 768 dims not 3072?**
pgvector ivfflat AND hnsw cap at 2000 dims. Truncating 3072→768 is valid (Matryoshka).

**Why structured caption not free-form?**
Free-form caused hallucination. Structured format with "unknown" is reliable.

**Why score_city_photos instead of search_rooms?**
search_rooms used match_count cap — hotels outside top 500 got no score. score_city_photos full scan gives every hotel a real score.

**Why structural feature penalty instead of hard filtering?**
Hard filtering removes hotels unexpectedly. Penalty (×0.45) sinks them to the bottom while keeping them visible.

**Why apply penalty after rescaling?**
If applied before rescaling on raw similarity, even a 0.60 raw score × 0.45 = 0.27 which is below SIM_MIN (0.40) → clamps to 0%. Applying on rescaled score preserves visibility: 50% × 0.45 = 22%.

**Why key roomPrices by mappedRoomId?**
LiteAPI `/hotels/rates` has two incompatible room type identifiers:
- `roomTypeId` (top-level) = encoded base64 string, NOT the same as catalog IDs — useless
- `rates[0].mappedRoomId` = integer, SAME as `/data/hotel` room IDs stored in DB → use this

---

## Debugging History — Key Issues

### Per-room pricing (2026-03-21)
- LiteAPI `/hotels/rates` `roomTypeId` is encoded (e.g. "GMYTSLJRG..."), incompatible with `/data/hotel` integer IDs
- Room name is at `rates[0].name` NOT `rt.name` (rt has no name field)
- Supplier rate names differ from catalog room names — name matching unreliable
- Solution: `roomMapping:true` in request returns `rates[0].mappedRoomId` = integer matching catalog IDs
- DB `room_type_id` stores catalog integer IDs → exact match via `mappedRoomId`
- Paris backfill: 1,213 rows updated 2026-03-21, 0 unmatched

### Supabase 1000-row cap
- PostgREST default `max_rows=1000` silently capped queries. Fix: `ALTER ROLE authenticator SET pgrst.db_max_rows='10000'`
- anon role `statement_timeout=3s` caused full city scan to fail. Fix: use supabaseAdmin (service role)

### Structural feature confirm regex (2026-03-21)
- Gemini captions write `SINKS: 2` or `sinks count: 2` but old regex only matched `two sinks` or `sinks: 2`
- Fixed: `\bsinks?\s*(?:count)?[:\s]+([2-9]|two|double|twin|dual)` handles `count` between field and value

### Match sort buttons stuck disabled
- Buttons initialized as `disabled` + `loading` in HTML. `render()` reset `_pricesLoaded=false`.
- No-dates case set `_pricesLoaded=true` before `render()` which overwrote it.
- Fix: set `_pricesLoaded=true` and enable buttons AFTER `render()` completes.

### Connection pool exhaustion (2026-03-20)
- Concurrent indexer runs caused Supabase to get stuck PAUSING. Fix: DB_CONCURRENCY=3 semaphore.

---

## Known Issues & Next Steps

1. **Expand Paris index** — Top 140 hotels indexed. LiteAPI has 7,221 total.
   - Cost: ~$9/1,000 hotels, ~50 min. Run batches of 1,000.
   - `POST /api/index-city {"city":"Paris","limit":1000,"secret":"roommatch-2026"}`
   - After each batch: `POST /api/backfill-room-ids {"city":"Paris","secret":"roommatch-2026"}`

2. **Index London and NYC** after Paris expanded.

3. **Neighborhood/Borough Search** — store lat/lng in hotels_cache, use Geoapify bbox for geo filtering.

4. **Consider Supabase logging table** to avoid parsing Render logs for analytics.

---

## Workflow

**Trigger indexing:**
```powershell
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/index-city" -Method POST -ContentType "application/json" -Body '{"city":"Paris","limit":1000,"secret":"roommatch-2026"}'
```

**Backfill room IDs after indexing:**
```powershell
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/backfill-room-ids" -Method POST -ContentType "application/json" -Body '{"city":"Paris","secret":"roommatch-2026"}'
```

**Check indexing progress (Supabase):**
```sql
SELECT city, status, hotel_count, photo_count FROM indexed_cities;
SELECT COUNT(*), COUNT(DISTINCT hotel_id) FROM room_embeddings WHERE city = 'Paris';
SELECT COUNT(*) FROM room_embeddings WHERE city = 'Paris' AND room_type_id IS NOT NULL;
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
