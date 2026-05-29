# Random Search QA Report (100 searches)

- **Date:** 2026-05-27
- **Base URL:** https://roommatch-1fg5.onrender.com
- **Seed:** 3693595482
- **Completed:** 100/100 (0 errors)
- **Cities:** Mexico City + Paris
- **Dated searches:** 58
- **Sort model:** Client Best Match (lib/client-match-sort.js)
- **Case generation:** 100% random (no stratified grid)

## Executive summary

Ran **100** Boop-style searches with varied trip type, stay vibe, neighbourhood scene, price slider, and optional dates. Found **4** high-severity issue categories (301 instances), **2** medium-severity categories. No fixes applied in this pass — see *Possible fixes* below.

## Test plan

Each case:
1. Builds a Boop profile (trip, stayVibe, nbhdScene, group_size, priceMatters ±100, optional must-haves / freetext).
2. Calls `GET /api/vsearch` (V2) with `boop_profile`.
3. When dates set (~52%): `GET /api/rates`, merges prices, enables *Available only* when `pricedCount > 0`.
4. Re-sorts with **Best Match** client logic (room vibe % + nbhd blend + Boop price guards + live-rate nudge).
5. Checks invariants vs design: room dominance, nbhd tiebreaks, expensive #1 outliers, display/sort alignment, data completeness.

## Results by issue category

### `DISPLAY_VS_LEGACY_SORT_ROOM` (high) — 225 hit(s)

- **rnd_001** (Paris): #1 lpfd01d badge=92% legacySortRoom=0% (Paris Pullman class bug)
- **rnd_001** (Paris): #2 lp1f980 badge=84% legacySortRoom=0% (Paris Pullman class bug)
- **rnd_001** (Paris): #3 lp656ce458 badge=92% legacySortRoom=0% (Paris Pullman class bug)
- **rnd_001** (Paris): #7 lp2093b9 badge=67% legacySortRoom=0% (Paris Pullman class bug)
- **rnd_003** (Paris): #2 lp33a9e badge=99% legacySortRoom=56% (Paris Pullman class bug)
- **rnd_003** (Paris): #5 lp65867b4a badge=51% legacySortRoom=34% (Paris Pullman class bug)
- **rnd_003** (Paris): #6 lp7326a badge=95% legacySortRoom=37% (Paris Pullman class bug)
- **rnd_003** (Paris): #7 lp1f399 badge=58% legacySortRoom=41% (Paris Pullman class bug)
- _…and 217 more_

### `SORT_NON_MONOTONIC` (high) — 68 hit(s)

- **rnd_001** (Paris): #6 lp2093b9 sort=66.2 > #7 lp2ab9a sort=51.6
- **rnd_003** (Paris): #3 lp9d2d7 sort=93.1 > #4 lp1b77b sort=81.9
- **rnd_004** (Mexico City): #3 lp65584c0c sort=91.6 > #4 lp6ba04 sort=87.8
- **rnd_005** (Mexico City): #3 lp21414 sort=74.0 > #4 lp73122 sort=73.8
- **rnd_007** (Mexico City): #2 lp65583727 sort=88.0 > #3 lpb6b6f sort=86.9
- **rnd_008** (Mexico City): #3 lp6557c3e1 sort=95.7 > #4 lp65573614 sort=90.6
- **rnd_009** (Mexico City): #3 lp65855653 sort=92.1 > #4 lp740a5 sort=90.8
- **rnd_011** (Paris): #7 lp6559104e sort=64.8 > #8 lp65493 sort=60.4
- _…and 60 more_

### `ROOM_GAP_IGNORED` (high) — 7 hit(s)

- **rnd_007** (Mexico City): #4 lp53aa8 room=72 beats #7 lp65573614 room=100 (nbhd ~equal)
- **rnd_007** (Mexico City): #4 lp53aa8 room=72 beats #8 lp4bab4 room=90 (nbhd ~equal)
- **rnd_029** (Paris): #6 lp2ab9a room=75 beats #8 lp1fbd3 room=92 (nbhd ~equal)
- **rnd_067** (Mexico City): #2 lp86fee room=56 beats #6 lp3158b room=71 (nbhd ~equal)
- **rnd_074** (Mexico City): #3 lp1ce969 room=72 beats #7 lp4bab4 room=88 (nbhd ~equal)
- **rnd_074** (Mexico City): #4 lp234e5 room=56 beats #7 lp4bab4 room=88 (nbhd ~equal)
- **rnd_079** (Mexico City): #4 lp65573614 room=81 beats #6 lp1ce969 room=96 (nbhd ~equal)

