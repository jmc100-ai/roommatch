/**
 * Node port of client/app.js Best Match sort (match branch + avail filter).
 * Keep in sync when changing getSortedHotelsForDisplay() match logic.
 */

const BOOP_PRICE_VALUE_PENALTY_MAX = 24;
const BOOP_PRICE_LUXURY_STAR_EXTRA = 10;
const BOOP_PRICE_HIGH_VALUE_EXTRA = 12;
const BOOP_PRICE_SPLURGE_BONUS_MAX = 14;
const BOOP_PRICE_ROOM_GAP_GUARD = 10;
const BOOP_PRICE_NBHD_GAP_GUARD = 16;
const BOOP_PRICE_NBHD_ROOM_YIELD_GAP = 22;
const BOOP_PRICE_NBHD_WEIGHT_BOOST = 0.30;
const BOOP_ROOM_DOMINANCE_GAP = 15;
const BOOP_NBHD_SIMILAR_MAX = 8;
const BOOP_PRICE_NEUTRAL_BAND = 32;
const BOOP_PRICE_LUXURY_ROOM_GUARD_LEAN = 0.72;
const MATCH_LIVE_RATE_NUDGE_MAX = 18;
const MATCH_LIVE_RATE_ROOM_GAP = 14;
const MATCH_LIVE_RATE_RATIO_BOOST = 12;
const MATCH_LIVE_RATE_PRICE_RATIO = 2.2;
const MATCH_LIVE_RATE_LUXURY_TRIM_MAX = 14;

function roomVibeMatchDisplayPct(h) {
  const allRooms = h?.roomTypes || [];
  if (allRooms.length === 0) return Math.round(h?.vectorScore || 0);
  const bestRoomScore = Math.max(0, ...allRooms.map((rt) => rt.score || 0));
  return bestRoomScore > 0 ? Math.round(bestRoomScore) : Math.round(h?.vectorScore || 0);
}

function bestMatchRoomScore(h) {
  const room = roomVibeMatchDisplayPct(h);
  return room > 0 ? room : (h.vectorScore || 0);
}

function boopPriceMattersForSort(profile) {
  const pm = Number(profile?.answers?.priceMatters);
  if (!Number.isFinite(pm)) return 0;
  return Math.max(-100, Math.min(100, pm));
}

function boopPriceMattersStrength(pm) {
  return Math.abs(Math.max(-100, Math.min(100, Number(pm) || 0))) / 100;
}

function boopPriceValuePenaltyMax(pm) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (p <= 0) return BOOP_PRICE_VALUE_PENALTY_MAX;
  return BOOP_PRICE_VALUE_PENALTY_MAX + (Math.abs(p) / 100) * 16;
}

function boopPriceRoomGapGuard(pm) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (p <= 0) return BOOP_PRICE_ROOM_GAP_GUARD;
  return Math.max(4, Math.round(BOOP_PRICE_ROOM_GAP_GUARD * (1 - 0.55 * (Math.abs(p) / 100))));
}

function valueSeekingLuxuryLean(h, pct) {
  if (pct && h.price != null && Number.isFinite(Number(h.price))) {
    const p = Number(h.price);
    return Math.max(0, Math.min(1, (p - pct.p10) / pct.range));
  }
  const s = Number(h.starRating);
  if (Number.isFinite(s) && s > 0) {
    if (s >= 4.5) return 1.0;
    if (s >= 3.5) return 0.72;
    if (s >= 2.5) return 0.42;
    if (s >= 1.5) return 0.24;
    return 0.14;
  }
  const hv = Number(h.hotelScore);
  if (Number.isFinite(hv) && hv >= 82) return 0.88;
  if (Number.isFinite(hv) && hv >= 70) return 0.62;
  return 0.45;
}

function shouldRoomGuardYieldToPrice(h, pct) {
  const stars = Number(h.starRating);
  if (Number.isFinite(stars) && stars >= 4) return true;
  return valueSeekingLuxuryLean(h, pct) >= BOOP_PRICE_LUXURY_ROOM_GUARD_LEAN;
}

function effectiveNbhdWeightForPriceMatters(baseW, pm) {
  const w = Number(baseW) || 0;
  if (w <= 0) return 0;
  const p = Number(pm) || 0;
  if (p <= 0) return w;
  return Math.min(0.72, w * (1 + BOOP_PRICE_NBHD_WEIGHT_BOOST * (Math.abs(p) / 100)));
}

