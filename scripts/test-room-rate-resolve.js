#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  resolveRoomRateForType,
  findRateIdByRoomName,
  roomPricePerNight,
} = require("../lib/room-rate-resolve");

const hotel = {
  roomPrices: { "999888": 312, "1169402": 400 },
  roomNames: {
    "999888": "Luxury King Room with Club Millésime Access and Skyline View",
    "1169402": "Club Corner, Club lounge access, Larger Guest room, 1 King",
  },
};

const luxuryRt = {
  name: "Luxury King Room with Club Millésime Access and Skyline View",
  roomTypeId: "wrong-catalog-id",
  score: 78,
};

assert.strictEqual(roomPricePerNight(hotel.roomPrices, "wrong-catalog-id"), null);
const resolved = resolveRoomRateForType(luxuryRt, hotel);
assert.strictEqual(resolved.price, 312);
assert.strictEqual(resolved.bookRoomTypeId, "999888");

assert.strictEqual(
  findRateIdByRoomName(hotel.roomNames, hotel.roomPrices, luxuryRt.name),
  "999888"
);

assert.strictEqual(
  resolveRoomRateForType({ name: "Club Corner", roomTypeId: "1169402" }, hotel).price,
  400
);

console.log("test-room-rate-resolve: ok");
