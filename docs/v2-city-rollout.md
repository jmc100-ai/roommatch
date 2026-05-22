# V2 city rollout (repeatable playbook)

Use this for **Paris**, then **London**, **NYC**, **Kuala Lumpur**, etc.

## Principles

1. **Commit + push + deploy Render** before starting a rollout (neighbourhood scoring runs whatever code loaded at instance startup).
2. **Production rollouts run on Render** — one API starts the full pipeline; your machine only triggers and polls status.
3. **Delete V1 per city** after V2 verify (automatic unless `keep_v1: true`).
4. **Do not delete `hotels_cache`** — lat/lng used for neighbourhood matching.

## Render (recommended)

### 1. Deploy latest `main`

Push includes `POST /api/v2/city-rollout` and `GET /api/v2/city-rollout/status`.

### 2. Start Paris (full redo)

```powershell
node scripts/v2-city-rollout-remote.js --city=Paris
```

This calls Render with `force: true` (clears Paris V2, reindexes all LiteAPI hotels, then neighbourhoods + V1 cleanup).

Optional flags: `--resume`, `--keep-v1`, `--skip-neighborhoods`, `--limit=5200`, `--watch-only`, `--interval=10`.

### 3. Progress every 10 minutes

The remote script prints a snapshot every 10 min until `status=complete` and `v2_room_types_index` is populated.

Manual check:

```powershell
Invoke-RestMethod "https://roommatch-1fg5.onrender.com/api/v2/city-rollout/status?city=Paris"
```

Render logs: filter `[v2-rollout]` and `[v2-index]`.

### 4. After complete

- **Restart Render** (or redeploy) so `loadV2Cities()` includes Paris → `/api/rates` uses `v2_hotels_cache`.
- Run search QA: `node scripts/test-search-quality.js`

### API reference (same as CLI)

| Endpoint | Body / query |
|----------|----------------|
| `POST /api/v2/city-rollout` | `{ "city", "secret", "force": true, "limit": 5200 }` |
| `GET /api/v2/city-rollout/status?city=Paris` | — |
| `POST /api/v2/reindex-city` | reindex only (legacy) |
| `POST /api/backfill-neighborhood-vibes` | vibes only (after deploy) |

## Local (fallback)

```powershell
node scripts/v2-city-rollout.js --city=Paris
```

Use when Render is unavailable; long runs may hit local network timeouts.

## Phase checklist

### 0 — Pre-flight

- [ ] Code committed, pushed, **Render deployed**
- [ ] `.env` on Render has `LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_*`, `UNSPLASH_KEY`

### 1 — V2 full reindex (`force: true`)

Clears per city: `v2_room_feature_facts`, `v2_room_inventory`, `v2_room_types_index`, `v2_hotels_cache`.

**Paris catalog:** ~5,097 LiteAPI hotels (FR); quality filter keeps hotels with ≥2 photos per room type.

**Runtime on Render:** many hours (similar order of magnitude to Mexico City).

### 2 — Verify V2

Automated inside rollout. Gates: `status=complete`, hotels ≥100, inventory/facts/room_types floors.

### 3 — Neighbourhood backfill

Polygons → `refreshHotelCounts` → `recomputeNeighborhoodVibes`.

### 4 — V1 cleanup

Deletes `room_embeddings`, `room_types_index`, `indexed_cities`, `hotel_profile_index` for that city.

## Country codes

Add new cities to `COUNTRY_CODES` in `scripts/index-city-v2.js` and `scripts/v2-city-rollout-core.js`.
