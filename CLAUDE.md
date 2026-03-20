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
  → Express backend (server.js) on Render
  → Vector Search (main and only working mode)

VECTOR SEARCH PIPELINE:
  LiteAPI /data/hotels (up to 7,221 Paris hotels)
  → /data/hotel (room photos per hotel)
  → Gemini 2.5 Flash Lite (structured photo captions)
  → gemini-embedding-001 (768-dim truncated embeddings)
  → Supabase pgvector (full city scan via score_city_photos RPC)
  → Live search: embed query → score ALL city photos → rank + filter → return all hotels
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js + Express, deployed on Render free tier |
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
INDEX_SECRET           — protects POST /api/index-city endpoint
```

---

## File Structure

```
roommatch/
├── server.js                 — Express backend (all API endpoints)
├── package.json              — deps: express, cors, dotenv, @supabase/supabase-js
├── render.yaml               — Render deployment config
├── CLAUDE.md                 — this file
├── client/
│   └── index.html            — full frontend (single file, vanilla JS)
├── scripts/
│   └── index-city.js         — batch indexing script
└── supabase/
    ├── schema.sql             — full DB schema
    ├── migrate-768.sql        — 768-dim vectors + ivfflat + disable RLS
    ├── fix-permissions.sql    — grants permissions on all tables
    ├── add-hotel-name.sql     — adds hotel_name column
    └── migrate-3072.sql       — SUPERSEDED, do not use
