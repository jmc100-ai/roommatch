const assert = require("assert");
const {
  budgetMaxNightlyCap,
  hotelHasInBudgetPricedRoom,
  pickInBudgetFeaturedRoom,
  roomMeetsBudgetCap,
} = require("../lib/budget-room-filter");

const filterUnder400 = { mode: "under", underMax: 400 };
const filterMax450 = { mode: "range", min: null, max: 450 };

const hotel = {
  id: "lp1ce969",
  price: 320,
  roomPrices: {
    111: 320,
    222: 580,
    4782854: 520,
  },
  roomNames: {
    111: "Superior Double",
    222: "Junior Suite Two Double Beds",
    4782854: "Junior Suite with Two Double Beds and Skyline View",
  },
  roomTypes: [
    {
      name: "Superior Room with Two Double Beds and View",
      roomTypeId: "111",
      score: 62,
      must_haves_met: false,
    },
    {
      name: "Junior Suite with Two Double Beds and Skyline View",
      roomTypeId: "4782854",
      score: 86,
      must_haves_met: true,
    },
  ],
  featured_room: {
    name: "Junior Suite with Two Double Beds and Skyline View",
    roomTypeId: "4782854",
  },
};

assert.strictEqual(budgetMaxNightlyCap(filterUnder400, true), 460);
assert.strictEqual(budgetMaxNightlyCap(filterMax450, true), 510);

assert.strictEqual(
  hotelHasInBudgetPricedRoom(hotel, filterMax450, true, ["double_sinks"]),
  false,
  "must-have room over cap should not pass"
);

assert.strictEqual(
  hotelHasInBudgetPricedRoom(hotel, filterUnder400, true, []),
  true,
  "cheapest room under cap passes when no must-haves"
);

assert.strictEqual(
  hotelHasInBudgetPricedRoom(
    {
      ...hotel,
      roomPrices: { 4782854: 420 },
    },
    filterMax450,
    true,
    ["double_sinks"]
  ),
  true,
  "must-have room under flex cap passes"
);

const picked = pickInBudgetFeaturedRoom(
  {
    ...hotel,
    roomPrices: { 111: 320, 4782854: 420 },
  },
  filterMax450,
  true,
  ["double_sinks"],
  false
);
assert.ok(picked);
assert.strictEqual(String(picked.roomTypeId), "4782854");

assert.strictEqual(
  pickInBudgetFeaturedRoom(hotel, filterMax450, true, ["double_sinks"], false),
  null,
  "no in-budget must-have room → no featured pick"
);

assert.strictEqual(
  roomMeetsBudgetCap(hotel.roomTypes[1], hotel, 510, null),
  false,
  "520/night over 510 flex cap"
);

console.log("test-budget-room-filter: ok");
