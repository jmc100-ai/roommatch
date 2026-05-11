# RoomMatch — Project Context for Claude Code

## What This Is
RoomMatch is a hotel room visual search engine. Users describe their ideal hotel room in natural language ("modern bathroom with double sinks and soaking tub") and get back ranked hotel results with matching room photos.

Live at: **https://www.travelboop.com**
GitHub: **https://github.com/jmc100-ai/roommatch**
Render service: **https://roommatch-1fg5.onrender.com** (service ID: srv-d6s27b75r7bs738737fg)
Supabase project ID: **dmgxrcmdihgsffvqllms**

**Launch city: Mexico City.** All manual testing, perf benchmarking, and search-quality QA must use `?city=Mexico City` (V2 catalog, ~3 600 hotels). Paris and Kuala Lumpur are V1-only and will be migrated/retired post-launch — do **not** use them as the primary test target.

---

## Architecture

```
FRONTEND (client/index.html + client/styles.css + client/app.js)
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
VSEARCH_FLAG_MODE      — soft (default) or strict: strict uses SQL `required_features` pre-filter; soft uses semantic recall + per-hotel flag coverage boost (see Search Design)
SOFT_FLAG_COVERAGE_MULT — multiplicative boost factor for soft flag-heavy queries: raw × (1 + mult × coverage); default 0.28 (replaces legacy SOFT_FLAG_BONUS_MAX additive)
SOFT_FLAG_MISS_PENALTY — multiply raw by (1 − pen × (1 − coverage)) so low coverage ranks lower; default 0.08; set 0 to disable
SOFT_FLAG_HOTEL_CAP    — max hotels scanned for coverage in soft mode (default 1500)
UNSPLASH_KEY           — (not yet set) free key from unsplash.com/developers — needed for neighborhood card photos
SITE_PASSWORD          — (not yet set) simple password gate for the frontend; omit to disable gate (API routes never gated)
LITEAPI_WL_DOMAIN      — LiteAPI white-label domain WITHOUT scheme, e.g. `travelboop.nuitee.link`. Server prefixes `https://` and serves via `/api/config` AND injects into `window._WL_BASE_URL` in served HTML so `buildBookUrl()` in client/app.js has it on first render. Empty/unset → "Find & Book" buttons fall back to a Google search.
MAPTILER_KEY           — Maptiler API key (free tier: 100k tile loads/month at maptiler.com). Powers the neighbourhood-vibe-page map module (MapLibre GL). Server exposes via `/api/config` AND injects into `window._MAPTILER_KEY` in served HTML so the map can boot before any /api/config fetch. **Must be restricted by HTTP referrer in the Maptiler dashboard** (Allowed origins: `travelboop.com`, `www.travelboop.com`, `roommatch-1fg5.onrender.com`, `localhost:*`). Unset → map falls back to OSM raster tiles (works but lower quality + against OSM tile usage policy at scale).
META_SYNC_LIMIT        — top-N hotels for which `/api/vsearch` (V2 path) fetches LiteAPI metadata synchronously before sending the response. Default `30`. Lower = faster TTFB, more cards initially show with placeholder name until lazy-load arrives. The remainder are listed in `data.deferred_meta_ids` and lazy-fetched by the client via `/api/hotels-meta`. See "V2 Search Latency" section below.
NLP_INTENT_TIMEOUT_MS  — `buildFactIntentLLM` (Gemini 2.5 flash-lite) call timeout in ms. Default `3000`. On timeout we fall back to the deterministic regex router (`v2-facts-1`); fine for most queries. Raise only if you see frequent `(router=v2-facts-1)` in logs and the regex is missing important facts.
LITEAPI_MAX_RATES_PER_HOTEL — `/hotels/rates` request knob (used by `/api/rates` AND `/api/debug-rates`). Default `60`, clamped 10–300. **Updated diagnosis (2026-05-11):** the real reason the response previously looked saturated at ~1.7 rates/hotel wasn't this cap — it was a hidden LiteAPI server-side cap that kicks in when the request batch size is `>= 50` hotels. Bisected empirically: a batch of 48 hotels returns full 3–5 rates each; a batch of 50+ returns 1 (cheapest only) regardless of `maxRatesPerHotel`. `/api/rates` now works around this with a two-pass design: (1) one large batched call drives hotel-level cheapest prices for sorting/filtering, (2) a top-N detail pass re-queries the highest-ranked priced hotels in chunks of <=40 to recover the missing per-room rates. Tuned by `RATES_DETAIL_TOPN` / `RATES_DETAIL_CHUNK` below. The `[rates] distinct-rooms histogram` log line is the empirical signal for tuning — for the top-N rows it should skew toward the 2-3 / 4-5 buckets after the detail pass.
RATES_DETAIL_TOPN           — number of top-ranked-and-priced hotels to re-fetch with smaller batches to recover the per-room rates dropped by LiteAPI's batch-size cap (see `LITEAPI_MAX_RATES_PER_HOTEL` above). Default `50`, clamped 0–200. Set `0` to disable the detail pass entirely (single-call legacy behaviour). Cost: 1-2 extra parallel LiteAPI calls per `/api/rates` invocation, ~1-2 s added latency. Only runs when the batched-call input had `>= 50` hotels (single-hotel / small-city searches already get full rates from the main call).
RATES_DETAIL_CHUNK          — chunk size for the detail pass. Default `40`, clamped 10–48. Must stay below the empirical threshold of 50 hotels per batch where LiteAPI starts truncating rates.
```

### Beta-launch env vars (added 2026-05-07)
```
SENTRY_DSN_SERVER       — server-side @sentry/node DSN. Unset → Sentry no-ops.
SENTRY_DSN_CLIENT       — browser Sentry DSN. Public-by-design; injected into served HTML.
SENTRY_ENV              — environment tag for Sentry (e.g. `production`, `staging`).
POSTHOG_PROJECT_KEY     — PostHog "Project API Key" (public). Browser tracking.
POSTHOG_API_KEY         — same key, used by `posthog-node` for server-side mirror events.
POSTHOG_HOST            — default `https://us.i.posthog.com`.
RESEND_API_KEY          — Resend transactional email API key (used by `scripts/email/send-emails.js`).
BETA_PASSWORD           — same value as `SITE_PASSWORD`, embedded by the email script in invites.
BETA_FROM               — From: header for outbound emails (e.g. `TravelBoop Beta <beta@travelboop.com>`).
BETA_REPLY_TO           — Reply-To: header.
BETA_BASE_URL           — base URL embedded in invite emails. Defaults to `https://www.travelboop.com`.
BETA_CALENDAR_URL       — optional Cal.com / Calendly URL embedded in nudge / call-invite emails.
BETA_BANNER             — optional sticky-top banner text shown to all users until dismissed (e.g. "Slow searches today — fix in flight"). Empty/unset → no banner.
SLACK_FEEDBACK_WEBHOOK  — optional. When set, every `POST /api/feedback` mirrors a brief preview to Slack.
BETA_FEEDBACK_EMAIL     — optional. When set (and RESEND_API_KEY + BETA_FROM are configured), every `POST /api/feedback` is also emailed here via Resend. Reply-To is the submitter's email when present so you can reply directly. Slack and email fan-outs are independent — set either, both, or neither.
```

### Beta-launch architecture notes
- **API beta gate**: when `SITE_PASSWORD` is set, every `/api/*` request requires the `rm_gate` cookie issued by `POST /auth` (or `INDEX_SECRET` in body / `x-index-secret` header). Allowlist: `/api/health`, `/api/config`, `/api/public-config`. Returns `401 { error: "beta_gate_required" }` on failure.
- **Rate limits** (per-IP, 60s window): `/api/vsearch` 60/min, `/api/rates` 30/min, `/api/hotels-meta` 90/min, admin/backfill routes 10/min, all other `/api/*` 240/min. Hits return `429 { error: "rate_limited" }`.
- **CORS** is allowlisted to `travelboop.com`, `www.travelboop.com`, the Render URL, and localhost. No more `origin: "*"`.
- **helmet** is enabled with default headers (HSTS, frameguard, noSniff, etc.). CSP is intentionally off until we have time to write a correct policy that allows Sentry/PostHog/MapLibre/inline injected config.
- **`rm_gate` cookie** is `HttpOnly; SameSite=Lax`, with `Secure` set when `x-forwarded-proto=https`.
- **PII stripping** applied at every layer: server Sentry strips query strings + cookies + auth headers in `beforeSend`; browser Sentry strips query strings; PostHog `sanitize_properties` strips query/fragment from any URL-shaped property; client `track()` never includes the actual search query text.
- **Feedback flow**: `POST /api/feedback` → `beta_feedback` table + optional Slack webhook (`SLACK_FEEDBACK_WEBHOOK`) + optional Resend email (`BETA_FEEDBACK_EMAIL`). Both fan-outs are fire-and-forget so they never block the API response. **Consent flow**: one-time modal on first gate pass → `POST /api/beta-consent` → `beta_consents` table (idempotent on `distinct_id`).
- **Booking attribution**: `buildBookUrl()` always appends `utm_source=travelboop`, `utm_medium=beta`, `utm_campaign=closed_beta_2026`, `utm_content=room_offer|hotel_page`, and `tb_distinct=<persistent browser uuid>` so we can attribute LiteAPI conversions back to a search session if a partner ever shares booking data.

### White-label booking links (Find & Book buttons)
- All "Find & Book" CTAs (search results card, room rows, hotel detail page sidebar + mobile sticky bar) call `buildBookUrl(hotel, roomTypeId)` in `client/app.js`.
- URL formats sent to the WL:
  - **Hotel page (no specific room)**: `https://<wl>/hotels/<hotelId>?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&occupancies=base64(JSON)` — guest picks a room on the WL.
  - **Direct offer (we have an offerId from `/api/rates`)**: `https://<wl>/booking?offerId=<id>` — straight to checkout for a specific room rate.
- `offerId` is captured per `(hotel_id, room_type_id)` inside `/api/rates` from `rates[0].offerId` (or `offer_id`) and sent to the client as `roomPrices.offerIds`. The client then exposes them as `hotel.offerIds[roomTypeId]` so room-row buttons get a deep link, while hotel-level buttons fall back to the hotel page URL.
- **Robustness:** the WL URL is read at *call time* (not module init) AND server-injected into HTML before app.js runs. Earlier code captured it at module init, before the `/api/config` fetch resolved → silently fell back to Google. Do not regress this — keep `_wlBaseUrl()` reading `window._WL_BASE_URL` on every call.

---

## File Structure

```
roommatch/
├── server.js                    — Express backend (all API endpoints)
├── package.json                 — deps: express, cors, dotenv, @supabase/supabase-js
├── render.yaml                  — Render deployment config
├── CLAUDE.md                    — this file
├── client/
│   ├── index.html               — HTML skeleton only (markup, meta tags, links to css/js)
│   ├── styles.css               — all CSS (extracted from index.html May 2026)
│   └── app.js                   — all frontend JS (extracted from index.html May 2026)
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

### Frontend file split (May 2026)

`client/index.html` was previously a single 473 KB / 10,165-line file containing all HTML, CSS, and JS. It grew too large for reliable agent edits (StrReplace collisions, context-window cost). It was split into:
- `client/index.html` — HTML skeleton + `<link>` and `<script src>` tags only
- `client/styles.css` — all CSS rules
- `client/app.js` — all frontend JS

**Going forward:**
- **Add new CSS to `client/styles.css`**, NOT inline in `index.html`
- **Add new JS to `client/app.js`**, NOT inline in `index.html`
- `index.html` should stay small (~500 lines) — only markup changes
- Express serves `client/` as static, so `/styles.css` and `/app.js` resolve directly
- If `app.js` grows beyond ~5,000 lines, split it into ES modules organized by concern (wizard, search, neighborhoods, results, vibes)

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
| GET /api/vsearch?query&city | Vector search (main mode). V2 path returns `deferred_meta_ids` (hotels beyond `META_SYNC_LIMIT`) for client lazy-fetch. |
| GET /api/hotels-meta?ids=h1,h2,… | Batch lazy fetch of LiteAPI metadata (name/mainPhoto/starRating/guestRating/address) for cards beyond the synchronous fetch limit. Up to 200 IDs/call. Returns `{ hotels: { [id]: {...} } }`. |
| GET /api/rates?city&checkin&checkout | Batch hotel+room pricing from LiteAPI. Returns `prices`, `roomPrices`, `roomNames` (rate name per `mappedRoomId`, used by D3 client-side "More bookable rates" rows for priced rooms we don't have indexed photos for), `offerIds`, `roomFreeCancel`, `hotelFreeCancel`, `currency`, `nights`, `pricedCount`. Tuned by `LITEAPI_MAX_RATES_PER_HOTEL` env var (default 200). |
| GET /api/index-status?city | Check indexing status |
| POST /api/index-city | Trigger indexing (requires INDEX_SECRET in body) |
| POST /api/backfill-feature-embeddings | Re-embed feature_summary + re-extract feature_flags for a city |
| POST /api/backfill-room-ids | Backfill room_type_id for existing rows (requires INDEX_SECRET) |
| GET /api/debug-city?city | LiteAPI coverage analysis |
| GET /api/debug-gemini | Test available Gemini model names |
| GET /api/debug-photos?hotelId | Show raw LiteAPI photo fields |
| GET /api/hotel/:hotelId | Hotel details data (live-fetch metadata + DB rooms) — consumed by the dedicated `/hotel/:hotelId` page (was: slide-out panel, now removed) |
| GET /api/hotel/:hotelId/reviews?limit&offset&language | **Live LiteAPI guest reviews proxy** — no DB write, in-memory hint cache only (3 min TTL, 200-entry LRU). Slim DTO + `Cache-Control: private, no-store`. **Never feed review text into embeddings, HyDE, or any prompt.** |
| GET /api/health | Health check |
| POST /api/feedback | Beta in-app feedback intake. Body: `{message, email?, sentiment?, distinctId, currentUrl, currentSearch}`. Inserts into `beta_feedback`; mirrors to Slack via `SLACK_FEEDBACK_WEBHOOK` if set. |
| POST /api/beta-consent | One-time consent ledger. Body: `{distinctId, email?, policyVersion?}`. Idempotent upsert into `beta_consents`. |
| POST /api/track | Generic server-side PostHog event mirror. Body: `{distinctId, event, properties}`. Used to bypass ad-blockers for high-signal events. |
| GET /api/debug-sentry?secret= | Throws an async test exception; should appear in Sentry within ~30s. Gated by `INDEX_SECRET`. |
| GET /privacy | Standalone, indexable, gate-bypassing privacy policy page. Mirrors copy from in-app overlay (`getStaticPageContent('privacy')`). |
| GET /terms | Standalone, indexable, gate-bypassing terms page. Mirrors copy from in-app overlay (`getStaticPageContent('terms')`). |
| GET /hotel/:hotelId | **SPA route** — serves `client/index.html` (no-cache, gate-aware). Client JS reads `location.pathname` and renders the dedicated hotel detail page (`#st-hotel-detail`). |

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
4. **Default (soft):** call `score_room_types` **without** `required_features`; load per-hotel flag coverage from `room_types_index.features`, apply multiplicative boost `× (1 + coverageMult × coverage) × (1 − missPenalty × (1 − coverage))` + re-sort before Phase B. **Strict:** `VSEARCH_FLAG_MODE=strict` or `?flag_mode=strict` → pass `required_features` (legacy hard AND pre-filter).
5. Build `hotelSimMap` (hotel → max similarity) and `roomTypeSimMap` (hotel::room → similarity)

### Phase B — Photo fetch
6. Fetch photos for top GALLERY_LIMIT (250) hotels via `fetch_hotel_photos` (includes per-photo `feature_flags`)
7. Assign photo similarity from `roomTypeSimMap`; rooms not in map get similarity=0 for feature queries
8. **Flag-heavy soft:** sort photos so images with more matching query flags come first; sort room rows the same way (then by score). Hotels with a feature anywhere in the index rank higher; presentation surfaces matching photos first.

### Score remapping
- `rawScore = max room-type similarity for hotel`
- `score = (rawScore - SIM_MIN) / simSpan * 100` with `simSpan = max(SIM_MAX - SIM_MIN, ε)`; `SIM_MAX` = max raw similarity in the result set (unboosted)
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
1. Fetch all hotel_ids for city from `v2_hotels_cache` (or use ranked IDs passed by client via `hotelIds=...` query param, sliced to 200).
2. **Main pass:** POST to LiteAPI `/hotels/rates` with all IDs, `maxRatesPerHotel: 60`, `roomMapping: true`. Drives hotel-level cheapest prices.
3. **Detail pass** (when batch size `>= 50`): re-query the top `RATES_DETAIL_TOPN` (default 50) ranked-and-priced hotels in parallel chunks of `RATES_DETAIL_CHUNK` (default 40) each. Reason: LiteAPI silently caps to ~1 rate/hotel when the request batch is `>= 50`, regardless of `maxRatesPerHotel`. Bisected empirically — full at 48, capped at 50. Without the detail pass, hotels like *City Express Reforma* show "Queen Room — available" while three other genuinely-bookable room types (incl. Superior King) render as "not available". The detail pass merges all 3–5 rates per top hotel into `roomPrices` / `roomNames` / `offerIds` / `roomFreeCancel`. Failure tolerant: `Promise.allSettled` — partial detail-pass failures just leave those hotels at cheapest-only.
4. Returns `prices` (hotel_id → cheapest/night), `roomPrices` (hotel_id → {room_type_id → $/night}), `roomNames`, `offerIds`, `roomFreeCancel`, `hotelFreeCancel`, `currency`, `nights`, `pricedCount`.

**IMPORTANT — LiteAPI ID mismatch:**
- `/hotels/rates` `roomTypeId` = encoded base64 string — useless for matching
- `/hotels/rates` `rates[0].mappedRoomId` = integer matching `/data/hotel` IDs → USE THIS
- `rates[0].name` ≠ `/data/hotel` `roomName` — do NOT match by name

**Implementation notes:**
- `liteRatesCall(hotelIds, checkin, checkout)` in `server.js` is the shared helper for both the main and detail-pass requests. Throws on 429 / non-2xx so the handler can surface `rateLimited` flag.
- `mergeLiteRatesIntoMaps(ratesList, nights, acc)` mutates an accumulator object in place; the detail pass can only add new mappedRoomIds or improve prices, never overwrite better data already populated by the main call.
- Knobs: `RATES_DETAIL_TOPN` (default 50), `RATES_DETAIL_CHUNK` (default 40) — see env-var section. `RATES_DETAIL_TOPN=0` disables the detail pass entirely.

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

## Data Source Licensing

### Current approach: lowest-risk architecture

LiteAPI's terms restrict creating databases from their data. We have not received (and may never receive) explicit permission. The V2 pipeline is deliberately designed to minimise what we persist.

**Risk profile by data type:**

| What we store | Risk | Status |
|---|---|---|
| Boolean facts (`walk_in_shower: true`) per hotel_id + room_name | Very low — abstract derived work, no LiteAPI expression | ✅ Keep |
| Vector embeddings (768 floats) | Very low — pure math derivative | ✅ Keep |
| `hotel_id`, `room_name`, `room_type_id` (identifiers) | Low — identifiers, not copyrightable content | ✅ Keep |
| Photo URLs in `v2_room_inventory` / `v2_room_feature_facts` | Low–medium — hotlinking references, not stored content | ✅ Keep for now (display only) |
| Gemini captions / `feature_summary` in `v2_room_inventory` | Medium — our text but derived from their photos | ⚠️ Candidate for removal |
| Hotel name, star rating, address persisted to DB | Higher — LiteAPI metadata | ❌ Never persist — always live-fetch |
| Hotel description, amenities persisted to DB | High — LiteAPI content | ❌ Never persist — always live-fetch |
| Guest reviews (text, score, author) persisted to DB | High — LiteAPI / partner UGC | ❌ Never persist — always live-fetch via `/data/reviews` proxy |
| Guest reviews used as embedding / HyDE / prompt input | Highest — LiteAPI ToS forbids derivative datasets / model training | ❌ Forbidden under any circumstance |
| Neighborhood vibes (pure Gemini, no LiteAPI data) | None | ✅ Clean |

**Key rules for all agents:**
- **Never add hotel metadata columns** (name, description, amenities, address, star_rating, guest_rating) to `v2_hotels_cache` as persistent fields. Always fetch live via LiteAPI at query/display time, cache in memory only (30–60 min TTL).
- Hotel details page (when built): live-fetch from LiteAPI `/data/hotel`, short in-memory cache, no DB write.
- **Guest reviews are live-only.** Always proxied via `GET /api/hotel/:hotelId/reviews` → LiteAPI `/data/reviews`. Bounded in-memory hint cache only (3 min TTL, 200-entry LRU; see server.js `_reviewsCache`). **Never persist review text, score, or author to any DB column. Never use review text as input to embeddings, HyDE, captioning prompts, vibe extraction, or any model.** LiteAPI ToS explicitly forbids derivative datasets / ML training.
- Display reviews only on the hotel details panel (`#hp-reviews-section`). Show LiteAPI attribution under the section: *“Reviews provided via LiteAPI”* with a link to `https://liteapi.travel`.
- The `v2_room_types_index` (our primary search index) contains zero LiteAPI data — only boolean facts we derived. This is the cleanest part of the architecture.
- `v2_room_inventory` captions/feature_summary are the next candidate to remove to further reduce risk. Not urgent, but do not expand what we store there.

**Long-term: Hotelbeds** has an explicit Cache API that permits storing their data. Requires a commercial agreement (weeks to onboard). Worth pursuing at commercial scale — they are the right long-term data partner. Also worth evaluating: **GIATA direct** (1.4M+ properties, the source Hotelbeds itself uses).

**Gemini API terms:** Clean. Generated content belongs to us. No restrictions on storing it.

**Unsplash terms:** Clean. Attribution required (displayed on neighbourhood cards). Hotlinking allowed.

---

## V2 Search Pipeline (facts-based, parallel to V1)

V2 is an isolated facts-based hotel ranking system running alongside V1. Default since Apr 28 2026.

### Goal
Index the **full Mexico City catalog** (~3,616 hotels from LiteAPI) with a quality filter: only include hotels that have at least one room type with **≥2 photos**. This is the planned launch catalog.

### V2 Tables (Supabase, project dmgxrcmdihgsffvqllms)
| Table | Purpose |
|---|---|
| `v2_indexed_cities` | Indexing status per city (status: indexing\|complete\|failed) |
| `v2_hotels_cache` | Hotel metadata: hotel_id, city, country_code, hotel_photos, lat, lng, cached_at |
| `v2_room_inventory` | One row per photo: hotel_id, photo_url, room_name, room_type_id, photo_type, caption, feature_summary, source, created_at |
| `v2_room_feature_facts` | Extracted facts: hotel_id, room_type_id, photo_url, fact_key, fact_value, confidence, source, extractor_version |
| `v2_room_types_index` | Pre-aggregated per-room facts (rebuilt via `rebuild_v2_room_types_index_city` RPC after indexing) |

**CRITICAL SCHEMA NOTE:** `v2_room_inventory` requires a `photo_url TEXT` column and a unique index on `(hotel_id, photo_url)` for upserts to work. This was added May 1 2026 after a failed run that cleared inventory and errored on every insert due to the missing column.

### V2 Indexing Script
`scripts/index-city-v2.js` — exports `reindexCityV2(city, limit, forceRebuild)`

**Quality filter (already implemented):** skips any hotel where no room type has ≥2 photos.

**Triggered via:**
```powershell
# Full Mexico City reindex (all ~3616 hotels, forceRebuild=true clears first)
$body = '{"city":"Mexico City","limit":3616,"secret":"roommatch-2026","force":true}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/reindex-city" -Method POST -ContentType "application/json" -Body $body
```

**Or run locally (faster, uses local .env):**
```powershell
node -e "require('./scripts/index-city-v2').reindexCityV2('Mexico City',3616,true).then(r=>console.log('DONE',JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)});"
```

### V2 Status Check
```sql
SELECT city, status, hotel_count, photo_count, started_at, updated_at, last_error
FROM v2_indexed_cities WHERE city='Mexico City';

SELECT
  (SELECT count(*) FROM v2_hotels_cache WHERE city='Mexico City') as hotels,
  (SELECT count(*) FROM v2_room_inventory WHERE city='Mexico City') as photos,
  (SELECT count(*) FROM v2_room_inventory WHERE city='Mexico City' AND caption IS NOT NULL AND length(caption)>20) as captioned,
  (SELECT count(*) FROM v2_room_feature_facts WHERE city='Mexico City') as facts;
```

### V2 Search Routing
- `GET /api/vsearch?search_version=v2` — forces V2
- `GET /api/vsearch?search_version=v1` — forces V1 (comparison)
- Default is V2 (hardcoded in server.js fallback; override with env `SEARCH_VERSION_DEFAULT`)

### V2 Indexing History (Mexico City)
| Date | Event |
|---|---|
| Apr 28 2026 | Initial V2 run — 116 hotels, captioning broken (file_uri bug) |
| Apr 28 2026 | Fixed captioning (image-bytes flow), re-ran — 128→249 hotels, 4390 captioned |
| Apr 28 2026 | Changed default to V2 in server.js |
| May 1 2026 | Failed run — triggered with limit=3616 via live endpoint; cleared inventory; failed on every inventory insert (missing photo_url column); wrote 154,588 facts orphaned |
| May 1 2026 | Fixed: added photo_url + unique index to v2_room_inventory; cleared all Mexico City V2 data; launched full reindex limit=3616 |

### V2 Known Issues Fixed
- **`v2_room_inventory` missing `photo_url`** — fixed May 1 2026 (ALTER TABLE + unique index)
- **Gemini captioning used file_uri** — fixed Apr 28 (switched to inline image-bytes)
- **Rate limits on Gemini 2.5 Flash Lite** — handled via CAPTION_RATE_PER_MIN=500 + exponential backoff (5 retries: 3s, 12s, 27s, 48s, 60s cap)
- **LiteAPI paginates at 1000/page** — indexer loops until `limit` reached

### V2 Search Latency — Cold-Instance Tuning (May 7 2026)

Render rotates instances every ~1–3 hours, so most users hit a cold-cache instance. Pre-fix, cold V2 search took 7–10 s server-side (TTFB). Profiled bottlenecks were:

| Stage | Cold | After fix |
|---|---|---|
| `buildFactIntentLLM` (Gemini NLP intent) | ~1–2 s, sequential before phase-A | parallel with phase-A; net ~0 ms when phase-A is the slower of the two |
| Phase-A DB load (3 500 hotels + 9 700 index rows) | ~1.1 s | unchanged (already minimal) |
| Phase-B parallel (photos + embed + score_hotels + nbhd RPC) | ~1–2 s | unchanged |
| **`fetchHotelMetaBatch` for 250 hotels** | **~2.7–3.4 s** in 5 sequential chunks of 50 | **~0.6–1 s** for top 30 sync; rest deferred + warmed in background |

**Code-level changes shipped in the same commit:**
1. `META_SYNC_LIMIT` (env, default `30`) caps the synchronous LiteAPI metadata fetch in `/api/vsearch` (V2 path) to the top N photo-having hotels. `v2.body.deferred_meta_ids` lists the rest.
2. `prefetchHotelMetaBackground(deferredIds)` runs fire-and-forget after the response is sent so `_hotelMetaCache` is warm by the time the client lazy-loads.
3. New endpoint **`GET /api/hotels-meta?ids=h1,h2,…`** (max 200 per call) returns `{ hotels: { id: {name, mainPhoto, starRating, guestRating, address} } }`. Reads from `_hotelMetaCache` first; misses hit LiteAPI.
4. Client `lazyFetchHotelMeta(deferredIds, reqId)` (in `client/app.js`) batches the deferred IDs in chunks of 100 and calls `applyMetaInPlace(metaMap)` to patch each card's `#hotel-name-{id}` and `#hotel-meta-{id}` without a full re-render. Bails when `_metaLazyReqId` is bumped by a newer search.
5. `fetchHotelMetaBatch` chunk size `50 → 200` so a single parallel LiteAPI wave is the norm; `_hotelMetaCache` TTL `4h → 24h` (hotel name/star/photo barely change intra-day).
6. `runV2Search` now kicks off `buildFactIntentLLM` immediately and awaits it just before scoring, so it overlaps with the geo prefilter + Phase-A DB load. Adds `[v2 perf] nlp intent: …` log when intent takes >50 ms (cache misses); `[v2 perf] TOTAL` now reports both `since phase-A` and `wall: since handler entry`.

**Expected end-to-end on a cold instance:** ~3 s server TTFB + ~1 s client lazy fetch (non-blocking, fills bottom cards). Warm instance: ~1 s.

**Knobs:**
- `META_SYNC_LIMIT` — top-N hotels to fetch metadata for synchronously (default `30`). Lower = faster TTFB but more cards render with placeholder name briefly.
- `NLP_INTENT_TIMEOUT_MS` — Gemini intent call timeout (default `3000`). On timeout we fall back to the regex router. Was previously hardcoded to `10000` which dominated tail latency when Gemini was degraded (observed cold path: `nlp intent: 10002ms (router=v2-facts-1)` blocking the whole search).
- TTL constant `HOTEL_META_TTL_MS` (24 h) and chunk size `200` are hardcoded in `server.js` → `fetchHotelMetaBatch`.

**Where to look in logs:**
- `[v2 perf] nlp intent: …`        — Gemini NLP intent latency (only logged when >50 ms)
- `[v2 perf] phase-A db: …`        — DB load
- `[v2 perf] TOTAL: X (since phase-A) | wall: Y (since handler entry)` — `Y` is the real server-side total
- `[v2-meta] sync fetched 30/30 in Xms (deferred 220, stubs N)` — confirms META_SYNC_LIMIT
- `[hotel-meta] background warm: 220 hotels in Xms` — confirms warm prefetch ran
- `[hotels-meta] returned 100/100 in Xms` — client lazy-fetch endpoint
- `[perf] lazy meta: 220 hotels in Xms`   — client-side lazy-fetch wall time

---

## Known Issues & Next Steps

0. **Neighbourhood vibe map module (built May 6 2026; top-match default May 7 2026)** — `#st-nbhd` renders a MapLibre GL map at the top of the page (above the card grid) with one rectangular vibe-% pill marker per neighbourhood + polygon shading when `polygon.ring` is available. Markers are colored by vibe-% tier (gold ≥85, amber ≥70, bronze ≥50, slate <50). **Default camera** is fitted to the top-match neighbourhood's bbox (highest `nbhdBoopVibeScore`, `maxZoom: 14`); the **"Show all"** button (formerly "Reset view") zooms back out to the full union of all neighbourhood bboxes (`_nbhdMapBounds`, `maxZoom: 15`). Click a marker (or polygon) → scroll the matching card into view + 1.3s gold flash highlight. Hover (desktop) is bidirectional between marker and card. Map lazy-loads MapLibre from CDN on first show and uses Maptiler `streets-v2` style when `MAPTILER_KEY` is set; falls back to OSM raster tiles otherwise. Module renders inside `#nbhd-map-module` (CSS in `client/styles.css` under "Neighbourhood map module"); core JS lives in `client/app.js` (`renderNbhdMap`, `_ensureMapLibre`, `_vibeColorForPct`, `resetNbhdMap`). Re-renders on every `fetchAndShowNeighborhoodsNew` call (city change or returning to step). **Action required: sign up at maptiler.com (free), set `MAPTILER_KEY` in `.env` and Render env, restrict by HTTP referrer in the Maptiler dashboard.**

1. **Hotel-level vibe score** — TODO: The `hotel-match-badge` currently shows the best room's vectorScore as a proxy for "hotel match." This is slightly misleading. When hotel-level vibe scoring is built (as part of the neighborhood vibe phase), replace `hotelEffectiveScore(h)` with a true hotel-level embedding score separate from the room score. The badge label can then be changed to "Hotel Vibe X%". See `hotelHTML()` and `applyPricesInPlace()` in `client/index.html`.

2. **Index London and NYC** — same flow as KL: trigger index-city, auto-rebuild happens after
   ```powershell
   Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/index-city" -Method POST -ContentType "application/json" -Body '{"city":"London","limit":200,"secret":"roommatch-2026"}'
   ```

3. **Neighborhood Vibe + Visual Search** — full plan in two places:
   - **Cursor plan file (authoritative, most detailed):** `C:\Users\jmc10\.cursor\plans\neighborhood_vibe_+_visual_search_39871fcd.plan.md`
   - **Inline summary:** see "VIBE PLAN" section below
   - When user says **"go build vibe plan"**, read the plan file first, then work through the phases in order.

4. **Hotel Details Page + Property Type** — see "HOTEL DETAILS PLAN" section below. When user says **"go build hotel details"**, read that section first.

5. **Update test-search-quality.js expected counts** after re-indexing any city.

6. **Consider Supabase logging table** to avoid parsing Render logs for analytics.

---

## What We Will NOT Build (Explicit Scope Exclusions)

These are intentionally out of scope. Do not build these without explicit user instruction:

- **SEO-optimised static hotel pages** at `/hotel/:id` — requires SSR or static generation. Current architecture is a single-page app served from Express. Not worth adding until traffic justifies it.
- **User reviews or ratings** — we show LiteAPI guest ratings (fetched live), not user-generated content.
- **Map view** inside the hotel details panel — adds map SDK dependency and complexity. A link to Google Maps / Apple Maps with the hotel address is sufficient.
- **Full booking flow** — we show a "See rates →" CTA that triggers the existing dates tray. We do not handle the booking transaction.
- **Real-time availability inside hotel panel** — rates come from the existing `/api/rates` endpoint tied to the search dates. Not surfaced per-hotel in isolation.
- **Hotel comparison feature** — side-by-side comparison across hotels.
- **Save / favourites / wishlist** — requires user accounts, which we don't have.
- **Social sharing beyond URL deep-link** — `?hotel=` param is sufficient; no OG tags or share sheets needed yet.
- **Storing hotel metadata (name, description, amenities) in the DB** — always live-fetch from LiteAPI. See Data Source Licensing section.
- **Hotel photos in our own CDN/storage** — always hotlink to LiteAPI/cupid.travel URLs.
- **`backfill-facts-from-captions` operation** — facts pipeline is one-way (index → facts → index rebuild). If facts need to change, re-index the city. Do not build a path that re-reads stored captions from `v2_room_inventory`.

---

## HOTEL DETAILS PAGE (as-built — May 2026)

**STATUS:** Built as a dedicated full page (not a slide-out panel). The legacy `#hotel-panel` slide-out drawer has been **deleted entirely** — do not reintroduce it.

### Architecture
- **Route:** `GET /hotel/:hotelId` (Express route in `server.js` serves `client/index.html` with no-cache HTML headers; same `SITE_PASSWORD` gate as `/`).
- **SPA container:** `<div id="st-hotel-detail" class="hpage">` in `client/index.html`, parallel to `#discovery-flow` and `#st-results`.
- **Body class toggle:** adding `body.has-hotel-detail` hides `#topnav`, `#discovery-flow`, `#st-results`, `.landing-sections`, `.trust-bar`, `.static-overlay` via CSS. Removing it restores the prior view (CSS rule based on `body.has-results` already drives results vs. discovery visibility).
- **No SSR:** still consistent with the scope exclusion of "SEO-optimised static hotel pages" — this is a client-rendered SPA route, just with a real URL.

### Entry points (all in `client/app.js`)
| From | Behavior |
|---|---|
| Hotel card hero image | `onclick="openHotelDetailPage(id)"` on `.hotel-hero--clickable`. Inner pills (`hotel-nbhd-pill`, badge wraps) `event.stopPropagation()` to keep their own actions. |
| `Details` button on card | `openHotelDetailPage(id)` |
| Guest-score badge on card | `openHotelDetailPage(id, { scrollTo: 'reviews' })` |
| Direct URL load (`/hotel/:id`) | `DOMContentLoaded` handler in app.js parses `location.pathname` and calls `openHotelDetailPage(id)`. |
| `Reviews` rating chip inside the page | `_hpScrollToReviews({ smooth: true })` |

### Page layout (`hotelDetailPageHTML(d)`)
Top → bottom:
1. **Sticky topbar** (`.hpage-topbar`) — Back button (calls `closeHotelDetailPage()`).
2. **Hero** (`.hpage-hero` wrapping `.hp-carousel`) — full-width carousel; height clamps to `42vw` desktop / `56vw` mobile; tap on image opens lightbox on desktop only (touch devices skip lightbox).
3. **Two-column grid** (`.hpage-grid`):
    - **`.hpage-content`** (left, full width on mobile): hp-meta (h1 name, stars, rating chip, neighbourhood chip, property-type chip, check-in/out times) → About (description, 4-line clamp + Read more) → Amenities (first 8 + "+N more" expander) → **Guest reviews** section.
    - **`.hpage-sidebar`** (right, 360px desktop only, sticky at `top:72px`): duplicates name, stars, rating, neighbourhood/property chips, times, **primary CTA "Find & Book →"** and **secondary CTA "Vibe tour"**, plus a "Copy link" share button.
4. **Mobile sticky bottom bar** (`.hpage-mobile-cta`, `display:none` on desktop): primary "Find & Book →" + secondary smaller "Vibe tour" — Vibe tour is intentionally less prominent (smaller, ghost style).

### State (in `client/app.js`)
- `_detailHotelId` — currently displayed hotel id (null when not on detail page)
- `_detailHotelData` — last loaded payload
- `_detailInflight` — `Map<hotelId, Promise>` for de-duplicating concurrent fetches
- `_detailReturnState` — `{results, scrollY}` captured on enter so `closeHotelDetailPage()` restores prior view + scroll position
- Reviews state (`_hpReviewsState`) is shared with the page (was originally built for the panel)

### URL/history rules
- `openHotelDetailPage(id)` — `history.pushState({hotelDetail:id}, '', '/hotel/:id?city=…&q=…')` (preserves `S.city` and `S.q` so the page is shareable AND back-context survives reload).
- `closeHotelDetailPage()` — `history.pushState({}, '', '/')` (back stays in app, doesn't navigate away).
- `popstate` listener: if URL becomes `/hotel/:id` → opens that hotel (forward nav); if URL leaves `/hotel/:id` while detail page is showing → close (back nav).
- ESC closes the page (defers to lightbox if it's open).

### Reusable element styles (`.hp-*`)
The following styles are reused inside the new page unchanged: `hp-carousel`, `hp-lightbox`, `hp-meta`, `hp-name` (overridden in page scope to be larger via `.hpage .hp-name`), `hp-stars`, `hp-rating`/`hp-rating--btn`, `hp-nbhd-chip`, `hp-proptype-chip`, `hp-times`, `hp-section` (padding overridden), `hp-desc(.clamped)`, `hp-amenities`, `hp-amenity`, `hp-reviews-*`, `hp-skeleton`. Page chrome lives in `.hpage*` rules.

### Future work (NOT yet built — plan reference)

### Option B — Licensing risk reduction (do first, independent of UI)
1. **NULL captions + feature_summary in `v2_room_inventory`** — these are indexing pipeline artifacts, not needed after facts are extracted. The indexer generates captions live; it never re-reads them from DB. Safe to null existing rows and stop writing them going forward. Zero search/display impact.
2. **Never persist hotel metadata to DB** — enforced by V2 architecture. Do not regress.

### Phase 0 — Verify LiteAPI `/data/hotel` response fields
Before writing schema migrations, hit `/api/debug-photos?hotelId=<id>` or add a one-line raw logger to `fetchHotelMetaBatch` to confirm which fields are available: `propertyType`/`accommodationType`, `hotelDescription`/`description`, `hotelFacilities`/`amenities`, `checkInOut.checkIn`/`checkOut`. This determines property type classification strategy.

### Phase 1 — `property_type` column on `v2_hotels_cache`
```sql
ALTER TABLE v2_hotels_cache ADD COLUMN IF NOT EXISTS property_type TEXT DEFAULT 'hotel';
CREATE INDEX IF NOT EXISTS v2_hotels_cache_proptype ON v2_hotels_cache(city, property_type);
```
**Classification logic (in priority order):**
1. Use LiteAPI `propertyType`/`accommodationType` field if present and non-null
2. Fall back to room-name heuristics: if ALL room types for a hotel match rental patterns (`/apartment|vacation home|house|villa|loft|dormitory|hostel/i`) → `apartment_rental` or `hostel`. If any non-rental room type exists → `hotel`.
3. Default: `hotel`

**Backfill:** `POST /api/backfill-property-types` endpoint — scans `v2_room_inventory` grouped by hotel, applies heuristics, updates `v2_hotels_cache.property_type`. Also update `index-city-v2.js` to write `property_type` during future indexing runs.

**Gotchas:**
- "Apartment Suite" at a Marriott ≠ apartment rental. Heuristic must require ALL room types to match, not just one.
- Paris/KL use V1 `hotels_cache` — no `property_type` column there. Phase 5 toggle must be hidden for V1 cities.

### Phase 2 — `GET /api/hotel/:hotelId` endpoint
Returns everything the details panel needs. Logic:
1. Load `v2_room_types_index` rows (facts per room type) — DB
2. Load `v2_room_inventory` rows (photo URLs per room type, grouped) — DB
3. Load `v2_hotels_cache` (hotel_photos, lat, lng, property_type) — DB
4. **REUSE `_hotelMetaCache`** (the existing 30-min in-memory map in `fetchHotelMetaBatch`) for name, star_rating, guest_rating, address, description, amenities, check-in/check-out — live LiteAPI call on miss, never write to DB
5. Load neighbourhood from `neighborhoods` table — DB
6. Sanitise LiteAPI description text (strip HTML tags) before returning

**Gotchas:**
- Reuse `_hotelMetaCache`, do NOT create a second cache for the same LiteAPI endpoint.
- Add in-flight deduplication: if 10 users open same hotel simultaneously on a cold cache, collapse to 1 LiteAPI call.
- V1 hotels (Paris/KL): `v2_room_types_index` won't have data. Fall back to `room_embeddings` for room photo data.
- Null-check `hotel_photos` — some rows have `[]`. Hero image falls back to first `v2_room_inventory` photo.
- LiteAPI descriptions may contain HTML — sanitise before sending to client.

### Phase 3 — UI ✅ SUPERSEDED — built as full page (`/hotel/:hotelId`), not a slide-out panel.
See "HOTEL DETAILS PAGE (as-built — May 2026)" section above for the actual layout, entry points, URL/history rules, and reusable styles. The slide-out panel (`#hotel-panel`, `openHotelPanel`, `hotelPanelHTML`, `.hotel-panel-*` CSS) has been deleted.

### Phase 4 — Search results card integration ✅ DONE
- `Details` ghost button exists in `.hotel-actions` (between "Vibe tour" and "Find & Book →") and now calls `openHotelDetailPage(id)`.
- Hero image (`.hotel-hero--clickable`) is now the primary entry point — clicking the hero opens `/hotel/:hotelId`. Inner pills `event.stopPropagation()` to keep their own actions.
- Guest-score badge calls `openHotelDetailPage(id, { scrollTo: 'reviews' })`.
- Property-type chip (`🏠 Apartment` / `🛏 Hostel`) is rendered in `.hotel-meta` for non-hotels.

### Phase 5 — "Hotels only" filter toggle (NOT yet built)
- **Default: "All properties"** (opt-in filter, not opt-out). Avoids silent result count drops for existing users.
- Toggle label: "Hotels only" — hides `apartment_rental`, `hostel`. Apartments remain accessible.
- State: `sessionStorage` (not `localStorage`) — per-tab, not permanent.
- When active: show beneath result count "N apartments & rentals hidden · Show all"
- Only show toggle for V2 cities (Mexico City). Hide or grey out for Paris/KL (V1, no property_type).
- Requires DB index on `(city, property_type)` — add in Phase 1 migration.

### Build status
| Phase | Status |
|---|---|
| Option B: null captions in v2_room_inventory | not started |
| Phase 0: verify LiteAPI response fields | done |
| Phase 1: property_type column + backfill | done |
| Phase 2: /api/hotel/:hotelId | done (+ /api/hotel/:id/reviews) |
| Phase 3: details UI | done (full page, not panel) |
| Phase 4: card entry points (Details + hero click + guest-score → reviews) | done |
| Phase 5: Hotels only toggle | not started |

---

## VIBE PLAN — Neighborhood Vibe + Visual Room Search

**TRIGGER PHRASE:** When user says "go build vibe plan", read this section first then work through phases in order.

### Product Vision
The implemented search flow is:
1. **City + optional dates** — user types/selects a city (autocomplete) and optionally enters check-in/check-out dates
2. **"Let's shape your vibe" — 5-question Boop wizard** (`#st-boop`) — users go through this immediately after city selection; this is the primary engagement path. The wizard has 5 inner screens driven by `BOOP_QUESTIONS`:
   - Q1 `trip`: "Have you been to this city before?" (single-tap)
   - Q2 `stayVibe`: "What kind of stay feels right?" (single-tap)
   - Q3 `nbhdScene`: "What kind of area do you want to stay in?" (single-tap)
   - Q4 `musthaves`: "Pick what matters most" + group size (multi-select)
   - Q5 `extras`: "Anything else we should know?" (free text; "Find hotels →")
   - Completing the wizard calls `boopFinish()` → `runBoopSearch()` → jumps directly to results (skipping nbhd/style/dates steps unless user navigates back)
3. **Post-boop flow steps** (only reached via back-navigation or returning users): `nbhd` ("Find your neighbourhood vibe", Step 3 of 5) → `style` ("Choose your room vibe", Step 4 of 5) → `dates` ("When are you going?", Step 5 of 5) → results
4. **Room search results** (`#st-results`) — vector search results, replaces `#discovery-flow`

**Key UX note:** Users do NOT use the neighbourhood grid as a primary first-action. The neighbourhood card grid is a post-boop step that most users skip (boop goes directly to results). Trending searches and discovery features belong on the room search results screen or within the Boop wizard, not on the neighbourhood grid.

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

### PHASE 3 — Frontend Wizard Flow

**Goal:** City+dates → "Let's shape your vibe" Boop wizard → room results. (See Product Vision above for implemented step IDs and flow.)

#### Step layout
```
[Pre-wizard]  City autocomplete + optional dates
[#st-boop]    "Let's shape your vibe" — 5-question Boop wizard (primary path → direct to results)
[#st-nbhd]    Neighbourhood grid (Step 3 of 5, reached via back-nav or returning users)
[#st-style]   Room vibe presets (Step 4 of 5)
[#st-dates]   Date picker (Step 5 of 5)
[#st-results] Results — hides #discovery-flow entirely
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
