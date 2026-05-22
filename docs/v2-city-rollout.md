# V2 city rollout runbook

Repeatable playbook for **Paris** and future cities (London, NYC, Kuala Lumpur). Matches the Paris build-out plan: **full LiteAPI catalog**, V2-only, neighbourhood repair, V1 cleanup per city.

## What “index all hotels” means

| Step | What happens |
|------|----------------|
| **Catalog fetch** | Paginate **every** LiteAPI hotel for the city (Paris: **5,097** FR; API `limit` = catalog + 50 → **5,147**). |
| **Per-hotel LiteAPI detail** | Each catalog ID gets `/data/hotel` (required to see room photos). |
| **Quality filter** | Only hotels with **≥2 photos on at least one room** are written to `v2_*` (same as Mexico City). Skipped IDs are counted in logs as `skipped_quality`. |
| **Not indexed** | Thin-photo properties are intentionally excluded from search — not a bug. |

**Success metric:** `v2_indexed_cities.status = complete` and `v2_hotels_cache` in the hundreds–thousands for Paris (not 5,097 rows).

---

## Paris checklist (follow in order)

### 0 — Code & deploy

- [ ] Changes committed and pushed to `main`
- [ ] **Render deploy live** (includes `POST /api/v2/city-rollout`)
- [ ] Render env: `LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_*`, `UNSPLASH_KEY`, `INDEX_SECRET`
- [ ] If Render **Starter (512 MB)** stalls/OOM: set `V2_BATCH_SIZE=10` and `V2_PHOTO_CONCURRENCY=2`, redeploy, then **resume**

### 1 — Start full rollout on Render

```powershell
node scripts/v2-city-rollout-remote.js --city=Paris
# or explicit catalog cap:
node scripts/v2-city-rollout-remote.js --city=Paris --limit=5147
```

Body sent: `force: true` (first run) or `resume: true` (after crash), **`limit: 5147`** (all catalog hotels).

**Do not** use a low cap like `1200` unless debugging — Paris catalog is ~5,097.

### 2 — Monitor (every 10 min)

```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
Invoke-RestMethod "https://roommatch-1fg5.onrender.com/api/v2/city-rollout/status?city=Paris" -Headers $h
```

Or: `node scripts/v2-city-rollout-remote.js --city=Paris --watch-only --interval=10`

Render logs: `[v2-index] progress Paris:` and `[v2-rollout]`.

**If counts freeze and `rollout_running: false`:** job died — **resume** (step 1 with `--resume`), do not `force` unless you intend to wipe partial V2.

### 3 — After `status: complete`

- [ ] `v2_room_types_index` > 0 (rebuild runs at end of reindex)
- [ ] **Restart Render** so `loadV2Cities()` includes Paris → `/api/rates` uses `v2_hotels_cache`
- [ ] `node scripts/test-search-quality.js` (Paris tests use `source: "v2"`)
- [ ] Manual Boop smoke: `?city=Paris`

### 4 — Automatic tail (same rollout job)

- Verify V2 thresholds
- Neighbourhoods: polygons → `hotel_count` → vibe recompute
- V1 cleanup for Paris only (`room_embeddings`, etc.)

---

## API reference

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v2/city-rollout` | Full pipeline (preferred) |
| `GET /api/v2/city-rollout/status?city=Paris` | Progress + `catalog_total` |
| `POST /api/v2/reindex-city` | Reindex only (use if splitting phases) |

Example start (PowerShell):

```powershell
$h = @{ "x-index-secret" = "roommatch-2026" }
$body = @{
  city = "Paris"
  secret = "roommatch-2026"
  force = $true      # first run; use resume=$true after crash
  limit = 5147       # all LiteAPI Paris hotels
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/city-rollout" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

Resume after crash:

```powershell
$body = @{ city = "Paris"; secret = "roommatch-2026"; resume = $true; limit = 5147 } | ConvertTo-Json
Invoke-RestMethod -Uri "https://roommatch-1fg5.onrender.com/api/v2/city-rollout" -Method POST -ContentType "application/json" -Headers $h -Body $body
```

---

## Local (fallback only)

```powershell
node scripts/v2-city-rollout.js --city=Paris --limit=5147
```

Long runs may hit local network timeouts; production path is Render.

---

## Future cities

1. Add `COUNTRY_CODES` entry in `scripts/index-city-v2.js` + `scripts/v2-city-rollout-core.js`
2. Preflight: `GET .../city-rollout/status?city=London` → note `catalog_total`
3. `node scripts/v2-city-rollout-remote.js --city=London` (limit auto = catalog + 50)
4. Restart Render after complete

---

## Principles

1. **Commit + deploy** before neighbourhood scoring jobs on Render.
2. **Never delete `hotels_cache`** for the city (coords for neighbourhood matching).
3. **V1 cleanup is per-city** — Paris rollout does not touch Kuala Lumpur V1 data.
