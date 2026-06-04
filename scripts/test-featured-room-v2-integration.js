#!/usr/bin/env node
"use strict";
/**
 * Integration: runV2Search locally (needs .env Supabase + Gemini).
 *   node scripts/test-featured-room-v2-integration.js
 */
require("dotenv").config();
const assert = require("assert");
const { createClient } = require("@supabase/supabase-js");
const { runV2Search } = require("./search-v2");
const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { pickFeaturedRoomType, featuredRoomMatchPct } = require("../lib/featured-room");

const WESTIN_ID = "lp575cf";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn("test-featured-room-v2-integration: SKIP — no Supabase env");
    process.exit(0);
  }
  const supabase = createClient(url, key);
  const profile = buildBoopProfile({
    answers: { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central" },
    dealbreakers: [],
    freetext: "",
  });
  const { roomSeed, hotelSeed } = buildBoopSeeds(profile);

  const req = {
    query: {
      query: roomSeed,
      city: "Mexico City",
      hotel_query: hotelSeed,
      must_haves: "double_sinks",
      boop_profile: JSON.stringify(profile),
    },
  };

  const result = await runV2Search({
    req,
    supabase,
    supabaseAdmin: supabase,
    resolveCityName: async (city) => city,
  });
  assert.strictEqual(result.status, 200);
  const w = (result.body.hotels || []).find((h) => h.id === WESTIN_ID);
  if (!w) {
    console.warn("Westin not in top payload — may be outside gallery limit; checking any hotel with must_haves_met");
    const sample = (result.body.hotels || []).find(
      (h) => h.roomTypes?.some((r) => r.must_haves_met === true)
    );
    assert.ok(sample, "expected at least one hotel with must_haves_met room in results");
    const fr = pickFeaturedRoomType(sample, { mustKeys: ["double_sinks"] });
    assert.ok(fr?.must_haves_met);
    console.log("test-featured-room-v2-integration: ok (sample hotel)", sample.id, fr.name);
    return;
  }

  assert.ok(w.featured_room, "featured_room on payload");
  assert.strictEqual(w.featured_room.must_haves_met, true);
  assert.ok(w.vectorScore === w.featured_room.score || w.vectorScore <= w.featured_room.score + 1);

  const deluxe = (w.roomTypes || []).find((r) => /deluxe room, 1 king bed$/i.test(r.name));
  if (deluxe) assert.strictEqual(deluxe.must_haves_met, false);

  const featured = pickFeaturedRoomType(w, { mustKeys: ["double_sinks"] });
  assert.ok(featured?.must_haves_met);
  assert.notStrictEqual(featured.name, deluxe?.name);
  assert.strictEqual(featuredRoomMatchPct(w, { mustKeys: ["double_sinks"] }), featured.score);

  console.log("test-featured-room-v2-integration: ok", {
    featured: w.featured_room.name,
    score: w.featured_room.score,
    vectorScore: w.vectorScore,
  });
}

main().catch((e) => {
  console.error("test-featured-room-v2-integration: FAIL", e.message);
  process.exit(1);
});
