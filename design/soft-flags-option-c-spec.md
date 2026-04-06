# Option C (soft flags): implementation plan & spec

Spec for semantic-first search with **structured flag boosting** instead of hard `required_features` AND pre-filters. Aligns with vibe-first positioning; amenity phrases still influence ranking via `room_types_index.features` without collapsing results to a handful.

**Status:** design complete — ready for implementation.  
**Related code:** `server.js` (`/api/vsearch`), `supabase/rebuild-functions.sql` (`score_room_types`), `scripts/test-search-quality.js`, `scripts/search-test-lib.js`.

---

## 1. Goal

| Today | Option C |
|--------|----------|
| Detected phrases → `required_features` → SQL `features @> ALL` → tiny candidate set | Same phrase detection → **no** hard DB pre-filter by default |
| "city view" + "floor-to-ceiling windows" → hard AND → 1 hotel in 7th bbox | **Semantic similarity** from `score_room_types` drives recall across full city |
| | Detected flags → **per-hotel coverage score** → **bounded additive boost** on top of raw similarity before re-sorting into Phase B |

**Non-goals (v1):** new embedding model, full re-index of all cities, user-visible "must-have" strict mode in UI (can be Phase 2 Option D layer).

---

## 2. Current pipeline (anchor points)

1. Regex on raw `query` → `detectedFlags` / `required_features`  ← **flags known here, before HyDE**
2. HyDE + embed → `queryEmbedding`
3. `score_room_types` RPC with optional `required_features` + optional `hotel_ids` (bbox)
4. Build `hotelSimMap` (hotel→max sim) / `roomTypeSimMap` (hotel::room→sim)
5. Phase B: `fetch_hotel_photos` for top **GALLERY_LIMIT=250** hotels by `rankedHotels`
6. `SIM_MAX` / `SIM_MIN` normalization → display %
7. Per-hotel + per-room score computation → JSON response

---

## 3. Target behavior (v1)

- **Default:** call `score_room_types` **without** `required_features` (omit the arg — always `NULL`).
- **Still pass** `hotel_ids` when bbox resolves to a non-empty set (geo filter unchanged).
- **Fire coverage lookup in parallel with Phase A** (flags are known before HyDE; see §6).
- After both Phase A and coverage lookup resolve: apply **bounded boost** to hotel-level similarity, re-sort, then slice `topHotelIds` for Phase B.
- **SIM_MAX computed from unboosted raw similarities** (see §5 — preserves meaning of display %).
- **Logging:** `[vsearch] soft_flags: mode=soft detected=[...] hotels_with_coverage=N boost_applied=N`.

**Kill switch:** `VSEARCH_FLAG_MODE=strict` env (or `?flag_mode=strict` query param) restores hard-filter behavior for rollback or A/B.

---

## 4. Flag coverage (definition)

