# Random Search QA Report (100 searches)

- **Date:** 2026-05-27
- **Base URL:** https://roommatch-1fg5.onrender.com
- **Seed:** 20260521
- **Completed:** 100/100 (0 errors)
- **Cities:** Mexico City + Paris
- **Dated searches:** 49
- **Sort model:** Client Best Match (lib/client-match-sort.js)

## Executive summary

Ran **100** Boop-style searches with varied trip type, stay vibe, neighbourhood scene, price slider, and optional dates. Found **4** high-severity issue categories (264 instances), **2** medium-severity categories. No fixes applied in this pass — see *Possible fixes* below.

## Test plan

Each case:
1. Builds a Boop profile (trip, stayVibe, nbhdScene, group_size, priceMatters ±100, optional must-haves / freetext).
2. Calls `GET /api/vsearch` (V2) with `boop_profile`.
3. When dates set (~52%): `GET /api/rates`, merges prices, enables *Available only* when `pricedCount > 0`.
4. Re-sorts with **Best Match** client logic (room vibe % + nbhd blend + Boop price guards + live-rate nudge).
5. Checks invariants vs design: room dominance, nbhd tiebreaks, expensive #1 outliers, display/sort alignment, data completeness.

## Results by issue category

### `DISPLAY_VS_LEGACY_SORT_ROOM` (high) — 195 hit(s)

- **grid_001** (Mexico City): #2 lp86fee badge=62% legacySortRoom=46% (Paris Pullman class bug)
- **grid_001** (Mexico City): #10 lp231f5 badge=37% legacySortRoom=0% (Paris Pullman class bug)
- **grid_003** (Mexico City): #1 lpb6b6f badge=73% legacySortRoom=0% (Paris Pullman class bug)
- **grid_003** (Mexico City): #2 lp740a5 badge=70% legacySortRoom=0% (Paris Pullman class bug)
- **grid_003** (Mexico City): #3 lpbae82 badge=70% legacySortRoom=0% (Paris Pullman class bug)
- **grid_003** (Mexico City): #4 lp65583727 badge=53% legacySortRoom=0% (Paris Pullman class bug)
- **grid_003** (Mexico City): #6 lp3b868 badge=14% legacySortRoom=0% (Paris Pullman class bug)
- **grid_005** (Mexico City): #1 lp4bab4 badge=89% legacySortRoom=73% (Paris Pullman class bug)
- _…and 187 more_

### `SORT_NON_MONOTONIC` (high) — 64 hit(s)

- **grid_003** (Mexico City): #5 lp3b868 sort=61.3 > #6 lp6bbed sort=40.9
- **grid_004** (Mexico City): #2 lp740a5 sort=81.3 > #3 lp6585d08e sort=71.0
- **grid_005** (Mexico City): #1 lp65573614 sort=95.2 > #2 lp4bab4 sort=91.8
- **grid_007** (Mexico City): #1 lp656c9782 sort=75.5 > #2 lpfc697 sort=51.4
- **grid_009** (Mexico City): #2 lp4081d sort=94.1 > #3 lp23189 sort=93.4
- **grid_011** (Mexico City): #3 lp3c781 sort=92.5 > #4 lp65555bd7 sort=91.9
- **grid_012** (Mexico City): #4 lp92dcb sort=74.1 > #5 lp6587bbcd sort=49.4
- **grid_013** (Mexico City): #8 lp4bab4 sort=77.8 > #9 lp656c9eb3 sort=73.4
- _…and 56 more_

### `EXPENSIVE_OUTLIER_#1` (high) — 3 hit(s)

- **grid_005** (Mexico City): #1 lp4bab4 $1703/n vs med $300 room=89% bestIn10=100%
- **grid_025** (Mexico City): #1 lp4bab4 $3369/n vs med $102 room=87% bestIn10=97%
- **rnd_047** (Mexico City): #1 lp4bab4 $2735/n vs med $141 room=91% bestIn10=97%

### `ROOM_GAP_IGNORED` (high) — 2 hit(s)

- **grid_009** (Mexico City): #8 lp10f642 room=75 beats #10 lp6559104c room=92 (nbhd ~equal)
- **rnd_078** (Paris): #2 lp5136f room=76 beats #4 lpc1bda room=91 (nbhd ~equal)

### `FIXED_VS_LEGACY_TOP3` (medium) — 28 hit(s)

