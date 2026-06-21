# Next 10 cities launch plan

**Status:** planning doc — do not execute indexing from this file alone; follow phase checklists and `docs/v2-city-rollout.md` for operational steps.

**Canonical playbook:** `docs/v2-city-rollout.md` (Paris-proven V2 pipeline)  
**Focus city:** **London** (first in queue)  
**Last updated:** 2026-06-20

---

## Neighbourhood fence QA (all cities)

**Why this exists:** London (2026-06) shipped with Covent Garden = 1 hotel, Shoreditch/Heathrow = 0. Root cause was **not** missing hotel data — it was **bad geographic fences** (see below).

### Root cause (London incident)

1. **Nominatim/OSM name ambiguity** — queries like `"Shoreditch, London"` often return a **single building** or the **Covent Garden piazza**, not the walkable guest area. Polygons were 4–51 vertices but covered ~100 m².
2. **`hotel_count` uses the bbox** (by design — slightly wider than polygon for display). When bbox span is ~0.0001°×0.0002°, almost no indexed hotels fall inside → count 0–1.
3. **Poly-backfill skipped “good” polygons** — rows with ≥20 OSM vertices were skipped even when bbox was degenerate (Covent Garden had a detailed piazza polygon + tiny bbox).
4. **No automated gate** — `verifyV2` / `readiness` checked row counts and vibes, not fence sanity or per-hood `hotel_count` vs catalog size.
5. **Heathrow** — Gemini bbox was west of the airport; triaged catalog only has **2** hotels in the fringe anyway (`sparse: true` override).

### Prevention (shipped in code)

| Layer | What |
|-------|------|
| **OSM reject** | `fetchOsmBoundary` rejects polygons with span &lt; **0.012°** (~1.3 km) |
| **Curated overrides** | `scripts/neighborhood-fence-overrides.js` — per-city bbox fixes when OSM/Gemini fail |
| **Auto-apply** | `runNeighborhoods` → `applyCuratedNeighborhoodFences` after polygon backfill + count refresh |
| **Verify gate** | `verifyNeighborhoodFences()` — fails if degenerate bbox, `hotel_count=0` on non-sparse hoods, or suspiciously low counts |
| **CLI** | `node scripts/city-launch.js --city=<City> --phase=repair-fences` |
| **Full verify** | `node scripts/city-launch.js --city=<City> --phase=verify` (index + fences) |

**Per new city checklist (after neighbourhoods):**
```powershell
node scripts/city-launch.js --city=London --phase=repair-fences
node scripts/city-launch.js --city=London --phase=verify
node scripts/city-launch.js --city=London --phase=readiness
```
If verify fails → add/adjust entries in `neighborhood-fence-overrides.js` (document `note` + `sparse` if airport fringe).

---

## Launch queue (10 cities)

| # | City | ISO | LiteAPI catalog* | V2 index | Neighbourhoods (DB) | Marketing pages |
|---|------|-----|------------------|----------|---------------------|-----------------|
| 1 | **London** | GB | **19,312** | none (0 hotels) | 7 rows — **stale** (no vibes/polygons) | none |
| 2 | Tokyo | JP | 5,465 | none | 7 rows — stale | none |
| 3 | Rome | IT | 19,533 | none | none | none |
| 4 | Barcelona | ES | 3,853 | none | none | none |
| 5 | Lisbon | PT | 6,872 | none | none | none |
| 6 | Bangkok | TH | 3,736 | none | none | none |
| 7 | Istanbul | TR | 7,044 | none | none | none |
| 8 | Amsterdam | NL | 1,218 | none | none | none |
| 9 | Athens | GR | 10,499 | none | none | none |
| 10 | New York City | US | **0**† | none | none | none |

\* `GET /api/v2/city-rollout/status?city=` → `catalog_total`, or `liteCatalogTotal()` in `scripts/v2-city-rollout-core.js`.  
† LiteAPI returns **0** for `cityName=New York City`; use canonical name **`New York`** (1,261 hotels). Needs a city alias before rollout.

**Reference (already live):** Mexico City (~3,616 V2 hotels, complete), Paris (4,979 V2 hotels, complete, 7 nbhds with vibes).