**Inputs:**
- `detectedFlags` — from existing `FEATURE_FLAGS` regex on **raw `query`` (unchanged regex set)
- `search_city` — normalized city string
- `H` — set of `hotel_id` from Phase A `hotelSimMap`, capped at `SOFT_FLAG_HOTEL_CAP` (default 1500, see §8)

**Per-hotel coverage:**

For hotel `h`, `rows(h)` = all `room_types_index` rows for that hotel in the city.

For each detected flag key `f`:

> `satisfied(h, f) = true`  if any row `r ∈ rows(h)` has `r.features @> {f: true}`

```
coverage(h) = count({ f ∈ detectedFlags | satisfied(h, f) }) / detectedFlags.length
```

- `coverage` ∈ [0, 1]
- If `detectedFlags.length === 0`, `coverage = 0` for all hotels → no boost, skip coverage query entirely.
- **Hotel-level OR-of-rooms is intentional:** "this property has at least one indexed room that confirms each flag." For multi-flag queries (e.g. city_view + floor_to_ceiling_windows), a hotel where Room A has city_view and Room B has floor_to_ceiling_windows scores coverage=1, even though no single room has both. This is acceptable for v1 — the hotel demonstrates both features in its inventory and is a valid recommendation.

---

## 5. Boost math

**Operate in raw similarity space before display normalization.**

Symbols:
- `s` = hotel's raw max cosine similarity from Phase A (`hotelSimMap` value)
- `c` = coverage ∈ [0, 1]
- `SOFT_FLAG_BONUS_MAX` = tunable (env), default `0.06`, range 0.04–0.10

**Formula (v1 — additive, bounded):**

```
s_boosted = min(0.999,  s + SOFT_FLAG_BONUS_MAX × c)
```

**Semantic floor guard (critical):** A hotel with very weak raw similarity should not leapfrog a genuinely better semantic match just from coverage. With `BONUS_MAX = 0.06` and a typical spread of 0.30, the max boost is 20% of the visible range — acceptable, but still needs watching. Log a warning if a hotel with `s < 0.55` gets boosted above a hotel with `s > 0.65` (canary for over-boosting).

**Re-sort** `rankedHotels` by `s_boosted` before slicing `topHotelIds` for Phase B. Specifically:

```js
// After coverage lookup resolves:
for (const hotel of rankedHotels) {
  const c = coverageMap.get(hotel.hotel_id) ?? 0;
  hotel.s_boosted = Math.min(0.999, hotel.similarity + SOFT_FLAG_BONUS_MAX * c);
}
rankedHotels.sort((a, b) => b.s_boosted - a.s_boosted);
// topHotelIds = rankedHotels.slice(0, GALLERY_LIMIT).map(h => h.hotel_id)
```

**SIM_MAX / SIM_MIN — use UNBOOSTED values:**

```js
// BEFORE boost: SIM_MAX = max raw similarity across the result set (= rankedHotels[0] after sort by raw sim desc)
const SIM_MAX = Math.max(...hotelSimMap.values()) || 0.9;
const SIM_MIN = Math.max(SIM_MAX - 0.30, 0);
```

**Rationale:** SIM_MAX from raw similarity preserves the meaning of "% match" — it reflects how semantically close the top hotel is to the query. Using the boosted SIM_MAX would subtly redefine 100% as "top hotel after boost," making the displayed percentage harder to interpret and more volatile across queries.

**Room-row scores (v1):** `roomTypeSimMap` values remain **unboosted** for per-room display (room similarity cards). The boost only affects **hotel ordering into Phase B**. This means a hotel promoted by boost may have a featured room row with a score lower than its card position implies. This is a known v1 tradeoff — the card % reflects hotel-level vibe alignment; the room row % reflects photo-level alignment. Document this in code. **v1.1 option:** cap room score display at the hotel's vectorScore if hotel was boosted.

---

## 6. Implementation strategy (Node-only, recommended v1)

**Key insight:** `detectedFlags` are computed from raw `query` **before** HyDE. The coverage lookup needs only `city` and `detectedFlagKeys`, both of which are available immediately. Fire it in parallel with Phase A (HyDE + embed + RPC) to avoid a sequential round-trip.

### Full revised pipeline

```
1. Regex → detectedFlags                  ← already before HyDE
2. [PARALLEL]:
   a. HyDE → embed → score_room_types     ← Phase A (unchanged)
   b. If detectedFlags.length > 0:
      coverage query → room_types_index   ← NEW, fires at same time
