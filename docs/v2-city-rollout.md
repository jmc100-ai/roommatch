# V2 city rollout (repeatable playbook)

Use this for **Paris**, then **London**, **NYC**, **Kuala Lumpur**, etc. Mexico City was done ad hoc before this playbook existed.

## Principles

1. **Commit + deploy before production jobs** — neighbourhood backfills on Render run whatever code was loaded at instance startup (see `.cursor/rules/push-before-remote-ops.mdc`).
2. **Local V2 reindex** — faster and avoids Render 512 MB OOM on multi-hour caption runs.
3. **Delete V1 only after V2 verify passes** — `room_embeddings` / `room_types_index` are not used by V2 search.
4. **Do not delete `hotels_cache` for the city** — lat/lng rows are merged from V2 at end of reindex; neighbourhoods count against both `hotels_cache` and `v2_hotels_cache`.

## One-command pipeline (local)

```powershell
# Full Paris build (catalog limit auto-detected from LiteAPI)
node scripts/v2-city-rollout.js --city=Paris

# V1 cleanup runs automatically at end of rollout (Paris-only). To skip:
node scripts/v2-city-rollout.js --city=Paris --keep-v1
```

### Flags

| Flag | Purpose |
|------|---------|
| `--limit=N` | Cap LiteAPI hotels fetched (default: catalog `total + 50`) |
| `--skip-reindex` | Neighbourhood / verify only |
| `--skip-neighborhoods` | Index + verify only |
| `--regenerate-neighborhoods` | Wipe non-`manual_override` hood rows + fresh Gemini list |
| `--verify-only` | Preflight + DB checks |
| `--keep-v1` | Skip V1 table cleanup at end (default: cleanup runs for `--city` only) |

Neighbourhood-only repair (no reindex):

```powershell
node scripts/repair-city-neighborhoods.js --city=Paris
```

## Phase checklist

### 0 — Pre-flight

- [ ] `.env` has `LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_*`, `UNSPLASH_KEY`
- [ ] `git status` clean or intentional changes **committed and pushed**
- [ ] **Deploy Render** if `index-city-v2.js`, `neighborhood-vibe-data.js`, or `search-v2.js` changed
- [ ] Note LiteAPI catalog total: `node scripts/v2-city-rollout.js --city=Paris` prints it in preflight

### 1 — V2 full reindex (`force: true`)

Clears per city: `v2_room_feature_facts`, `v2_room_inventory`, `v2_room_types_index`, `v2_hotels_cache`.

Then: LiteAPI paginate → quality filter (≥2 photos on some room) → room captions + facts + `__hotel_public__` → `rebuild_v2_room_types_index_city` → copy lat/lng to `hotels_cache`.

**Not needed on fresh index:** `classify-visual-style`, `classify-hotel-public` (built into `index-city-v2.js`).

**Runtime (Paris ~1k hotels):** ~1.5–3 h local.

### 2 — Verify V2

Automated: `node scripts/v2-city-rollout.js --city=Paris --verify-only`

Manual SQL (optional) — see CLAUDE.md Mexico City verification block; substitute `Paris`.

### 3 — Neighbourhood backfill

Default in rollout script:

1. `backfillNeighborhoodPolygons`
2. `refreshHotelCounts`
3. `recomputeNeighborhoodVibes` (Overpass + Gemini elements)

**Deploy first** if `neighborhood-vibe-data.js` changed recently.

### 4 — Production routing

- [ ] `v2_indexed_cities.status = 'complete'` for the city
- [ ] **Restart Render** (or redeploy) so `_v2Cities` includes the city → `/api/rates` uses `v2_hotels_cache`

### 5 — QA

- [ ] Migrate city tests in `scripts/search-test-lib.js` to `source: "v2"` (Paris: tests 6, 7, 13–17)
- [ ] `node scripts/test-search-quality.js`
- [ ] Manual: Boop + `?city=Paris` + neighbourhood map

### 6 — V1 cleanup

Runs automatically at end of `v2-city-rollout.js` (scoped to `--city` only — never touches Mexico City).

Deletes: `room_embeddings`, `room_types_index`, `indexed_cities`, `hotel_profile_index` for that city only.

## Country codes

Add new cities to `COUNTRY_CODES` in `scripts/index-city-v2.js` and `scripts/v2-city-rollout.js` (same map).

## Remote API equivalents (after deploy)

| Local script | Render endpoint |
|--------------|-----------------|
| reindex | `POST /api/v2/reindex-city` |
| neighbourhood vibes | `POST /api/backfill-neighborhood-vibes` |
| polygons | `POST /api/backfill-neighborhood-polygons` |
| hotel counts | `POST /api/refresh-hotel-counts` |
| wipe + regen hoods | `POST /api/regenerate-neighborhoods` |

Prefer **local** for reindex; use remote for neighbourhood jobs only when you cannot run locally and code is already deployed.
