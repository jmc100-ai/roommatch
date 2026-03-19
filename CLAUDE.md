# RoomMatch — Project Context for Claude Code

## What This Is
RoomMatch is a hotel room visual search engine. Users describe their ideal hotel room in natural language ("modern bathroom with double sinks and soaking tub") and get back ranked hotel results with matching room photos.

Live at: **https://www.travelboop.com**
GitHub: **https://github.com/jmc100-ai/roommatch**
Render service: **https://roommatch-1fg5.onrender.com**

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
| Photo captioning | Gemini 2.5 Flash Lite (`gemini-2.5-flash-lite`) |
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
INDEX_SECRET           — protects POST /api/index-city endpoint
```

---

## File Structure

```
roommatch/
├── server.js                 — Express backend (all API endpoints)
├── package.json              — dependencies: express, cors, dotenv, @supabase/supabase-js
├── render.yaml               — Render deployment config
├── CLAUDE.md                 — this file
├── client/
│   └── index.html            — full frontend (single file, vanilla JS)
├── scripts/
│   └── index-city.js         — batch indexing script (hotels → captions → embeddings → Supabase)
└── supabase/
    ├── schema.sql             — full DB schema (run once to set up)
    ├── migrate-768.sql        — migration to 768-dim vectors + HNSW index + disable RLS
    ├── fix-permissions.sql    — grants permissions on all tables
    ├── add-hotel-name.sql     — adds hotel_name column to room_embeddings
    └── migrate-3072.sql       — (superseded, do not use)