---

## What “fully launched” means per city

A city is **launch-ready** when all of the following pass:

| Layer | Done when |
|-------|-----------|
| **V2 search index** | `v2_indexed_cities.status = complete`; `verifyV2()` passes (`v2_hotels_cache` ≥100, inventory ≥1000, `v2_room_types_index` ≥100, facts ≥1000) |
| **Room facts + visual style** | Written during V2 index (`index-city-v2.js`); `visual_style_*` included in caption pipeline |
| **Hotel-public areas** | `__hotel_public__` rows + `area_*` facts populated (during index **or** post-pass `POST /api/v2/classify-hotel-public` if `V2_SKIP_HOTEL_PUBLIC=1` on Render) |
| **Property types** | `v2_hotels_cache.property_type` set during index |
| **Rates** | Render restarted after `complete` so `loadV2Cities()` includes city → `/api/rates` reads `v2_hotels_cache` |
| **Neighbourhoods** | `neighborhoods` rows with polygons, `hotel_count` refreshed, `vibe_last_computed_at` set (Overpass + Gemini via `runNeighborhoods`); **`verifyNeighborhoodFences` passes** (see § Neighbourhood fence QA) |
| **Boop trip images** | `boop_trip_images` populated (`ensureBoopTripImages`) |
| **Search QA** | City block in `scripts/search-test-lib.js` + green run of `test-search-quality.js` |
| **Comprehensive QA** | City added to `scripts/audit-v2-comprehensive-suite.js`; report reviewed |
| **Product smoke** | Boop wizard → results at `https://www.travelbyvibe.com/?city=<City>`; nbhd map + boop rank behave |
| **Marketing (optional for beta, required for SEO launch)** | 3-page cluster like Paris: `{city-slug}-hotels`, `where-to-stay-in-{slug}`, `{city-slug}-visual-search` + routes in `scripts/marketing-paths.js` |

---

## London — current state (2026-06-20)

| Asset | State |
|-------|--------|
| V2 index | **Complete** — 4,000 hotels, ~98k photos |
| Hotel-public | **Done** — ~31k public photo rows |
| Neighbourhoods | **11 areas**, vibes + polygons; fence QA **fixed** (Covent Garden ~135, Shoreditch ~70, City ~69, Westminster ~275) |
| Search QA | Pending — add London block to `test-search-quality.js` |
| Prod | Pending — commit/push, Render restart, live smoke |

*(Historical planning notes for pre-index London below may be stale.)*

## London — planning snapshot (2026-06-19, pre-index)

| Asset | State |
|-------|--------|
| `COUNTRY_CODES` | ✅ `london → GB` in `index-city-v2.js` + `v2-city-rollout-core.js` |
| LiteAPI catalog | **19,312** hotels (`limit` param = **19,362**) |
| V2 tables | **Empty** — no `v2_indexed_cities` row (`status: none`) |
| V1 legacy | `hotels_cache`: 200 rows (old partial); `room_embeddings`: **0** |
| Neighbourhoods | **7 pre-generated rows** (Mayfair, Shoreditch, etc.) — **no** `vibe_last_computed_at`, **no** polygons, tiny `hotel_count` (1–25) from old cache |
| Hotel-public | 0 rows |
| Frontend fallback | Hardcoded London cards in `client/app.js` (`FALLBACK_NBHD`) — used when API empty/stale |
| Search tests | None for London |
| Marketing | None (planned stub in `docs/marketing-plan-beta-launch.md` §11) |
| Supervisor | Not in `V2_SUPERVISOR_CITIES` (defaults to Paris only) |

**Scale note:** London’s catalog is **~3.8× Paris** (19,312 vs 5,097). Paris completed with **4,979** quality-filtered hotels (~98% pass rate). If London behaves similarly, expect **~15k–19k indexed hotels** — significantly longer index runtime and higher Gemini cost than Paris (~**24–72 h** on Render Starter at Paris throughput, vs Paris’s ~4–12 h).

---

## London work plan (phased)

### Phase 0 — Preflight (no indexing yet)

