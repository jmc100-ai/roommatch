/**
 * Unit tests for rates snapshot cache key + bookable rank helpers.
 * Run: node scripts/test-rates-snapshot-logic.js
 */
const assert = require("assert");
const {
  buildFullRatesCacheKey,
  parseCacheKeyDates,
  snapshotEnabled,
} = require("../lib/rates-snapshot");
const {
  isHotelBookable,
  applyBookableRank,
} = require("../lib/bookable-rank");

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  passed++;
}

// Cache key
const key = buildFullRatesCacheKey("Mexico City", "2026-06-10", "2026-06-13", "usd");
ok(key.endsWith("|full"), "key ends with |full");
ok(key.includes("MXN") === false, "currency normalized to USD");
const parsed = parseCacheKeyDates(key);
ok(parsed.city === "Mexico City", "parse city");
ok(parsed.checkin === "2026-06-10", "parse checkin");

// Bookable filter preserves order
const hotels = [
  { id: "a", vectorScore: 90, roomTypes: [] },
  { id: "b", vectorScore: 85, roomTypes: [] },
  { id: "c", vectorScore: 80, roomTypes: [] },
];
const rates = {
  prices: { b: 120, c: 99 },
  roomPrices: { a: { "1": 200 } },
  roomNames: {},
  offerIds: {},
  roomFreeCancel: {},
  hotelFreeCancel: {},
};
const br = applyBookableRank(hotels, rates);
ok(br.bookableCount === 3, "three bookable");
ok(br.hotels.map((h) => h.id).join(",") === "a,b,c", "preserves vibe order");
ok(br.hotels[1].price === 120, "price attached");
ok(isHotelBookable("x", { prices: {}, roomPrices: {} }) === false, "unpriced not bookable");

console.log(`test-rates-snapshot-logic: ${passed} assertions passed`);
console.log(`snapshotEnabled default=${snapshotEnabled()}`);
