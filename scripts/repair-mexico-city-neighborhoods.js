/**
 * One-shot: OSM polygon repair + hotel_count refresh + vibe recompute for Mexico City.
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_KEY, UNSPLASH_KEY;
 * optional: GOOGLE_PLACES_KEY, PEXELS_KEY, FLICKR_KEY.
 *
 *   node scripts/repair-mexico-city-neighborhoods.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const ng = require("./neighborhood-generator");

const CITY = "Mexico City";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
  }
  const db = createClient(url, key);

  console.log(`[repair] polygon backfill (${CITY})…`);
  const poly = await ng.backfillNeighborhoodPolygons(CITY, db, false);
  console.log("[repair] polygons:", poly);

  console.log(`[repair] refresh hotel_count…`);
  await ng.refreshHotelCounts(CITY, db);

  const gemini = process.env.GEMINI_KEY;
  const unsplash = process.env.UNSPLASH_KEY;
  if (!gemini || !unsplash) {
    console.warn("[repair] skip vibe recompute — set GEMINI_KEY and UNSPLASH_KEY");
    process.exit(0);
  }

  console.log(`[repair] recompute neighborhood vibes (slow)…`);
  const n = await ng.recomputeNeighborhoodVibes(
    CITY,
    db,
    unsplash,
    process.env.GOOGLE_PLACES_KEY || null,
    gemini,
    process.env.PEXELS_KEY || null,
    process.env.FLICKR_KEY || null,
  );
  console.log("[repair] vibe rows updated:", n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
