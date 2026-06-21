# V2 city index playbook

**Authoritative runbook** for indexing a city on V2 (Paris first, then London/NYC/KL). Any agent or operator can resume from this file + `CLAUDE.md` § "V2 City Rollout".

**Render service:** `https://roommatch-1fg5.onrender.com` (ID `srv-d6s27b75r7bs738737fg`)  
**Supabase project:** `dmgxrcmdihgsffvqllms`  
**Beta gate:** pass `x-index-secret: roommatch-2026` (same as `INDEX_SECRET`) on all `/api/v2/*` admin calls when `SITE_PASSWORD` is set.

---

## Agent handoff — start here

1. **Read status** (do not assume code on Render matches local until deploy is confirmed):
   ```powershell
   $h = @{ "x-index-secret" = "roommatch-2026" }
   Invoke-RestMethod "https://roommatch-1fg5.onrender.com/api/v2/city-rollout/status?city=Paris" -Headers $h
   ```
2. **Interpret counts:**
   - `counts.v2_hotels` = hotels in `v2_hotels_cache` (truth for “how many indexed”)
   - `v2_indexed_cities.index_progress` = catalog walk checkpoint (`catalog_scanned`, `liteapi_offset`, `indexed_in_cache`, `skipped_quality`, `skipped_existing`)
   - `catalog_total` ≈ LiteAPI hotel count; API `limit` = `catalog_total + 50`
   - **Success ≠ 5,097 rows** — quality filter keeps only hotels with ≥2 photos on at least one room (expect **hundreds–~1.5k** for Paris)
3. **If `status` is `indexing` but `rollout_running: false` and `updated_at` is stale (12+ min):** job stopped — resume (step 4). On Render with supervisor deployed (`7d234bf+`), this should auto-resume within ~5–17 min.
4. **Resume reindex only** (preferred while catalog pass incomplete):
   ```powershell
   $h = @{ "x-index-secret" = "roommatch-2026" }
   $body = '{"city":"Paris","secret":"roommatch-2026","resume":true,"force":false,"limit":5147}'
   Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/reindex-city" -Method POST -ContentType "application/json" -Headers $h -Body $body
   ```
   Duplicate POSTs **join the in-flight job** (no bogus `failed` from “already running”).
5. **After `status: complete` and `v2_room_types_index` > 0:** run post-index tail (step 6). **Never `force: true`** on Paris unless intentionally wiping partial V2.
6. **Commit + push + deploy** before neighbourhood vibe backfills on Render (see `.cursor/rules/push-before-remote-ops.mdc`).

---

## What “index all hotels” means

| Step | What happens |
|------|----------------|
| **Catalog fetch** | Paginate **every** LiteAPI hotel for the city (Paris FR: **5,097**; API `limit` = **5,147**). |
| **Per-hotel detail** | `GET /data/hotel?hotelId=` for room photos. |
| **Quality filter** | Only hotels with **≥2 photos on at least one room** → `v2_hotels_cache` + inventory + facts. |
| **Skipped** | Thin-photo listings — counted in logs / `index_progress.skipped_quality`. |
| **Already in cache** | On resume, IDs in `v2_hotels_cache` are skipped quickly — `index_progress.skipped_existing`. |

**End state:** `v2_indexed_cities.status = complete`, `rebuild_v2_room_types_index_city` run automatically, `v2_room_types_index` > 0.

---

## Architecture (files)

| File | Role |
|------|------|
| `scripts/index-city-v2.js` | Catalog scan, Gemini captions, facts, checkpoints (`index_progress`), guarded `reindexCityV2` |
| `scripts/v2-city-rollout-core.js` | Verify thresholds, neighbourhoods, V1 cleanup |
| `scripts/v2-city-rollout.js` | Local full pipeline CLI |
| `scripts/v2-city-rollout-remote.js` | Render trigger + optional watch loop |
| `scripts/v2-index-supervisor.js` | Auto-resume on Render (stale / bogus `failed`) |
| `server.js` | `POST/GET /api/v2/city-rollout`, `POST /api/v2/reindex-city` |
| `supabase/add-v2-index-progress.sql` | `v2_indexed_cities.index_progress JSONB` |

**In-flight coalescing:** `_reindexJobs` Map in `index-city-v2.js` — second start for same city returns the same Promise (`joined in-flight` in API response).