function shouldNbhdGuardYieldToPrice(weakNbhdHotel, strongNbhdHotel) {
  return bestMatchRoomScore(weakNbhdHotel) - bestMatchRoomScore(strongNbhdHotel) >= BOOP_PRICE_NBHD_ROOM_YIELD_GAP;
}

function hotelPriceValueScore(h, pct) {
  if (pct && h.price != null && Number.isFinite(Number(h.price))) {
    const p = Number(h.price);
    return Math.max(0, Math.min(100, ((pct.p90 - p) / pct.range) * 100));
  }
  const s = Number(h.starRating);
  if (Number.isFinite(s) && s > 0) {
    return Math.max(0, Math.min(100, ((5 - Math.min(s, 5)) / 4) * 100));
  }
  return 50;
}

function boopPriceAdjustBlendedScore(blended, h, pm, pct) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (Math.abs(p) < 1) return blended;
  const t = Math.abs(p) / 100;
  if (p > 0) {
    let penalty = t * boopPriceValuePenaltyMax(p) * valueSeekingLuxuryLean(h, pct);
    const stars = Number(h.starRating);
    if (Number.isFinite(stars) && stars >= 4) penalty += t * BOOP_PRICE_LUXURY_STAR_EXTRA;
    if (Math.abs(p) >= 70) penalty += t * BOOP_PRICE_HIGH_VALUE_EXTRA * valueSeekingLuxuryLean(h, pct);
    return Math.max(0, blended - penalty);
  }
  const exp = valueSeekingLuxuryLean(h, pct);
  return blended + t * BOOP_PRICE_SPLURGE_BONUS_MAX * exp;
}

function matchLiveRateNudgeDiff(a, b, roomA, roomB, pricePercentiles) {
  if (!pricePercentiles) return 0;
  const aP = a.price != null && Number.isFinite(Number(a.price));
  const bP = b.price != null && Number.isFinite(Number(b.price));
  if (!aP || !bP) return 0;

  const priceA = Number(a.price);
  const priceB = Number(b.price);
  const med = (pricePercentiles.p10 + pricePercentiles.p90) / 2;
  const maxP = Math.max(priceA, priceB);
  const priceRatio = med > 0 ? maxP / med : 1;

  const roomGap = Math.abs(roomB - roomA);
  const roomGapLimit =
    MATCH_LIVE_RATE_ROOM_GAP + (priceRatio >= 2.5 ? Math.min(14, (priceRatio - 2) * 5) : 0);
  if (roomGap > roomGapLimit) return 0;

  const nudgeScale =
    priceRatio >= MATCH_LIVE_RATE_PRICE_RATIO
      ? Math.min(2.4, 1 + (priceRatio - MATCH_LIVE_RATE_PRICE_RATIO) * 0.5)
      : 1;
  let diff =
    ((hotelPriceValueScore(b, pricePercentiles) - hotelPriceValueScore(a, pricePercentiles)) / 100) *
    MATCH_LIVE_RATE_NUDGE_MAX *
    nudgeScale;

  if (priceRatio >= MATCH_LIVE_RATE_PRICE_RATIO) {
    const ratioBoost =
      MATCH_LIVE_RATE_RATIO_BOOST * Math.min(2.5, priceRatio / MATCH_LIVE_RATE_PRICE_RATIO);
    if (priceA > priceB) diff -= ratioBoost;
    else if (priceB > priceA) diff += ratioBoost;
  }
  return diff;
}

function neutralLuxuryPriceTrim(h, pricePercentiles, pm) {
  if (Math.abs(pm) > BOOP_PRICE_NEUTRAL_BAND || !pricePercentiles || h.price == null) return 0;
  const med = (pricePercentiles.p10 + pricePercentiles.p90) / 2;
  if (med <= 0) return 0;
  const ratio = Number(h.price) / med;
  if (ratio <= MATCH_LIVE_RATE_PRICE_RATIO) return 0;
  return Math.min(MATCH_LIVE_RATE_LUXURY_TRIM_MAX, (ratio - MATCH_LIVE_RATE_PRICE_RATIO) * 4.5);
}

function matchSortUsesLiveRates(hasDateSearch, profile) {
  return hasDateSearch && Math.abs(boopPriceMattersForSort(profile)) <= BOOP_PRICE_NEUTRAL_BAND;
}

function hotelPassesAvailFilter(h, ctx) {
  const { showAvailOnly, hasDateSearch, pricesLoaded } = ctx;
  if (!showAvailOnly || !hasDateSearch || !pricesLoaded) return true;
  const rp = h?.roomPrices;
  if (!rp) return false;
  for (const _k in rp) return true;
  return false;
}

