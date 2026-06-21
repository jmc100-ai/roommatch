/**
 * Shared V2 city rollout logic (local CLI + Render POST /api/v2/city-rollout).
 */
const ng = require("./neighborhood-generator");
const { ensureBoopTripImages } = require("./boop-trip-images");
const { ensureBoopNbhdSceneImages } = require("./boop-nbhd-scene-images");
const {
  COUNTRY_CODES,
  resolveCityConfig,
  countryCode,
  getVerifyThresholds,
} = require("./city-registry");

async function liteCatalogTotal(city, cc, liteKey) {
  const key = liteKey || process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
  if (!key) throw new Error("Missing LITEAPI_PROD_KEY / LITEAPI_KEY");
  const cfg = resolveCityConfig(city);
  const cityName = cfg.liteapiCityName;
  const country = cfg.countryCode || cc || "";
  const params = new URLSearchParams({ limit: "1", offset: "0" });
  if (country) {
    params.set("countryCode", country);
    params.set("cityName", cityName);
  } else {
    params.set("city", cityName);
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
  const cfg = resolveCityConfig(city);
  const cc = cfg.countryCode;
  const displayCity = cfg.displayName;
  const { data: status } = await db
    .from("v2_indexed_cities")
    .select("status, hotel_count, photo_count, started_at, completed_at, last_error, updated_at, index_progress")
    .eq("city", displayCity)
    .maybeSingle();

  const hotels = await countRows(db, "v2_hotels_cache", displayCity);
  const inventory = await countRows(db, "v2_room_inventory", displayCity);
  const facts = await countRows(db, "v2_room_feature_facts", displayCity);
  const roomTypes = await countRows(db, "v2_room_types_index", displayCity);
  const v1Photos = await countRows(db, "room_embeddings", displayCity);
  const nbhds = await countRows(db, "neighborhoods", displayCity);

  const { count: hotelPublic } = await db
    .from("v2_room_inventory")
    .select("hotel_id", { count: "exact", head: true })
    .eq("city", displayCity)
    .eq("room_name", "__hotel_public__");

  return {
    city: displayCity,
    country_code: cc,
    liteapi_city_name: cfg.liteapiCityName,
    quality_policy: {
      indexCap: cfg.indexCap,
      minStars: cfg.minStars,
      minGuestRating: cfg.minGuestRating,
      minRoomPhotos: cfg.minRoomPhotos,
    },
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
  const cfg = resolveCityConfig(city);
  const displayCity = cfg.displayName;
  const thresholds = getVerifyThresholds(cfg);
  const snap = await getRolloutSnapshot(db, displayCity);
  const status = snap.v2_indexed_cities;
  const { v2_hotels: hotels, v2_inventory: inventory, v2_facts: facts, v2_room_types: roomTypes, hotel_public_rows: hotelPublic } = snap.counts;

  log("  v2_indexed_cities:", status);
  log(`  counts: hotels=${hotels} inventory=${inventory} facts=${facts} room_types=${roomTypes} hotel_public_rows=${hotelPublic}`);
  log(`  verify thresholds: hotels>=${thresholds.minHotels} inventory>=${thresholds.minInventory} room_types>=${thresholds.minRoomTypes} facts>=${thresholds.minFacts}`);

  const errors = [];
  if (!status || status.status !== "complete") errors.push(`v2_indexed_cities.status is not complete (${status?.status})`);
  if (hotels < thresholds.minHotels) errors.push(`v2_hotels_cache too low (${hotels} < ${thresholds.minHotels})`);
  if (inventory < thresholds.minInventory) errors.push(`v2_room_inventory too low (${inventory} < ${thresholds.minInventory})`);
  if (roomTypes < thresholds.minRoomTypes) errors.push(`v2_room_types_index too low (${roomTypes} < ${thresholds.minRoomTypes})`);
  if (facts < thresholds.minFacts) errors.push(`v2_room_feature_facts too low (${facts} < ${thresholds.minFacts})`);

  if (errors.length) {
    log("  VERIFY FAILED:");
    for (const e of errors) log(`    - ${e}`);
    return { ok: false, errors, snapshot: snap };
  }
  log("  VERIFY OK");
  return { ok: true, errors: [], snapshot: snap };
}

async function verifyNeighborhoodFences(city, db, { log = console.log } = {}) {
  const cfg = resolveCityConfig(city);
  return ng.verifyNeighborhoodFences(cfg.displayName, db, { log });
}

async function verifyCityRollout(city, db, { log = console.log } = {}) {
  const v2 = await verifyV2(city, db, { log });
  if (!v2.ok) return { ...v2, nbhdFences: null };
  const nbhdFences = await verifyNeighborhoodFences(city, db, { log });
  if (!nbhdFences.ok) {
    return {
      ok: false,
      errors: [...v2.errors, ...nbhdFences.issues],
      snapshot: v2.snapshot,
      nbhdFences,
    };
  }
  return { ok: true, errors: [], snapshot: v2.snapshot, nbhdFences };
}

async function runNeighborhoods(city, db, { regenerate, log = console.log } = {}) {
  log("\n══ neighbourhoods ══");
  if (regenerate) {
    const gemini = process.env.GEMINI_KEY;
    const unsplash = process.env.UNSPLASH_KEY;
    if (!gemini && city !== "London") throw new Error("GEMINI_KEY required for regenerate_neighborhoods");
    const { error: delErr } = await db.from("neighborhoods").delete().eq("city", city).eq("manual_override", false);
    if (delErr) throw new Error(`neighborhood delete: ${delErr.message}`);
    if (city === "London") {
      const { rebuildLondonCanonicalDistricts } = require("./london-canonical-districts");
      await rebuildLondonCanonicalDistricts(db, { log });
      log("  rebuilt 12 London tourist districts");
    } else {
      const rows = await ng.generateNeighborhoods(
        city, db, gemini, unsplash,
        process.env.GOOGLE_PLACES_KEY || null,
        process.env.PEXELS_KEY || null,
        process.env.FLICKR_KEY || null,
      );
      log(`  generated ${rows.length} neighborhoods`);
    }
  }

  log("  polygon backfill…");
  const poly = await ng.backfillNeighborhoodPolygons(city, db, false);
  log("  polygons:", poly);

  await ng.refreshHotelCounts(city, db);
  const curated = await ng.applyCuratedNeighborhoodFences(city, db);
  if (curated.updated) log(`  curated fences applied: ${curated.updated}`);

  if (city === "London") {
    log("  London uses 12 canonical tourist districts (no supplemental coverage pass)");
  } else {
    log("  neighborhood coverage audit…");
    const { ensureNeighborhoodCoverage } = require("./neighborhood-coverage");
    const cov = await ensureNeighborhoodCoverage(city, db, {
      geminiKey: process.env.GEMINI_KEY,
      unsplashKey: process.env.UNSPLASH_KEY,
      googlePlacesKey: process.env.GOOGLE_PLACES_KEY || null,
      pexelsKey: process.env.PEXELS_KEY || null,
      flickrKey: process.env.FLICKR_KEY || null,
    }, { log });
    if (!cov.ok) {
      log(`  ⚠ coverage ${Math.round(cov.coverage_pct * 100)}% still below ${Math.round(cov.threshold * 100)}%`);
    }
  }

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

  log("  boop historic & energetic wizard image…");
  try {
    await ensureBoopNbhdSceneImages(city, db, {
      force: !!regenerate,
      log,
      placesKey: process.env.GOOGLE_PLACES_KEY || null,
      unsplashKey: process.env.UNSPLASH_KEY || null,
      geminiKey: process.env.GEMINI_KEY || null,
    });
  } catch (e) {
    log(`  boop nbhd scene images failed (non-fatal): ${e.message}`);
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

  const cfg = resolveCityConfig(city);
  const displayCity = cfg.displayName;
  const cc = cfg.countryCode;
  const catalogTotal = await liteCatalogTotal(displayCity, cc);
  const limit = limitIn != null ? Number(limitIn) : catalogTotal + 50;
  log(`[v2-rollout] ${displayCity}: catalog=${catalogTotal} limit=${limit} index_cap=${cfg.indexCap || "none"} force=${force}`);

  if (!skipReindex) {
    log(`[v2-rollout] phase=reindex`);
    const result = await reindexFn(displayCity, limit, !!force);
    log(`[v2-rollout] reindex done:`, result);
  }

  log(`[v2-rollout] phase=verify`);
  const { ok } = await verifyV2(displayCity, db, { log });
  if (!ok) {
    const err = new Error("V2 verify failed — neighbourhoods and V1 cleanup skipped");
    err.code = "VERIFY_FAILED";
    throw err;
  }

  if (!skipNeighborhoods) {
    log(`[v2-rollout] phase=neighborhoods`);
    await runNeighborhoods(displayCity, db, { regenerate: regenerateNeighborhoods, log });
  }

  if (!keepV1) {
    log(`[v2-rollout] phase=v1_cleanup`);
    await cleanupV1(displayCity, db, { dryRun: false, log });
  }

  log(`[v2-rollout] phase=done city=${displayCity}`);
  return getRolloutSnapshot(db, displayCity);
}

module.exports = {
  COUNTRY_CODES,
  countryCode,
  resolveCityConfig,
  liteCatalogTotal,
  countRows,
  getRolloutSnapshot,
  verifyV2,
  verifyNeighborhoodFences,
  verifyCityRollout,
  runNeighborhoods,
  cleanupV1,
  runFullCityRollout,
};
