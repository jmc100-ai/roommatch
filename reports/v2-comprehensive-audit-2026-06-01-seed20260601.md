# V2 Comprehensive QA Report (150 searches)

- **Date:** 2026-06-01
- **Base URL:** https://roommatch-1fg5.onrender.com
- **Seed:** 20260601
- **Search cases:** 150/150 ok (0 errors)
- **Detail pages sampled:** 30 (0 with issues)
- **Cities:** Mexico City + Paris
- **Dated searches:** 91

## Executive summary

Ran **150** Boop-style V2 searches (stratified grid + random) across Mexico City and Paris with varied trip type, stay vibe, neighbourhood scene, price slider, optional dates, must-haves, and freetext. Audited **30** hotel detail pages from random top-result samples. Found **3** high-severity issue categories (**125** instances). **No fixes applied** — see labeled fix catalog at end.

## Performance (instrumented)

| Metric | p50 | p90 | max |
|--------|-----|-----|-----|
| vsearch client (full response) | 9946 | 15109 | 18698 |
| server handler_wall_ms | 9820 | 14907 | 18517 |
| server wall_ms (v2 perf) | 6721 | 8940 | 13302 |
| phase-A DB | 1330 | 3104 | 3104 |
| phase-B parallel | 2309 | 3520 | 8089 |
| NLP intent | 67 | 868 | 1102 |
| meta sync (top names) | 8 | 95 | 1096 |
| rates embed (in vsearch) | 11956 | 14047 | 17077 |
| end-to-end case (vsearch+rates) | 9961 | 30573 | 42928 |

- Deferred meta IDs (lazy client fetch): median **0**, p90 **0**
- Sync meta count (names on first paint): median **35**

_Interpretation:_ `meta_sync_ms` ≈ time until top ~30 cards have names; full `client_ms` includes Phase-B photos for ~250 hotels + optional embedded rates.

## Results by issue category

### `DISPLAY_VS_LEGACY_SORT_ROOM` (high) — 69 hit(s)

- **grid_009** (Mexico City): #1 lpb6b6f badge=65% legacySortRoom=0%
- **grid_009** (Mexico City): #2 lp65583727 badge=57% legacySortRoom=0%
- **grid_009** (Mexico City): #5 lpa8229 badge=51% legacySortRoom=0%
- **grid_009** (Mexico City): #8 lp53aa8 badge=68% legacySortRoom=0%
- **grid_009** (Mexico City): #10 lp740a5 badge=16% legacySortRoom=0%
- **grid_019** (Mexico City): #1 lpb6b6f badge=81% legacySortRoom=0%
- _…and 63 more_

### `SORT_NON_MONOTONIC` (high) — 55 hit(s)

- **grid_003** (Mexico City): #3 lp740a5 sort=80.6 > #4 lp6585d08e sort=71.0
- **grid_004** (Mexico City): #10 lp1ded84 sort=89.7 > #11 lp657817ba sort=88.1
- **grid_006** (Mexico City): #14 lp6580361f sort=75.2 > #15 lp65887e65 sort=60.4
- **grid_008** (Mexico City): #3 lp6584bf96 sort=77.5 > #4 lp656c9978 sort=57.2
- **grid_009** (Mexico City): #3 lp3721c sort=83.1 > #4 lpbae82 sort=82.5
- **grid_012** (Mexico City): #3 lp655bb5d9 sort=76.4 > #4 lp656c9dca sort=57.2
- _…and 49 more_

### `ROOM_GAP_IGNORED` (high) — 1 hit(s)

- **rnd_110** (Paris): #7 lp1ebcf room=82 beats #8 lp1f42a room=98

### `NBHD_BLEND_SPARSE` (medium) — 57 hit(s)

- **grid_005** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- **grid_007** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- **grid_010** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- **grid_011** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- **grid_013** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- **grid_017** (Mexico City): only 0/10 have nbhd_fit_pct with blend on
- _…and 51 more_

### `STUB_HEAVY_TOP10` (medium) — 15 hit(s)

- **grid_008** (Mexico City): 5/10 cards lack room photos
- **grid_012** (Mexico City): 5/10 cards lack room photos
- **grid_026** (Mexico City): 5/10 cards lack room photos
- **grid_040** (Mexico City): 4/10 cards lack room photos
- **grid_060** (Mexico City): 4/10 cards lack room photos
- **grid_066** (Paris): 9/10 cards lack room photos
- _…and 9 more_

### `FIXED_VS_LEGACY_TOP3` (medium) — 2 hit(s)

- **grid_079** (Paris): fixed=[lpc1bda,lp5d025,lp656ce458] legacy=[lpc1bda,lp1c508,lp5d025]
- **rnd_094** (Paris): fixed=[lp1fbd3,lp5f2b9,lp65729ea3] legacy=[lp1fbd3,lp2b678,lp5f2b9]

### `WEAK_NAME_TOP5` (low) — 110 hit(s)