### `EXPENSIVE_OUTLIER_#1` (high) — 1 hit(s)

- **rnd_080** (Mexico City): #1 lpaef30 $145/n vs med $48 room=31% bestIn10=65%

### `FIXED_VS_LEGACY_TOP3` (medium) — 35 hit(s)

- **rnd_003** (Paris): fixed=[lpc1bda,lp33a9e,lp1b77b] legacy=[lpc1bda,lp1b77b,lp9d2d7]
- **rnd_004** (Mexico City): fixed=[lp65555bd7,lpdaa8c,lp6ba04] legacy=[lp65555bd7,lp3c781,lp3385a0]
- **rnd_005** (Mexico City): fixed=[lp656c9ed6,lpb6b6f,lp73122] legacy=[lp73122,lp6558215b,lp656785a8]
- **rnd_009** (Mexico City): fixed=[lp10f642,lp1ded84,lp740a5] legacy=[lp10f642,lp1ded84,lp65855653]
- **rnd_011** (Paris): fixed=[lp6e8e9,lp1be32,lpada38] legacy=[lpada38,lp656ce430,lp65493]
- **rnd_013** (Mexico City): fixed=[lp6557b7ec,lp3e1a2,lp6558ab62] legacy=[lp6557b7ec,lp10f642,lp656c9f51]
- **rnd_015** (Mexico City): fixed=[lp234e5,lp2f760,lp65573614] legacy=[lp21414,lp65583932,lp234e5]
- **rnd_018** (Mexico City): fixed=[lp6557b7ec,lp65576030,lp10f642] legacy=[lp6557b7ec,lp10f642,lp655ae9e4]
- _…and 27 more_

### `STUB_HEAVY_TOP10` (medium) — 14 hit(s)

- **rnd_001** (Paris): 4/10 cards lack room photos
- **rnd_011** (Paris): 5/10 cards lack room photos
- **rnd_021** (Paris): 8/10 cards lack room photos
- **rnd_023** (Mexico City): 6/10 cards lack room photos
- **rnd_025** (Mexico City): 4/10 cards lack room photos
- **rnd_026** (Mexico City): 5/10 cards lack room photos
- **rnd_044** (Paris): 7/10 cards lack room photos
- **rnd_048** (Paris): 4/10 cards lack room photos
- _…and 6 more_

### `WEAK_NAME_TOP5` (low) — 80 hit(s)

- **rnd_001** (Paris): #4 lp3f518
- **rnd_001** (Paris): #5 lp55487
- **rnd_005** (Mexico City): #2 lpb6b6f
- **rnd_005** (Mexico City): #3 lp73122
- **rnd_005** (Mexico City): #5 lp6558215b
- **rnd_011** (Paris): #2 lp1be32
- **rnd_011** (Paris): #3 lpada38
- **rnd_011** (Paris): #4 lp1d5ea
- _…and 72 more_

### `API_VS_CLIENT_TOP3` (info) — 59 hit(s)

- **rnd_003** (Paris): api=[lp29c41,lpc1bda,lp33a9e] client=[lpc1bda,lp33a9e,lp1b77b]
- **rnd_004** (Mexico City): api=[lp72e20,lp65584c0c,lp65555bd7] client=[lp65555bd7,lpdaa8c,lp6ba04]
- **rnd_005** (Mexico City): api=[lp6558421e,lp656c9978,lp110b76] client=[lp656c9ed6,lpb6b6f,lp73122]
- **rnd_007** (Mexico City): api=[lp740a5,lp65583727,lpb6b6f] client=[lp740a5,lpb6b6f,lp65583727]
- **rnd_008** (Mexico City): api=[lp6557c3e1,lp65583727,lpbae82] client=[lp3721c,lp53aa8,lp65573614]
- **rnd_009** (Mexico City): api=[lp65770deb,lp65577ecf,lp65582fc6] client=[lp10f642,lp1ded84,lp740a5]
- **rnd_011** (Paris): api=[lp6588e568,lp6e8e9,lp6588f405] client=[lp6e8e9,lp1be32,lpada38]
- **rnd_012** (Paris): api=[lp6f7a6,lp37617,lp3ed9b] client=[lp6f7a6,lp1bbc1,lp37617]
- _…and 51 more_