function buildPricePercentiles(hotels) {
  const priced = hotels.filter((h) => h.price != null).map((h) => h.price).sort((a, b) => a - b);
  if (priced.length < 3) return null;
  const p10 = priced[Math.floor(priced.length * 0.10)] ?? priced[0];
  const p90 = priced[Math.floor(priced.length * 0.90)] ?? priced[priced.length - 1];
  return { p10, p90, range: Math.max(p90 - p10, 1) };
}

/**
 * @param {object[]} hotels — mutated copy returned sorted
 * @param {object} stats — vsearch stats (nbhd_rank_weight, etc.)
 * @param {object} profile — boop_profile
 * @param {{ pricesLoaded: boolean, hasDateSearch: boolean, showAvailOnly?: boolean }} ctx
 */
function sortHotelsBestMatch(hotels, stats, profile, ctx) {
  const list = hotels.filter((h) => hotelPassesAvailFilter(h, ctx));
  const wNbhdBase = typeof stats?.nbhd_rank_weight === "number" ? stats.nbhd_rank_weight : 0;
  const pm = boopPriceMattersForSort(profile);
  const wNbhd = effectiveNbhdWeightForPriceMatters(wNbhdBase, pm);
  const pricePercentiles =
    ctx.pricesLoaded && ctx.hasDateSearch ? buildPricePercentiles(list) : null;

  const roomMatchScore = (h) => bestMatchRoomScore(h);
  const blendedMatchScore = (h) => {
    const room = roomMatchScore(h);
    if (wNbhd > 0 && h.nbhd_fit_pct != null) return (1 - wNbhd) * room + wNbhd * h.nbhd_fit_pct;
    return room;
  };
  const roomGapGuard = boopPriceRoomGapGuard(pm);
  const pmNeutral = matchSortUsesLiveRates(ctx.hasDateSearch, profile);
  const sortScore = (h) => {
    let s = boopPriceAdjustBlendedScore(blendedMatchScore(h), h, pm, pricePercentiles);
    if (pmNeutral && pricePercentiles) s -= neutralLuxuryPriceTrim(h, pricePercentiles, pm);
    return s;
  };

  list.sort((a, b) => {
    const roomA = roomMatchScore(a);
    const roomB = roomMatchScore(b);
    if (Math.abs(pm) <= BOOP_PRICE_NEUTRAL_BAND) {
      const nbhdA = a.nbhd_fit_pct;
      const nbhdB = b.nbhd_fit_pct;
      const nbhdGap = nbhdA != null && nbhdB != null ? Math.abs(nbhdB - nbhdA) : 0;
      const roomGap = roomB - roomA;
      if (roomGap >= BOOP_ROOM_DOMINANCE_GAP && nbhdGap <= BOOP_NBHD_SIMILAR_MAX) return 1;
      if (roomGap <= -BOOP_ROOM_DOMINANCE_GAP && nbhdGap <= BOOP_NBHD_SIMILAR_MAX) return -1;
    }
    if (pm > 0) {
      const roomGap = roomB - roomA;
      if (roomGap >= roomGapGuard) {
        if (!shouldRoomGuardYieldToPrice(b, pricePercentiles)) return 1;
      } else if (roomGap <= -roomGapGuard) {
        if (!shouldRoomGuardYieldToPrice(a, pricePercentiles)) return -1;
      }
      const nbhdA = a.nbhd_fit_pct;
      const nbhdB = b.nbhd_fit_pct;
      if (wNbhd > 0 && nbhdA != null && nbhdB != null) {
        const nbhdGap = nbhdB - nbhdA;
        if (nbhdGap >= BOOP_PRICE_NBHD_GAP_GUARD) {
          if (!shouldNbhdGuardYieldToPrice(a, b)) return 1;
        } else if (nbhdGap <= -BOOP_PRICE_NBHD_GAP_GUARD) {
          if (!shouldNbhdGuardYieldToPrice(b, a)) return -1;
        }
      }
    }
    let diff = sortScore(b) - sortScore(a);
    if (pmNeutral && pricePercentiles) {
      diff += matchLiveRateNudgeDiff(a, b, roomA, roomB, pricePercentiles);
    }
    if (Math.abs(diff) < 1e-6) diff = (b.vectorScore || 0) - (a.vectorScore || 0);
    return diff > 0 ? 1 : diff < 0 ? -1 : 0;
  });

  return {
    hotels: list,
    meta: { wNbhd, pm, pricePercentiles, sortScore, blendedMatchScore, roomMatchScore },
  };
}