- **grid_004** (Mexico City): #3 lp85197
- **grid_004** (Mexico City): #5 lp657b45c9
- **grid_006** (Mexico City): #4 lp656c99aa
- **grid_006** (Mexico City): #5 lp6558421e
- **grid_008** (Mexico City): #1 lp8412d
- **grid_008** (Mexico City): #2 lpfc697
- _…and 104 more_

### `VIBE_SCORE_SPARSE_TOP10` (low) — 63 hit(s)

- **grid_005** (Mexico City): only 0/10 top hotels have hotelScore>0
- **grid_007** (Mexico City): only 0/10 top hotels have hotelScore>0
- **grid_010** (Mexico City): only 0/10 top hotels have hotelScore>0
- **grid_011** (Mexico City): only 0/10 top hotels have hotelScore>0
- **grid_013** (Mexico City): only 0/10 top hotels have hotelScore>0
- **grid_017** (Mexico City): only 0/10 top hotels have hotelScore>0
- _…and 57 more_

### `API_VS_CLIENT_TOP3` (info) — 102 hit(s)

- **grid_004** (Mexico City): api=[lp6557b7ec,lp658695f9,lp656c9750] client=[lp6557b7ec,lp10f642,lp85197]
- **grid_005** (Mexico City): api=[lp575cf,lp246dd,lp23189] client=[]
- **grid_007** (Mexico City): api=[lp65573614,lp2f760,lp23157] client=[]
- **grid_009** (Mexico City): api=[lpb6b6f,lp65583727,lp3721c] client=[lpb6b6f,lp65583727,lpbae82]
- **grid_010** (Mexico City): api=[lp3873de,lpb2ab9,lp656c9978] client=[]
- **grid_011** (Mexico City): api=[lp1f6a78,lp1ce969,lp65573614] client=[]
- _…and 96 more_

## City breakdown

- **Mexico City:** 97 cases, avg 12891ms, 49 high-severity findings
- **Paris:** 53 cases, avg 15968ms, 76 high-severity findings

## Sample cases (first 8 with findings)

### grid_003 — Mexico City, stay=sleek_polished, nbhd=hip_local
- Perf: client=6904ms wall=6630ms meta_sync=16ms
- Findings: SORT_NON_MONOTONIC

### grid_004 — Mexico City, stay=sleek_polished, nbhd=leafy_local, 2026-07-04→2026-07-10
- Perf: client=13222ms wall=5106ms meta_sync=4ms
- Findings: SORT_NON_MONOTONIC, API_VS_CLIENT_TOP3, WEAK_NAME_TOP5, WEAK_NAME_TOP5

### grid_005 — Mexico City, stay=sleek_polished, nbhd=scenic_open, 2026-07-04→2026-07-10
- Perf: client=4280ms wall=3985ms meta_sync=98ms
- Findings: API_VS_CLIENT_TOP3, VIBE_SCORE_SPARSE_TOP10, NBHD_BLEND_SPARSE

### grid_006 — Mexico City, stay=cozy_warm, nbhd=buzz_central
- Perf: client=4393ms wall=3925ms meta_sync=105ms
- Findings: SORT_NON_MONOTONIC, WEAK_NAME_TOP5, WEAK_NAME_TOP5

### grid_007 — Mexico City, stay=cozy_warm, nbhd=calm_central, 2026-07-17→2026-07-22
- Perf: client=12027ms wall=5015ms meta_sync=6ms
- Findings: API_VS_CLIENT_TOP3, VIBE_SCORE_SPARSE_TOP10, NBHD_BLEND_SPARSE

### grid_008 — Mexico City, stay=cozy_warm, nbhd=hip_local
- Perf: client=5107ms wall=4717ms meta_sync=101ms
- Findings: SORT_NON_MONOTONIC, STUB_HEAVY_TOP10, WEAK_NAME_TOP5, WEAK_NAME_TOP5, WEAK_NAME_TOP5

### grid_009 — Mexico City, stay=cozy_warm, nbhd=leafy_local, 2026-07-03→2026-07-08
- Perf: client=12079ms wall=3960ms meta_sync=2ms
- Findings: SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3

### grid_010 — Mexico City, stay=cozy_warm, nbhd=scenic_open, 2026-07-05→2026-07-07
- Perf: client=13294ms wall=6218ms meta_sync=57ms
- Findings: API_VS_CLIENT_TOP3, VIBE_SCORE_SPARSE_TOP10, NBHD_BLEND_SPARSE

## Fix catalog (NOT implemented — for later triage)

### F1. Align Best Match sort with room badge display — **TRIGGERED**
- **Risk:** Low
- **Area:** client/app.js + lib/client-match-sort.js
- **Proposed fix:** Use bestMatchRoomScore()/roomVibeMatchDisplayPct() for sort when avail filter is on; never hotelEffectiveScore().
- **Related codes:** DISPLAY_VS_LEGACY_SORT_ROOM