3. Await both; apply boost; re-sort
4. Phase B: fetch_hotel_photos (top GALLERY_LIMIT by s_boosted)
5. Normalization using unboosted SIM_MAX
6. Build response (unchanged)
```

### Coverage query implementation

**Batching required:** PostgREST `.in()` with 999+ hotel IDs can exceed URL length limits. Batch in groups of 400:

```js
async function fetchFlagCoverage(city, detectedFlagKeys, hotelIds, supabase) {
  // detectedFlagKeys = ['city_view', 'floor_to_ceiling_windows']
  // Returns Map<hotel_id, coverage> ∈ [0,1]
  const BATCH = 400;
  const hotelFlagHits = new Map(); // hotel_id → Set of satisfied flags

  for (let i = 0; i < hotelIds.length; i += BATCH) {
    const batch = hotelIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('room_types_index')
      .select('hotel_id, features')
      .eq('city', city)
      .in('hotel_id', batch);
    if (error) { console.error('[soft_flags] coverage query error:', error.message); break; }

    for (const row of (data || [])) {
      if (!hotelFlagHits.has(row.hotel_id)) hotelFlagHits.set(row.hotel_id, new Set());
      const hits = hotelFlagHits.get(row.hotel_id);
      for (const flagKey of detectedFlagKeys) {
        if (row.features?.[flagKey] === true) hits.add(flagKey);
      }
    }
  }

  const coverageMap = new Map();
  for (const [hotelId, hits] of hotelFlagHits) {
    coverageMap.set(hotelId, hits.size / detectedFlagKeys.length);
  }
  return coverageMap; // hotels not in map → coverage=0
}
```

### In-process coverage cache

`room_types_index` is rebuilt only during indexing (rare). Cache coverage results with a short TTL to avoid re-querying on repeated searches:

```js
const coverageCache = new Map(); // key: 'city::flag1,flag2' → { data: Map, expires: ts }
const COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedCoverage(city, flagKeys) {
  const key = city + '::' + [...flagKeys].sort().join(',');
  const cached = coverageCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  return null;
}
function setCachedCoverage(city, flagKeys, data) {
  const key = city + '::' + [...flagKeys].sort().join(',');
  coverageCache.set(key, { data, expires: Date.now() + COVERAGE_CACHE_TTL_MS });
}
```

### Integration with existing code (delta only)

In `/api/vsearch`, replace the Phase A block:

```js
// 1. flags (unchanged)
const detectedFlags = FEATURE_FLAGS.filter(f => f.queryMatch.test(query));
const detectedFlagKeys = detectedFlags.map(f => f.flag);
const flagMode = (process.env.VSEARCH_FLAG_MODE || 'soft') === 'strict' || req.query.flag_mode === 'strict'
  ? 'strict' : 'soft';

// required_features only used in strict mode
const required_features = flagMode === 'strict' && detectedFlags.length > 0
  ? Object.fromEntries(detectedFlags.map(f => [f.flag, true]))
  : null;

// 2. Fire coverage lookup in parallel with HyDE+embed+Phase A
//    (detectedFlagKeys and city known before HyDE)
const hotelIdsForCoverage = null; // filled after bbox resolves (see below)
// ... [bbox resolution block unchanged] ...

// Build candidateIds for coverage (all city hotels, capped at SOFT_FLAG_HOTEL_CAP)
const SOFT_FLAG_HOTEL_CAP = parseInt(process.env.SOFT_FLAG_HOTEL_CAP || '1500', 10);
const SOFT_FLAG_BONUS_MAX = parseFloat(process.env.SOFT_FLAG_BONUS_MAX || '0.06');

// Coverage promise: only fire if soft mode + flags detected
let coveragePromise = Promise.resolve(null);
if (flagMode === 'soft' && detectedFlagKeys.length > 0) {
  const cached = getCachedCoverage(city, detectedFlagKeys);
  if (cached) {
    coveragePromise = Promise.resolve(cached);
  } else {
    // Fetch all hotel_ids in city from hotels_cache (or scope to bbox if available)
    // This fires in parallel with HyDE+embed
    coveragePromise = (bboxHotelIds
      ? Promise.resolve(bboxHotelIds)
      : fetchClient.from('hotels_cache').select('hotel_id').eq('city', city)
          .then(r => (r.data || []).map(h => h.hotel_id))
    ).then(ids => {
      const capped = ids.slice(0, SOFT_FLAG_HOTEL_CAP);
      return fetchFlagCoverage(city, detectedFlagKeys, capped, fetchClient);
    }).then(coverage => {
      setCachedCoverage(city, detectedFlagKeys, coverage);
      return coverage;
    }).catch(e => {
      console.error('[soft_flags] coverage fetch failed:', e.message);
      return null;
    });
  }
}

// 3. [Phase A RPC + hotels_cache in parallel — unchanged code]
const [roomTypesResult, cachedResult, coverageMap] = await Promise.all([
  fetchClient.rpc("score_room_types", { query_embedding: queryEmbedding, search_city: city,
    ...(required_features ? { required_features } : {}),
    ...(bboxHotelIds ? { hotel_ids: bboxHotelIds } : {}),
  }),
  hotelsPromise,
  coveragePromise,
]);

