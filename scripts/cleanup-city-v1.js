#!/usr/bin/env node
/**
 * Remove legacy V1 index rows for a city after V2 is verified.
 * Does NOT touch v2_* tables or hotels_cache (coords still used for neighbourhoods).
 *
 *   node scripts/cleanup-city-v1.js --city=Paris
 *   node scripts/cleanup-city-v1.js --city=Paris --dry-run
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const V1_TABLES = [
  "room_embeddings",
  "room_types_index",
  "indexed_cities",
  "hotel_profile_index",
];

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

async function main() {
  const city = getArg("city");
  const dryRun = process.argv.includes("--dry-run");
  if (!city) {
    console.error("Usage: node scripts/cleanup-city-v1.js --city=<City> [--dry-run]");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key);

  console.log(`[cleanup-v1] city=${city} dry_run=${dryRun}`);
  for (const table of V1_TABLES) {
    if (dryRun) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("city", city);
      if (error) console.log(`  ${table}: (count error) ${error.message}`);
      else console.log(`  ${table}: would delete ${count ?? 0} rows`);
      continue;
    }
    const { error } = await db.from(table).delete().eq("city", city);
    if (error) console.error(`  ${table}: ERROR ${error.message}`);
    else console.log(`  ${table}: deleted`);
  }
  console.log("[cleanup-v1] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
