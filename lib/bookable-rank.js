/**
 * Bookable-first ranking for dated vsearch (server-side, no first-paint swap).
 */
const { sortHotelsBestMatch } = require("./client-match-sort");

function isHotelBookable(hotelId, rates) {
  const id = String(hotelId);
  const pv = rates?.prices?.[id];
  if (pv != null && Number.isFinite(Number(pv))) return true;
  const rp = rates?.roomPrices?.[id];
  if (rp && typeof rp === "object") {
    for (const _k in rp) return true;
  }
  return false;
}

function attachRatesToHotel(h, rates) {
  const id = String(h.id);
  const pv = rates.prices?.[id];
  h.price = pv != null && Number.isFinite(Number(pv)) ? Number(pv) : null;
  h.roomPrices = rates.roomPrices?.[id] ? { ...rates.roomPrices[id] } : {};
  if (rates.roomNames?.[id]) h.roomNames = { ...rates.roomNames[id] };
  if (rates.offerIds?.[id]) h.offerIds = { ...rates.offerIds[id] };
  if (rates.roomFreeCancel?.[id]) h.roomFreeCancel = { ...rates.roomFreeCancel[id] };
  if (rates.hotelFreeCancel && Object.prototype.hasOwnProperty.call(rates.hotelFreeCancel, id)) {
    h.hotelFreeCancel = !!rates.hotelFreeCancel[id];
  }
}

function hotelPassesFreeCancelMustHave(h, requireFreeCancel) {
  if (!requireFreeCancel) return true;
  if (h.hotelFreeCancel === true) return true;
  const rfc = h.roomFreeCancel;
  if (!rfc || typeof rfc !== "object") return false;
  for (const rt of h.roomTypes || []) {
    const rid = rt.roomTypeId;
    if (rid == null || h.roomPrices?.[rid] == null) continue;
    if (rfc[rid] === true || rfc[String(rid)] === true) return true;
  }
  return false;
}

/**
 * Filter to bookable hotels (preserve relative vibe order).
 * @returns {{ hotels: object[], bookableCount: number, unbookableVibeCount: number }}
 */
function applyBookableRank(hotels, rates, opts = {}) {
  const requireFreeCancel = !!opts.requireFreeCancel;
  const bookable = [];
  let unbookableVibeCount = 0;
  for (const h of hotels) {
    if (!isHotelBookable(h.id, rates)) {
      unbookableVibeCount++;
      continue;
    }
    attachRatesToHotel(h, rates);
    if (!hotelPassesFreeCancelMustHave(h, requireFreeCancel)) {
      unbookableVibeCount++;
      continue;
    }
    bookable.push(h);
  }
  return {
    hotels: bookable,
    bookableCount: bookable.length,
    unbookableVibeCount,
  };
}

function buildDatedDisplayOrder(hotels, stats, boopProfile) {
  const { hotels: sorted } = sortHotelsBestMatch(hotels, stats, boopProfile, {
    pricesLoaded: true,
    hasDateSearch: true,
    showAvailOnly: false,
  });
  return sorted;
}

module.exports = {
  isHotelBookable,
  attachRatesToHotel,
  applyBookableRank,
  buildDatedDisplayOrder,
};