- [ ] Confirm Render deploy is current (`main` ≥ Paris rollout fixes: coalescing, supervisor, throughput env).
- [ ] Verify Render env (same as Paris checklist in `docs/v2-city-rollout.md` § Paris 0):
  - `V2_MAX_INFLIGHT_PHOTOS=10`, `V2_HOTEL_CONCURRENCY=2`, `V2_BATCH_SIZE=10`
  - `V2_SKIP_HOTEL_PUBLIC=1` (plan post-index classify pass)
  - `GEMINI_KEY`, `LITEAPI_PROD_KEY`, `SUPABASE_*`, `UNSPLASH_KEY`, `INDEX_SECRET`
- [ ] Add **`London`** to `V2_SUPERVISOR_CITIES` (e.g. `Paris,London`) before starting long index.
- [ ] Snapshot baseline: `GET .../city-rollout/status?city=London` + SQL counts (all should be 0 except stale nbhds).
- [ ] **Decision:** accept full-catalog run (`limit=19362`) vs cap for first pass (not recommended for launch — partial catalog skews search).

### Phase 1 — V2 room index (**prefer local PC** — see § Prod-safe indexing)

**Recommended (local, prod Render untouched):**
```powershell
$env:V2_SKIP_HOTEL_PUBLIC = "1"
$env:V2_MAX_INFLIGHT_PHOTOS = "12"
$env:V2_HOTEL_CONCURRENCY = "2"
$env:V2_BATCH_SIZE = "10"
node -e "require('./scripts/index-city-v2').reindexCityV2('London',19362,true).then(r=>console.log('DONE',JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)})"
```

**Only if local is not possible — Render (off-peak, conservative env):**
```powershell
node scripts/v2-city-rollout-remote.js --city=London --limit=19362
```

**Monitor:**
```powershell
node scripts/v2-city-rollout-remote.js --city=London --watch-only --interval=10
```

**Watch for:** OOM → lower `V2_MAX_INFLIGHT_PHOTOS` to 6; stale `indexing` → supervisor or manual `--resume`; `catalog_scanned` vs `catalog_limit` in `index_progress`.

**Exit criteria:** `status := complete`, `counts.v2_hotels` >> 100, `v2_room_types_index` >> 100.

### Phase 2 — Hotel-public classify (if skipped during bulk index)

```powershell
$body = '{"city":"London","secret":"roommatch-2026","concurrency":24,"rate_per_min":1500}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/classify-hotel-public" -Method POST -ContentType "application/json" -Headers @{ "x-index-secret" = "roommatch-2026" } -Body $body
```

Then: `SELECT rebuild_v2_room_types_index_city('London');`

**Verify:** `area_*` fact counts comparable to Paris/MX City pattern.

### Phase 3 — Neighbourhoods (regenerate — do not reuse stale rows)

London’s existing 7 rows pre-date V2 hotels and lack vibes/polygons. **Regenerate.**

```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
$body = '{"city":"London","secret":"roommatch-2026","skip_reindex":true,"regenerate_neighborhoods":true,"limit":19362}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/city-rollout" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

This runs: Gemini nbhd generation → polygon backfill → `refreshHotelCounts` → `recomputeNeighborhoodVibes` (Overpass) → `ensureBoopTripImages`.

**Prerequisite:** scoring code for neighbourhood vibes must be **committed, pushed, and deployed** before backfill (see `.cursor/rules/push-before-remote-ops.mdc`).

**Verify SQL:**
```sql
SELECT name, hotel_count, vibe_last_computed_at,
       (polygon IS NOT NULL) AS has_polygon
