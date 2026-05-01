/**
 * Triggers rebuild_v2_room_types_index_city() for a given city.
 * Usage: node scripts/rebuild-v2-city-index.js "Mexico City"
 *        node scripts/rebuild-v2-city-index.js "Kuala Lumpur"
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const city = process.argv[2];
if (!city) {
  console.error("Usage: node scripts/rebuild-v2-city-index.js <city>");
  process.exit(1);
}

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  console.log(`Rebuilding v2_room_types_index for "${city}"...`);
  const t0 = Date.now();

  const { data, error } = await db.rpc("rebuild_v2_room_types_index_city", {
    p_city: city,
  });

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s — ${data} room types indexed.`);

  // Quick sanity check
  const { data: sample, error: e2 } = await db
    .from("v2_room_types_index")
    .select("hotel_id, room_name, facts, photo_count")
    .eq("city", city)
    .limit(3);

  if (!e2 && sample?.length) {
    console.log("\nSample rows:");
    for (const r of sample) {
      const factCount = Object.keys(r.facts || {}).length;
      console.log(`  ${r.hotel_id} | ${r.room_name} | ${factCount} facts | ${r.photo_count} photos`);
    }
  }
}

main().catch(console.error);
