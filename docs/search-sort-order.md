# Search result sort order (V2)

## Two orderings exist by design

### 1. API response order (`GET /api/vsearch`)

Hotels in the JSON array are sorted by the **server primary signal**:

```
primarySignal = (1 − HOTEL_VIBE_BLEND_WEIGHT) × vectorScore + HOTEL_VIBE_BLEND_WEIGHT × hotelVibePct
```

When Boop neighbourhood ranking is active, the server may also blend `nbhd_fit_pct` before Phase B (see `applyNbhdBoopRank` + `nbhd_reshuffle` in `scripts/search-v2.js`).

This order optimizes **which hotels get Phase-B photos, hotel vibe RPC, and sync LiteAPI metadata** — not what the user ultimately sees after client filters.

### 2. UI display order (`getSortedHotelsForDisplay()` in `client/app.js`)

The results grid re-sorts on every render using the active sort mode:

| Mode | Signal |
|------|--------|
| **Best Match** (default) | `bestMatchRoomScore` (= card ROOM VIBE %) blended with `nbhd_fit_pct`, Boop price slider guards, optional live-rate nudge when dates + neutral price slider |
| **Guest Rating** | LiteAPI guest rating |
| **Stars** | Star rating |
| **Best Price** | Nightly price (unchanged — see F9 backlog) |
| **Match + Price** | Tiered match + price blend (unchanged — see F9 backlog) |

**Availability filter** (`Available rooms only`) runs *before* sort: hotels with no `roomPrices` entries are hidden when dates + rates are loaded. It does **not** change the room % used for Best Match sort.

### Debug snapshot

`copyDebugSnapshot()` (localhost debug button) serializes **`getSortedHotelsForDisplay()` top 10**, not raw API order. Field `sort_note` in the JSON explains the difference.

## Performance metadata

`/api/vsearch` → `stats.perf_ms` breaks down server time (phase-A DB, NLP intent, phase-B photos, embedded rates). Client-side lazy fetches (`/api/hotels-meta`, `/api/hotel-rooms`) happen after first paint and are not included in `perf_ms.wall_ms`.

## Related env knobs

| Var | Default | Effect |
|-----|---------|--------|
| `META_SYNC_LIMIT` | 50 | Sync LiteAPI names/photos for first N hotels in API order |
| `BOOP_META_SYNC_LIMIT` | 50 | Used when `boop_profile` present |
| `VSEARCH_NBHD_NEUTRAL_PCT` | 62 | Default `nbhd_fit_pct` when Boop rank ran but hotel lacks explicit score |