FROM neighborhoods WHERE city = 'London' ORDER BY hotel_count DESC;
```
Expect `vibe_last_computed_at` populated on all rows; `hotel_count` in realistic range (not 1–3).

**Fence QA (required):**
```powershell
node scripts/city-launch.js --city=London --phase=repair-fences
node scripts/city-launch.js --city=London --phase=verify
```
Fails if any hood has degenerate bbox or `hotel_count=0` without a `sparse` override. Add fixes to `scripts/neighborhood-fence-overrides.js`.

### Phase 4 — Platform wiring

- [ ] **Restart Render** (manual deploy or env bump) → `loadV2Cities()` picks up London for `/api/rates`.
- [ ] Confirm `/api/rates?city=London` returns `pricedCount > 0` with test dates.
- [ ] Confirm `/api/vsearch?city=London&query=...&search_version=v2` returns hotels with photos + scores.
- [ ] Confirm `/api/neighborhoods?city=London` returns live rows (not app.js fallback).

### Phase 5 — Validation & QA

- [ ] Add **London test block** to `scripts/search-test-lib.js` (mirror Paris: feature flags + semantic queries).
- [ ] Run `node scripts/test-search-quality.js` against production.
- [ ] Add London to `scripts/audit-v2-comprehensive-suite.js`; run `--count=100` audit.
- [ ] Manual Boop smoke: sleek_polished, rooftop, walk-in shower queries.
- [ ] Spot-check hotel detail pages for top 5 results.
- [ ] Latency: cold_start server TTFB < 6 s cold (see CLAUDE.md § V2 Search Latency).

### Phase 6 — Marketing & discovery (can parallel Phase 5)

Duplicate Paris 3-page cluster (see `docs/marketing-plan-beta-launch.md` §14):

| Page | Path |
|------|------|
| Hub | `/london-hotels` |
| Neighbourhood guide | `/where-to-stay-in-london` |
| Feature SEO | `/london-visual-search` |

- [ ] Add routes to `scripts/marketing-paths.js` + HTML in `client/marketing/`
- [ ] Update `client/marketing/destinations.html`
- [ ] Run `scripts/indexnow-ping.js` after deploy
- [ ] Remove or gate `client/app.js` hardcoded London `FALLBACK_NBHD` once API is authoritative

### Phase 7 — V1 cleanup (optional, low risk for London)

London has **0** `room_embeddings`. Safe to run V1 cleanup tail:
```powershell
# Included in full city-rollout when skip_reindex=true after verify
# Or: node scripts/v2-city-rollout.js --city=London --skip-reindex --skip-neighborhoods
```
Keep `hotels_cache` lat/lng rows until V2 coords confirmed — rollout doc says never delete coords needed for nbhd matching (V2 writes lat/lng to `v2_hotels_cache`).

---

## Prod-safe indexing (live traffic)

**Why this matters:** V2 indexing runs **inside the same Node process** as the Express web server when triggered via `POST /api/v2/reindex-city` on Render. Paris OOM on Starter (~512 MB) did not just stall the index — it **killed prod**. London’s catalog is ~4× Paris, so the risk window is much longer if indexing runs on the web instance.

### Decision tree

```
Can you run the indexer locally for 1–3 days?
  YES → index locally; prod Render untouched ✅  (recommended for London)
  NO  → dedicated Render worker OR off-peak + conservative env + canary 200 hotels first