### `AVAIL_FILTER_SHRINK` (info) — 58 hit(s)

- **rnd_001** (Paris): 4975 → 100 visible (2%)
- **rnd_003** (Paris): 4975 → 90 visible (2%)
- **rnd_004** (Mexico City): 3497 → 73 visible (2%)
- **rnd_005** (Mexico City): 3497 → 58 visible (2%)
- **rnd_007** (Mexico City): 3497 → 60 visible (2%)
- **rnd_008** (Mexico City): 3497 → 42 visible (1%)
- **rnd_009** (Mexico City): 3497 → 68 visible (2%)
- **rnd_011** (Paris): 4975 → 113 visible (2%)
- _…and 50 more_

## Sample top-5 rankings (first 12 cases)

### rnd_001 — Paris, trip=expert, stay=simple_value, nbhd=hip_local, pm=50, 2026-06-26→2026-07-01
- 1. Les cles du 27 Paris (lpfd01d) room=92% disp=92% nbhd=95% $274
- 2. Timhotel Opéra Blanche Fontaine (lp1f980) room=84% disp=84% nbhd=95% $206
- 3. 1.75 Paris La Source (lp656ce458) room=92% disp=92% nbhd=95% $903
- 4. lp3f518 (lp3f518) room=92% disp=92% nbhd=51% $316
- 5. lp55487 (lp55487) room=87% disp=87% nbhd=51% $443
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, STUB_HEAVY_TOP10, WEAK_NAME_TOP5, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### rnd_002 — Paris, trip=first, stay=simple_value, nbhd=leafy_local, pm=-80, no dates
- 1. Mandarin Oriental Lutetia, Paris (lpc1bda) room=100% disp=100% nbhd=95% —
- 2. Mandarin Oriental, Paris (lp5d025) room=96% disp=96% nbhd=95% —
- 3. Le Metropolitan, Paris Tour Eiffel,  (lp1f42a) room=96% disp=96% nbhd=95% —
- 4. Grand Hôtel Du Palais Royal (lp86c7c) room=95% disp=95% nbhd=95% —
- 5. Hotel Marignan Champs-Elysées (lp1c508) room=93% disp=93% nbhd=95% —

### rnd_003 — Paris, trip=first, stay=distinct_unique, nbhd=calm_central, pm=-100, 2026-07-02→2026-07-06
- 1. Mandarin Oriental Lutetia, Paris (lpc1bda) room=62% disp=62% nbhd=95% $2467
- 2. Hôtel de Berri Champs-Élysées, a Lux (lp33a9e) room=99% disp=99% nbhd=77% $1043
- 3. Hôtel de Crillon A Rosewood Hotel (lp1b77b) room=33% disp=33% nbhd=95% $3978
- 4. Nolinski Paris - Evok Collection (lp9d2d7) room=44% disp=44% nbhd=95% $1140
- 5. Sax Paris, LXR Hotels & Resorts (lp65867b4a) room=51% disp=51% nbhd=95% $929
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

### rnd_004 — Mexico City, trip=repeat, stay=distinct_unique, nbhd=buzz_central, pm=0, 2026-07-05→2026-07-09
- 1. Cadillac Hotel Boutique (lp65555bd7) room=82% disp=82% nbhd=95% $69
- 2. Casa Pepe Hostel Boutique - CDMX (lpdaa8c) room=80% disp=80% nbhd=95% $128
- 3. Gran Hotel Villa de Madrid (lp6ba04) room=72% disp=72% nbhd=95% $93
- 4. Barrio Downtown Mexico City Hostel (lp65584c0c) room=84% disp=84% nbhd=95% $168
- 5. Hotel Fontan Reforma Centro Historic (lp3c781) room=76% disp=76% nbhd=95% $177
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

