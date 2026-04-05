# Option C (soft flags): implementation plan & spec

Spec for semantic-first search with **structured flag boosting** instead of hard `required_features` AND pre-filters. Aligns with vibe-first positioning; amenity phrases still influence ranking via `room_types_index.features`.

**Status:** design only — not implemented.  
**Related code:** `server.js` (`/api/vsearch`), `supabase/rebuild-functions.sql` (`score_room_types`), `scripts/test-search-quality.js`, `scripts/search-test-lib.js`.

---

## 1. Goal

| Today | Option C |
|--------|----------|
| Detected phrases → `required_features` → SQL `features @> ALL` → tiny candidate set | Same phrase detection → **no** hard prefilter by default |
| | **Semantic similarity** from `score_room_types` drives recall |
| | **Structured flags** from `room_types_index.features` → **bounded boost** so embeddings still win when signals disagree |

**Non-goals (v1):** new embedding model, full re-index of all cities, user-visible “strict mode” in UI (can be Phase 2).

---

## 2. Current pipeline (anchor points)

1. HyDE + embed → `queryEmbedding`
2. `FEATURE_FLAGS` + regex on raw `query` → `detectedFlags` / `required_features`
3. `score_room_types` with optional `required_features` + optional `hotel_ids` (bbox)
4. Build `hotelSimMap` / `roomTypeSimMap`
5. Phase B: `fetch_hotel_photos` for top **GALLERY_LIMIT** hotels
6. `SIM_MAX` / `SIM_MIN` normalization (+ photo-count penalty, intent type, etc.)
7. JSON response

---

## 3. Target behavior (v1)

- **Default:** call `score_room_types` **without** `required_features` (pass `NULL` / omit when soft mode on).
- **Still pass** `hotel_ids` when bbox resolves to a non-empty set (geo filter unchanged).
- After Phase A, compute **per-hotel flag coverage** from `room_types_index` and apply a **bounded boost** to hotel-level ranking before taking top N for Phase B.
- **Logging:** `[vsearch] soft_flags: detected=[...] mode=soft bonus=...` for tuning.

**Optional v1.1:** query param `flag_mode=soft|strict` — `strict` restores current hard-filter behavior for A/B or rollback.

---

## 4. Flag coverage (core definition)

**Inputs**

- `detectedFlags`: from existing `FEATURE_FLAGS` regex on **raw `query`**
- City: `search_city`
- Hotels: all `hotel_id` in Phase A results (`hotelSimMap` keys)

**Per-hotel coverage (v1)**

For hotel `h`, let `rows(h)` = all `room_types_index` rows with `city = search_city` and `hotel_id = h`.

For each detected flag key `f`:

- `satisfied(h, f) = true` if **∃** row `r ∈ rows(h)` with `r.features @> '{"f": true}'::jsonb` (match actual JSON shape in DB).

\[
\text{coverage}(h) = \frac{|\{ f \in \text{detected} \mid \text{satisfied}(h,f)\}|}{|\text{detected}|}
\]

- If `detectedFlags.length === 0`, `coverage(h) = 0` (no boost).

**Rationale:** Hotel-level OR across room rows matches “this property has some indexed room that confirms the flag,” without requiring a single room type to satisfy every flag at once.

---

## 5. Boost math (spec)

Operate in **raw similarity** space from `score_room_types` (0–1 cosine-style) **before** display normalization.

**Symbols**

- `s` = raw hotel similarity (max over room types, as today’s `hotelSimMap`)
- `c` = coverage ∈ [0,1]
- Tunables (env):

  - `SOFT_FLAG_BONUS_MAX` — e.g. `0.06` (tune 0.04–0.10)

**Recommended v1**

\[
s' = \min(0.999,\, s + \text{SOFT\_FLAG\_BONUS\_MAX} \cdot c)
\]

**Re-sort** hotels by `s'` descending before slicing **GALLERY_LIMIT** for `fetch_hotel_photos`.

**`roomTypeSimMap` (v1 default):** Keep similarities from **unboosted** RPC output for per-photo assignment; **only** hotel **ordering** into Phase B changes.

**Display %:** Compute `SIM_MAX` / `SIM_MIN` from the **boosted** ordering so the top listed hotel can still map to 100% for the set.

**Optional v1.1:** `BONUS_MAX_effective = BONUS_MAX / sqrt(|detected|)` to dampen long multi-flag queries.

**Alternative:** multiplicative `s' = min(0.999, s * (1 + α * c))` — requires separate tuning.

---

## 6. Implementation strategies

### Strategy A — Node-only (recommended v1)

1. Phase A: `score_room_types({ query_embedding, search_city, hotel_ids })` — **omit** `required_features`.
2. Build `hotelSimMap`, `roomTypeSimMap`, `rankedHotels` as today.
3. If `detectedFlags.length > 0`:
   - `H` = unique hotel IDs from ranked list (optionally cap `M` e.g. 2000 + similarity floor).
   - Batch query: `room_types_index` — `hotel_id`, `features`, `city` filter, `.in('hotel_id', H)` (paginate if needed).
   - Compute `coverage(h)` in Node; compute `s'`; re-sort; replace ordering for Phase B top slice.