**Supervisor (Render only, unless `V2_INDEX_SUPERVISOR=0`):** every 5 min, resumes cities in `V2_SUPERVISOR_CITIES` (default `Paris`) when indexing stalled or falsely failed and catalog incomplete.

---

## Paris checklist

### 0 — Code, DB, deploy

- [ ] `index_progress` column applied: `supabase/add-v2-index-progress.sql`
- [ ] Changes on `main`, Render deploy **live** (check commit ≥ `7d234bf` for supervisor + coalescing; ≥ `a1c4896` for throughput)
- [ ] Env: `LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_*`, `UNSPLASH_KEY`, `INDEX_SECRET`
- [ ] **Throughput env on Render (Starter 512 MB):**
  - `V2_MAX_INFLIGHT_PHOTOS=10`
  - `V2_HOTEL_CONCURRENCY=2`
  - `V2_BATCH_SIZE=10`
  - `V2_SKIP_HOTEL_PUBLIC=1` (run `classify-hotel-public` after index — see step 6b)
  - `V2_CAPTION_RATE_PER_MIN=1500` (optional)
  - **Remove** old conservative overrides (`V2_HOTEL_CONCURRENCY=1`, `V2_PHOTO_CONCURRENCY=2`) if set
  - OOM → lower `V2_MAX_INFLIGHT_PHOTOS` to **6**, not serial hotels

### 1 — Start or resume on Render

**Full pipeline (reindex + verify + nbhds + V1 cleanup):**
```powershell
node scripts/v2-city-rollout-remote.js --city=Paris --limit=5147
# after crash:
node scripts/v2-city-rollout-remote.js --city=Paris --resume --limit=5147
```

**Reindex only** (use while catalog pass running; do neighbourhoods later):
```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
$body = '{"city":"Paris","secret":"roommatch-2026","resume":true,"force":false,"limit":5147}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/reindex-city" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

**Do not** use `limit: 1200` for Paris unless debugging.

### 2 — Monitor

```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
Invoke-RestMethod "https://roommatch-1fg5.onrender.com/api/v2/city-rollout/status?city=Paris" -Headers $h
```

Or watch locally:
```powershell
node scripts/v2-city-rollout-remote.js --city=Paris --watch-only --interval=10
```

**Render logs:** `[v2-index]`, `[v2-supervisor]`, `[v2-rollout]`.  
Good boot line: `max_inflight_photos=10 skip_hotel_public=true`.

**SQL sanity:**
```sql
SELECT status, hotel_count, photo_count, last_error, index_progress, updated_at
FROM v2_indexed_cities WHERE city = 'Paris';

SELECT count(*) AS hotels FROM v2_hotels_cache WHERE city = 'Paris';
SELECT count(*) AS photos FROM v2_room_inventory WHERE city = 'Paris';
SELECT count(*) AS room_types FROM v2_room_types_index WHERE city = 'Paris';
```

**Stall signals:** `rollout_running: false` + `status: indexing` + `updated_at` unchanged 12+ min; or `status: failed` with `last_error` matching `already running`.

### 3 — After `status: complete`

- [ ] `v2_room_types_index` > 0
- [ ] **Restart Render** (Manual Deploy or env bump) so `loadV2Cities()` includes Paris → `/api/rates` uses `v2_hotels_cache`
- [ ] `node scripts/test-search-quality.js` (Paris cases use V2 when indexed)
- [ ] Boop smoke: `?city=Paris`

### 4 — Post-index tail (neighbourhoods + V1)

If reindex was **reindex-only**, run tail without wiping V2:

```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
$body = '{"city":"Paris","secret":"roommatch-2026","skip_reindex":true,"limit":5147}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/city-rollout" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

Or local:
```powershell
node scripts/v2-city-rollout.js --city=Paris --skip-reindex
```

**Neighbourhood fence QA (all cities):** after `runNeighborhoods`, run:
```powershell
node scripts/city-launch.js --city=Paris --phase=repair-fences
node scripts/city-launch.js --city=Paris --phase=verify
```
See `docs/next-10-cities-launch-plan.md` § Neighbourhood fence QA. Curated bbox overrides live in `scripts/neighborhood-fence-overrides.js`.

### 5 — Hotel-public photos (required if `V2_SKIP_HOTEL_PUBLIC=1` during index)

```powershell
$body = '{"city":"Paris","secret":"roommatch-2026","concurrency":24,"rate_per_min":1500}'
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/classify-hotel-public" -Method POST -ContentType "application/json" -Headers @{ "x-index-secret" = "roommatch-2026" } -Body $body
```