### F2. Tune live-rate nudge / nbhd guard — **TRIGGERED**
- **Risk:** Medium
- **Area:** lib/client-match-sort.js
- **Proposed fix:** Adjust MATCH_LIVE_RATE_NUDGE_MAX and BOOP_PRICE_NBHD_GAP_GUARD when priceMatters neutral.
- **Related codes:** ROOM_GAP_IGNORED

### F3. Property-type penalty for hostel × sleek — not observed
- **Risk:** Low
- **Area:** scripts/search-v2.js
- **Proposed fix:** Verify stayVibe property_type multiplier in search-v2.js is deployed.

### F4. Stub hotels in top 10 — **TRIGGERED**
- **Risk:** Medium
- **Area:** scripts/search-v2.js + client
- **Proposed fix:** Expand Phase-B gallery or lazy-fetch room photos for priced top hotels before first paint.
- **Related codes:** STUB_HEAVY_TOP10

### F5. Deferred hotel metadata — **TRIGGERED**
- **Risk:** Low
- **Area:** server.js search-v2 meta fetch
- **Proposed fix:** Raise META_SYNC_LIMIT for Boop or prefetch meta for client-sorted top 30.
- **Related codes:** WEAK_NAME_TOP5

### F6. Hotel vibe model not applying stayVibe — not observed
- **Risk:** Medium
- **Area:** scripts/search-v2.js + fact-catalog
- **Proposed fix:** Ensure mergeStayVibeIntoIntent runs and score_hotels_facts_v2 receives visual_style weights.

### F7. Neighbourhood fit gaps — **TRIGGERED**
- **Risk:** Medium
- **Area:** Supabase + neighborhood-generator
- **Proposed fix:** Verify get_primary_nbhds_for_hotels RPC coverage; regen neighbourhoods if Paris incomplete.
- **Related codes:** NBHD_BLEND_SPARSE

### F8. API order ≠ UI Best Match — **TRIGGERED**
- **Risk:** Info
- **Area:** docs / debug snapshot
- **Proposed fix:** Document server primarySignal vs client re-sort; optional debug export of getSortedHotelsForDisplay().
- **Related codes:** API_VS_CLIENT_TOP3

### F9. Alternate sort modes broken — not observed
- **Risk:** High
- **Area:** client/app.js
- **Proposed fix:** Audit getSortedHotelsForDisplay() branches for price/rating/stars.

### F10. Hotel detail page missing data — not observed
- **Risk:** Medium
- **Area:** /api/hotel/:id
- **Proposed fix:** Check LiteAPI live-fetch + v2_room_inventory coverage for sampled hotels.

### F11. Best Match sort inversions — **TRIGGERED**
- **Risk:** High
- **Area:** lib/client-match-sort.js
- **Proposed fix:** Review sortScore tiebreaker stack in client-match-sort.js.
- **Related codes:** SORT_NON_MONOTONIC

### F12. Legacy sort still diverges — **TRIGGERED**
- **Risk:** Low
- **Area:** lib/client-match-sort.js
- **Proposed fix:** Remove legacy path or gate behind debug flag once fixed sort verified.
- **Related codes:** FIXED_VS_LEGACY_TOP3

### F13. Playwright UI audit blocked by consent modal — **TRIGGERED (test harness)**
- **Risk:** Low (test infra only)
- **Area:** tests/audit-v2-ui-journey.spec.js
- **Proposed fix:** Dismiss `#beta-consent` / “Sounds good — let's explore” before city autocomplete; update selectors (`#cityInput` vs landing textbox); set `SITE_PASSWORD` + `PLAYWRIGHT_BASE_URL` in `.env`.
- **Related codes:** _(UI layer not reached — 0/8 Playwright scenarios completed)_

### F14. Avail filter zero-result dated searches — **TRIGGERED**
- **Risk:** Medium (UX)
- **Area:** client avail filter + LiteAPI rates coverage
- **Proposed fix:** When `pricedCount=0` or post-filter visible set is empty, show empty-state with “No bookable rooms for these dates” instead of blank results; consider relaxing default _Available only_ when rates return 0 priced hotels.
- **Related codes:** NBHD_BLEND_SPARSE, VIBE_SCORE_SPARSE_TOP10, API_VS_CLIENT_TOP3 (57/150 cases had **0 visible hotels** after avail filter)

## UI browser audit (Playwright — 8 scenarios, not completed)

Attempted live UI journey tests against `https://www.travelbyvibe.com` for 8 query/city combos (4 Mexico City, 4 Paris). **All 8 failed** before search: beta consent modal blocked interaction; city autocomplete dropdown never opened (test used `#cityDropdown .city-option` while landing page uses a different flow). **No production UI bugs confirmed** in this pass — harness needs F13 before UI timing can be measured.

**Scripts created for re-run:**
- `node scripts/audit-v2-comprehensive-suite.js --count=150 --seed=20260601` (API + detail pages — this report)
- `npx playwright test tests/audit-v2-ui-journey.spec.js` (after F13)
