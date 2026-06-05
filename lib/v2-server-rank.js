/**
 * Server-side V2 hotel ranking signals — mirrors scripts/search-v2.js sort logic
 * for QA audits (API order monotonicity, Playwright intercept checks).
 */

const NBHD_NEUTRAL_PCT_DEFAULT = 62;

function hotelVibeBlendWeight(stats) {
  const w = stats?.hotel_vibe_blend_weight;
  if (typeof w === "number" && Number.isFinite(w)) return Math.max(0, Math.min(1, w));
  return 0.2;
}

function hotelVibeModel(stats) {
  return stats?.hotel_vibe_model || "fallback_rating";
}

function nbhdRankWeight(stats) {
  if (typeof stats?.nbhd_rank_weight === "number") return stats.nbhd_rank_weight;
  if (stats?.nbhd_blend_applied && typeof stats?.nbhd_rank_weight_active === "number") {
    return stats.nbhd_rank_weight_active;
  }
  return 0;
}

/** Normalize API hotel row → internal rank row. */
function toRankRow(h, stats) {
  const id = String(h.id || h.hotel_id || "");
  const topScore = Number(h.vectorScore ?? h.topScore) || 0;

  let hotelVibePct = h.hotelVibePct;
  if (hotelVibePct == null && h.score_breakdown?.v2_hotel_vibe_pct != null) {
    hotelVibePct = h.score_breakdown.v2_hotel_vibe_pct;
  }

  let rawHotelVibe = h.rawHotelVibe;
  if (rawHotelVibe == null && h.score_breakdown?.raw_hotel_vibe != null) {
    rawHotelVibe = h.score_breakdown.raw_hotel_vibe;
  }
  if (rawHotelVibe == null && h.hotelScore != null && Number.isFinite(Number(h.hotelScore))) {
    rawHotelVibe = Number(h.hotelScore) / 100;
  }
  if (rawHotelVibe == null) rawHotelVibe = -1;

  if (hotelVibePct == null && rawHotelVibe >= 0 && stats?.hotel_vibe_sim_max != null) {
    const hvMax = Number(stats.hotel_vibe_sim_max);
    const hvMin = Number(stats.hotel_vibe_sim_min ?? Math.max(hvMax - 0.30, 0));
    const span = Math.max(hvMax - hvMin, 1e-9);
    hotelVibePct = Math.max(0, Math.min(100, ((rawHotelVibe - hvMin) / span) * 100));
  }

  let rawRoom = h.rawRoom;
  if (rawRoom == null && h.score_breakdown?.raw_room != null) {
    rawRoom = Number(h.score_breakdown.raw_room);
  }
  if (rawRoom == null) rawRoom = 0;

  const guest = Number(h.rating ?? h.guest_rating) || 0;
  const stars = Number(h.starRating ?? h.star_rating) || 0;

  return {
    hotel_id: id,
    topScore,
    hotelVibePct: hotelVibePct != null ? Number(hotelVibePct) : null,
    rawHotelVibe: Number(rawHotelVibe),
    rawRoom: Number(rawRoom) || 0,
    guest_rating: guest,
    star_rating: stars,
    nbhd_fit_pct: h.nbhd_fit_pct != null ? Number(h.nbhd_fit_pct) : null,
  };
}

function primarySignal(row, stats) {
  const HVB = hotelVibeBlendWeight(stats);
  const model = hotelVibeModel(stats);
  if (row.hotelVibePct != null) {
    return (1 - HVB) * row.topScore + HVB * row.hotelVibePct;
  }
  if (model === "v2_facts") {
    return (1 - HVB) * row.topScore;
  }
  return row.topScore;
}

function nbhdFitPct(row, stats) {
  if (row.nbhd_fit_pct != null) return row.nbhd_fit_pct;
  if (nbhdRankWeight(stats) > 0 && stats?.nbhd_blend_applied) {
    return NBHD_NEUTRAL_PCT_DEFAULT;
  }
  return null;
}

function blendedSortScore(row, stats) {
  const ps = primarySignal(row, stats);
  const w = nbhdRankWeight(stats);
  const nb = nbhdFitPct(row, stats);
  if (w > 0 && nb != null) {
    return ((1 - w) * (ps / 100) + w * (nb / 100)) * 100;
  }
  return ps;
}