### rnd_005 — Mexico City, trip=repeat, stay=cozy_warm, nbhd=scenic_open, pm=50, 2026-06-30→2026-07-05
- 1. Casa Altata Hotel Boutique (lp656c9ed6) room=96% disp=96% nbhd=82% $320
- 2. lpb6b6f (lpb6b6f) room=88% disp=88% nbhd=82% $128
- 3. lp73122 (lp73122) room=88% disp=88% nbhd=82% $172
- 4. Sevilla Palace (lp21414) room=79% disp=79% nbhd=95% $179
- 5. lp6558215b (lp6558215b) room=83% disp=83% nbhd=79% $110
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, WEAK_NAME_TOP5, WEAK_NAME_TOP5, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### rnd_006 — Paris, trip=expert, stay=distinct_unique, nbhd=buzz_central, pm=-50, no dates
- 1. Hôtel Les Artistes (lp6557917d) room=98% disp=98% nbhd=86% —
- 2. Maison Colbert member of Meliá Colle (lp1fbd3) room=78% disp=78% nbhd=86% —
- 3. Novotel Paris 14 Porte d'Orléans (lp2ab9a) room=84% disp=84% nbhd=86% —
- 4. Novotel Paris Centre Bercy (lp2b678) room=49% disp=49% nbhd=95% —
- 5. Hôtel de France Gare de Lyon Bastill (lp5173e) room=48% disp=48% nbhd=95% —

### rnd_007 — Mexico City, trip=first, stay=sleek_polished, nbhd=leafy_local, pm=-30, 2026-07-17→2026-07-22
- 1. Hive Nápoles By G Hotels (lp740a5) room=69% disp=69% nbhd=95% $86
- 2. Distrito Condesa Rooms and Studios (lpb6b6f) room=63% disp=63% nbhd=95% $128
- 3. The Amsterdam Boutique Stays by Viad (lp65583727) room=63% disp=63% nbhd=95% $292
- 4. Las Alcobas, a Luxury Collection Hot (lp53aa8) room=72% disp=72% nbhd=72% $714
- 5. Felix Luxury Plus by Viadora (lpbae82) room=59% disp=59% nbhd=95% $383
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3, ROOM_GAP_IGNORED, ROOM_GAP_IGNORED, AVAIL_FILTER_SHRINK

### rnd_008 — Mexico City, trip=expert, stay=sleek_polished, nbhd=hip_local, pm=-100, 2026-07-08→2026-07-12
- 1. Condesa df, Mexico City, a Member of (lp3721c) room=69% disp=69% nbhd=92% $504
- 2. Las Alcobas, a Luxury Collection Hot (lp53aa8) room=75% disp=75% nbhd=79% $904
- 3. The Ritz-Carlton, Mexico City (lp65573614) room=100% disp=100% nbhd=66% $810
- 4. HOTEL LUCA (lp6557c3e1) room=65% disp=65% nbhd=95% $284
- 5. The Amsterdam Boutique Stays by Viad (lp65583727) room=69% disp=69% nbhd=92% $307
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

### rnd_009 — Mexico City, trip=first, stay=sleek_polished, nbhd=leafy_local, pm=-30, 2026-07-09→2026-07-13
- 1. Hotel Harare (lp10f642) room=76% disp=76% nbhd=95% $59
- 2. VOS Condesa (lp1ded84) room=76% disp=76% nbhd=95% $59
- 3. Hive Nápoles By G Hotels (lp740a5) room=76% disp=76% nbhd=95% $86
- 4. JTowers (lp65855653) room=76% disp=76% nbhd=95% $92
- 5. Be Local Aparthotel (lp656c9d1d) room=76% disp=76% nbhd=95% $97
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

### rnd_010 — Paris, trip=expert, stay=distinct_unique, nbhd=buzz_central, pm=-100, no dates
- 1. Maison Colbert member of Meliá Colle (lp1fbd3) room=92% disp=92% nbhd=86% —
- 2. Novotel Paris Centre Bercy (lp2b678) room=80% disp=80% nbhd=95% —
- 3. Experimental Marais (lp20e3e5) room=66% disp=66% nbhd=95% —
- 4. Hôtel Les Artistes (lp6557917d) room=93% disp=93% nbhd=86% —
- 5. Hôtel de Nell (lp66c96) room=85% disp=85% nbhd=80% —