```

### Recommended: local indexing (prod Render stays clean)

**Trigger from your PC** (writes directly to prod Supabase — same DB as live search once Render is restarted):

```powershell
# From repo root with .env populated (see checklist below)
node -e "require('./scripts/index-city-v2').reindexCityV2('London',19362,true).then(r=>console.log('DONE',JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)})"
```

**Resume after crash / sleep** (never use `force:true` on resume — that wipes partial work):

```powershell
node -e "require('./scripts/index-city-v2').reindexCityV2('London',19362,false).then(r=>console.log('DONE',JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)})"
```

Checkpoints live in `v2_indexed_cities.index_progress` (`liteapi_offset`, `indexed_in_cache`, etc.).

**Suggested local env** (PowerShell — local defaults are *more aggressive* than Render unless you override):

```powershell
$env:V2_SKIP_HOTEL_PUBLIC = "1"          # same as Render; run classify-hotel-public after
$env:V2_MAX_INFLIGHT_PHOTOS = "12"      # tune to your RAM (8 GB PC → 8; 16 GB → 12–16)
$env:V2_HOTEL_CONCURRENCY = "2"
$env:V2_BATCH_SIZE = "10"
$env:V2_CAPTION_RATE_PER_MIN = "1200"    # leave headroom for prod search Gemini calls
```

**Monitor progress** (separate terminal, read-only):

```powershell
node scripts/v2-city-rollout-remote.js --city=London --watch-only --interval=5
```

### If indexing must run on Render

| Rule | Why |
|------|-----|
| **Off-peak window only** (e.g. 02:00–07:00 UK) | Limits user impact if instance dies |
| **Conservative env:** `V2_MAX_INFLIGHT_PHOTOS=6`, `V2_HOTEL_CONCURRENCY=1`, `V2_BATCH_SIZE=5` | Paris OOM fix was lowering inflight, not raising it |
| **Keep `V2_SKIP_HOTEL_PUBLIC=1`** | Hotel-public is a separate post-index pass |
| **Canary first:** `limit=200`, watch Render memory 30 min, then `--resume` full catalog | Validates env before 19k run |
| **Never full `city-rollout` on web** during traffic | Nbhd + Overpass + index together = worst case |
| **One heavy job at a time** | No classify / vibe backfill concurrent with reindex |
| **Do not add city to `V2_SUPERVISOR_CITIES` until you want unattended resume on Render** | Supervisor re-starts stalled jobs on the web instance |

Optional: temporary **Standard** (2 GB) **worker** service for indexing only — upgrade the worker, not necessarily the web tier.

### Never do during prod indexing

- `POST /api/v2/reindex-city` on Render **while local indexer is running** (two writers → corrupt progress / duplicate Gemini spend)
- `force:true` unless intentionally wiping the city’s V2 tables
- Full pipeline `POST /api/v2/city-rollout` on the web service during business hours
- Index two cities concurrently on one machine or one Render instance

### After local index completes

1. Verify `v2_indexed_cities.status = complete` and counts via status API or SQL.
2. **Restart Render** (deploy or env bump) so `loadV2Cities()` includes London → `/api/rates` works.
3. Run post-index passes **off-peak on Render or locally:** `classify-hotel-public`, then neighbourhoods tail (`skip_reindex + regenerate_neighborhoods`).
4. Search QA + Boop smoke before announcing London.

### Future hardening (not built yet)

- `V2_INDEX_ON_WEB=0` — web service rejects reindex; worker-only
- Second Render **background worker** in `render.yaml`
- Pre-flight canary script (200 hotels → report peak heap)

---

## Local indexing readiness checklist

Use this before starting London from your PC.

| Check | London (2026-06-19) |
|-------|---------------------|
| `.env` has `LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | ✅ verified present |
| `COUNTRY_CODES` includes city | ✅ `london → GB` |
| No in-flight index on Render for same city | ✅ `status: none`, `rollout_running: false` |
| `V2_SUPERVISOR_CITIES` does **not** include London (or supervisor disabled) | ⚠️ confirm in Render dashboard (default: Paris only) |
| Understand `force:true` wipes city V2 tables | ✅ safe today (0 V2 hotels); dangerous on re-run after partial progress |
| PC power: sleep/hibernate disabled for run duration | ⚠️ your responsibility |
| Disk / network stable | Indexer fetches every hotel photo URL |

### Local-specific concerns

| Concern | Severity | Mitigation |
|---------|----------|------------|
| **Local defaults are faster than Render** | Medium | Without env overrides, local uses `BATCH_SIZE=25`, `HOTEL_CONCURRENCY=3`, up to 24 in-flight photos — can OOM a laptop or saturate network. Set explicit knobs (see above). |
| **`V2_SKIP_HOTEL_PUBLIC` off locally by default** | Medium | Local bulk index will classify lobby/pool photos inline unless you set `V2_SKIP_HOTEL_PUBLIC=1`. Skip during bulk; run classify pass after. |
| **Shared `GEMINI_KEY` with prod search** | Medium | Indexing + live NLP intent share one key. Use `V2_CAPTION_RATE_PER_MIN=1200` (not 1500+) so user searches keep headroom. |
| **Accidental Render reindex while local runs** | High | Do not POST to Render reindex API. If status is `indexing`, supervisor (if enabled for London) could also start Render-side resume. |
| **Multi-day runtime** | Expected | London ≈ 24–72 h local depending on pass rate and knobs. Resume is safe; `index_progress` checkpoints every ~25 hotels. |
| **Laptop sleep disconnects** | Medium | Run resumes with `force:false`; verify `liteapi_offset` advanced before leaving unattended. |
| **Prod search for London before Render restart** | Low | London won’t appear in `/api/rates` until Render restart loads V2 city list. V2 search may partially work from DB before restart — restart is still required for full launch. |
| **Stale neighbourhood rows** | Low | 7 London nbhd rows exist without vibes; regenerate after index (Phase 3). |
| **Cost** | Info | ~$15–40 Gemini for full London catalog (order of magnitude). |

