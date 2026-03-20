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
  → Two search modes:
      1. LiteAPI Room Search (broken beta endpoint, ~9 results globally)
      2. Vector Search (our own index, works well)

VECTOR SEARCH PIPELINE:
  LiteAPI /data/hotels (up to 7,221 Paris hotels)
  → /data/hotel (room photos per hotel)
  → Gemini 2.5 Flash Lite (structured photo captions)
  → gemini-embedding-001 (768-dim truncated embeddings)
  → Supabase pgvector (cosine similarity search)
  → Live search: embed query → search_rooms() → rank hotels
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

### Key SQL function
```sql
search_rooms(query_embedding vector(768), search_city TEXT, match_count INT)
-- returns: hotel_id, room_name, photo_url, photo_type, caption, similarity
```

### Current Index Status
- Paris: 200 hotels, 7,036 embeddings — NEEDS RE-INDEXING (old caption format)

---

## API Endpoints

| Endpoint | Description |
|---|---|
| GET /api/room-search?query&city | LiteAPI room-search (broken, ~9 results) |
| GET /api/vsearch?query&city | Vector search (main mode) |
| GET /api/index-status?city | Check indexing status |
| POST /api/index-city | Trigger indexing (requires INDEX_SECRET in body) |
| GET /api/clip-search?query&city | HuggingFace CLIP (deprecated, broken) |
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
pgvector ivfflat AND hnsw both cap at 2000 dims. Truncating 3072→768 is valid (Matryoshka). Both caption embeddings and query embeddings use .slice(0, 768).

**Why structured caption not free-form?**
Free-form caused hallucination — model invented "double undermount sink" in a photo without one. Also generated "not visible" negative descriptions polluting embeddings. Structured format with "unknown" is reliable.

**Why Gemini self-classifies photo type?**
LiteAPI imageDescription, imageClass1, imageClass2, classId, classOrder — ALL empty strings/zero for every hotel. No usable classification metadata. Gemini self-classifying as first structured field is accurate and free.

**Why hybrid embedding text?**
Visual captions miss amenity details visible in metadata but not photos. Room name + size + beds + amenities from LiteAPI supplements visual caption and greatly improves matching accuracy.

**Why atomic INSERT for indexing trigger?**
vsearch triggers indexing on first search of unindexed city. Race condition: two simultaneous searches both saw status=none and both triggered indexers. Atomic INSERT (not upsert) only succeeds once — second attempt fails silently, no duplicate run.

---

## Debugging History — What Failed & Why

### LiteAPI room-search Investigation
- Room-search returns 9 hotels globally regardless of city/query params
- Geo filtering completely non-functional — Paris search returns hotels in Minsk, Prague, Japan
- Confirmed via /api/debug-city: 7,221 full catalog vs 9 room-search
- limit=200 on room-search → 500 error
- OR queries ("room OR suite") make no difference
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

### Search Result Issues Fixed
1. **Only 1-2 photos showing** — match_count=100 shared across all hotels, most got 1-2. Fix: increase to 500, fetch all hotel photos from DB separately.
2. **Hotel IDs as names** — cache only fetched for top 10 but response had 20. Fix: fetch all, use hotel_name from room_embeddings as fallback.
3. **Wrong top match** — hallucinated caption matched query. Fix: structured prompt eliminates this.

---

## Known Issues & Next Steps

1. ~~**Paris needs re-indexing with structured prompt**~~ — Done. 4,699 photos, 140 hotels.

2. ~~**SUPABASE STUCK IN PAUSING STATE**~~ — Resolved 2026-03-20. Back to ACTIVE_HEALTHY.

3. ~~**DB write semaphore fix**~~ — Deployed. DB_CONCURRENCY=3 in scripts/index-city.js.

4. **Expand Paris index** — Currently only top-200 hotels by star rating indexed (140 with photos). LiteAPI has 7,221 Paris hotels total. Planned expansion:
   - Next: limit=1000 (~700 hotels, ~$2.50 Gemini cost, ~10 min)
   - Full: limit=7221 (~5,000 hotels, ~$17, ~60-70 min)
   - Trigger: POST /api/index-city {"city":"Paris","limit":1000,"secret":"..."}
   - Indexer is idempotent — skips already-indexed photos

5. **Index London and NYC** after Paris expanded and validated.

6. **Consider Supabase logging table** to avoid copy-pasting Render logs for debugging.

## Search Design (current)

- Returns ALL hotels in city index, sorted by visual match score (best first)
- Unscored hotels (photos didn't appear in top-500 vector results) shown at bottom sorted by guest rating
- Client renders 10 hotels initially, infinite scroll reveals 10 more at a time
- Match % badge shown on first photo of best-matching room type for every scored hotel
- Single unified list — no "matched/unmatched" divider
- Structural caption filters still applied to scoring (e.g. one-sink photos don't boost score for double-sink queries), but hotels are never hard-filtered out

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

**View Render logs (Cursor terminal):**
```bash
npm install -g @render-cli/render
render login
render logs --service roommatch-1fg5 --tail
```

**Debug endpoints:**
- /api/debug-gemini — test which Gemini models work
- /api/debug-city?city=Paris — LiteAPI coverage
- /api/debug-photos?hotelId=lp1beec — raw photo metadata

---

## Recommended Dev Setup

- **IDE:** Cursor (edits files directly, reads terminal, built-in git)
- **Logs:** render logs --tail in Cursor terminal (AI reads directly)
- **DB:** Supabase MCP in Claude.ai, or Supabase CLI in Cursor terminal
- **Deploy:** git push in Cursor → Render auto-deploys in ~2min
- **Render MCP:** Add via /mcp add in Claude Code: https://mcp.render.com/sse

---

## MCP Connections
- **Supabase MCP** — connected in Claude.ai, project ID dmgxrcmdihgsffvqllms
- **Render MCP** — use in Claude Code/Cursor: https://mcp.render.com/sse
