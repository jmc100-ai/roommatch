#!/usr/bin/env node
/**
 * Regression: LiteAPI puts offerId on the roomTypes offer row, not rates[0].
 */
const assert = require("assert");
const { mergeLiteRatesIntoMaps } = require("../lib/lite-rates");

const nights = 7;
const acc = {
  prices: {},
  roomPrices: {},
  roomNames: {},
  offerIds: {},
  roomFreeCancel: {},
  hotelFreeCancel: {},
};

mergeLiteRatesIntoMaps(
  [
    {
      hotelId: "lp3e1a2",
      roomTypes: [
        {
          offerId: "offer-on-room-type-row",
          rates: [
            {
              mappedRoomId: 1178486,
              name: "Double Room with Two Double Beds",
              retailRate: { total: [{ amount: 700 }] },
            },
          ],
        },
      ],
    },
  ],
  nights,
  acc
);

assert.strictEqual(acc.roomPrices.lp3e1a2["1178486"], 100);
assert.strictEqual(
  acc.offerIds.lp3e1a2["1178486"],
  "offer-on-room-type-row",
  "offerId must be read from roomTypes row"
);

// Legacy shape: offerId only on rate row still works.
const acc2 = {
  prices: {},
  roomPrices: {},
  roomNames: {},
  offerIds: {},
  roomFreeCancel: {},
  hotelFreeCancel: {},
};
mergeLiteRatesIntoMaps(
  [
    {
      hotelId: "h2",
      roomTypes: [
        {
          rates: [
            {
              offerId: "offer-on-rate-row",
              mappedRoomId: 99,
              name: "Standard",
              retailRate: { total: [{ amount: 350 }] },
            },
          ],
        },
      ],
    },
  ],
  nights,
  acc2
);
assert.strictEqual(acc2.offerIds.h2["99"], "offer-on-rate-row");

console.log("test-lite-rates-offerid: OK");