```

---

## Supabase Database

**Project ID:** dmgxrcmdihgsffvqllms — Region: us-west-2

### Tables

**indexed_cities** — tracks indexing status per city
- city, country_code, status (pending|indexing|complete|failed), hotel_count, photo_count, started_at, completed_at, last_error

**hotels_cache** — hotel metadata cache
- hotel_id (PK), city, country_code, name, address, star_rating, guest_rating, main_photo, cached_at

**room_embeddings** — core table, one row per photo
- id, hotel_id, city, country_code, hotel_name, room_name, photo_url
- photo_type (bedroom|bathroom|living|view|other) — Gemini self-classifies
- caption (hybrid: structured Gemini output + room metadata)
- embedding vector(768), star_rating, guest_rating, created_at
- UNIQUE(hotel_id, photo_url)

### Key SQL functions

**`score_city_photos(query_embedding vector(768), search_city TEXT)`** — primary search function
```sql
-- Full scan of ALL photos in a city, returns every photo with similarity score.
-- No match_count cap — every hotel gets a real score.
-- Returns: hotel_id, hotel_name, room_name, photo_url, photo_type, caption, similarity
-- Ordered by similarity DESC.
-- Uses service role (no statement_timeout) to avoid 3s anon timeout.
```

**`get_city_photos(search_city TEXT)`** — legacy, no longer used (superseded by score_city_photos)

**`search_rooms(query_embedding, search_city, match_count)`** — legacy, no longer used

### PostgREST row limit fix (required — do not revert)
```sql
ALTER ROLE authenticator SET pgrst.db_max_rows = '10000';
NOTIFY pgrst, 'reload config';
```
Default was 1000, which silently capped all queries. Paris has 4,699 photos — without this fix, only 1,000 were returned.

### Current Index Status
- **Paris: 140 hotels, 4,699 photos** (re-indexed 2026-03-20 with structured caption format)

---

## API Endpoints

| Endpoint | Description |
|---|---|
| GET /api/vsearch?query&city | Vector search (main mode) |
| GET /api/index-status?city | Check indexing status |
| POST /api/index-city | Trigger indexing (requires INDEX_SECRET in body) |
| GET /api/room-search?query&city | LiteAPI room-search (broken, ~9 results globally) |
| GET /api/debug-city?city | LiteAPI coverage analysis |
| GET /api/debug-gemini | Test available Gemini model names |
| GET /api/debug-photos?hotelId | Show raw LiteAPI photo fields |
| GET /api/health | Health check |

---

## Indexer (scripts/index-city.js)

Triggered via: POST /api/index-city {"city":"Paris","limit":200,"secret":"..."}

**Flow:**
1. Fetch hotels sorted by star rating (best hotels first)
2. 20 hotels concurrent: fetch room detail → collect photos (max 10/room type, 60/hotel)
3. Per photo: caption → embed → upsert to Supabase
4. Rate limits: 500 caption/min, 1000 embed/min (paid Gemini tier)
5. Idempotent: UNIQUE(hotel_id, photo_url) prevents duplicates
6. DB_CONCURRENCY=3 semaphore prevents connection pool exhaustion

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

**IMPORTANT: Room name is embedded in every caption header.** This means room names containing common words (e.g. "Two Adjacent Double Rooms") can create spurious embedding similarity to queries containing those words (e.g. "double sinks"). The structural feature penalty system (see below) is the mitigation for this.

---

## Search Design (current — /api/vsearch)

### Overview
Returns ALL hotels in the city index, sorted by match score. Every hotel is scored. No hard filtering — low-scoring hotels appear at the bottom with their score.

### Scoring pipeline
1. Embed the user's query with `gemini-embedding-001`, truncate to 768 dims
2. Call `score_city_photos` RPC — full scan of all ~4,699 Paris photos, returns similarity scores for every photo
3. Group photos by hotel. For each hotel, compute `topScore` = average of top-3 intent-matching photo similarities
   - `intentType` detection: if query mentions bathrooms/sinks → use only bathroom photos for topScore; bedrooms → bedroom only; etc.
   - Falls back to all photos if no intent type or no matching photos
4. **Structural feature penalty**: for each detected structural feature in the query, apply `topScore × 0.45` if no caption in the hotel confirms the feature. Multiple missing features stack multiplicatively (e.g. two missing = ×0.45² ≈ ×0.20).
5. **Score rescaling**: raw cosine similarity [0.40–0.80] → display percentage [0–100%]. A raw 0.73 displays as ~83%.
6. Sort all hotels by adjusted topScore descending

### Structural feature detection (in server.js `STRUCTURAL_FEATURES`)
These query patterns trigger caption-based confirmation checks:
- **double sinks**: query `/\bdouble sinks?\b|two sinks?\b.../` → confirm `/\b(two|double|dual|twin|2)\s*sinks?\b.../`
- **soaking tub**: confirm `/\b(soaking|freestanding|clawfoot)\s*(tub|bath)\b.../`
- **balcony**: confirm `/\bbalcon(y|ies)\b/`
- **fireplace**: confirm `/\bfireplace\b/`
- **large windows**: confirm `/\b(large|floor.to.ceiling|panoramic|huge|oversized|expansive)\s*windows?\b.../`

Penalty is `0.45×` per unconfirmed feature. A hotel passes if ANY of its photo captions confirms the feature.

### Room type ordering
Within each hotel, rooms are ordered by **how many detected structural features their captions confirm** (descending), with similarity as tiebreaker. This ensures the room that actually has the queried features (e.g. the room with two stone sinks) appears first — not a room whose name happens to contain a matching word.

For non-feature queries, rooms are sorted by best photo similarity descending.

### Client-side
- 10 hotels rendered initially; `IntersectionObserver` on sentinel div triggers +10 more on scroll
- Match % badge on first photo of first room type per hotel
- Client-side sort: by match % (default), star rating, or guest rating

---

## Frontend Features (client/index.html)

### Search bar
- Hero state (large, centered) before first search
- Compact sticky state after search
- City autocomplete via Geoapify
- Date pickers (UI only — no live pricing yet)
- Sort controls: Match %, Stars, Guest Score

### Hotel cards
- Hotel name, stars, location, guest score, "Find & Book" link (Google search)
- Room type rows — collapsible, first room open by default
- Horizontal photo strip per room, scrollable, up to 10 photos
- Match % badge on first photo of best-matching room

### Lightbox gallery
- Click any photo → fullscreen dark overlay
- Room name + match % badge at the top
- ← → navigation buttons; keyboard arrow keys; Escape to close
- Thumbnail strip at the bottom; click any thumbnail to jump; active thumbnail highlighted in gold
- Photo counter (e.g. "3 / 5") above thumbnails
- Click dark background to close

---

## Key Decisions & Why

**Why not LiteAPI room-search?**
Returns 9 hotels globally regardless of city — geo filtering broken. Paris has 7,221 hotels in full catalog but room-search returns hotels from Minsk, Prague, Japan. limit>100 returns 500 error. Use /data/hotels full catalog instead.

**Why not HuggingFace CLIP?**
Three blockers: api-inference.huggingface.co deprecated (410), router.huggingface.co CLIP not on free hf-inference tier, free tier rate limit (200 req/5min) exhausted instantly at scale.

**Why not VLM scoring at search time?**
~2-3s per image × hundreds of photos = 10+ minutes per search. Unusable. Precompute is the only viable architecture.

**Why Gemini over OpenAI?**
10x cheaper, already had key. gemini-2.5-flash-lite confirmed working. OpenAI ~$600 for global index vs ~$60 Gemini.

**Why gemini-embedding-001 not text-embedding-004?**
text-embedding-004 returns 404 on this account (not available on v1beta). gemini-embedding-001 works, returns 3072 dims.

**Why 768 dims not 3072?**
pgvector ivfflat AND hnsw both cap at 2000 dims. Truncating 3072→768 is valid (Matryoshka). Both caption embeddings and query embeddings use `.slice(0, 768)`.

**Why structured caption not free-form?**
Free-form caused hallucination — model invented "double undermount sink" in a photo without one. Also generated "not visible" negative descriptions polluting embeddings. Structured format with "unknown" is reliable.

**Why Gemini self-classifies photo type?**
LiteAPI imageDescription, imageClass1, imageClass2, classId, classOrder — ALL empty strings/zero for every hotel. No usable classification metadata. Gemini self-classifying as first structured field is accurate and free.

**Why hybrid embedding text?**
Visual captions miss amenity details visible in metadata but not photos. Room name + size + beds + amenities from LiteAPI supplements visual caption and greatly improves matching accuracy.

**Why atomic INSERT for indexing trigger?**
vsearch triggers indexing on first search of unindexed city. Race condition: two simultaneous searches both saw status=none and both triggered indexers. Atomic INSERT (not upsert) only succeeds once — second attempt fails silently, no duplicate run.

**Why score_city_photos instead of search_rooms?**
search_rooms used a match_count cap (top 500 photos globally), so hotels outside the top 500 got no score and appeared as "browse" entries. score_city_photos does a full scan — every hotel gets a real similarity score, enabling a single ranked list with percentages for all 140 hotels.

**Why structural feature penalty instead of hard filtering?**
Hard filtering removes hotels from results entirely, which is surprising for users. A penalty (×0.45 per missing feature) sinks non-matching hotels toward the bottom while keeping them visible. Multiple penalties stack — a hotel missing both "double sinks" and "large windows" gets ×0.20 of its original score.

**Why sort rooms by feature confirmation, not by similarity?**
Pure similarity ordering causes a false-positive: "Two Adjacent Double Rooms" (a room name) contains the word "double", which creates high embedding similarity to "double sinks" queries. Sorting by caption confirmation count ensures the room that genuinely has the features (e.g. "Junior Suite (Exception)" with two stone sinks) appears first.

---

## Debugging History — What Failed & Why

### LiteAPI room-search Investigation
- Room-search returns 9 hotels globally regardless of city/query params
- Geo filtering completely non-functional — Paris search returns hotels in Minsk, Prague, Japan
- Confirmed via /api/debug-city: 7,221 full catalog vs 9 room-search
- limit=200 on room-search → 500 error
- LiteAPI docs say it's a similarity index not inventory endpoint — confirmed broken in practice

### HuggingFace CLIP Debugging
1. api-inference.huggingface.co + image URL → 503 errors (overloaded/deprecated)
2. Switched to base64 encoding → 410 Gone (endpoint fully deprecated)
3. router.huggingface.co/hf-inference/models/openai/clip-vit-large-patch14 → 404 (model not on this tier)
4. Free tier: 200 req/5min exhausted in seconds with 10 hotels
5. VLM scoring at search time (Llama Vision) → 10+ min for 10 hotels, unusable
6. Final decision: remove CLIP, replace toggle with Vector Search

### Gemini Model Discovery
Working models on this account (confirmed via /api/debug-gemini):
- gemini-2.5-flash-lite ✅ (vision + text, use for captioning)
- gemini-2.5-flash ✅ (works but more expensive)
- gemini-embedding-001 ✅ (3072 dims, use for embeddings)

NOT working (all 404 on this account):
- gemini-2.5-flash-lite-preview-06-17, gemini-2.5-flash-lite-001
- gemini-1.5-flash, gemini-1.5-flash-8b (deprecated for new users)
- gemini-2.0-flash, gemini-2.0-flash-lite (no longer available to new users)
- text-embedding-004, text-embedding-005, embedding-001, text-multilingual-embedding-002

### Supabase Permission Issues
Symptom: "permission denied for table room_embeddings" on every insert
Root cause: Supabase enables RLS by default. Service role key still blocked without explicit disable.
Fix (run in Supabase SQL editor):
```sql
ALTER TABLE room_embeddings DISABLE ROW LEVEL SECURITY;
ALTER TABLE hotels_cache    DISABLE ROW LEVEL SECURITY;
ALTER TABLE indexed_cities  DISABLE ROW LEVEL SECURITY;
GRANT ALL ON room_embeddings TO anon, service_role, authenticated;
GRANT ALL ON hotels_cache    TO anon, service_role, authenticated;
GRANT ALL ON indexed_cities  TO anon, service_role, authenticated;
GRANT ALL ON SEQUENCE room_embeddings_id_seq TO anon, service_role, authenticated;
GRANT ALL ON SEQUENCE indexed_cities_id_seq  TO anon, service_role, authenticated;
```

### Supabase 1000-row cap (PostgREST)
- Symptom: `allPhotos: 1000` in logs even though Paris has 4,699 photos. Hotels 11+ had no photos.
- Root cause 1: PostgREST default `max_rows=1000` applies server-side; `.limit(10000)` in client code is overridden.
- Root cause 2: anon role has `statement_timeout=3s`; full city scan took >3s.
- Fix 1: Created `score_city_photos` as a SQL function (RPCs bypass row limit + run with SECURITY DEFINER, no timeout).
- Fix 2: `ALTER ROLE authenticator SET pgrst.db_max_rows = '10000'; NOTIFY pgrst, 'reload config';`
- Fix 3: Use `supabaseAdmin` (service role key) for all vsearch queries, not `supabase` (anon key).

### pgvector Dimension Issues
- vector(768) → fine
- vector(3072) + ivfflat → "column cannot have more than 2000 dimensions for ivfflat index"
- vector(3072) + hnsw → "column cannot have more than 2000 dimensions for hnsw index"
- Solution: keep vector(768), slice embeddings to 768 in code

### Indexer Bugs Fixed
1. **"photo is not defined"** — geminiCaption() referenced photo.type/photo.roomName from outer scope. Fix: pass photoContext = {type, roomName} as second arg.
2. **0 embeddings after successful captions** — text-embedding-004 returning 404 silently. Fix: switch to gemini-embedding-001.
3. **Duplicate indexer runs** — race condition in vsearch trigger. Fix: atomic INSERT prevents second run.
4. **maxOutputTokens: 150** — structured response truncated, FURNITURE/NOTABLE FEATURES missing. Fix: increase to 400.
5. **Free tier rate limit** — 15 req/min caused 60min Paris indexing. Fix: pay-as-you-go Gemini (1000 req/min), now ~2min.
6. **Caption hallucination** — free-form prompt invented features. Fix: structured prompt with "unknown".
7. **Photo type always "other"** — LiteAPI metadata all empty. Fix: Gemini self-classifies.
8. **503 errors on gemini-2.5-flash-lite** — transient overload on first use. Fix: retry with 2s/4s/6s backoff, model works fine.
9. **Connection pool exhaustion** — concurrent indexer runs + unthrottled DB writes caused Supabase to get stuck in PAUSING state (2026-03-20). Fix: DB_CONCURRENCY=3 semaphore in index-city.js. Do NOT re-index without this fix in place.

### Search Result Issues Fixed
1. **Only 1-2 photos per hotel** — match_count=100 shared across all hotels, most got 1-2. Fix: increase to 500, fetch all hotel photos from DB separately.
2. **Hotel IDs as names** — cache only fetched for top 10 but response had 20. Fix: fetch all, use hotel_name from room_embeddings as fallback.
3. **Wrong top match** — hallucinated caption matched query. Fix: structured prompt eliminates this.
4. **Hotels 11+ had no photos** — PostgREST 1000-row cap. Fix: score_city_photos RPC + pgrst.db_max_rows=10000.
5. **Hotels 11+ had no match badge** — badge only rendered when `rt.score !== null`. Fix: all hotels get a score from full scan; "browse" badge for hotels with score=0.
6. **"Hidden Hotel" ranking #1 for "double sinks" despite having them** — the room with two stone sinks ("Junior Suite Exception") was buried behind other rooms because "Two Adjacent Double Rooms" had "double" in its name, inflating embedding similarity. Fix: sort rooms by caption confirmation count of detected features, not by similarity.
7. **Wrong first photo shown in hotel card** — intentType sorting put bathroom rooms first even when the confirming photo was a bedroom type. Fix: rooms sorted by feature confirmation count → the room that proves the match is always shown first.

---

## Known Issues & Next Steps

1. **Expand Paris index** — Currently top-200 hotels by star rating indexed (140 with photos). LiteAPI has 7,221 Paris hotels total.
   - Next: limit=1000 (~700 hotels, ~$2.50 Gemini cost, ~10 min)
   - Full: limit=7221 (~5,000 hotels, ~$17, ~60-70 min)
   - Trigger: `POST /api/index-city {"city":"Paris","limit":1000,"secret":"..."}`
   - Indexer is idempotent — skips already-indexed photos

2. **Index London and NYC** after Paris expanded and validated.

3. **Live pricing** — date inputs are UI-only; connect to LiteAPI rates endpoint to show real nightly prices.

4. **Consider Supabase logging table** to avoid copy-pasting Render logs for debugging.

---

## Roadmap

### Neighborhood / Borough Search (post-Paris testing)
Currently city input is matched exactly against the index. "Brooklyn" would trigger a new index instead of reusing "New York City".

**Planned approach (how Expedia/Booking.com handle it):**
- Store `lat` and `lng` per hotel in `hotels_cache` (LiteAPI returns coordinates)
- Geoapify autocomplete already returns bounding boxes for any place (city, borough, neighborhood)
- When user searches "Brooklyn": resolve to bounding box via Geoapify, use "New York City" for index lookup, filter results to hotels within the bounding box
- Index stays city-level forever — neighborhood precision comes from geo filtering at search time

**What needs building:**
1. Add `lat FLOAT, lng FLOAT` columns to `hotels_cache` in Supabase
2. Store coordinates during indexing (LiteAPI `/data/hotel` returns `location.latitude/longitude`)
3. Update `/api/places` autocomplete to return bounding boxes alongside city name
4. Update `/api/vsearch` to accept optional `bbox` param and filter `hotels_cache` by coordinates
5. Frontend: when user selects a neighborhood from autocomplete, send canonical city + bbox

---

## Workflow

**Trigger re-indexing:**
```bash
curl -X POST https://roommatch-1fg5.onrender.com/api/index-city \
  -H "Content-Type: application/json" \
  -d '{"city":"Paris","limit":200,"secret":"YOUR_INDEX_SECRET"}'
```

**Check indexing progress (Supabase):**
```sql
SELECT city, status, hotel_count, photo_count FROM indexed_cities;
SELECT COUNT(*), COUNT(DISTINCT hotel_id) FROM room_embeddings WHERE city = 'Paris';
```

**View Render logs via MCP:**
Use `list_logs` tool with `resource: ["srv-d6s27b75r7bs738737fg"]` (Render MCP connected in Cursor).

**Debug endpoints:**
- /api/debug-gemini — test which Gemini models work
- /api/debug-city?city=Paris — LiteAPI coverage
- /api/debug-photos?hotelId=lp1beec — raw photo metadata

---

## Recommended Dev Setup

- **IDE:** Cursor (edits files directly, reads terminal, built-in git)
- **Logs:** Render MCP `list_logs` tool in Cursor (faster than CLI)
- **DB:** Supabase MCP `execute_sql` tool in Cursor
- **Deploy:** git push in Cursor → Render auto-deploys in ~2min

---

## MCP Connections
- **Supabase MCP** — `user-supabase`, project ID dmgxrcmdihgsffvqllms
- **Render MCP** — `user-render`, service ID srv-d6s27b75r7bs738737fg
