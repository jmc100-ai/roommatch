/**
 * Featured room selection — keep in sync with client/app.js pickFeaturedRoomType().
 * Picks one indexed room per hotel; room match % and card highlight use the same room.
 */

function isPseudoPublicRoom(rt) {
  const n = String(rt?.name || "").trim().toLowerCase();
  return n === "__hotel_public__";
}

function roomMustHavesMet(rt, mustKeys) {
  if (!mustKeys?.length) return true;
  if (rt?.must_haves_met === true) return true;
  if (rt?.must_haves_met === false) return false;
  return null;
}

function resolveFeaturedFromServer(hotel, rooms, ctx) {
  const fr = hotel?.featured_room;
  if (!fr?.name && fr?.roomTypeId == null) return null;
  return (
    rooms.find(
      (rt) =>
        (fr.roomTypeId != null && String(rt.roomTypeId) === String(fr.roomTypeId)) ||
        (fr.name && rt.name === fr.name)
    ) || null
  );
}

function roomHasPrice(rt, hotel) {
  if (!rt || rt.roomTypeId == null || !hotel?.roomPrices) return false;
  const id = String(rt.roomTypeId);
  return hotel.roomPrices[id] != null || hotel.roomPrices[rt.roomTypeId] != null;
}

/**
 * @param {object} hotel
 * @param {object} ctx
 * @param {string[]} [ctx.mustKeys]
 * @param {boolean} [ctx.availOnly]
 * @param {boolean} [ctx.priceSort] — cheapest priced room when true + availOnly
 */
function pickFeaturedRoomType(hotel, ctx = {}) {
  const mustKeys = ctx.mustKeys || [];
  const availOnly = !!ctx.availOnly;
  const priceSort = !!ctx.priceSort;

  const rooms = (hotel?.roomTypes || []).filter((rt) => !isPseudoPublicRoom(rt));
  if (!rooms.length) return null;

  let eligible = rooms.filter((rt) => {
    const met = roomMustHavesMet(rt, mustKeys);
    if (met === false) return false;
    if (!availOnly || roomHasPrice(rt, hotel)) {
      if (met === true) return true;
      if (!mustKeys.length) return true;
    }
    return false;
  });

  if (!eligible.length && mustKeys.length) {
    const hasExplicit = rooms.some((rt) => rt?.must_haves_met === true || rt?.must_haves_met === false);
    if (!hasExplicit) {
      const srv = resolveFeaturedFromServer(hotel, rooms, ctx);
      if (srv && (!availOnly || roomHasPrice(srv, hotel))) return srv;
    }
  }
  if (!eligible.length) return null;

  if (priceSort && availOnly) {
    return [...eligible].sort(
      (a, b) =>
        (Number(hotel.roomPrices[a.roomTypeId]) || 0) -
        (Number(hotel.roomPrices[b.roomTypeId]) || 0)
    )[0];
  }

  return [...eligible].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
}

function featuredRoomMatchPct(hotel, ctx = {}) {
  const rooms = hotel?.roomTypes || [];
  if (!rooms.length) return Math.round(Number(hotel?.vectorScore) || 0);

  const picked = pickFeaturedRoomType(hotel, ctx);
  if (picked && (picked.score || 0) > 0) return Math.round(picked.score);

  const fr = hotel?.featured_room;
  if (fr && Number(fr.score) > 0) return Math.round(Number(fr.score));

  if (picked) return Math.round(Number(hotel?.vectorScore) || 0);
  return 0;
}

function sortRoomsFeaturedFirst(rooms, hotel, ctx = {}) {
  const list = rooms || [];
  if (!list.length) return list;
  const featured = pickFeaturedRoomType(hotel, ctx);
  if (!featured) return list;
  const same = (a, b) =>
    a === b ||
    (a?.roomTypeId != null &&
      b?.roomTypeId != null &&
      String(a.roomTypeId) === String(b.roomTypeId)) ||
    (a?.name && b?.name && a.name === b.name);
  const rest = list.filter((rt) => !same(rt, featured));
  return [featured, ...rest];
}

/** Server-side: room-type facts jsonb meets all required must-have keys. */
function factsMeetMustKeys(features, mustKeys) {
  if (!mustKeys?.length) return true;
  const f = features || {};
  return mustKeys.every((fk) => f[fk] === true);
}

module.exports = {
  isPseudoPublicRoom,
  roomMustHavesMet,
  roomHasPrice,
  resolveFeaturedFromServer,
  pickFeaturedRoomType,
  featuredRoomMatchPct,
  sortRoomsFeaturedFirst,
  factsMeetMustKeys,
};