**Verdict:** You are in a **good state to start local indexing** — credentials are in place, London has no V2 data yet, nothing is running on Render. Main actions before kickoff: set local env knobs, confirm Render supervisor isn’t watching London, disable PC sleep, and **never trigger Render reindex in parallel**.

---

## London ETA & cost (rough)

| Step | Wall clock (Render Starter) | Gemini cost (order of magnitude) |
|------|----------------------------|-----------------------------------|
| V2 room index | 24–72 h (19k catalog) | ~$15–40 (caption + facts; scales with indexed hotels × photos) |
| Hotel-public classify | 4–12 h | ~$1–3 |
| Neighbourhoods + vibes | 1–3 h | ~$0.50 (Gemini nbhd + vibe recompute) |
| QA + marketing | 1–2 days human | — |

**Bottleneck:** Render Starter memory + London catalog size. Consider temporary Standard tier for index window if OOM repeats.

---

## Remaining 9 cities — prep before each rollout

### 1. Add to city registry

Today `COUNTRY_CODES` only has: Mexico City, Paris, KL, London, New York City.

**Add:**

| City | Code | LiteAPI `cityName` note |
|------|------|-------------------------|
| Tokyo | JP | `Tokyo` |
| Rome | IT | `Rome` |
| Barcelona | ES | `Barcelona` |
| Lisbon | PT | `Lisbon` |
| Bangkok | TH | `Bangkok` |
| Istanbul | TR | `Istanbul` |
| Amsterdam | NL | `Amsterdam` |
| Athens | GR | `Athens` |
| New York City | US | **`New York`** (alias required) |

Files to update: `scripts/index-city-v2.js`, `scripts/v2-city-rollout-core.js`, optionally `scripts/index-city.js` (V1 legacy).

### 2. Suggested rollout order (by effort)

Smaller catalogs first to prove the factory, then mega-cities:

1. **London** (priority — registry ready)
2. Amsterdam (1,218)
3. Barcelona (3,853)
4. Bangkok (3,736)
5. New York (`New York`, 1,261) — after alias fix
6. Tokyo (5,465)
7. Lisbon (6,872)
8. Istanbul (7,044)
9. Athens (10,499)
10. Rome (19,533)

### 3. Per-city checklist (copy for each)

Use London phases 0–7; swap city name, catalog limit (`catalog_total + 50`), and marketing slug.

---

## Build queue — before London local index

**Agreed direction:** triaged city quality list for **all future cities**, then automate the local index factory. **Do not start the London run until these are built and preflight passes.**

### Phase A — City registry + quality policy (build first)

Single source of truth: `scripts/city-registry.js` (or JSON + loader).

| Field | Example (London) | Purpose |
|-------|------------------|---------|
| `displayName` | `London` | UI + DB city key |
| `liteapiCityName` | `London` | LiteAPI `cityName` param |
| `countryCode` | `GB` | Catalog fetch |
| `indexCap` | `4000` | Stop after N **indexed** hotels (not catalog offset) |
| `minStars` | `3` | Pre-filter before `/data/hotel` + Gemini |
| `minGuestRating` | `7.0` | Applied when `stars === 0` |
| `minRoomPhotos` | `2` | Keep current default; optional `3` later |
| `catalogLimit` | auto | `liteCatalogTotal + 50` upper bound for scan |
| `verifyOverrides` | optional | City-aware `verifyV2` floors |

**All 10 launch cities** get a row (Tokyo → `JP`, NYC alias → `New York`, etc.). Replace duplicated `COUNTRY_CODES` in `index-city-v2.js`, `v2-city-rollout-core.js`, `server.js` debug maps.

