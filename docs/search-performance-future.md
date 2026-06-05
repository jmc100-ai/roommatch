# Search performance — full implementation plan

**Status:** Active (bookable-first, **low risk only**). **Do not build** cohort+tail UX or `search-sessions` until post-beta.

**Requirements:**

| # | Requirement |
|---|-------------|
| 1 | **#1 = best bookable vibe match** for entered dates |
| 2 | **No UX swaps** after first paint |
| 3 | **Cold** latency acceptable; fix double-waits and duplicate LiteAPI |
| 4 | **Warm** p50 **~2–3s** (Paris dated Boop) |
| 5 | **Out of scope:** catalog trim (optional later), stats trimming, medium/high-risk items listed below |

**Context:** Paris ~5k hotels → full-city LiteAPI + ~2.6 MB vsearch. Warm p50 ~3–4s on same Render instance; cold often 8s embed timeout + client re-fetch (up to 20s). See `docs/search-sort-order.md`.

---

## Core rule

**First paint only when full-city rates are complete** (`rates.full_city === true` or complete Supabase snapshot).

Server sends **one final bookable vibe order**. Client does **not** auto-enable avail filter or re-sort on load for dated Best Match.

---

## Pre-build: config audit (no code)

Verify on Render **before** feature flags ship:

| Config | Expected | Purpose |
|--------|----------|---------|
| `NBHD_BOOP_CACHE=1` | On (`render.yaml`) | L2 nbhd BOOP cache; check `nbhd_cache_hit` in logs |
| `VSEARCH_SLIM_STUBS=1` | On | Slim stub payloads |
| `VSEARCH_COMPACT_TAIL=1` | On | Compact tail rows |
| `v2_intent_cache` table | Populated in Supabase | NLP intent L2 across instances |
| `CLIENT_PARALLEL_RATES=1` | On | Legacy; superseded by single embed once Phase 1 ships |

---

## Phase 0 — Pre-launch verification

Run baseline **`audit-vsearch-perf.js`** (Paris + MX, dated Boop, 5 runs) and record handler p50, client wall p50, `#1` stability. Store as regression comparison.

---

## Phase 1 — Shared foundation (cold + warm)

| # | Change | Risk | Touchpoints |
|---|--------|------|-------------|
| 1.1 | **Supabase `rates_snapshots`** — key `city\|checkin\|checkout\|currency\|full`; TTL 30 min (env `RATES_SNAPSHOT_TTL_MS`) | Low | migration SQL, `lib/lite-rates.js` |
| 1.2 | **Write** snapshot on `prefetchCityRatesForDates()` + successful full-city fetch | Low | `client/app.js`, `/api/rates` |
| 1.3 | **Read** snapshot before LiteAPI; on hit **write through** to in-memory `_ratesResultCache` | Low | `lib/lite-rates.js` |
| 1.4 | **Align** `RATES_CACHE_TTL_MS` with snapshot TTL (e.g. 30 min) | Low | `render.yaml`, `lib/lite-rates.js` |
| 1.5 | **Dated vsearch:** await **full** rates (cache/snapshot hit = instant); remove 8s race that returns without embed | Low | `scripts/search-v2.js` |
| 1.6 | **Dedupe** prefetch + vsearch via single `_ratesInflight` + full cache key | Low | `lib/lite-rates.js` |
| 1.7 | **Client:** if `rates.full_city` embedded → no second full-city `fetchPrices` on load | Low | `client/app.js` |

**Flags:** `RATES_SNAPSHOT=1`, `VSEARCH_FULL_RATES_EMBED=1`

---

## Phase 2 — Bookable rank, no swaps

