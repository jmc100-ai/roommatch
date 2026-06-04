#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  pickFeaturedRoomType,
  featuredRoomMatchPct,
  sortRoomsFeaturedFirst,
  factsMeetMustKeys,
} = require("../lib/featured-room");
const { buildMatchBreakdown } = require("../lib/match-breakdown");

// Westin-like: deluxe has no double sinks; club suite does.
const westin = {
  id: "lp575cf",
  vectorScore: 100,
  roomTypes: [
    { name: "Deluxe Room, 1 King Bed", score: 45, roomTypeId: "deluxe", must_haves_met: false, photos: ["a"] },
    { name: "Club Corner, Club lounge access, Larger Guest room, 1 King", score: 100, roomTypeId: "club", must_haves_met: true, photos: ["b"] },
    { name: "Master Suite, Club lounge access, 1 Bedroom Junior Suite", score: 100, roomTypeId: "suite", must_haves_met: true, photos: ["c"] },
  ],
  roomPrices: { deluxe: 243, club: 400 },
};

const must = ["double_sinks"];

// Without avail filter: featured = best scoring room that meets must-haves (club/suite 100)
const f1 = pickFeaturedRoomType(westin, { mustKeys: must, availOnly: false });
assert.strictEqual(f1.roomTypeId, "club", "featured is qualifying high-score room, not deluxe");
assert.strictEqual(featuredRoomMatchPct(westin, { mustKeys: must }), 100);
assert.notStrictEqual(f1.name, "Deluxe Room, 1 King Bed");

// Avail only + must: deluxe priced but fails must-haves → club if priced
const f2 = pickFeaturedRoomType(westin, { mustKeys: must, availOnly: true });
assert.ok(f2 && f2.must_haves_met, "priced room must meet must-haves");
assert.strictEqual(f2.roomTypeId, "club");

// Deluxe-only priced scenario
const westin2 = {
  ...westin,
  roomPrices: { deluxe: 243 },
};
const f3 = pickFeaturedRoomType(westin2, { mustKeys: must, availOnly: true });
assert.strictEqual(f3, null, "no room meets must-haves and availability");
assert.strictEqual(featuredRoomMatchPct(westin2, { mustKeys: must, availOnly: true }), 0);

// sort puts featured first
const sorted = sortRoomsFeaturedFirst(westin.roomTypes, westin, { mustKeys: must });
assert.strictEqual(sorted[0].roomTypeId, "club");

// Server facts helper
assert.strictEqual(factsMeetMustKeys({ double_sinks: false }, must), false);
assert.strictEqual(factsMeetMustKeys({ double_sinks: true }, must), true);

// Match breakdown follows featured room, not hotel-wide hits
const hits = new Map([["h1", new Set(["double_sinks"])]]);
const mbDeluxe = buildMatchBreakdown({
  hotelId: "h1",
  topScore: 45,
  mustHaveKeys: must,
  hotelFactHits: hits,
  featuredRoom: { must_haves_met: false },
});
assert.strictEqual(mbDeluxe.must_haves.find((m) => m.fact_key === "double_sinks").status, "none");

const mbClub = buildMatchBreakdown({
  hotelId: "h1",
  topScore: 100,
  mustHaveKeys: must,
  hotelFactHits: hits,
  featuredRoom: { must_haves_met: true },
});
assert.strictEqual(mbClub.must_haves.find((m) => m.fact_key === "double_sinks").status, "met");

// No must-haves: best score wins
const f0 = pickFeaturedRoomType(westin, { mustKeys: [] });
assert.strictEqual(f0.score, 100);

console.log("test-featured-room: ok");
