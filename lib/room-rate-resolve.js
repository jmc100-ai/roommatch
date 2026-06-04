/**
 * Match indexed room rows to LiteAPI rate maps (roomPrices / roomNames).
 * Keep in sync with client/app.js resolveRoomRateForType().
 */

function normalizeRoomNameForRate(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roomPricePerNight(roomPrices, roomTypeId) {
  if (roomTypeId == null || !roomPrices) return null;
  const v = roomPrices[roomTypeId] ?? roomPrices[String(roomTypeId)];
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

/**
 * Find a rates map key when catalog room_type_id does not match mappedRoomId.
 */
function findRateIdByRoomName(roomNames, roomPrices, targetName) {
  if (!roomNames || !targetName) return null;
  const target = normalizeRoomNameForRate(targetName);
  if (!target) return null;

  let bestId = null;
  let bestLen = 0;
  for (const [id, label] of Object.entries(roomNames)) {
    if (roomPricePerNight(roomPrices, id) == null) continue;
    const n = normalizeRoomNameForRate(label);
    if (!n) continue;
    if (n === target) return id;
    if (n.includes(target) || target.includes(n)) {
      const len = Math.min(n.length, target.length);
      if (len > bestLen) {
        bestLen = len;
        bestId = id;
      }
    }
  }
  return bestId;
}

/**
 * @returns {{ price: number|null, bookRoomTypeId: string|number|null }}
 */
function resolveRoomRateForType(rt, hotel) {
  const roomPrices = hotel?.roomPrices;
  if (!roomPrices) {
    return { price: null, bookRoomTypeId: rt?.roomTypeId ?? null };
  }

  let bookId = rt?.roomTypeId ?? null;
  let price = roomPricePerNight(roomPrices, bookId);

  if (price == null && rt?.name) {
    const altId = findRateIdByRoomName(hotel.roomNames, roomPrices, rt.name);
    if (altId != null) {
      const altPrice = roomPricePerNight(roomPrices, altId);
      if (altPrice != null) {
        bookId = altId;
        price = altPrice;
      }
    }
  }

  return { price, bookRoomTypeId: bookId };
}

module.exports = {
  normalizeRoomNameForRate,
  roomPricePerNight,
  findRateIdByRoomName,
  resolveRoomRateForType,
};
