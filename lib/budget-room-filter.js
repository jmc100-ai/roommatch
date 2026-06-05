/**
 * Room-aware nightly budget checks (must-have + resolved room price).
 * Keep in sync with client/app.js budget room helpers.
 */

const { resolveRoomRateForType } = require("./room-rate-resolve");

function isIndexedGuestRoom(rt) {
  return String(rt?.name || "").trim().toLowerCase() !== "__hotel_public__";
}

function budgetFlexMaxPrice(baseMax) {
  if (baseMax == null || !Number.isFinite(baseMax)) return null;
  return Math.round(baseMax + Math.min(60, baseMax * 0.15));
}

/**
 * @param {{ mode: string, underMax?: number, min?: number|null, max?: number|null }} filter normalized
 * @returns {number|null} max nightly cap (with flex applied)
 */
function budgetMaxNightlyCap(filter, flexOn) {
  if (!filter || filter.mode === "any") return null;
  if (filter.mode === "under") {
    let max = filter.underMax;
    if (flexOn !== false) max = budgetFlexMaxPrice(max);
    return max;
  }
  if (filter.mode === "range" && filter.max != null) {
    let max = filter.max;
    if (flexOn !== false) max = budgetFlexMaxPrice(max);
    return max;
  }
  return null;
}

function roomTypeMustHavesMet(rt, mustKeys) {
  if (!mustKeys?.length) return true;
  if (rt?.must_haves_met === true) return true;
  if (rt?.must_haves_met === false) return false;
  return null;
}

function roomsMatchingMustHaves(hotel, mustKeys) {
  const rooms = (hotel?.roomTypes || []).filter(isIndexedGuestRoom);
  if (!mustKeys?.length) return rooms;

  let eligible = rooms.filter((rt) => roomTypeMustHavesMet(rt, mustKeys) === true);
  if (!eligible.length) {
    const hasExplicit = rooms.some(
      (rt) => rt?.must_haves_met === true || rt?.must_haves_met === false
    );
    if (!hasExplicit && hotel?.featured_room) {
      const fr = hotel.featured_room;
      const srv = rooms.find(
        (rt) =>
          (fr.roomTypeId != null && String(rt.roomTypeId) === String(fr.roomTypeId)) ||
          (fr.name && rt.name === fr.name)
      );
      if (srv) eligible = [srv];
    }
  }
  return eligible;
}

function roomResolvedNightly(rt, hotel) {
  return resolveRoomRateForType(rt, hotel).price;
}

function roomMeetsBudgetCap(rt, hotel, maxCap, minCap) {
  const p = roomResolvedNightly(rt, hotel);
  if (p == null) return false;
  if (maxCap != null && Number.isFinite(maxCap) && p > maxCap) return false;
  if (minCap != null && Number.isFinite(minCap) && p < minCap) return false;
  return true;
}

/**
 * True when hotel has at least one must-have-eligible room with a resolved price in range.
 */
function hotelHasInBudgetPricedRoom(hotel, filter, flexOn, mustKeys) {
  const maxCap = budgetMaxNightlyCap(filter, flexOn);
  const minCap = filter?.mode === "range" ? filter.min ?? null : null;
  if (maxCap == null && minCap == null) return true;

  const keys = mustKeys || [];
  const candidates = roomsMatchingMustHaves(hotel, keys);
  for (const rt of candidates) {
    if (roomMeetsBudgetCap(rt, hotel, maxCap, minCap)) return true;
  }

  if (!keys.length) {
    for (const price of Object.values(hotel?.roomPrices || {})) {
      const p = Number(price);
      if (!Number.isFinite(p)) continue;
      if (maxCap != null && p > maxCap) continue;
      if (minCap != null && p < minCap) continue;
      return true;
    }
  }
  return false;
}

function pickInBudgetFeaturedRoom(hotel, filter, flexOn, mustKeys, priceSort) {
  const maxCap = budgetMaxNightlyCap(filter, flexOn);
  const minCap = filter?.mode === "range" ? filter.min ?? null : null;
  if (maxCap == null && minCap == null) return null;

  const keys = mustKeys || [];
  let eligible = roomsMatchingMustHaves(hotel, keys);
  eligible = eligible.filter((rt) => roomMeetsBudgetCap(rt, hotel, maxCap, minCap));
  if (!eligible.length) return null;

  if (priceSort) {
    return [...eligible].sort(
      (a, b) => roomResolvedNightly(a, hotel) - roomResolvedNightly(b, hotel)
    )[0];
  }
  return [...eligible].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
}

module.exports = {
  isIndexedGuestRoom,
  budgetFlexMaxPrice,
  budgetMaxNightlyCap,
  roomTypeMustHavesMet,
  roomsMatchingMustHaves,
  roomResolvedNightly,
  roomMeetsBudgetCap,
  hotelHasInBudgetPricedRoom,
  pickInBudgetFeaturedRoom,
};