- **grid_001** (Mexico City): fixed=[lp65573614,lp86fee,lp1f6a78] legacy=[lp65573614,lp1f6a78,lp86fee]
- **grid_005** (Mexico City): fixed=[lp4bab4,lp65573614,lp1f6a78] legacy=[lp65573614,lp4bab4,lp1f6a78]
- **grid_011** (Mexico City): fixed=[lp65584c0c,lp6ba04,lp65555bd7] legacy=[lp65584c0c,lp3c781,lp6ba04]
- **grid_015** (Mexico City): fixed=[lpbb18c,lp65584c0c,lpdaa8c] legacy=[lpbb18c,lpc2d3d,lp656785a8]
- **grid_021** (Mexico City): fixed=[lp6558ae7e,lp724ac,lp1a04a8] legacy=[lp6558ae7e,lp1a04a8,lp8402f]
- **grid_023** (Mexico City): fixed=[lp575cf,lp6557b689,lp231dd] legacy=[lp575cf,lp6557b689,lp65555e40]
- **grid_025** (Mexico City): fixed=[lp4bab4,lp1ce969,lp234e5] legacy=[lp234e5,lp292c6e,lp65583932]
- **grid_031** (Mexico City): fixed=[lp65584c0c,lp65555bd7,lp6ba04] legacy=[lp6ba04,lp61209,lp3c781]
- _…and 20 more_

### `STUB_HEAVY_TOP10` (medium) — 14 hit(s)

- **grid_007** (Mexico City): 4/10 cards lack room photos
- **grid_012** (Mexico City): 4/10 cards lack room photos
- **grid_016** (Mexico City): 5/10 cards lack room photos
- **grid_018** (Mexico City): 4/10 cards lack room photos
- **rnd_044** (Paris): 8/10 cards lack room photos
- **rnd_061** (Mexico City): 6/10 cards lack room photos
- **rnd_063** (Mexico City): 4/10 cards lack room photos
- **rnd_069** (Paris): 6/10 cards lack room photos
- _…and 6 more_

### `WEAK_NAME_TOP5` (low) — 97 hit(s)

- **grid_003** (Mexico City): #5 lp6bbed
- **grid_007** (Mexico City): #5 lp4f097
- **grid_009** (Mexico City): #4 lp655d568e
- **grid_009** (Mexico City): #5 lp65584809
- **grid_012** (Mexico City): #2 lp6587bbd9
- **grid_012** (Mexico City): #3 lp656803ae
- **grid_012** (Mexico City): #4 lp6587bbcd
- **grid_015** (Mexico City): #1 lpbb18c
- _…and 89 more_

### `API_VS_CLIENT_TOP3` (info) — 54 hit(s)

- **grid_002** (Mexico City): api=[lp65573614,lp1ce969,lp4bab4] client=[lp65573614,lp1ce969,lp23157]
- **grid_003** (Mexico City): api=[lp27959c,lpb6b6f,lp6585d08e] client=[lpb6b6f,lp740a5,lpbae82]
- **grid_005** (Mexico City): api=[lp65573614,lp4bab4,lpb46e4] client=[lp4bab4,lp65573614,lp1f6a78]
- **grid_009** (Mexico City): api=[lp6584bf96,lp656c9ed6,lp6559104c] client=[lp73122,lp23189,lp4081d]
- **grid_010** (Mexico City): api=[lp3873de,lp65797c94,lp110b76] client=[lp3873de,lp656c9978,lp65797c94]
- **grid_011** (Mexico City): api=[lp65584c0c,lp72e20,lp3c781] client=[lp65584c0c,lp6ba04,lp65555bd7]
- **grid_013** (Mexico City): api=[lp27959c,lpa8229,lpb6b6f] client=[lpb6b6f,lp740a5,lp3721c]
- **grid_015** (Mexico City): api=[lp6587bbd9,lpbb18c,lp6587bbcd] client=[lpbb18c,lp65584c0c,lpdaa8c]
- _…and 46 more_

### `AVAIL_FILTER_SHRINK` (info) — 49 hit(s)

- **grid_001** (Mexico City): 3497 → 88 visible (3%)
- **grid_003** (Mexico City): 3497 → 34 visible (1%)
- **grid_005** (Mexico City): 3497 → 93 visible (3%)
- **grid_007** (Mexico City): 3497 → 60 visible (2%)
- **grid_009** (Mexico City): 3497 → 57 visible (2%)
- **grid_011** (Mexico City): 3497 → 89 visible (3%)
- **grid_013** (Mexico City): 3497 → 66 visible (2%)
- **grid_015** (Mexico City): 3497 → 54 visible (2%)
- _…and 41 more_

## Sample top-5 rankings (first 12 cases)

