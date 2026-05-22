#!/usr/bin/env node
/**
 * Local V2 city rollout CLI. For Render/production use:
 *   node scripts/v2-city-rollout-remote.js --city=Paris
 *
 * See docs/v2-city-rollout.md
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { reindexCityV2 } = require("./index-city-v2");
const {
  liteCatalogTotal,
  countryCode,
  countRows,
  verifyV2,
  runNeighborhoods,
  cleanupV1,
  runFullCityRollout,
} = require("./v2-city-rollout-core");

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function preflight(city) {
  const cc = countryCode(city);
  console.log("\n══ preflight ══");
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GEMINI_KEY"];
  const liteKey = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY;
  if (!liteKey) required.push("LITEAPI_PROD_KEY|LITEAPI_KEY");
  for (const k of required) {
    if (k.includes("|")) {
      if (!liteKey) throw new Error(`Missing ${k}`);
    } else if (!process.env[k]) throw new Error(`Missing ${k}`);
  }

  const catalogTotal = await liteCatalogTotal(city, cc);
  console.log(`  LiteAPI catalog total: ${catalogTotal} (country=${cc || "n/a"})`);

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const snap = {
    v2_hotels: await countRows(db, "v2_hotels_cache", city),
    v2_inventory: await countRows(db, "v2_room_inventory", city),
    v2_facts: await countRows(db, "v2_room_feature_facts", city),
    v2_room_types: await countRows(db, "v2_room_types_index", city),
    v1_photos: await countRows(db, "room_embeddings", city),
    nbhds: await countRows(db, "neighborhoods", city),
  };
  console.log("  DB snapshot:", snap);
  return { catalogTotal, db, snap };
}

async function main() {
  const city = getArg("city");
  if (!city) {
    console.error("Usage: node scripts/v2-city-rollout.js --city=<City> [options]");
    console.error("  Prefer Render: node scripts/v2-city-rollout-remote.js --city=<City>");
    console.error("  --limit=N  --skip-reindex  --skip-neighborhoods  --verify-only");
    console.error("  --keep-v1  --resume  --regenerate-neighborhoods");
    process.exit(1);
  }

  const { catalogTotal, db } = await preflight(city);

  if (hasFlag("--verify-only")) {
    const { ok } = await verifyV2(city, db);
    process.exit(ok ? 0 : 1);
  }

  const limitArg = getArg("limit");
  const limit = limitArg ? Number(limitArg) : catalogTotal + 50;
  const force = !hasFlag("--resume");

  await runFullCityRollout({
    db,
    city,
    reindexFn: reindexCityV2,
    limit,
    force,
    skipReindex: hasFlag("--skip-reindex"),
    skipNeighborhoods: hasFlag("--skip-neighborhoods"),
    keepV1: hasFlag("--keep-v1"),
    regenerateNeighborhoods: hasFlag("--regenerate-neighborhoods"),
  });

  console.log("\n══ post-rollout (manual) ══");
  console.log("  Restart Render so loadV2Cities() includes this city for /api/rates");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
