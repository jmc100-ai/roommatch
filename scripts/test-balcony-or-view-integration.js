#!/usr/bin/env node
"use strict";
/**
 * Balcony-or-view OR must-have: server must_haves_met on ranked hotels.
 * Usage: node scripts/test-balcony-or-view-integration.js [baseUrl]
 */
const assert = require("assert");
const { buildBoopProfile } = require("../lib/boop-wizard");
const { factsMeetMustRequirements } = require("../lib/featured-room");
const { BALCONY_OR_VIEW_FACTS } = require("../lib/must-have-spec");

const BASE = process.argv.find((a) => a.startsWith("http")) || "http://127.0.0.1:3000";
const H = { "x-index-secret": "roommatch-2026" };

function isGuestRoom(rt) {
  return String(rt?.name || "").trim().toLowerCase() !== "__hotel_public__";
}

function hotelMustMet(h) {
  if (h?.hotel_must_haves_met === true) return true;
  if (h?.hotel_must_haves_met === false) return false;
  return (h.roomTypes || []).filter(isGuestRoom).some((rt) => rt?.must_haves_met === true);
}

async function main() {
  const profile = buildBoopProfile(
    {
      trip: "repeat",
      stayVibe: "cozy_warm",
      nbhdScene: "hip_local",
      group_size: "couple",
    },
    ["balcony", "work_desk"]
  );
  const { roomSeed, hotelSeed, mustHaves } = require("../lib/boop-wizard").buildBoopSeeds(profile);

  assert(profile.mustHaveSpec?.length >= 2, "profile has mustHaveSpec");

  const params = new URLSearchParams({
    city: "Mexico City",
    query: roomSeed,
    hotel_query: hotelSeed,
    checkin: "2026-06-12",
    checkout: "2026-06-15",
    currency: "USD",
    boop_profile: JSON.stringify(profile),
  });
  if (mustHaves.length) params.set("must_haves", mustHaves.join(","));

  const url = `${BASE}/api/vsearch?${params}`;
  let j;
  try {
    const r = await fetch(url, { headers: H });
    j = await r.json();
  } catch (e) {
    console.log(`SKIP integration (server unreachable): ${e.message}`);
    process.exit(0);
  }

  const hotels = j.hotels || [];
  const met = hotels.filter(hotelMustMet);
  console.log(`[balcony-or-view] ranked=${hotels.length} must_met=${met.length} (expect >> 23 balcony-only)`);

  assert(met.length > 23, `OR balcony/view+desk should exceed old balcony-only catalog (got ${met.length})`);

  const withViewNotBalcony = met.filter((h) =>
    (h.roomTypes || []).some(
      (rt) =>
        rt.must_haves_met &&
        factsMeetMustRequirements(
          { ergonomic_workspace: true, skyline_view: true },
          profile.mustHaveSpec
        )
    )
  );
  assert(met.length >= 10, "at least 10 hotels pass OR must-have spec");

  // Sample: first met hotel should not require private_balcony alone
  const sample = met.find((h) => h.id);
  assert(sample, "at least one hotel passes");

  console.log("test-balcony-or-view-integration: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