### rnd_011 — Paris, trip=expert, stay=sleek_polished, nbhd=leafy_local, pm=30, 2026-07-04→2026-07-07
- 1. Kyriad Paris 18 - Porte de Clignanco (lp6e8e9) room=96% disp=96% nbhd=95% $156
- 2. lp1be32 (lp1be32) room=96% disp=96% nbhd=80% $320
- 3. lpada38 (lpada38) room=96% disp=96% nbhd=80% $370
- 4. lp1d5ea (lp1d5ea) room=96% disp=96% nbhd=80% $423
- 5. lp44e9d (lp44e9d) room=96% disp=96% nbhd=78% $424
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, STUB_HEAVY_TOP10, WEAK_NAME_TOP5, WEAK_NAME_TOP5, WEAK_NAME_TOP5, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### rnd_012 — Paris, trip=repeat, stay=simple_value, nbhd=hip_local, pm=-100, 2026-07-17→2026-07-23
- 1. Maison Barbès (lp6f7a6) room=98% disp=98% nbhd=95% $205
- 2. Maison Astor Paris, Curio Collection (lp1bbc1) room=60% disp=60% nbhd=95% $410
- 3. Le Regent Montmartre by Hiphophostel (lp37617) room=100% disp=100% nbhd=95% $172
- 4. Hôtel National Arts et Métiers (lpa4e1c) room=88% disp=88% nbhd=71% $414
- 5. Hotel Elysees Opera (lp19c58) room=66% disp=66% nbhd=95% $228
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

## Possible fixes (not implemented)

### F1. DISPLAY_VS_LEGACY_SORT_ROOM
Ensure production deploys `bestMatchRoomScore()` using `roomVibeMatchDisplayPct()` only; never `hotelEffectiveScore()` for Best Match sort when avail filter is on.
_Triggered by:_ DISPLAY_VS_LEGACY_SORT_ROOM, SORT_NON_MONOTONIC, ROOM_GAP_IGNORED

### F2. EXPENSIVE_OUTLIER_#1 with neutral price slider + dates
Increase `MATCH_LIVE_RATE_NUDGE_MAX` (currently 10) or tighten `MATCH_LIVE_RATE_ROOM_GAP`; optionally tier nudge by price ratio (e.g. 3× median).
_Triggered by:_ EXPENSIVE_OUTLIER_#1

### F3. ROOM_GAP_IGNORED
When `priceMatters` neutral, skip or soften `shouldNbhdGuardYieldToPrice` unless room gap < 8; raise `BOOP_PRICE_NBHD_GAP_GUARD` for neutral pm.
_Triggered by:_ ROOM_GAP_IGNORED

### F4. API_VS_CLIENT_TOP3 divergence
Document that API order is server primarySignal; client re-sorts on render. Optionally align server export order with client Best Match for debug snapshots.
_Triggered by:_ API_VS_CLIENT_TOP3

### F5. Vibe tour ≠ list #1
Open auto vibe tour only after rates + `getSortedHotelsForDisplay()[0]` (local fix in app.js — verify deployed).

### F6. STUB_HEAVY_TOP10 in large cities with dates
Expand Phase-B gallery for priced stubs; lazy-fetch room photos before first paint for top priced hotels.
_Triggered by:_ STUB_HEAVY_TOP10

### F7. VALUE_SLIDER_LUXURY_TOP when pm≥70
Strengthen value penalty for 4★+ when `priceMatters` high; verify `valueSeekingLuxuryLean` uses live price not star proxy when rates exist.

### F8. WEAK_NAME_TOP5
Raise `META_SYNC_LIMIT` for Boop searches or prefetch meta for client-sorted top 30 after sort.
_Triggered by:_ WEAK_NAME_TOP5

### F9. AVAIL_FILTER_SHRINK hides most results
UX: warn when >85% filtered; consider showing unpriced with badge instead of hiding when pricedCount low.
_Triggered by:_ AVAIL_FILTER_SHRINK

### F10. Debug snapshot shows API order not UI order
`copyDebugSnapshot()` should serialize `getSortedHotelsForDisplay()` not `_lastVsearchHotels`.
_Triggered by:_ API_VS_CLIENT_TOP3

## Performance notes

- vsearch wall ms (p50/p90): undefined / undefined
- End-to-end per case ms (p50/p90): 9837 / 15518