Then verify `area_*` facts and rebuild if needed: `SELECT rebuild_v2_room_types_index_city('Paris');`

---

## API reference

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v2/city-rollout` | Full pipeline; body: `city`, `secret`, `force`, `resume`, `limit`, `skip_reindex`, `skip_neighborhoods`, `keep_v1`, `regenerate_neighborhoods` |
| `GET /api/v2/city-rollout/status?city=` | `counts`, `catalog_total`, `rollout_running`, `index_progress` |
| `POST /api/v2/reindex-city` | Reindex only; body: `city`, `secret`, `force`, `resume`, `limit` |

**PowerShell start (full rollout, first run):**
```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
$body = @{ city = "Paris"; secret = "roommatch-2026"; force = $true; limit = 5147 } | ConvertTo-Json
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/city-rollout" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

---

## Indexer throughput (May 2026 fixes)

| Issue | Mitigation |
|-------|------------|
| OOM at ~50 hotels on Starter | Stream catalog pages; serial batches; `V2_MAX_INFLIGHT_PHOTOS`; checkpoint `index_progress` |
| Very slow Gemini | Global in-flight pool; 2 hotels parallel; skip hotel-public during bulk |
| False `failed` on duplicate resume | Coalesce in-flight jobs; supervisor auto-resume; rollout catch ignores “already running” |
| Resume re-walks catalog | `index_progress.liteapi_offset` + skip `existing` hotel IDs |
| **Hung job (`running: true`, `updated_at` stale 12+ h)** | May 2026: **semaphore deadlock** — Gemini retries re-entered `_photoGeminiSlot` and blocked all workers. Fixed: retries call `*Inner` without re-acquiring slot. **Restart Render** to clear a hung process, then deploy fix + resume. |
| `liteapi_offset: 0` for a long time | Normal until the **first 1000-hotel LiteAPI page** finishes; prefer `catalog_scanned` + `v2_hotels_cache` counts. After fix, pagination advances by `liteapi_offset`. |

**ETA (Starter, after `a1c4896` env):** ~4–12 h for Paris quality hotels (not wall-clock for full 5,097).

---

## Paris rollout history (for agents)

| Date | Event |
|------|--------|
| May 2026 | Paris V2 rollout started; LiteAPI catalog **5,097** (not ~1k V1 hotels) |
| May 2026 | Repeated stalls at ~50 hotels — Render Starter OOM; mitigated with streaming indexer (`6202a5b`), smaller batches |
| May 2026 | False `failed` from duplicate `POST /reindex-city` + `city-rollout` race |
| May 2026 | Throughput pass (`a1c4896`): in-flight photo pool, skip hotel-public on Render |
| May 2026 | Auto-resume supervisor (`7d234bf`): coalesce starts, 5 min watchdog |

**Legacy V1 Paris:** ~999 hotels in `room_embeddings` — **do not delete** until V2 complete and tail cleanup runs.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `hotel_count` 0 in status row but `counts.v2_hotels` > 0 | Normal lag; trust `counts` + `index_progress` |
| `index_progress` null | Old deploy or no checkpoint yet; wait for 25 catalog ticks or redeploy |
| `failed` + `already running` | Benign; supervisor or manual resume; clear with `UPDATE v2_indexed_cities SET status='indexing', last_error=NULL WHERE city='Paris'` |
| OOM / instance restart | Resume; lower `V2_MAX_INFLIGHT_PHOTOS` |
| Want fresh wipe | `force: true` on **reindex-city only** when sure — **destructive** for city V2 tables |

---

## Future cities

1. Add `paris` / city key to `COUNTRY_CODES` in `scripts/index-city-v2.js` + `scripts/v2-city-rollout-core.js`
2. `GET .../city-rollout/status?city=London` → `catalog_total`
3. `node scripts/v2-city-rollout-remote.js --city=London`
4. Add city to `V2_SUPERVISOR_CITIES` on Render if using supervisor
5. Restart Render after complete

---

## Principles

1. **Commit + deploy** before neighbourhood scoring / backfill jobs on Render.
2. **Never delete `hotels_cache`** coords for the city (neighbourhood matching).
3. **V1 cleanup is per-city** — Paris rollout only deletes Paris V1 rows (`room_embeddings`, etc.).
4. **Do not** run `POST /api/backfill-neighborhood-vibes` until scoring code is deployed.