/** compareHotels(a, b) — positive when b should rank above a (same as search-v2). */
function compareHotels(a, b, stats) {
  const sa = primarySignal(a, stats);
  const sb = primarySignal(b, stats);
  if (Math.abs(sb - sa) > 1e-6) return sb - sa;

  if (Math.abs(b.rawHotelVibe - a.rawHotelVibe) > 1e-9) return b.rawHotelVibe - a.rawHotelVibe;
  if (Math.abs(b.rawRoom - a.rawRoom) > 1e-9) return b.rawRoom - a.rawRoom;

  if (b.guest_rating !== a.guest_rating) return b.guest_rating - a.guest_rating;
  if (b.star_rating !== a.star_rating) return b.star_rating - a.star_rating;

  return a.hotel_id.localeCompare(b.hotel_id);
}

function compareWithNbhd(a, b, stats) {
  const w = nbhdRankWeight(stats);
  if (w > 0 && stats?.nbhd_blend_applied) {
    const nbA = nbhdFitPct(a, stats) ?? NBHD_NEUTRAL_PCT_DEFAULT;
    const nbB = nbhdFitPct(b, stats) ?? NBHD_NEUTRAL_PCT_DEFAULT;
    const ca = (1 - w) * (primarySignal(a, stats) / 100) + w * (nbA / 100);
    const cb = (1 - w) * (primarySignal(b, stats) / 100) + w * (nbB / 100);
    if (Math.abs(cb - ca) > 1e-6) return cb - ca;
  }
  return compareHotels(a, b, stats);
}

function countServerSortInversions(hotels, stats, depth = 30) {
  const rows = hotels.slice(0, depth).map((h) => toRankRow(h, stats));
  let inversions = 0;
  for (let i = 1; i < rows.length; i++) {
    // Positive when rows[i] should rank above rows[i-1] but appears later.
    const cmp = compareWithNbhd(rows[i - 1], rows[i], stats);
    if (cmp > 1e-5) inversions++;
  }
  return inversions;
}

/** Price-matters re-sort in server.js — approximate via client Best Match port. */
function countPriceMattersSortInversions(hotels, stats, profile, depth = 30) {
  if (!stats?.price_matters_ranking_active || !profile) {
    return countServerSortInversions(hotels, stats, depth);
  }
  const { sortHotelsBestMatch } = require("./client-match-sort");
  const { hotels: expected } = sortHotelsBestMatch(
    hotels.map((h) => ({ ...h })),
    stats,
    profile,
    { pricesLoaded: false, hasDateSearch: false, showAvailOnly: false }
  );
  const rankOf = new Map(expected.slice(0, depth).map((h, i) => [String(h.id), i]));
  let inversions = 0;
  const apiIds = hotels.slice(0, depth).map((h) => String(h.id));
  for (let i = 1; i < apiIds.length; i++) {
    const ra = rankOf.get(apiIds[i - 1]);
    const rb = rankOf.get(apiIds[i]);
    if (ra != null && rb != null && rb < ra) inversions++;
  }
  return inversions;
}

/** True when hotels are in descending server sort order (for tests). */
function isServerSortDescending(hotels, stats, depth = 30) {
  const rows = hotels.slice(0, depth).map((h) => toRankRow(h, stats));
  for (let i = 1; i < rows.length; i++) {
    if (compareWithNbhd(rows[i - 1], rows[i], stats) > 1e-5) return false;
  }
  return true;
}

function hotelHasHero(h) {
  if (h.mainPhoto) return true;
  if (Array.isArray(h.hotelPhotos) && h.hotelPhotos.length) return true;
  return (h.roomTypes || []).some((rt) => (rt.photos || []).length > 0);
}

function metaSyncLimit(stats, fallback = 30) {
  const n = stats?.meta_sync_count;
  return typeof n === "number" && n > 0 ? n : fallback;
}

/**
 * Audit /api/vsearch hotel payload (API order, completeness).
 * @param {object} data — parsed vsearch JSON
 * @param {number} [topN=50]
 */