4. Phase B+ unchanged.

**Pros:** No SQL migration. **Cons:** Extra round-trip; mitigate with cap `M`.

### Strategy B — RPC extension (scale)

Extend `score_room_types` (or add `score_room_types_soft`) to join `features` and apply boost in SQL — one round-trip.

**Pros:** Efficient. **Cons:** deploy SQL, slower iteration.

---

## 7. Edge cases

| Case | Behavior |
|------|----------|
| No flags detected | Pure semantic; skip flag query. |
| Bbox → 0 hotels | Keep retry Phase A without `hotel_ids`; same soft logic. |
| Bbox + flags | Geo unchanged; boost only within bbox set. |
| Eval / contracts | Existing `test-search-quality.js` exact counts assume **strict** mode; use separate eval (§9) or `flag_mode=strict` until baseline regenerated. |

---

## 8. API & configuration

| Mechanism | Suggestion |
|-----------|------------|
| Env | `VSEARCH_FLAG_MODE=soft` \| `strict` |
| Query override | `?flag_mode=soft` (debug / A/B) |
| Tunables | `SOFT_FLAG_BONUS_MAX`, optional `SOFT_FLAG_HOTEL_CAP` |

**Optional response (debug):** `stats.softFlags: { mode, detected, bonusMax, hotels: [...] }` behind `debug=1` or non-prod.

---

## 9. Eval harness

### 9.1 Purposes

- **Regression (soft):** feature-like queries still get **enough** flag-relevant hotels in top-K.
- **Recall:** curated **vibe** strings return **≥ N** hotels (Paris/KL) without bbox.
- **Sanity:** broad semantic queries still return many hotels.

### 9.2 New artifacts

- `scripts/search-eval-soft-flags.js`
- `scripts/search-eval-cases.json` (or `design/search-eval-cases.json`)

Keep **`scripts/test-search-quality.js`** on current **strict** expectations until baselines are consciously updated.

### 9.3 Case schema (example)

```json
{
  "id": "paris-urban-vibe",
  "query": "urban high-rise hotel room city view sweeping skyline panoramic elevated floor-to-ceiling windows night",
  "city": "Paris",
  "bbox": null,
  "expects": {
    "type": "recall_floor",
    "minHotels": 25,
    "minTopScore": 35
  }
}
```

```json
{
  "id": "paris-double-sinks-soft",
  "query": "double sinks",
  "city": "Paris",
  "expects": {
    "type": "feature_density_topk",
    "k": 20,
    "flag": "double_sinks",
    "minFraction": 0.35
  }
}
```

### 9.4 Assertion types

1. **`recall_floor`:** `hotels.length >= minHotels`, top `vectorScore >= minTopScore`.
2. **`feature_density_topk`:** In top `k` IDs, fraction of hotels with flag satisfied in DB (via Supabase + `room_types_index`) ≥ `minFraction`.
3. **`bbox_recall_floor`:** Same as recall with `bbox` query param on `/api/vsearch`.
4. **`semantic_baseline`:** Min hotels for broad semantic query.

### 9.5 CLI (planned)

```bash
node scripts/search-eval-soft-flags.js --base-url=http://localhost:3000
node scripts/search-eval-soft-flags.js --base-url=https://roommatch-1fg5.onrender.com --report=json
```

Optional `--compare-strict` if `flag_mode=strict` exists.

### 9.6 Initial golden cases (recommended)

- Curated `STYLES` vibes: urban, luxury spa, bright, coastal/ocean stress, double-sinks style.
- Paris + KL: `double_sinks`, `city view`, `floor-to-ceiling windows`, broad semantic.
- At least one **Paris bbox** (e.g. 7th) + long vibe query — modest `minHotels` to limit flakiness.

### 9.7 CI

- First: **non-blocking** soft eval job.
- After tuning: **blocking** with frozen thresholds.

---

## 10. Rollout checklist

1. Implement Strategy A + env; default **soft** on staging.
2. Run `search-eval-soft-flags.js`; tune `SOFT_FLAG_BONUS_MAX`.
3. Manual checks: Paris urban + 7th bbox; KL feature queries.
4. Production deploy; retain `flag_mode=strict` kill switch.
5. Phase 2: explicit user “must-have” strict mode + optional RPC (Strategy B).

---

## 11. Summary

| Area | Notes |
|------|--------|
| **Risk** | Medium — ranking shifts; mitigate with eval + kill switch |
| **Effort** | Small–medium — `server.js` + eval script + case JSON |
| **Dependencies** | Existing `room_types_index.features`; no reindex required for v1 |

---

## 12. Related design threads

- Complements **Option D** (explicit strict vs semantic mode in UX) — can layer on later.
- **Improvements to Option C** (photo-type-aligned boosts, coverage-aware weights, geo priors) can be added as v1.1+ with the same eval harness.