**Indexer changes** (`index-city-v2.js`):

1. Sort catalog candidates by `stars DESC`, `rating DESC` before processing (V1 pattern).
2. Pre-skip list rows failing `minStars` / `minGuestRating` (cheap — no detail fetch).
3. Stop catalog walk when `indexed_in_cache >= indexCap`.
4. Persist cap + filter stats in `index_progress` (`skipped_star_filter`, `stopped_at_cap`).

### Phase B — Local index orchestrator (build second)

New CLI: `scripts/city-launch.js` (or extend `v2-city-rollout.js` with `--phase=`).

| Command | What it does |
|---------|----------------|
| `--phase=preflight` | Env keys, LiteAPI catalog, DB snapshot, **Render status check** (fail if Render indexing same city), print planned cap/filters |
| `--phase=index` | Index only (local), env knobs baked in, log to `logs/city-index-<city>-<date>.log` |
| `--phase=watch` | Poll Supabase / status API every N min (reuse remote formatter) |
| `--phase=verify` | `verifyV2` with city overrides |
| `--phase=classify-public` | `classify-hotel-public.js` wrapper |
| `--phase=neighborhoods` | `skip_reindex + regenerate_neighborhoods` tail |
| `--phase=readiness` | Green/yellow/red checklist (index, public, nbhds, room_types) |

**Safety gates in preflight:**

- Abort if `v2_indexed_cities.status = indexing` **and** `updated_at` fresh (<5 min) — something else is writing.
- Warn if Render `rollout_running: true` for same city.
- Print explicit “do not POST Render reindex” reminder.
- Confirm `V2_SUPERVISOR_CITIES` does not include this city (manual Render check until supervisor reads registry).

**Not in v1 orchestrator:** auto Render restart (still manual deploy); full marketing scaffold.

### Phase C — Validation hooks (build third, can overlap B)

- `verifyV2(city, db, { registry })` — use per-city floors or `% of indexCap`.
- `search-test-lib.js` — stub London block or generator from top fact keys post-index.
- Document canary: `--phase=index --canary=200` runs cap=200 indexed for memory/Gemini smoke.

### Phase D — Run London (after A+B preflight green)

See § Local index runbook below.

---

## Local index runbook (automated path — target state)

```powershell
# 1. Preflight (must exit 0)
node scripts/city-launch.js --city=London --phase=preflight

# 2. Optional canary
node scripts/city-launch.js --city=London --phase=index --canary=200

# 3. Full index (foreground; separate terminal for watch)
node scripts/city-launch.js --city=London --phase=index

# 4. Post-index (local or off-peak Render)
node scripts/city-launch.js --city=London --phase=classify-public
node scripts/city-launch.js --city=London --phase=neighborhoods

# 5. Verify + manual Render restart
node scripts/city-launch.js --city=London --phase=verify
node scripts/city-launch.js --city=London --phase=readiness
# → deploy/restart Render; run search QA
```

---

## Manual preflight (no code required — do today)

Before **any** London index (even current manual `node -e`):

| # | Action | Why |
|---|--------|-----|
| 1 | Confirm Render `V2_SUPERVISOR_CITIES` = `Paris` only (not London) | Prevents Render auto-resume colliding with local |
| 2 | Confirm no one triggers `POST /api/v2/reindex-city` for London on Render | Dual-writer corruption |
| 3 | `.env`: prod LiteAPI + service role + Gemini present | Already verified ✅ |
| 4 | Disable PC sleep for run duration | Resume works but wastes hours |
| 5 | Decide: delete or regenerate 7 stale London `neighborhoods` rows | Regenerate in post-index phase anyway |
| 6 | Normal Render deploys OK during local index | Web process unrelated |
| 7 | **Wait for Phase A+B code** before full run | Without triage, London indexes ~15k+ hotels |

---

## Triaged quality defaults (proposed registry)