// 4. Build hotelSimMap / roomTypeSimMap (unchanged)
// ...

// 5. Apply soft boost (new)
if (flagMode === 'soft' && coverageMap && detectedFlagKeys.length > 0) {
  let boostedCount = 0;
  for (const hotel of rankedHotels) {
    const c = coverageMap.get(hotel.hotel_id) ?? 0;
    hotel.s_boosted = Math.min(0.999, hotel.similarity + SOFT_FLAG_BONUS_MAX * c);
    if (c > 0) boostedCount++;
  }
  rankedHotels.sort((a, b) => (b.s_boosted ?? b.similarity) - (a.s_boosted ?? a.similarity));
  console.log(`[vsearch] soft_flags: mode=soft detected=[${detectedFlagKeys.join(',')}] hotels_with_coverage=${boostedCount}/${rankedHotels.length} bonus_max=${SOFT_FLAG_BONUS_MAX}`);
}

// 6. SIM_MAX from UNBOOSTED max (important — see §5)
const SIM_MAX = Math.max(...rankedHotels.map(h => h.similarity), 0.90); // raw, not s_boosted
```

### Bbox fallback edge case

The existing fallback (0 results in bbox → retry city-wide) also needs coverage to apply after the retry:

```js
// After fallback refills hotelSimMap:
if (flagMode === 'soft' && detectedFlagKeys.length > 0 && coverageMap == null) {
  // coverage wasn't available yet (bbox path skipped global fetch) — fetch now
  const allIds = rankedHotels.map(h => h.hotel_id).slice(0, SOFT_FLAG_HOTEL_CAP);
  const fallbackCoverage = await fetchFlagCoverage(city, detectedFlagKeys, allIds, fetchClient);
  // apply boost to rankedHotels (same logic as above)
}
```

---

## 7. Edge cases

| Case | Behavior |
|------|----------|
| No flags detected | Skip coverage query entirely. Pure semantic — no change from today. |
| Flags detected, `flag_mode=strict` | Pass `required_features` to RPC as today. Coverage query not fired. |
| Bbox → 0 hotels | Keep existing city-wide fallback. Apply coverage boost after fallback fills `rankedHotels`. |
| Bbox + flags | Geo filter unchanged (still `hotel_ids`). Coverage runs on bbox hotel IDs (already small). |
| Coverage query errors | Log, set `coverageMap = null`, continue with pure semantic result (graceful degradation). |
| All hotels have coverage=0 | No re-sort needed (all `s_boosted = s`). Pure semantic wins. |
| Hotel in bbox but not in coverage cache | Coverage = 0 for that hotel (conservative). |
| `SOFT_FLAG_HOTEL_CAP` exceeded | Silently use top N — hotels beyond cap get coverage=0 (they're low-similarity anyway). |

---

## 8. Configuration & API

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `VSEARCH_FLAG_MODE` | env | `soft` | `strict` restores hard-filter mode |
| `SOFT_FLAG_BONUS_MAX` | env | `0.06` | Absolute cosine-space boost for full coverage (c=1). Range: 0.04–0.10. |
| `SOFT_FLAG_HOTEL_CAP` | env | `1500` | Max hotels passed to coverage query. Paris has ~999, KL ~200 — 1500 covers both with headroom. |
| `?flag_mode=strict\|soft` | query param | inherits env | Debug / A/B override. Not exposed in UI (v1). |
| `?debug=1` | query param | off | Adds `stats.softFlags` to response: `{ mode, detected, bonusMax, hotelsCoverage: [{hotel_id, s, s_boosted, coverage}] }` capped at 10 sample hotels. |

---

## 9. Eval harness

### 9.1 Purposes

| Test | Purpose |
|------|---------|
| **recall_floor** | Vibe queries return ≥ N hotels — proves soft mode fixes the "1 result" problem |
| **feature_density_topk** | Feature-amenity queries still surface relevant hotels in top-K — proves we didn't destroy precision |
| **score_distribution** | Top + p25 score distribution stays healthy — proves rank collapse isn't happening |
| **semantic_baseline** | Broad non-flag queries unaffected — proves soft mode is additive only |
| **bbox_recall_floor** | With neighborhood selected, reasonable hotel count — proves geo filter still works |

### 9.2 New artifacts

- `scripts/search-eval-soft-flags.js` — runner
- `scripts/search-eval-cases.json` — golden cases (lives in `scripts/` with other eval fixtures)

**Keep `scripts/test-search-quality.js` on strict baseline for now.** Before shipping Option C to production, add `?flag_mode=strict` to the URL in that script's `callVsearch` helper, so it continues asserting exact hard-filter counts.

### 9.3 Case schema

```json
{
  "id": "paris-urban-vibe-no-bbox",
  "description": "Urban high-rise vibe, all Paris — soft mode should return many hotels",
  "query": "urban high-rise hotel room city view sweeping skyline panoramic elevated floor-to-ceiling windows night",
  "city": "Paris",
  "bbox": null,
  "flag_mode": "soft",
  "expects": {
    "type": "recall_floor",
    "minHotels": 200,
    "minTopScore": 35,
    "minP25Score": 10
  }
}
```

```json
{
  "id": "paris-urban-vibe-7th-bbox",
  "description": "Same vibe, constrained to 7th — should return multiple hotels not just 1",
  "query": "urban high-rise hotel room city view sweeping skyline panoramic elevated floor-to-ceiling windows night",
  "city": "Paris",
  "bbox": "48.837,48.875,2.276,2.331",
  "flag_mode": "soft",
  "expects": {
    "type": "bbox_recall_floor",
    "minHotels": 5,
    "minTopScore": 25
  }
}
```

```json
{
  "id": "paris-double-sinks-density",
  "description": "Amenity query — top-10 should be mostly double-sinks hotels (feature density)",
  "query": "double sinks",
  "city": "Paris",
  "bbox": null,
  "flag_mode": "soft",
  "expects": {
    "type": "feature_density_topk",
    "k": 10,
    "flag": "double_sinks",
    "minFraction": 0.60
  }
}
```

```json
{
  "id": "paris-art-deco-semantic",
  "description": "Broad semantic query — should be unaffected by soft flags (no flags fire)",
  "query": "Art Deco style room",
  "city": "Paris",
  "bbox": null,
  "flag_mode": "soft",
  "expects": {
    "type": "semantic_baseline",
    "minHotels": 200,
    "minTopScore": 30
  }
}
```

### 9.4 Assertion types (full spec)

**`recall_floor`**
- PASS: `hotels.length >= minHotels` AND `hotels[0].vectorScore >= minTopScore`
- Optional `minP25Score`: score at `hotels[Math.floor(hotels.length * 0.25)]` >= threshold

**`feature_density_topk`**
- Take top `k` hotel IDs from response
- Query `room_types_index` via Supabase: `fetchDistinctHotelIds(city, flag)` (reuse `search-test-lib.js`)
- Intersect: fraction of top-k hotels that appear in the flag set
- PASS: fraction >= `minFraction`
- Recommended thresholds by flag type:
  - Very common flags (bathtub Paris ~677): `k=10, minFraction=0.70`
  - Common flags (double_sinks Paris ~159): `k=10, minFraction=0.50`
  - Rarer flags (soaking_tub Paris ~50): `k=10, minFraction=0.30`

**`score_distribution`** (catches normalization bugs / rank collapse)
- PASS: `hotels[0].vectorScore <= 100` AND `hotels[0].vectorScore >= minTopScore`
- PASS: `hotels[Math.floor(hotels.length * 0.25)].vectorScore >= minP25Score`
- Fail fast if top score = 0 (normalization error) or > 100 (overflow)

**`bbox_recall_floor`**
- Same as `recall_floor` but pass `bbox` as `?bbox=lat_min,lat_max,lon_min,lon_max` in URL
- Separate `minHotels` (smaller) since geo constraint legitimately shrinks results

**`semantic_baseline`**
- Same as `recall_floor`; used for queries that fire no flags (verifies no regression)

### 9.5 CLI

```bash
# Run against local server
node scripts/search-eval-soft-flags.js --base-url=http://localhost:3000

