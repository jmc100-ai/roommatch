/**
 * Shared V2 city rollout logic (local CLI + Render POST /api/v2/city-rollout).
 */
const ng = require("./neighborhood-generator");
const { ensureBoopTripImages } = require("./boop-trip-images");

const COUNTRY_CODES = {
  "mexico city": "MX",
  paris: "FR",
  "kuala lumpur": "MY",
  london: "GB",
  "new york city": "US",
};

function countryCode(city) {
  return COUNTRY_CODES[String(city || "").toLowerCase()] || "";
}

async function liteCatalogTotal(city, cc, liteKey) {
  const key = liteKey || process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
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
    params.set("limit", "1000");
    const r2 = await fetch(`https://api.liteapi.travel/v3.0/data/hotels?${params}`, {
      headers: { "X-API-Key": key, accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const d2 = await r2.json();
    return (d2?.data || []).length;
  }
  return Number(total);
}

async function countRows(db, table, city) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("city", city);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function getRolloutSnapshot(db, city) {
  const cc = countryCode(city);
  const { data: status } = await db
    .from("v2_indexed_cities")
    .select("status, hotel_count, photo_count, started_at, completed_at, last_error, updated_at, index_progress")
    .eq("city", city)
    .maybeSingle();

  const hotels = await countRows(db, "v2_hotels_cache", city);
  const inventory = await countRows(db, "v2_room_inventory", city);
  const facts = await countRows(db, "v2_room_feature_facts", city);
  const roomTypes = await countRows(db, "v2_room_types_index", city);
  const v1Photos = await countRows(db, "room_embeddings", city);
  const nbhds = await countRows(db, "neighborhoods", city);

  const { count: hotelPublic } = await db
    .from("v2_room_inventory")
    .select("hotel_id", { count: "exact", head: true })
    .eq("city", city)
    .eq("room_name", "__hotel_public__");

  return {
    city,
    country_code: cc,
    v2_indexed_cities: status || { status: "none" },
    counts: {
      v2_hotels: hotels,
      v2_inventory: inventory,
      v2_facts: facts,
      v2_room_types: roomTypes,
      hotel_public_rows: hotelPublic ?? 0,
      v1_photos: v1Photos,
      neighborhoods: nbhds,
    },
    progress: {
      hotels_in_cache: hotels,
      status_row_hotels: status?.hotel_count ?? 0,
      status_row_photos: status?.photo_count ?? 0,
    },
  };
}

async function verifyV2(city, db, { log = console.log } = {}) {
  const snap = await getRolloutSnapshot(db, city);
  const status = snap.v2_indexed_cities;
  const { v2_hotels: hotels, v2_inventory: inventory, v2_facts: facts, v2_room_types: roomTypes, hotel_public_rows: hotelPublic } = snap.counts;

  log("  v2_indexed_cities:", status);
  log(`  counts: hotels=${hotels} inventory=${inventory} facts=${facts} room_types=${roomTypes} hotel_public_rows=${hotelPublic}`);

  const errors = [];
  if (!status || status.status !== "complete") errors.push(`v2_indexed_cities.status is not complete (${status?.status})`);
  if (hotels < 100) errors.push(`v2_hotels_cache too low (${hotels})`);
  if (inventory < 1000) errors.push(`v2_room_inventory too low (${inventory})`);
  if (roomTypes < 100) errors.push(`v2_room_types_index too low (${roomTypes})`);
  if (facts < 1000) errors.push(`v2_room_feature_facts too low (${facts})`);

  if (errors.length) {
    log("  VERIFY FAILED:");
    for (const e of errors) log(`    - ${e}`);
    return { ok: false, errors, snapshot: snap };
  }
  log("  VERIFY OK");
  return { ok: true, errors: [], snapshot: snap };
}

async function runNeighborhoods(city, db, { regenerate, log = console.log } = {}) {
  log("\n══ neighbourhoods ══");
  if (regenerate) {
    const gemini = process.env.GEMINI_KEY;
    const unsplash = process.env.UNSPLASH_KEY;
    if (!gemini) throw new Error("GEMINI_KEY required for regenerate_neighborhoods");
    const { error: delErr } = await db.from("neighborhoods").delete().eq("city", city).eq("manual_override", false);
    if (delErr) throw new Error(`neighborhood delete: ${delErr.message}`);
    const rows = await ng.generateNeighborhoods(
      city, db, gemini, unsplash,
      process.env.GOOGLE_PLACES_KEY || null,
      process.env.PEXELS_KEY || null,
      process.env.FLICKR_KEY || null,
    );
    log(`  generated ${rows.length} neighborhoods`);
  }

  log("  polygon backfill…");
  const poly = await ng.backfillNeighborhoodPolygons(city, db, false);
  log("  polygons:", poly);

  await ng.refreshHotelCounts(city, db);

  const gemini = process.env.GEMINI_KEY;
  const unsplash = process.env.UNSPLASH_KEY;
  if (!gemini || !unsplash) {
    log("  skip vibe recompute — set GEMINI_KEY and UNSPLASH_KEY");
    return;
  }
  log("  vibe recompute (Overpass + Gemini)…");
  const n = await ng.recomputeNeighborhoodVibes(
    city, db, unsplash,
    process.env.GOOGLE_PLACES_KEY || null,
    gemini,
    process.env.PEXELS_KEY || null,
    process.env.FLICKR_KEY || null,
  );
  log(`  vibe rows updated: ${n}`);

  log("  boop trip wizard images…");
  try {
    await ensureBoopTripImages(city, db, {
      force: !!regenerate,
      log,
      placesKey: process.env.GOOGLE_PLACES_KEY || null,
      unsplashKey: process.env.UNSPLASH_KEY || null,
      geminiKey: process.env.GEMINI_KEY || null,
    });
  } catch (e) {
    log(`  boop trip images failed (non-fatal): ${e.message}`);
  }
}

async function cleanupV1(city, db, { dryRun = false, log = console.log } = {}) {
  log(`\n══ V1 cleanup (dry_run=${dryRun}) ══`);
  const tables = ["room_embeddings", "room_types_index", "indexed_cities", "hotel_profile_index"];
  for (const table of tables) {
    if (dryRun) {
      const n = await countRows(db, table, city);
      log(`  ${table}: would delete ${n} rows`);
    } else {
      const { error } = await db.from(table).delete().eq("city", city);
      if (error) log(`  ${table}: ${error.message}`);
      else log(`  ${table}: deleted`);
    }
  }
}

/**
 * Full pipeline: reindex → verify → neighbourhoods → V1 cleanup.
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.db
 * @param {string} opts.city
 * @param {function} opts.reindexFn - (city, limit, force) => Promise
 * @param {number} [opts.limit]
 * @param {boolean} [opts.force=true]
 * @param {boolean} [opts.skipReindex=false]
 * @param {boolean} [opts.skipNeighborhoods=false]
 * @param {boolean} [opts.keepV1=false]
 * @param {boolean} [opts.regenerateNeighborhoods=false]
 */
async function runFullCityRollout(opts) {
  const {
    db,
    city,
    reindexFn,
    limit: limitIn,
    force = true,
    skipReindex = false,
    skipNeighborhoods = false,
    keepV1 = false,
    regenerateNeighborhoods = false,
    log = console.log,
  } = opts;

  const cc = countryCode(city);
  const catalogTotal = await liteCatalogTotal(city, cc);
  const limit = limitIn != null ? Number(limitIn) : catalogTotal + 50;
  log(`[v2-rollout] ${city}: catalog=${catalogTotal} limit=${limit} force=${force}`);

  if (!skipReindex) {
    log(`[v2-rollout] phase=reindex`);
    const result = await reindexFn(city, limit, !!force);
    log(`[v2-rollout] reindex done:`, result);
  }

  log(`[v2-rollout] phase=verify`);
  const { ok } = await verifyV2(city, db, { log });
  if (!ok) {
    const err = new Error("V2 verify failed — neighbourhoods and V1 cleanup skipped");
    err.code = "VERIFY_FAILED";
    throw err;
  }

  if (!skipNeighborhoods) {
    log(`[v2-rollout] phase=neighborhoods`);
    await runNeighborhoods(city, db, { regenerate: regenerateNeighborhoods, log });
  }

  if (!keepV1) {
    log(`[v2-rollout] phase=v1_cleanup`);
    await cleanupV1(city, db, { dryRun: false, log });
  }

  log(`[v2-rollout] phase=done city=${city}`);
  return getRolloutSnapshot(db, city);
}

module.exports = {
  COUNTRY_CODES,
  countryCode,
  liteCatalogTotal,
  countRows,
  getRolloutSnapshot,
  verifyV2,
  runNeighborhoods,
  cleanupV1,
  runFullCityRollout,
};