| City tier | Cities | `indexCap` | `minStars` | Notes |
|-----------|--------|------------|------------|-------|
| Mega | London, Rome, Athens | 4000 | 3 | Catalog 10k–19k |
| Large | Tokyo, Lisbon, Istanbul | 4000 | 3 | Catalog 5k–7k |
| Medium | Barcelona, Bangkok | 3500 | 3 | Catalog ~4k |
| Small | Amsterdam, New York | 0 (= no cap) | 2 | Catalog <1.5k — index all quality hotels |
| Launch reference | Mexico City, Paris | — | — | Already complete; caps not applied retroactively |

`indexCap: 0` means scan full catalog with quality filters only (no early stop).

---


## Automation & validation gaps

These are **manual or partial today** — blocking a one-command “launch city X” flow.

| Gap | Impact | Suggested fix |
|-----|--------|---------------|
| **`COUNTRY_CODES` hardcoded in 2+ files** | 8/10 cities fail catalog lookup (`catalog_total: null`) | Single `scripts/city-registry.js` exported everywhere; include LiteAPI name aliases |
| **NYC name mismatch** | `New York City` → 0 hotels | Alias map: `New York City` → `New York` for LiteAPI |
| **`verifyV2` fixed thresholds** | May fail small cities (Amsterdam 1218 catalog) or pass too early | City-aware thresholds (% of catalog or absolute floor by tier) |
| **`V2_SUPERVISOR_CITIES` manual** | Must edit Render env per city | Supervisor reads pending cities from `v2_indexed_cities WHERE status != complete` |
| **`loadV2Cities()` requires Render restart** | Rates broken until manual restart | Periodic refresh (e.g. 5 min) or webhook after index complete |
| **Hotel-public is separate step** | Easy to forget; hotel vibe scores weak | Auto-queue classify when index completes if `V2_SKIP_HOTEL_PUBLIC=1` |
| **No unified launch CLI** | Operator runs 4–6 commands + SQL | `node scripts/city-launch.js --city=London --phase=all` wrapping rollout-remote + classify + verify + QA |
| **Search QA not city-scaffolded** | Each city needs hand-written tests | Generator: sample top fact keys from DB → `search-test-lib` entries |
| **`audit-v2-comprehensive-suite.js` hardcodes 2 cities** | No automated Boop audit for new cities | `--cities=London,Tokyo` flag |
| **Marketing pages hand-built** | ~3 HTML files + routes per city | Template script from city slug + Unsplash hero set |
| **Stale neighbourhood detection** | London has rows that look “done” but aren’t | Verify checks: `vibe_last_computed_at IS NOT NULL` + min `hotel_count` |
| **Frontend `FALLBACK_NBHD` mask** | Hides broken nbhd API in dev/demo | Gate fallback behind `?debug=fallback` or remove once city live |
| **No launch readiness endpoint** | Status spread across status API + SQL | `GET /api/v2/city-rollout/readiness?city=` → red/yellow/green per layer |
| **Cost/time estimator** | London size surprises | Pre-flight script: catalog × avg photos × Gemini unit cost |
| **CI does not gate city launch** | Regressions ship | Optional workflow: run city-specific tests when `v2_indexed_cities` marks complete |
| **IndexNow / sitemap** | Manual ping after marketing | Hook into marketing build script |

---

## Immediate next actions (London)

1. **Review** Phase 0 preflight + Render env; add London to supervisor.
2. **Commit** any pending neighbourhood-scoring changes; **push + deploy** before vibe backfill.
3. **Start** Phase 1 index (`limit=19362`) on Render; monitor with `--watch-only`.
4. **Do not** treat existing 7 London neighbourhood rows as launch-ready — regenerate in Phase 3.
5. **Parallel track:** scaffold London search tests + marketing HTML while index runs.

---

## Related docs & scripts

| Resource | Purpose |
|----------|---------|
| `docs/v2-city-rollout.md` | Operational runbook (Paris-proven) |
| `scripts/v2-city-rollout-remote.js` | Trigger + watch on Render |
| `scripts/v2-city-rollout-core.js` | Verify, neighbourhoods, V1 cleanup |
| `scripts/test-search-quality.js` | Search regression suite |
| `scripts/audit-v2-comprehensive-suite.js` | Boop + detail page audit |
| `docs/marketing-plan-beta-launch.md` | Marketing cluster pattern |
| `CLAUDE.md` § V2 City Rollout | Architecture summary |