# Run against production
node scripts/search-eval-soft-flags.js --base-url=https://roommatch-1fg5.onrender.com

# Compare soft vs strict side-by-side (requires ?flag_mode= support)
node scripts/search-eval-soft-flags.js --compare-strict --base-url=http://localhost:3000

# JSON report for CI
node scripts/search-eval-soft-flags.js --report=json > eval-results.json
```

**`--compare-strict`:** For each case, runs the query twice: once with `?flag_mode=soft`, once with `?flag_mode=strict`. Prints side-by-side: hotel count, top score, feature density for each mode. Used during tuning to confirm soft mode improves recall without destroying precision.

**Output format:** Mirror `test-search-quality.js` — PASS/FAIL per case, summary table, top-5 hotels per failing case.

**Exit code:** 0 if all pass, 1 if any fail (CI-compatible).

**`.env` requirements:** `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` for `feature_density_topk` assertions (same as existing lib). `BASE_URL` env or `--base-url` CLI flag for HTTP calls.

### 9.6 Initial golden cases (all STYLES + key amenity + bbox stress)

| Case ID | Query (abbreviated) | City | Bbox | Type | Key threshold |
|---------|---------------------|------|------|------|---------------|
| `paris-urban-vibe` | urban high-rise … city view … floor-to-ceiling | Paris | null | recall_floor | ≥200 hotels |
| `paris-urban-vibe-7th` | same | Paris | 7th bbox | bbox_recall_floor | ≥5 hotels |
| `paris-luxury-spa` | soaking tub double sinks rainfall shower | Paris | null | feature_density_topk | top-10 ≥50% have any spa flag |
| `paris-bright-airy` | bright airy large windows natural light | Paris | null | semantic_baseline | ≥200 hotels |
| `paris-ocean-stress` | ocean view balcony sea coastal waves | Paris | null | recall_floor | ≥50 hotels (stress test — no ocean) |
| `paris-cozy-boutique` | cozy boutique warm lighting layered textures | Paris | null | semantic_baseline | ≥200 hotels |
| `paris-modern-lounge` | modern lounge sofa sitting area contemporary | Paris | null | semantic_baseline | ≥200 hotels |
| `paris-work-friendly` | ergonomic desk strong lighting clutter-free | Paris | null | semantic_baseline | ≥150 hotels |
| `paris-family-suite` | multiple beds spacious sofa bed family-friendly | Paris | null | semantic_baseline | ≥150 hotels |
| `paris-romantic-min` | romantic minimalist soft lighting double vanity | Paris | null | semantic_baseline | ≥200 hotels |
| `paris-nature-inspired` | earthy materials outdoor view greenery wood garden | Paris | null | semantic_baseline | ≥150 hotels |
| `paris-double-sinks` | double sinks | Paris | null | feature_density_topk + recall_floor | top-10 ≥50% have flag; ≥50 total hotels |
| `paris-double-sinks-marais-bbox` | double sinks | Paris | Marais bbox | bbox_recall_floor | ≥3 hotels |
| `paris-art-deco` | Art Deco style room | Paris | null | semantic_baseline | ≥200 hotels |
| `kl-double-sinks` | double sinks | Kuala Lumpur | null | feature_density_topk | top-10 ≥40% have flag |
| `kl-rainfall-shower` | rainfall shower | Kuala Lumpur | null | feature_density_topk | top-10 ≥50% have flag |
| `kl-bright-airy` | bright room with large windows | Kuala Lumpur | null | semantic_baseline | ≥100 hotels |

**Bbox coordinates to include in cases JSON:**

- 7th arrondissement (Eiffel Tower area): `48.837,48.875,2.276,2.331`
- Le Marais (3rd/4th): `48.852,48.863,2.343,2.363`

### 9.7 CI integration

1. **Phase 1 (non-blocking):** Run `search-eval-soft-flags.js` as informational step; don't block deploy.
2. **Phase 2 (blocking):** After tuning `SOFT_FLAG_BONUS_MAX`, freeze thresholds and make the job blocking.
3. **Existing test:** Add `?flag_mode=strict` to `callVsearch` in `test-search-quality.js` **before** deploying Option C to production, to preserve its exact-count assertions.

---

## 10. UX implications

### Display % signal
- Hotel card shows `vectorScore` (display %) derived from **unboosted** SIM_MAX/SIM_MIN normalization. A boosted hotel that was promoted from rank 50 to rank 5 may display e.g. 62% — not 100% — because its raw embedding similarity is moderate. This is correct behavior: the % reflects semantic match; position reflects semantic + structural feature alignment.
- **Risk to monitor:** Users may see a 62% hotel ranked above a 78% hotel and find it confusing. Mitigate by: (a) keeping BONUS_MAX small (≤ 0.06) so jumps are bounded, (b) Phase 2 Option D "confirmed: city view ✓" tag on boosted hotel cards.

### Room row score vs hotel position
- Hotel card position reflects `s_boosted`; featured room row score reflects **unboosted** room-type similarity. A hotel promoted by boost may show a room row scored lower than its card implies. This is intentional v1 behavior. Document in code.
- v1.1 option: cap room row score display at the parent hotel's vectorScore to avoid incoherence.

### Existing `test-search-quality.js`
- **Must add `?flag_mode=strict`** to that script's URL before production cutover, or all feature-flag tests will fail (they assert exact DB counts that only hold under hard-filter mode).

---

## 11. Rollout checklist

1. Add `?flag_mode=strict` to `scripts/test-search-quality.js` — do this FIRST (zero-risk, protects regression tests).
2. Implement `fetchFlagCoverage` + coverage cache in `server.js`.
3. Wire coverage into the Phase A `Promise.all` block.
4. Apply boost + re-sort before Phase B slice.
5. Set `SIM_MAX` from unboosted `rankedHotels[0].similarity`.
6. Set env `VSEARCH_FLAG_MODE=soft` on staging; run `search-eval-soft-flags.js`.
7. Tune `SOFT_FLAG_BONUS_MAX` until `feature_density_topk` cases pass at configured thresholds.
8. Manual spot-check: Paris urban + 7th bbox (should return multiple hotels); KL double sinks (top results should be double-sinks hotels).
9. Deploy to production with `VSEARCH_FLAG_MODE=soft`; keep `flag_mode=strict` override in reserve.
10. Phase 2: add "confirmed feature" tags on boosted hotel cards (Option D layer).

---

## 12. Summary

| Area | Notes |
|------|--------|
| **Risk** | Medium — ranking shifts; mitigated by unboosted SIM_MAX, bounded BONUS_MAX, kill switch |
| **Effort** | Small–medium — new `fetchFlagCoverage` helper, parallel Promise, re-sort, eval script + cases JSON |
| **Dependencies** | Existing `room_types_index.features`; no reindex required; no SQL migration |
| **Performance impact** | ~+50–150ms for coverage batch query (parallel with Phase A + in-process cache reduces repeats to ~0ms) |

---

## 13. Known limitations & v1.1 roadmap

| Limitation | v1.1 option |
|------------|-------------|
| Hotel-level OR coverage (no single-room AND guarantee) | Score only room types that satisfy ALL flags; use per-room coverage |
| intentType double-count (view query already biases to view photos) | Only boost for flags whose photo_type matches intentType |
| Room row score incoherence with promoted hotel card | Cap room row display at hotel vectorScore |
| No user-facing "why is this here" signal | Add "confirmed: city view ✓" tag (Option D) |
| BONUS_MAX is a global constant | Per-flag weights (rare flags worth more boost than common ones) |
| Coverage cache is in-process (single server instance) | Move to Redis if multi-instance Render deploy |

---

## 14. Related design threads

- **Option D** (explicit strict vs semantic UX mode) can layer on top of this as Phase 2.
- **STYLES query rewrite (Option A)** is still worth doing as a defensive measure for the worst curated offenders regardless of Option C being live.
- **CLAUDE.md** should be updated post-implementation to document `VSEARCH_FLAG_MODE` env and soft-flag behavior in the Search Design section.
