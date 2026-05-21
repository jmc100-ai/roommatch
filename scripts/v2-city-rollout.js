#!/usr/bin/env node
/**
 * Repeatable local pipeline: V2 full city index + verify + neighbourhood repair.
 * Use for Paris, London, NYC, etc. Production API jobs only after commit + deploy.
 *
 * Phases (default: all):
 *   preflight → reindex → verify → neighborhoods → v1-cleanup (default; --keep-v1 to skip)
 *
 * Examples:
 *   node scripts/v2-city-rollout.js --city=Paris
 *   node scripts/v2-city-rollout.js --city=Paris --limit=1200
 *   node scripts/v2-city-rollout.js --city=Paris --skip-reindex --skip-neighborhoods
 *   node scripts/v2-city-rollout.js --city=Paris --verify-only
 *   node scripts/v2-city-rollout.js --city=Paris --keep-v1
 *
 * Env: LITEAPI_PROD_KEY|LITEAPI_KEY, GEMINI_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *      UNSPLASH_KEY (neighbourhoods), optional GOOGLE_PLACES_KEY / PEXELS_KEY / FLICKR_KEY
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { reindexCityV2 } = require("./index-city-v2");
const ng = require("./neighborhood-generator");

const COUNTRY_CODES = {
  "mexico city": "MX",
  paris: "FR",
  "kuala lumpur": "MY",
  london: "GB",
  "new york city": "US",
};

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function liteCatalogTotal(city, cc) {
  const key = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
  if (!key) throw new Error("Missing LITEAPI_PROD_KEY / LITEAPI_KEY");
  const params = new URLSearchParams({ limit: "1", offset: "0" });
  if (cc) {
    params.set("countryCode", cc);
    params.set("cityName", city);
  } else {
    params.set("city", city);
  }
  const url = `https://api.liteapi.travel/v3.0/data/hotels?${params}`;
  const r = await fetch(url, {
    headers: { "X-API-Key": key, accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`LiteAPI /data/hotels ${r.status}`);
  const data = await r.json();
  const total = data?.total ?? data?.count ?? null;
  if (total == null) {
    // Paginate first page if total missing
    params.set("limit", "1000");
    const r2 = await fetch(`https://api.liteapi.travel/v3.0/data/hotels?${params}`, {
      headers: { "X-API-Key": key, accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const d2 = await r2.json();
    const page = d2?.data || [];
    return page.length;
  }
  return Number(total);
}

async function countRows(db, table, city) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("city", city);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function preflight(city) {
  const cc = COUNTRY_CODES[city.toLowerCase()] || "";
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

async function verifyV2(city, db) {
  console.log("\n══ verify V2 ══");
  const { data: status } = await db
    .from("v2_indexed_cities")
    .select("status, hotel_count, photo_count, completed_at, last_error")
    .eq("city", city)
    .single();

  const hotels = await countRows(db, "v2_hotels_cache", city);
  const inventory = await countRows(db, "v2_room_inventory", city);
  const facts = await countRows(db, "v2_room_feature_facts", city);
  const roomTypes = await countRows(db, "v2_room_types_index", city);

  const { count: hotelPublic } = await db
    .from("v2_room_inventory")
    .select("hotel_id", { count: "exact", head: true })
    .eq("city", city)
    .eq("room_name", "__hotel_public__");

  console.log("  v2_indexed_cities:", status || { status: "none" });
  console.log(`  counts: hotels=${hotels} inventory=${inventory} facts=${facts} room_types=${roomTypes} hotel_public_hotels=${hotelPublic ?? 0}`);

  const errors = [];
  if (!status || status.status !== "complete") errors.push(`v2_indexed_cities.status is not complete (${status?.status})`);
  if (hotels < 100) errors.push(`v2_hotels_cache too low (${hotels})`);
  if (inventory < 1000) errors.push(`v2_room_inventory too low (${inventory})`);
  if (roomTypes < 100) errors.push(`v2_room_types_index too low (${roomTypes})`);
  if (facts < 1000) errors.push(`v2_room_feature_facts too low (${facts})`);

  const { data: styleRows } = await db
    .from("v2_room_feature_facts")
    .select("fact_key, hotel_id")
    .eq("city", city)
    .like("fact_key", "visual_style_%")
    .eq("fact_value", 1);
  const styleHotels = new Set((styleRows || []).map((r) => r.hotel_id)).size;
  console.log(`  visual_style yes-rows: ${(styleRows || []).length} (${styleHotels} distinct hotels)`);

  if (errors.length) {
    console.error("  VERIFY FAILED:");
    for (const e of errors) console.error(`    - ${e}`);
    return false;
  }
  console.log("  VERIFY OK");
  return true;
}

async function runNeighborhoods(city, db, { regenerate }) {
  console.log("\n══ neighbourhoods ══");
  if (regenerate) {
    const gemini = process.env.GEMINI_KEY;
    const unsplash = process.env.UNSPLASH_KEY;
    if (!gemini) throw new Error("GEMINI_KEY required for --regenerate-neighborhoods");
    let deleteQ = db.from("neighborhoods").delete().eq("city", city).eq("manual_override", false);
    const { error: delErr } = await deleteQ;
    if (delErr) throw new Error(`neighborhood delete: ${delErr.message}`);
    const rows = await ng.generateNeighborhoods(
      city, db, gemini, unsplash,
      process.env.GOOGLE_PLACES_KEY || null,
      process.env.PEXELS_KEY || null,
      process.env.FLICKR_KEY || null,
    );
    console.log(`  generated ${rows.length} neighborhoods`);
  }

  console.log("  polygon backfill…");
  const poly = await ng.backfillNeighborhoodPolygons(city, db, false);
  console.log("  polygons:", poly);

  await ng.refreshHotelCounts(city, db);

  const gemini = process.env.GEMINI_KEY;
  const unsplash = process.env.UNSPLASH_KEY;
  if (!gemini || !unsplash) {
    console.warn("  skip vibe recompute — set GEMINI_KEY and UNSPLASH_KEY");
    return;
  }
  console.log("  vibe recompute (Overpass + Gemini)…");
  const n = await ng.recomputeNeighborhoodVibes(
    city, db, unsplash,
    process.env.GOOGLE_PLACES_KEY || null,
    gemini,
    process.env.PEXELS_KEY || null,
    process.env.FLICKR_KEY || null,
  );
  console.log(`  vibe rows updated: ${n}`);
}

async function cleanupV1(city, db, dryRun) {
  console.log(`\n══ V1 cleanup (dry_run=${dryRun}) ══`);
  const tables = ["room_embeddings", "room_types_index", "indexed_cities", "hotel_profile_index"];
  for (const table of tables) {
    if (dryRun) {
      const n = await countRows(db, table, city);
      console.log(`  ${table}: would delete ${n} rows`);
    } else {
      const { error } = await db.from(table).delete().eq("city", city);
      if (error) console.error(`  ${table}: ${error.message}`);
      else console.log(`  ${table}: deleted`);
    }
  }
}

async function main() {
  const city = getArg("city");
  if (!city) {
    console.error("Usage: node scripts/v2-city-rollout.js --city=<City> [options]");
    console.error("  --limit=N          LiteAPI fetch cap (default: catalog total + 50)");
    console.error("  --skip-reindex     Skip V2 index");
    console.error("  --skip-neighborhoods");
    console.error("  --regenerate-neighborhoods  Wipe non-manual hood rows + Gemini regen");
    console.error("  --verify-only      Run preflight + verify only");
    console.error("  --keep-v1             Skip V1 table cleanup after successful verify");
    process.exit(1);
  }

  const { catalogTotal, db } = await preflight(city);

  if (hasFlag("--verify-only")) {
    const ok = await verifyV2(city, db);
    process.exit(ok ? 0 : 1);
  }

  if (!hasFlag("--skip-reindex")) {
    const limitArg = getArg("limit");
    const limit = limitArg ? Number(limitArg) : catalogTotal + 50;
    console.log(`\n══ V2 reindex (force=true, limit=${limit}) ══`);
    console.log("  This may take several hours. Monitor [v2-index] logs.");
    const result = await reindexCityV2(city, limit, true);
    console.log("  reindex result:", result);
  }

  const ok = await verifyV2(city, db);
  if (!ok) {
    console.error("\nAborting: fix V2 index before neighbourhoods / V1 cleanup.");
    process.exit(1);
  }

  if (!hasFlag("--skip-neighborhoods")) {
    await runNeighborhoods(city, db, { regenerate: hasFlag("--regenerate-neighborhoods") });
  }

  if (!hasFlag("--keep-v1")) {
    await cleanupV1(city, db, false);
  } else {
    console.log("\n  V1 cleanup skipped (--keep-v1).");
  }

  console.log("\n══ post-rollout (manual) ══");
  console.log("  1. Commit + push + deploy Render (if code changed)");
  console.log("  2. Restart Render so loadV2Cities() includes this city for /api/rates");
  console.log("  3. Migrate Paris tests in search-test-lib.js to source:v2 if not done");
  console.log("  4. node scripts/test-search-quality.js --base-url=...");
  console.log(`  5. Smoke: GET /api/vsearch?city=${encodeURIComponent(city)}&query=double+sinks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
