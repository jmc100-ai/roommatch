#!/usr/bin/env node
"use strict";
/**
 * Live smoke: Westin Santa Fe + double_sinks must-have.
 *   node scripts/test-featured-room-live.js
 *   node scripts/test-featured-room-live.js --base-url=http://localhost:3000
 */
require("dotenv").config();
const assert = require("assert");
const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { pickFeaturedRoomType, featuredRoomMatchPct } = require("../lib/featured-room");

const BASE = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]
  || process.env.TEST_BASE_URL
  || "https://roommatch-1fg5.onrender.com";
const WESTIN_ID = "lp575cf";

async function main() {
  const profile = buildBoopProfile({
    answers: { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central" },
    dealbreakers: ["spa_bathroom"],
    freetext: "",
  });
  const { roomSeed, hotelSeed } = buildBoopSeeds(profile);
  const params = new URLSearchParams({
    query: roomSeed,
    city: "Mexico City",
    search_version: "v2",
    hotel_query: hotelSeed,
    must_haves: "double_sinks",
    boop_profile: JSON.stringify(profile),
  });
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const res = await fetch(`${BASE}/api/vsearch?${params}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);

  const w = (data.hotels || []).find((h) => h.id === WESTIN_ID);
  assert.ok(w, "Westin should appear with double_sinks must-have");

  const hasExplicit = (w.roomTypes || []).some(
    (r) => r.must_haves_met === true || r.must_haves_met === false
  );
  if (!hasExplicit && !w.featured_room) {
    console.warn(
      "test-featured-room-live: SKIP — deploy server with featured_room / must_haves_met (not on API yet)"
    );
    process.exit(0);
  }

  const featured = pickFeaturedRoomType(w, { mustKeys: ["double_sinks"], availOnly: false });
  const pct = featuredRoomMatchPct(w, { mustKeys: ["double_sinks"] });

  assert.ok(featured, "Westin should have a qualifying featured room");
  assert.strictEqual(featured.must_haves_met, true);
  assert.ok(
    !/deluxe room, 1 king bed/i.test(featured.name) || featured.must_haves_met,
    "featured room should not be deluxe without must-haves"
  );
  assert.strictEqual(pct, featured.score, "display pct matches featured room score");
  assert.ok(
    w.roomTypes[0].must_haves_met !== false || w.roomTypes[0].name === featured.name,
    "first roomTypes entry should be featured (must-haves met first)"
  );

  const deluxe = (w.roomTypes || []).find((r) => /deluxe room, 1 king bed/i.test(r.name));
  if (deluxe) {
    assert.strictEqual(deluxe.must_haves_met, false, "deluxe indexed as no double sinks");
    assert.notStrictEqual(featured.name, deluxe.name, "featured is not deluxe");
  }

  console.log("test-featured-room-live: ok", {
    featured: featured.name,
    score: featured.score,
    vectorScore: w.vectorScore,
    firstRoom: w.roomTypes[0]?.name,
  });
}

main().catch((e) => {
  console.error("test-featured-room-live: FAIL", e.message);
  process.exit(1);
});