function hotelEffectiveScore(h, ctx) {
  const allRooms = h.roomTypes || [];
  const canFilter = ctx.showAvailOnly && ctx.hasDateSearch && ctx.pricesLoaded;
  if (canFilter) {
    const availRooms = allRooms.filter(
      (rt) => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null
    );
    if (availRooms.length > 0) return Math.max(0, ...availRooms.map((rt) => rt.score || 0));
    if (h.price != null) {
      const bestRoom = Math.max(0, ...allRooms.map((rt) => rt.score || 0));
      return bestRoom > 0 ? bestRoom : h.vectorScore || 0;
    }
    return 0;
  }
  if (allRooms.length === 0) return h.vectorScore || 0;
  return Math.max(0, ...allRooms.map((rt) => rt.score || 0));
}

/**
 * Pre-May-2026 production bug path: Best Match sort used hotelEffectiveScore when avail filter on.
 */
function sortHotelsBestMatchLegacy(hotels, stats, profile, ctx) {
  const patched = (h) => {
    const room = roomVibeMatchDisplayPct(h);
    const legacy = hotelEffectiveScore(h, ctx);
    return legacy > 0 ? legacy : room > 0 ? room : h.vectorScore || 0;
  };
  // Re-use sort with legacy room scorer
  const list = hotels.filter((h) => hotelPassesAvailFilter(h, ctx));
  const wNbhdBase = typeof stats?.nbhd_rank_weight === "number" ? stats.nbhd_rank_weight : 0;
  const pm = boopPriceMattersForSort(profile);
  const wNbhd = effectiveNbhdWeightForPriceMatters(wNbhdBase, pm);
  const pricePercentiles =
    ctx.pricesLoaded && ctx.hasDateSearch ? buildPricePercentiles(list) : null;
  const roomMatchScore = patched;
  const blendedMatchScore = (h) => {
    const room = roomMatchScore(h);
    if (wNbhd > 0 && h.nbhd_fit_pct != null) return (1 - wNbhd) * room + wNbhd * h.nbhd_fit_pct;
    return room;
  };
  const sortScore = (h) => boopPriceAdjustBlendedScore(blendedMatchScore(h), h, pm, pricePercentiles);
  const roomGapGuard = boopPriceRoomGapGuard(pm);
  const pmNeutral = matchSortUsesLiveRates(ctx.hasDateSearch, profile);

  list.sort((a, b) => {
    const roomA = roomMatchScore(a);
    const roomB = roomMatchScore(b);
    if (pm > 0) {
      const roomGap = roomB - roomA;
      if (roomGap >= roomGapGuard && !shouldRoomGuardYieldToPrice(b, pricePercentiles)) return 1;
      if (roomGap <= -roomGapGuard && !shouldRoomGuardYieldToPrice(a, pricePercentiles)) return -1;
      const nbhdA = a.nbhd_fit_pct;
      const nbhdB = b.nbhd_fit_pct;
      if (wNbhd > 0 && nbhdA != null && nbhdB != null) {
        const nbhdGap = nbhdB - nbhdA;
        if (nbhdGap >= BOOP_PRICE_NBHD_GAP_GUARD && !shouldNbhdGuardYieldToPrice(a, b)) return 1;
        if (nbhdGap <= -BOOP_PRICE_NBHD_GAP_GUARD && !shouldNbhdGuardYieldToPrice(b, a)) return -1;
      }
    }
    let diff = sortScore(b) - sortScore(a);
    if (pmNeutral && pricePercentiles && Math.abs(roomB - roomA) <= MATCH_LIVE_RATE_ROOM_GAP) {
      const aP = a.price != null && Number.isFinite(Number(a.price));
      const bP = b.price != null && Number.isFinite(Number(b.price));
      if (aP && bP) {
        diff +=
          ((hotelPriceValueScore(b, pricePercentiles) - hotelPriceValueScore(a, pricePercentiles)) /
            100) *
          MATCH_LIVE_RATE_NUDGE_MAX;
      }
    }
    if (Math.abs(diff) < 1e-6) diff = (b.vectorScore || 0) - (a.vectorScore || 0);
    return diff > 0 ? 1 : diff < 0 ? -1 : 0;
  });

  return { hotels: list, meta: { wNbhd, pm, pricePercentiles, sortScore, blendedMatchScore, roomMatchScore } };
}

module.exports = {
  roomVibeMatchDisplayPct,
  bestMatchRoomScore,
  hotelEffectiveScore,
  sortHotelsBestMatch,
  sortHotelsBestMatchLegacy,
  hotelPassesAvailFilter,
  buildPricePercentiles,
  boopPriceMattersForSort,
};