function auditVsearchHotels(data, topN = 50, profile = null) {
  const stats = data.stats || {};
  const hotels = (data.hotels || []).slice(0, topN);
  const metaSyncN = metaSyncLimit(stats);
  const issues = [];

  for (let i = 0; i < hotels.length; i++) {
    const h = hotels[i];
    const id = String(h.id || "");
    const rank = i + 1;
    if (!id) issues.push({ rank, id, msg: "missing id" });
    if (rank <= 10 && !hotelHasHero(h)) {
      issues.push({ rank, id, msg: "no hero / room photos" });
    }
    if (h.vectorScore == null) issues.push({ rank, id, msg: "missing vectorScore" });
    // Names are sync-fetched for the first meta_sync_count hotels (first paint).
    // Ranks 31–50 may still lazy-fill; only fail empty names in the top 30.
    const nameCheckN = Math.min(metaSyncN, 30);
    if (rank <= nameCheckN && (!h.name || h.name === "Hotel" || h.name === id)) {
      issues.push({ rank, id, msg: `weak name: ${h.name || "(empty)"}` });
    }
    if (stats.nbhd_blend_applied && h.nbhd_fit_pct == null) {
      issues.push({ rank, id, msg: "missing nbhd_fit_pct" });
    }
    const featured = (h.roomTypes || [])[0];
    if (featured && (featured.photos || []).length === 0) {
      issues.push({ rank, id, msg: "featured room has no photos" });
    }
  }

  const sortInversions = stats?.price_matters_ranking_active
    ? countPriceMattersSortInversions(data.hotels || [], stats, profile, 30)
    : countServerSortInversions(data.hotels || [], stats, 30);
  const stubsTop10 = hotels.slice(0, 10).filter((h) => !(h.roomTypes || []).length).length;
  const stubsTop50 = hotels.filter((h) => !(h.roomTypes || []).length).length;

  return {
    issues,
    sortInversions,
    stubsTop10,
    stubsTop50,
    metaSyncN,
    w: nbhdRankWeight(stats),
    count: hotels.length,
    sortSource: stats.sort_source || "server_vibe",
  };
}

function formatAuditFailures(audit, stats = {}) {
  const errs = [];
  if (audit.count < 30) errs.push(`only ${audit.count} hotels in top slice`);
  if (audit.stubsTop10 > 1) {
    errs.push(`${audit.stubsTop10}/10 top cards lack indexed room photos`);
  }
  if (audit.issues.length > 5) {
    errs.push(`${audit.issues.length} data issues in top 50 (max 5 allowed)`);
  } else if (audit.issues.length) {
    errs.push(audit.issues.slice(0, 3).map((x) => `#${x.rank} ${x.id}: ${x.msg}`).join("; "));
  }
  if (audit.sortSource === "server_vibe" && audit.sortInversions > 4) {
    errs.push(`${audit.sortInversions} server sort inversions in top 30 (tiebreakers expected ≤4)`);
  } else if (audit.sortSource === "server_bookable") {
    // Dated bookable order — validated in Playwright via client bridge.
  } else if (stats?.price_matters_ranking_active && audit.sortInversions > 6) {
    errs.push(`${audit.sortInversions} price-matters sort inversions in top 30 (max 6)`);
  }
  return errs;
}

function deprioritizeStubHotels(hotels, depth = 50) {
  if (depth <= 0 || hotels.length <= 1) return hotels;
  const head = hotels.slice(0, depth);
  const tail = hotels.slice(depth);
  const withRooms = head.filter((h) => (h.roomTypes || []).length > 0);
  const stubs = head.filter((h) => !(h.roomTypes || []).length);
  if (!stubs.length || !withRooms.length) return hotels;
  return [...withRooms, ...stubs, ...tail];
}

/** Re-sort API hotel[] using search-v2 primarySignal + nbhd blend (post-penalty tweaks). */
function sortHotelsByServerVibe(hotels, stats) {
  hotels.sort((a, b) =>
    compareWithNbhd(toRankRow(a, stats), toRankRow(b, stats), stats)
  );
}

module.exports = {
  toRankRow,
  primarySignal,
  blendedSortScore,
  compareHotels,
  compareWithNbhd,
  countServerSortInversions,
  countPriceMattersSortInversions,
  sortHotelsByServerVibe,
  deprioritizeStubHotels,
  auditVsearchHotels,
  formatAuditFailures,
  hotelHasHero,
  metaSyncLimit,
};