| # | Change | Risk | Touchpoints |
|---|--------|------|-------------|
| 2.1 | **`applyBookableRank()`** after rates merge on `eligibleHotelIds`; keep hotels with price / `roomPrices` | Low–med* | `scripts/search-v2.js` |
| 2.2 | **Server dated sort parity:** `buildDatedDisplayOrder()` mirrors client Best Match after bookable filter (priceMatters, nbhd blend, free-cancel must-have) | Low–med* | `search-v2.js`, `server.js` |
| 2.3 | **Stats (additive only):** `bookable_count`, `ranked_total`, `rates_as_of`, optional `hero_hotel_id`, `unbookable_vibe_count` — **keep full `query_router` / intent in stats** (no trimming) | Low | vsearch `stats` |
| 2.4 | **Client dated Best Match:** trust API order on first paint; no load-time `renderSortedSmooth` or `hotelPassesAvailFilter` | Low | `client/app.js` |
| 2.5 | **No auto `_showAvailOnly`** on load; list is bookable-first | Low | `applyPrices()` |
| 2.6 | **User sort modes** (Price, Match+Price, etc.): user-initiated only | Low | `getSortedHotelsForDisplay()` |
| 2.7 | **Background detail pass** after first paint: `RATES_DETAIL` for top **50** ranked ids (room `offerIds`) | Low | `lib/lite-rates.js`, client idle hook |
| 2.8 | **`match_breakdown` only top K** (e.g. **25**) full cards; omit on compact tail / lower ranks | Low | `search-v2.js`, `match-breakdown` call sites |

\*Phase 2 sort parity is the highest-risk item in this plan; mitigated by fixture tests (T5) and golden-query QA.

**Flags:** `VSEARCH_BOOKABLE_RANK=1`, optional `VSEARCH_MATCH_BREAKDOWN_TOPN=25`

---

## Phase 3 — Warm speed (low risk only)

| # | Change | Risk | Touchpoints |
|---|--------|------|-------------|
| 3.1 | **Prefetch:** date confirm (existing) + best-effort on city select (+14/+3 nights) | Low | `client/app.js` |
| 3.2 | **`GET /api/warm-v2-city?city=`** — load phase-A cache during Boop; rate-limited | Low | `server.js`, `search-v2.js` |
| 3.3 | **Warm endpoint also preloads** `neighborhoods` rows for city into nbhd L1 (pairs with `NBHD_BOOP_CACHE`) | Low | `server.js`, `lib/nbhd-boop-cache.js` |
| 3.4 | **Extend `PHASE_A_TTL_MS`** 5 min → **15 min** | Low | `scripts/search-v2.js` |
| 3.5 | **Bookable payload diet** (dated + full snapshot): full cards top 250; compact rows for remaining **bookable** ids; stat `unbookable_vibe_count` | Low | `shapeVsearchHotelPayload` |
| 3.6 | **gzip/brotli** on `/api/vsearch` JSON | Low | `server.js` / Render |
| 3.7 | **Defer nbhd map** render until after `revealResultsWhenReady` (`requestIdleCallback` or ~100ms timeout) | Low | `client/app.js` |
| 3.8 | **Ops:** Render min 1 instance / keep-alive for beta | Low | Render config |

**Flags:** `V2_WARM_CITY=1`, `VSEARCH_BOOKABLE_PAYLOAD=1`

---

## Phase 4 — Cold tuning (env only, low risk)

| Knob | Action |
|------|--------|
| `RATES_MAIN_CONCURRENCY` | Tune 10 → 12 if 429s rare |
| `RATES_MAIN_CHUNK` | Re-benchmark 250–300 for Paris |
| No partial embed; no cohort+tail UX | — |

---

## Rollout & rollback

| Order | Enable | Rollback |
|-------|--------|----------|
| 1 | `RATES_SNAPSHOT` + embed + dedupe (Phase 1) | Flag off → legacy double-fetch |
| 2 | `VSEARCH_BOOKABLE_RANK` (Phase 2) | Flag off → client re-sort (swap risk returns) |
| 3 | Warm + payload + gzip (Phase 3) | Per-flag off |

---

## Performance estimates

### Baseline (measured, production Render)

