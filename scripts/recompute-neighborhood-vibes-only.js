/**
 * Recompute only neighborhood vibe payloads (Overpass + photos + scores) for one city.
 * Run after fixing bbox/polygon in SQL so in-memory geometry matches DB.
 *
 *   node scripts/recompute-neighborhood-vibes-only.js "Mexico City"
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const ng = require("./neighborhood-generator");

const city = process.argv[2] || "Mexico City";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  if (!process.env.GEMINI_KEY || !process.env.UNSPLASH_KEY) {
    console.error("GEMINI_KEY and UNSPLASH_KEY required");
    process.exit(1);
  }
  const db = createClient(url, key);
  const n = await ng.recomputeNeighborhoodVibes(
    city,
    db,
    process.env.UNSPLASH_KEY,
    process.env.GOOGLE_PLACES_KEY || null,
    process.env.GEMINI_KEY,
    process.env.PEXELS_KEY || null,
    process.env.FLICKR_KEY || null,
  );
  console.log("[recompute-only] done, rows:", n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
