/**
 * Server/client Best Match parity smoke test (bookable list, no avail re-sort).
 * Run: node scripts/test-bookable-rank-parity.js
 */
const assert = require("assert");
const { applyBookableRank, buildDatedDisplayOrder } = require("../lib/bookable-rank");

const hotels = [
  {
    id: "h1",
    vectorScore: 88,
    nbhd_fit_pct: 70,
    starRating: 4,
    price: null,
    roomTypes: [{ roomTypeId: "101", score: 88, name: "Deluxe" }],
  },
  {
    id: "h2",
    vectorScore: 92,
    nbhd_fit_pct: 65,
    starRating: 5,
    price: null,
    roomTypes: [{ roomTypeId: "201", score: 92, name: "Suite" }],
  },
  {
    id: "h3",
    vectorScore: 95,
    nbhd_fit_pct: 60,
    starRating: 3,
    price: null,
    roomTypes: [{ roomTypeId: "301", score: 95, name: "Standard" }],
  },
];

const rates = {
  prices: { h1: 150, h2: 400, h3: 90 },
  roomPrices: {
    h1: { 101: 150 },
    h2: { 201: 400 },
    h3: { 301: 90 },
  },
  roomNames: {},
  offerIds: {},
  roomFreeCancel: {},
  hotelFreeCancel: {},
};

const { hotels: bookable } = applyBookableRank(hotels, rates);
assert.strictEqual(bookable.length, 3);

const stats = { nbhd_rank_weight: 0.55, nbhd_blend_applied: true };
const profile = { answers: { priceMatters: 0 }, prefs: {}, dealbreakers: [] };
const ordered = buildDatedDisplayOrder(bookable, stats, profile);

assert.ok(ordered.length === 3);
assert.deepStrictEqual(new Set(ordered.map((h) => h.id)), new Set(["h1", "h2", "h3"]));

console.log("test-bookable-rank-parity: OK", ordered.map((h) => h.id).join(" → "));