| Metric | Paris | Mexico City |
|--------|------:|------------:|
| Hotels in vsearch | ~4,975 | ~3,497 |
| Payload (compact tail) | ~2.64 MB | ~2.19 MB |
| **Warm p50** (client wall) | ~**3.6s** | ~**3.4s** |
| **Cold dated** (snapshot miss) | ~12–14s (+ double-fetch up to ~20s) | ~9–12s |
| Cold LiteAPI full-city | ~4–10s | ~6–9s |
| Phase-A cold | ~2–3s | ~2–30s (variance) |

*Warm = same-instance phase-A + in-memory rates cache hit.*

### Target (this plan, all phases)

| Metric | Paris | Mexico City |
|--------|------:|------------:|
| **Warm p50** (stable bookable #1) | **~2.0–2.8s** | **~1.8–2.5s** |
| **Warm p90** | ~3.0–4.0s | ~2.8–3.5s |
| **Cold p50** (snapshot miss, one hop) | **~10–14s** | **~8–12s** |
| **Cold E2E worst** vs today ~20s+ | **~10–14s** single wait | **~8–12s** |
| **After date prefetch** (snapshot hit) | **~2–3s** | **~2–3s** |

### Incremental gains by phase (approx)

| Phase | Paris warm | Paris cold | MX warm | MX cold |
|-------|------------|------------|---------|---------|
| 1 — snapshot + one embed | Cross-instance warm; −5–10s E2E vs double wait | −0–4s handler; big E2E win | Same | Same |
| 2 — bookable rank | Stable #1 (correctness) | Stable #1 | Same | Same |
| 3 — payload + gzip + defer map + phase-A TTL | **−0.5–1.2s** | −0.3–0.8s parse | **−0.4–1.0s** | −0.2–0.6s |
| 2.8 — breakdown top 25 | **−0.1–0.3s** parse | Same | **−0.1–0.2s** | Same |
| 4 — LiteAPI env | — | **−0.5–1.5s** | — | **−0.5–1.0s** |

---

## Explicitly out of scope (this plan)

| Item | Reason |
|------|--------|
| **Trim / slim `stats.query_router` or intent** | UX/debug complications; full stats preserved |
| Cohort embed + tail UX | #1 swap risk |
| `search-sessions` / SSE / `rank_version` | Deferred post-beta |
| Catalog trim (~1.5k Paris) | Optional quality/cost follow-up |
| Durable phase-A Supabase snapshot | Medium risk / size |
| Parallel meta vs rates overlap | Medium ordering risk |
| Rates snapshot cron | Medium cost/ops |
| `POST /api/vsearch` | Medium contract change |
| HTTP keep-alive for LiteAPI | Low–med; revisit if cold still high after Phase 4 |
| Phase 2b “unbookable matches” UI section | Optional product follow-up |

---

## Risks & mitigations (summary)

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | Server #1 ≠ client Best Match | `buildDatedDisplayOrder()` + T5 parity tests |
| R2 | Avail toggle default off | Copy: “X bookable for your dates”; optional rename toggle |
| R3 | Unbookable vibe matches hidden | `stats.unbookable_vibe_count`; optional Phase 2b UI later |
| R4 | Stale snapshot prices | `stats.rates_as_of`; 30m TTL; WL checkout is source of truth |
| R5 | Search before prefetch done | Prefetch status UI; deduped inflight; optional 0–2s soft delay on CTA |
| R6 | LiteAPI outage | Vibe-only fallback + banner; no false “bookable #1” |
| R7 | Free-cancel must-have | Filter in `applyBookableRank()` |
| R8 | SearchResultsV2 curated unbookable | Picks from bookable-ordered list only |
| R9 | Missing room `offerIds` at paint | Background detail pass top 50 (2.7) |
| R10 | Meta / priceMatters order | Meta fetch after bookable reorder |
| R11 | Geo filter | Bookable rank on `eligibleHotelIds` only |
| R12 | Long cold TTFB | Loading copy; gzip; monitor 504 p99 |
| R13 | Snapshot licensing | Minimal fields; TTL; purge job |
| R14 | Warm endpoint abuse | Rate limit + gate |
| R15 | Tests / debug drift | Update audits; debug snapshot fields additive only |

Full narrative for R1–R15 retained in git history; see prior doc revision if needed.

---

## UX copy changes

| Element | After |
|---------|-------|
| Loading (dated) | “Finding bookable matches for your dates…” |
| Result count | “142 bookable for your dates” (+ unbookable note in stats-driven suffix) |
| Avail toggle | Off by default; list already bookable-first |
| Rates status | “✓ Rates checked at …” via `rates_as_of` |
| Rates outage | Banner + vibe-only fallback |

---

## Test plan (launch gates)

### Automated

| ID | Test | Pass |
|----|------|------|
| T1 | `test-search-quality.js` | Green |
| T2 | `test-mx-boop-qa.js` | Hero stable + bookable |
| T3 | `test-search-results-v2-logic.js` | Curated picks bookable with dates |
| T4 | `test-rates-snapshot-logic.js` (new) | Key, TTL, merge, dedupe, L1 write-through |
| T5 | `test-bookable-rank-parity.js` (new) | Server #1 === client #1 on fixtures |
| T6 | `audit-vsearch-perf.js --dates` Paris + MX | Warm p50 ≤3s; cold single fetch; no duplicate `/api/rates` |

### Manual

| ID | Check |
|----|-------|
| M1 | `#1` hotel id unchanged 10s post-paint |
| M2 | `#1` has price + bookable row |
| M3 | Full `stats.query_router` still present for debug / fine-tune flows |
| M4 | Date prefetch → second search ~2–3s |
| M5 | Free-cancel must-have respected |
| M6 | User sort modes only change order on user action |
| M7 | Rates outage → banner, no blank page |
| M8 | Breakdown panel works on top 25; absent on stub tail (expected) |

---

## Env knobs

| Var | Default → ship | Purpose |
|-----|----------------|---------|
| `RATES_SNAPSHOT` | `0` → `1` | Supabase rates snapshot |
| `RATES_SNAPSHOT_TTL_MS` | `1800000` | 30 min |
| `RATES_CACHE_TTL_MS` | `180000` → `1800000` | In-memory aligned with snapshot |
| `VSEARCH_FULL_RATES_EMBED` | `0` → `1` | Await full rates |
| `VSEARCH_BOOKABLE_RANK` | `0` → `1` | Server bookable order |
| `VSEARCH_BOOKABLE_PAYLOAD` | `0` → `1` | Bookable-only tail in body |
| `VSEARCH_MATCH_BREAKDOWN_TOPN` | `25` | Breakdown on top N only |
| `V2_WARM_CITY` | `0` → `1` | Phase-A + nbhd warm |
| `PHASE_A_TTL_MS` | `300000` → `900000` | 15 min phase-A cache |
| `RATES_MAIN_CONCURRENCY` | `10` | Cold LiteAPI tuning |
| `NBHD_BOOP_CACHE` | `1` | Already on — keep |
| `VSEARCH_SLIM_STUBS` / `VSEARCH_COMPACT_TAIL` | `1` | Already on — keep |

---

## Deferred architecture (post-beta)

**Server-owned rank + tiered rates + patch-only hydration + `rank_version`** — see collapsed sketch in prior commits. Cohort+tail **rejected** for swap risk.

```
POST /api/search-sessions  →  rank_version, ranked_ids[], cards[], rates_status
```

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-04 | Initial doc: deferred session architecture + cohort interim. |
| 2026-06-04 | Bookable-first plan; risks; test gates. |
| 2026-06-04 | **Full plan revision:** low-risk add-ons only; **no stats trim**; performance tables; explicit out-of-scope; phases 0–4 consolidated. |