### grid_001 — Mexico City, trip=first, stay=sleek_polished, nbhd=buzz_central, pm=0, 2026-07-07→2026-07-10
- 1. The Ritz-Carlton, Mexico City (lp65573614) room=100% disp=100% nbhd=79% $864
- 2. Hotel El Senador (lp86fee) room=62% disp=62% nbhd=95% $93
- 3. Umbral, Curio Collection By Hilton (lp1f6a78) room=62% disp=62% nbhd=95% $255
- 4. Hilton Mexico City Reforma (lp3158b) room=54% disp=54% nbhd=95% $326
- 5. The St. Regis Mexico City (lp4bab4) room=88% disp=88% nbhd=79% $843
- _Findings:_ DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, AVAIL_FILTER_SHRINK

### grid_002 — Mexico City, trip=first, stay=sleek_polished, nbhd=calm_central, pm=0, no dates
- 1. The Ritz-Carlton, Mexico City (lp65573614) room=100% disp=100% nbhd=95% —
- 2. Sofitel Mexico City Reforma (lp1ce969) room=97% disp=97% nbhd=95% —
- 3. Four Seasons Hotel Mexico City (lp23157) room=87% disp=87% nbhd=95% —
- 4. Mathias Luxury Plus by Viadora (lpb46e4) room=84% disp=84% nbhd=95% —
- 5. The St. Regis Mexico City (lp4bab4) room=81% disp=81% nbhd=95% —
- _Findings:_ API_VS_CLIENT_TOP3

### grid_003 — Mexico City, trip=first, stay=sleek_polished, nbhd=hip_local, pm=50, 2026-06-29→2026-07-04
- 1. Distrito Condesa Rooms and Studios (lpb6b6f) room=73% disp=73% nbhd=94% $128
- 2. Hive Nápoles By G Hotels (lp740a5) room=70% disp=70% nbhd=94% $190
- 3. Felix Luxury Plus by Viadora (lpbae82) room=70% disp=70% nbhd=94% $398
- 4. The Amsterdam Boutique Stays by Viad (lp65583727) room=53% disp=53% nbhd=94% $394
- 5. lp6bbed (lp6bbed) room=56% disp=56% nbhd=45% $174
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### grid_004 — Mexico City, trip=first, stay=sleek_polished, nbhd=leafy_local, pm=50, no dates
- 1. Distrito Condesa Rooms and Studios (lpb6b6f) room=73% disp=73% nbhd=95% —
- 2. HOTEL CASA KAVIA (lp6585d08e) room=77% disp=77% nbhd=74% —
- 3. Hive Nápoles By G Hotels (lp740a5) room=70% disp=70% nbhd=95% —
- 4. Felix Luxury Plus by Viadora (lpbae82) room=70% disp=70% nbhd=95% —
- 5. Illumé Urban Living - Apartments in  (lp27959c) room=70% disp=70% nbhd=81% —
- _Findings:_ SORT_NON_MONOTONIC

### grid_005 — Mexico City, trip=first, stay=sleek_polished, nbhd=scenic_open, pm=0, 2026-06-25→2026-06-28
- 1. The St. Regis Mexico City (lp4bab4) room=89% disp=89% nbhd=93% $1703
- 2. The Ritz-Carlton, Mexico City (lp65573614) room=100% disp=100% nbhd=93% $1070
- 3. Umbral, Curio Collection By Hilton (lp1f6a78) room=27% disp=27% nbhd=95% $217
- 4. Hotel Punto MX (lpaef30) room=20% disp=20% nbhd=95% $182
- 5. Hive Nápoles By G Hotels (lp740a5) room=70% disp=70% nbhd=72% $166
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, EXPENSIVE_OUTLIER_#1, AVAIL_FILTER_SHRINK

### grid_006 — Mexico City, trip=first, stay=cozy_warm, nbhd=buzz_central, pm=0, no dates
- 1. Casa Sabina Down Town Mexico City (lp656c9978) room=100% disp=100% nbhd=95% —
- 2. Casa de la Luz Hotel Boutique (lp3873de) room=100% disp=100% nbhd=95% —
- 3. Antiguo Molino de San Jerónimo Hotel (lp110b76) room=96% disp=96% nbhd=95% —
- 4. Departamento Emilio Dondé zona céntr (lp657cb6dc) room=96% disp=96% nbhd=95% —
- 5. Stunning 1 BR Condo - Alameda Centra (lp6588f4c8) room=96% disp=96% nbhd=95% —

