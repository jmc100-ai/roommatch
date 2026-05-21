#!/usr/bin/env node
/**
 * Neighbourhood repair for any indexed city (OSM polygons + hotel_count + vibe recompute).
 * Same steps as scripts/repair-mexico-city-neighborhoods.js but parameterized.
 *
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_KEY, UNSPLASH_KEY;
 * optional: GOOGLE_PLACES_KEY, PEXELS_KEY, FLICKR_KEY.
 *
 *   node scripts/repair-city-neighborhoods.js --city=Paris
 *   node scripts/repair-city-neighborhoods.js --city=Paris --polygons-only
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const ng = require("./neighborhood-generator");

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

async function main() {
  const city = getArg("city");
  const polygonsOnly = process.argv.includes("--polygons-only");
  if (!city) {
    console.error("Usage: node scripts/repair-city-neighborhoods.js --city=<City> [--polygons-only]");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key);

  console.log(`[repair-nbhd] polygon backfill (${city})…`);
  const poly = await ng.backfillNeighborhoodPolygons(city, db, false);
  console.log("[repair-nbhd] polygons:", poly);

  console.log("[repair-nbhd] refresh hotel_count…");
  await ng.refreshHotelCounts(city, db);

  if (polygonsOnly) {
    console.log("[repair-nbhd] --polygons-only: skipping vibe recompute");
    return;
  }

  const gemini = process.env.GEMINI_KEY;
  const unsplash = process.env.UNSPLASH_KEY;
  if (!gemini || !unsplash) {
    console.warn("[repair-nbhd] skip vibe recompute — set GEMINI_KEY and UNSPLASH_KEY");
    return;
  }

  console.log("[repair-nbhd] recompute neighborhood vibes (Overpass + Gemini, slow)…");
  const n = await ng.recomputeNeighborhoodVibes(
    city,
    db,
    unsplash,
    process.env.GOOGLE_PLACES_KEY || null,
    gemini,
    process.env.PEXELS_KEY || null,
    process.env.FLICKR_KEY || null,
  );
  console.log("[repair-nbhd] vibe rows updated:", n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