```

---

## Supabase Database

**Project ID:** `dmgxrcmdihgsffvqllms`
**Region:** us-west-2

### Tables

**`indexed_cities`** — tracks indexing status per city
```sql
city, country_code, status (pending|indexing|complete|failed),
hotel_count, photo_count, started_at, completed_at, last_error
```

**`hotels_cache`** — hotel metadata cache (avoids re-fetching at search time)
```sql
hotel_id (PK), city, country_code, name, address,
star_rating, guest_rating, main_photo, cached_at
```

**`room_embeddings`** — core table, one row per photo
```sql
id, hotel_id, city, country_code, hotel_name,
room_name, photo_url, photo_type (bedroom|bathroom|living|view|other),
caption (hybrid text: structured Gemini output + room metadata),
embedding vector(768), star_rating, guest_rating, created_at
UNIQUE(hotel_id, photo_url)
```

### Key SQL function
```sql
search_rooms(query_embedding vector(768), search_city TEXT, match_count INT)
→ returns hotel_id, room_name, photo_url, photo_type, caption, similarity
```

### Current Index Status
- Paris: 200 hotels, 7,036 embeddings ✅

---

## API Endpoints (server.js)

| Endpoint | Description |
|---|---|
| `GET /api/room-search?query&city` | LiteAPI room-search (broken beta, ~9 results) |
| `GET /api/vsearch?query&city` | Vector search (main mode) |
| `GET /api/index-status?city` | Check indexing status for a city |
| `POST /api/index-city` | Trigger indexing (requires INDEX_SECRET) |
| `GET /api/clip-search?query&city` | HuggingFace CLIP (deprecated, broken) |
| `GET /api/debug-city?city` | LiteAPI coverage analysis |
| `GET /api/debug-gemini` | Test available Gemini model names |
| `GET /api/debug-photos?hotelId` | Show raw LiteAPI photo fields |
| `GET /api/health` | Health check |

---

## Frontend (client/index.html)

- Freeform text search + city autocomplete (Geoapify)
- Mode toggle: **LiteAPI Room Search** | **Vector Search**
- Hotel cards with collapsible room type rows
- Photo strips (horizontal scroll) per room type
- Match score pill on best-matching room type
- Indexing status banner with auto-poll (15s) when city is being processed
- Find & Book button → Google search
- Keepalive self-ping every 10 min (prevents Render free tier spin-down)

---

## Indexer (scripts/index-city.js)

Triggered via: `POST /api/index-city {"city":"Paris","limit":200,"secret":"..."}`

**Flow:**
1. Fetch hotels from LiteAPI sorted by star rating
2. For each hotel (20 concurrent): fetch room detail → collect photos (max 10/room type, 60/hotel)
3. For each photo: Gemini caption → Gemini embed → Supabase upsert
4. Rate limits: 500 caption/min, 1000 embed/min (paid Gemini tier)
5. Idempotent: skips already-indexed photos via UNIQUE constraint
6. Updates `indexed_cities` progress throughout

**Gemini caption prompt:** Structured feature extraction asking about:
- PHOTO TYPE (self-classified by Gemini)
- BATHROOM: sinks, counter space, bathtub, shower, bidet, separate toilet
- BEDROOM: bed type, walk-in closet
- VIEWS & LIGHT: natural light, windows, view, balcony
- SPACE & LAYOUT: size, ceiling height, separate living area
- FLOORING & DECOR: flooring, wall colour, style (2 picks), color mood
- FURNITURE: sofa, armchair, chaise lounge, desk, dining table
- NOTABLE FEATURES: fireplace, coffee machine, TV, in-room hot tub

**Hybrid embedding text:** Structured caption + room metadata (name, size, beds, amenities)

---

## Key Decisions & Why

**Why not LiteAPI room-search?**
Paris has 7,221 hotels in full catalog but room-search returns only 9 (globally random, wrong cities). Confirmed broken via `/api/debug-city`. Reported to LiteAPI.

**Why Gemini over OpenAI?**
Already had Gemini key. 10x cheaper than GPT-4o-mini for captioning. `gemini-2.5-flash-lite` confirmed working on this account.

**Why 768 dims not 3072?**
pgvector indexes (ivfflat + hnsw) cap at 2000 dimensions. `gemini-embedding-001` returns 3072 dims — we truncate to 768 (Matryoshka truncation is valid).

**Why structured caption prompt?**
Free-form descriptions caused hallucination (model described features not visible). Structured format forces conservative answers ("unknown" if not visible).

**Why hybrid text for embedding?**
LiteAPI photo metadata has no classification (imageDescription/imageClass1/imageClass2 are all empty strings). Room name + amenities from LiteAPI metadata is reliable and supplements visual caption.

**Why on-demand indexing?**
First vector search of an unindexed city triggers background indexing. Returns LiteAPI results + banner while indexing. Race condition handled with atomic INSERT (not upsert) to prevent duplicate runs.

---

## Known Issues & Current Work In Progress

1. **Caption quality** — structured prompt working well, Gemini self-classifies photo type. Old Paris embeddings used previous prompt format — needs re-indexing with new prompt.

2. **Photo type detection** — LiteAPI provides no photo metadata (all empty). Gemini now self-classifies as first field in structured output and result stored in `photo_type` column.

3. **`photo` variable scope bug** — fixed: `geminiCaption(url, {type, roomName})` now passes context correctly.

4. **maxOutputTokens** — set to 400 to fit full structured response.

5. **Paris needs re-indexing** — current 7,036 embeddings used old caption format. Clear and re-index to get structured captions:
```sql
DELETE FROM room_embeddings WHERE city = 'Paris';
DELETE FROM indexed_cities WHERE city = 'Paris';
DELETE FROM hotels_cache WHERE city = 'Paris';
```
Then: `POST /api/index-city {"city":"Paris","limit":200,"secret":"..."}`

---

## Workflow

**To make code changes:**
1. Edit files
2. `git add . && git commit -m "description" && git push`
3. Render auto-deploys in ~2 minutes

**To run SQL migrations:**
Use Supabase MCP directly — project ID `dmgxrcmdihgsffvqllms`

**To trigger re-indexing:**
```bash
curl -X POST https://roommatch-1fg5.onrender.com/api/index-city \
  -H "Content-Type: application/json" \
  -d '{"city":"Paris","limit":200,"secret":"YOUR_INDEX_SECRET"}'
```

**To check indexing progress:**
```
GET https://roommatch-1fg5.onrender.com/api/index-status?city=Paris
```
Or via Supabase: `SELECT * FROM indexed_cities;`

---

## MCP Connections (Claude.ai)
- **Supabase MCP** — connected, project ID `dmgxrcmdihgsffvqllms`
- **GitHub** — via native Claude.ai integration
- **Render MCP** — not available in Claude.ai, use Claude Code for log access