### grid_007 — Mexico City, trip=first, stay=cozy_warm, nbhd=calm_central, pm=80, 2026-07-03→2026-07-07
- 1. H21 Hospedaje Boutique (lpfc697) room=97% disp=97% nbhd=58% $314
- 2. Collections by ULIV Polanco (lp656c9782) room=88% disp=88% nbhd=95% $281
- 3. Hotel Casa Blanca (lp234e5) room=86% disp=86% nbhd=95% $120
- 4. Grand Fiesta Americana Chapultepec (lp2f760) room=82% disp=82% nbhd=95% $400
- 5. lp4f097 (lp4f097) room=0% disp=0% nbhd=95% $159
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, STUB_HEAVY_TOP10, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### grid_008 — Mexico City, trip=first, stay=cozy_warm, nbhd=hip_local, pm=0, no dates
- 1. Maison du comte (lp656c9dca) room=100% disp=100% nbhd=95% —
- 2. ONTO Alvaro Obregon Mexico City (lp65887e65) room=100% disp=100% nbhd=95% —
- 3. Casa Altata Hotel Boutique (lp656c9ed6) room=92% disp=92% nbhd=95% —
- 4. Dib Collection (lp656c9e74) room=92% disp=92% nbhd=95% —
- 5. Hacienda Gobernadores – Boutique Sta (lp6584bf96) room=91% disp=91% nbhd=95% —

### grid_009 — Mexico City, trip=first, stay=cozy_warm, nbhd=leafy_local, pm=0, 2026-07-11→2026-07-14
- 1. KALI Escandón Mexico City (lp73122) room=92% disp=92% nbhd=95% $100
- 2. Courtyard by Marriott Mexico City Re (lp23189) room=90% disp=90% nbhd=95% $107
- 3. BelAir Unique, a Wyndham Hotel (lp4081d) room=92% disp=92% nbhd=95% $123
- 4. lp655d568e (lp655d568e) room=79% disp=79% nbhd=95% $54
- 5. lp65584809 (lp65584809) room=79% disp=79% nbhd=95% $62
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, API_VS_CLIENT_TOP3, ROOM_GAP_IGNORED, WEAK_NAME_TOP5, WEAK_NAME_TOP5, AVAIL_FILTER_SHRINK

### grid_010 — Mexico City, trip=first, stay=cozy_warm, nbhd=scenic_open, pm=0, no dates
- 1. Casa de la Luz Hotel Boutique (lp3873de) room=100% disp=100% nbhd=95% —
- 2. Casa Sabina Down Town Mexico City (lp656c9978) room=100% disp=100% nbhd=95% —
- 3. Antiguo Molino de San Jerónimo (lp65797c94) room=96% disp=96% nbhd=95% —
- 4. Antiguo Molino de San Jerónimo Hotel (lp110b76) room=96% disp=96% nbhd=95% —
- 5. Casa9Zocalo (lp656c80ac) room=96% disp=96% nbhd=95% —
- _Findings:_ API_VS_CLIENT_TOP3

### grid_011 — Mexico City, trip=first, stay=distinct_unique, nbhd=buzz_central, pm=0, 2026-07-15→2026-07-20
- 1. Barrio Downtown Mexico City Hostel (lp65584c0c) room=96% disp=96% nbhd=95% $62
- 2. Gran Hotel Villa de Madrid (lp6ba04) room=85% disp=85% nbhd=95% $71
- 3. Cadillac Hotel Boutique (lp65555bd7) room=85% disp=85% nbhd=95% $71
- 4. Hotel Fontan Reforma Centro Historic (lp3c781) room=87% disp=87% nbhd=95% $92
- 5. Hotel B Urban Xaman by Fontán Reform (lp65577a8d) room=85% disp=85% nbhd=95% $114
- _Findings:_ SORT_NON_MONOTONIC, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, DISPLAY_VS_LEGACY_SORT_ROOM, FIXED_VS_LEGACY_TOP3, API_VS_CLIENT_TOP3, AVAIL_FILTER_SHRINK

### grid_012 — Mexico City, trip=first, stay=distinct_unique, nbhd=calm_central, pm=80, no dates
- 1. Casa Kanabri Hostal Boutique (lpbb18c) room=98% disp=98% nbhd=65% —
- 2. lp6587bbd9 (lp6587bbd9) room=100% disp=100% nbhd=58% —
- 3. lp656803ae (lp656803ae) room=95% disp=95% nbhd=58% —
- 4. lp6587bbcd (lp6587bbcd) room=90% disp=90% nbhd=58% —
- 5. Collection O Casa Anzures Thematic,  (lp92dcb) room=79% disp=79% nbhd=95% —
- _Findings:_ SORT_NON_MONOTONIC, STUB_HEAVY_TOP10, WEAK_NAME_TOP5, WEAK_NAME_TOP5, WEAK_NAME_TOP5

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
- End-to-end per case ms (p50/p90): 8558 / 14160
