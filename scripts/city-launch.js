#!/usr/bin/env node
/**
 * Local V2 city launch orchestrator — preflight, index, watch, post-index phases.
 *
 *   node scripts/city-launch.js --city=London --phase=preflight
 *   node scripts/city-launch.js --city=London --phase=index
 *   node scripts/city-launch.js --city=London --phase=index --canary=200
 *   node scripts/city-launch.js --city=London --phase=index --resume
 *   node scripts/city-launch.js --city=London --phase=watch --interval=5
 *   node scripts/city-launch.js --city=London --phase=classify-public
 *   node scripts/city-launch.js --city=London --phase=neighborhoods
 *   node scripts/city-launch.js --city=London --phase=verify
 *   node scripts/city-launch.js --city=London --phase=geo-backfill
 *   node scripts/city-launch.js --city=London --phase=geo-backfill --quota=5
 */
require("dotenv").config();

// Must run before require("./index-city-v2") — that module reads env at load time.
process.env.V2_SKIP_HOTEL_PUBLIC = process.env.V2_SKIP_HOTEL_PUBLIC || "1";
process.env.V2_MAX_INFLIGHT_PHOTOS = process.env.V2_MAX_INFLIGHT_PHOTOS || "12";
process.env.V2_HOTEL_CONCURRENCY = process.env.V2_HOTEL_CONCURRENCY || "2";
process.env.V2_BATCH_SIZE = process.env.V2_BATCH_SIZE || "10";
process.env.V2_CAPTION_RATE_PER_MIN = process.env.V2_CAPTION_RATE_PER_MIN || "1200";

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { resolveCityConfig, getVerifyThresholds } = require("./city-registry");
const { reindexCityV2, fetchAndSortCatalog, rebuildV2RoomTypesIndex, geoBackfillCityV2 } = require("./index-city-v2");
const {
  liteCatalogTotal,
  getRolloutSnapshot,
  verifyV2,
  verifyCityRollout,
  runNeighborhoods,
} = require("./v2-city-rollout-core");
const { classifyHotelPublicForCity } = require("./classify-hotel-public");

const RENDER_BASE = (process.env.RENDER_BASE_URL || "https://roommatch-1fg5.onrender.com").replace(/\/$/, "");
const INDEX_SECRET = process.env.INDEX_SECRET || "roommatch-2026";

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function applyIndexEnv() {
  /* env applied at module load — see top of file */
}

function getDb() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function checkRenderStatus(city) {
  const url = `${RENDER_BASE}/api/v2/city-rollout/status?city=${encodeURIComponent(city)}`;
  const r = await fetch(url, {
    headers: { "x-index-secret": INDEX_SECRET, accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Render status ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

function formatSnapshot(snap) {
  const st = snap.v2_indexed_cities || {};
  const c = snap.counts || {};
  const prog = st.index_progress || {};
  const lines = [
    `[${new Date().toISOString()}] ${snap.city}`,
    `  status: ${st.status || "none"} | rollout_running: ${snap.rollout_running ?? "?"}`,
    `  v2_hotels: ${c.v2_hotels} | inventory: ${c.v2_inventory} | facts: ${c.v2_facts} | room_types: ${c.v2_room_types}`,
    `  quality: index_cap=${snap.quality_policy?.indexCap ?? "?"} min_stars=${snap.quality_policy?.minStars ?? "?"}`,
  ];
  if (prog.queue_total != null) {
    lines.push(
      `  index_progress: queue=${prog.queue_offset ?? "?"}/${prog.queue_total} indexed=${prog.indexed_in_cache ?? "?"} ` +
      `skip_star=${prog.skipped_star_filter ?? 0} cap=${prog.index_cap ?? "?"} stopped_at_cap=${prog.stopped_at_cap ?? false}`,
    );
  } else if (prog.liteapi_offset != null) {
    lines.push(`  index_progress (legacy): liteapi_offset=${prog.liteapi_offset} indexed=${prog.indexed_in_cache ?? "?"}`);
  }
  if (st.last_error) lines.push(`  last_error: ${st.last_error}`);
  if (st.updated_at) lines.push(`  updated: ${st.updated_at}`);
  return lines.join("\n");
}

async function phaseQuickPreflight(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const liteKey = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY;
  if (!liteKey || !process.env.SUPABASE_SERVICE_KEY || !process.env.GEMINI_KEY) {
    throw new Error("Missing required env keys — run --phase=preflight first");
  }
  const remote = await checkRenderStatus(city);
  if (remote.rollout_running) {
    throw new Error("Render rollout_running=true — abort local index");
  }
  const rSt = remote.v2_indexed_cities || {};
  if (rSt.status === "indexing" && rSt.updated_at) {
    const ageMs = Date.now() - new Date(rSt.updated_at).getTime();
    if (ageMs < 5 * 60 * 1000) {
      throw new Error(`Render fresh indexing heartbeat (${Math.round(ageMs / 1000)}s ago)`);
    }
  }
  return { city, cfg };
}

async function phasePreflight(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  console.log(`\n══ city-launch preflight: ${city} ══\n`);

  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "GEMINI_KEY"];
  const liteKey = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY;
  if (!liteKey) required.push("LITEAPI_PROD_KEY|LITEAPI_KEY");
  for (const k of required) {
    if (k.includes("|")) {
      if (!liteKey) throw new Error(`Missing ${k}`);
    } else if (!process.env[k]) {
      throw new Error(`Missing ${k}`);
    }
  }
  console.log("  env keys: OK");

  console.log("  registry:", {
    liteapiCityName: cfg.liteapiCityName,
    liteapiSatelliteCities: cfg.liteapiSatelliteCities || [],
    countryCode: cfg.countryCode,
    tier: cfg.tier,
    indexCap: cfg.indexCap || "none",
    minStars: cfg.minStars,
    minGuestRating: cfg.minGuestRating,
    minRoomPhotos: cfg.minRoomPhotos,
  });

  const catalogTotal = await liteCatalogTotal(city, cfg.countryCode, liteKey);
  const catalogLimit = catalogTotal + 50;
  console.log(`  LiteAPI catalog: ${catalogTotal} (scan limit ${catalogLimit})`);

  console.log("  estimating sorted queue (star filter + sort)…");
  const { hotels: sortedQueue, skippedStarFilter } = await fetchAndSortCatalog(
    cfg.liteapiCityName,
    cfg.countryCode,
    catalogLimit,
    cfg,
  );
  const effectiveCap = cfg.indexCap > 0 ? Math.min(cfg.indexCap, sortedQueue.length) : sortedQueue.length;
  console.log(`  sorted queue: ${sortedQueue.length} hotels (skipped_star=${skippedStarFilter})`);
  console.log(`  will index up to: ${effectiveCap} hotels`);
  if (sortedQueue[0]) {
    console.log(`  top hotel: ${sortedQueue[0].name} (${sortedQueue[0].stars}★ rating=${sortedQueue[0].rating})`);
  }

  const db = getDb();
  const snap = await getRolloutSnapshot(db, city);
  console.log("  DB snapshot:", snap.counts);
  console.log("  v2 status:", snap.v2_indexed_cities?.status || "none");

  console.log("\n  Render status check…");
  const remote = await checkRenderStatus(city);
  console.log(`  Render: status=${remote.v2_indexed_cities?.status || "none"} rollout_running=${remote.rollout_running}`);

  if (remote.rollout_running) {
    throw new Error("Render rollout_running=true for this city — do not start local index in parallel");
  }
  const rSt = remote.v2_indexed_cities || {};
  if (rSt.status === "indexing" && rSt.updated_at) {
    const ageMs = Date.now() - new Date(rSt.updated_at).getTime();
    if (ageMs < 5 * 60 * 1000) {
      throw new Error(
        `Render shows fresh indexing heartbeat (${Math.round(ageMs / 1000)}s ago) — possible collision`,
      );
    }
    console.warn(`  WARN: Render status=indexing but stale (${Math.round(ageMs / 60000)}m) — local resume OK`);
  }

  const thresholds = getVerifyThresholds(cfg);
  console.log("\n  post-index verify thresholds:", thresholds);
  console.log("\n  ✓ PREFLIGHT OK");
  console.log("\n  Next steps:");
  console.log(`    node scripts/city-launch.js --city=${city} --phase=index --canary=200`);
  console.log(`    node scripts/city-launch.js --city=${city} --phase=index`);
  console.log(`    node scripts/city-launch.js --city=${city} --phase=watch --interval=5`);
  console.log("\n  Do NOT POST /api/v2/reindex-city on Render while local index runs.");
  return { city, cfg, catalogLimit, sortedQueue: sortedQueue.length, effectiveCap };
}

function createLogStream(city) {
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const logPath = path.join(dir, `city-index-${city.replace(/\s+/g, "-").toLowerCase()}-${stamp}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  console.log(`  logging to ${logPath}`);
  return { logPath, stream };
}

function teeWrite(stream, args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  stream.write(`${line}\n`);
  return line;
}

async function phaseIndex(cityInput) {
  const { city, cfg } = hasFlag("--full-preflight")
    ? await phasePreflight(cityInput)
    : await phaseQuickPreflight(cityInput);

  applyIndexEnv();
  const catalogTotal = await liteCatalogTotal(city, cfg.countryCode);
  let catalogLimit = Number(getArg("limit")) || catalogTotal + 50;
  const canary = getArg("canary");
  const force = !hasFlag("--resume");
  const opts = {};
  if (canary) {
    opts.indexCapOverride = Number(canary);
    // Canary only needs enough catalog to fill the cap with 3★+ hotels — skip full 19k scan.
    catalogLimit = Math.min(catalogLimit, 8000);
  }

  const { logPath, stream } = createLogStream(city);
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...args) => { origLog(teeWrite(stream, args)); };
  console.warn = (...args) => { origWarn(teeWrite(stream, args)); };
  console.error = (...args) => { origErr(teeWrite(stream, args)); };

  console.log(`\n══ index start ${city} force=${force} catalogLimit=${catalogLimit} cap=${opts.indexCapOverride || cfg.indexCap || "registry"} ══`);

  try {
    const result = await reindexCityV2(city, catalogLimit, force, opts);
    console.log("DONE", JSON.stringify(result));
    origLog(`\n✓ Index complete — log: ${logPath}`);
    origLog("  Next: node scripts/city-launch.js --city=" + city + " --phase=classify-public");
    return result;
  } catch (e) {
    origErr(`\n✗ Index failed: ${e.message} — log: ${logPath}`);
    origErr("  Resume: node scripts/city-launch.js --city=" + city + " --phase=index --resume");
    throw e;
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
    stream.end();
  }
}

async function phaseWatch(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const intervalMin = Number(getArg("interval") || "5");
  const autoFix = !hasFlag("--no-auto-fix");
  const { snapshot, formatReport, checkAndFix } = require("./launch-watchdog");
  const logPath = path.join(process.cwd(), "logs", `${city.toLowerCase().replace(/\s+/g, "-")}-launch-monitor.log`);
  const statePath = path.join(process.cwd(), "logs", `${city.toLowerCase().replace(/\s+/g, "-")}-watchdog.state.json`);
  console.log(
    `Watching ${city} every ${intervalMin}m (${autoFix ? "auto-fix ON" : "observe only"})… Ctrl+C to stop\n`,
  );
  for (;;) {
    const s = await snapshot(city);
    const actions = await checkAndFix(s, { city, logPath, statePath, autoFix });
    console.log(formatReport(s, actions));
    console.log("");
    await new Promise((r) => setTimeout(r, intervalMin * 60 * 1000));
  }
}

async function phaseClassifyPublic(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  console.log(`\n══ classify-hotel-public: ${city} ══\n`);
  const result = await classifyHotelPublicForCity(city, {
    concurrency: Number(getArg("concurrency") || process.env.HP_PHOTO_CONCURRENCY || 16),
    ratePerMin: Number(getArg("rate-per-min") || process.env.HP_RATE_PER_MIN || 1200),
    limit: getArg("limit") ? Number(getArg("limit")) : null,
  });
  console.log("  result:", result);
  const db = getDb();
  console.log("  rebuilding v2_room_types_index…");
  const { error } = await db.rpc("rebuild_v2_room_types_index_city", { p_city: city });
  if (error) throw new Error(error.message);
  console.log("  ✓ classify-public done");
}

async function phaseNeighborhoods(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  await runNeighborhoods(city, db, { regenerate: !hasFlag("--no-regenerate"), log: console.log });
  console.log("\n  ✓ neighbourhoods done");
}

async function phaseVerify(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  const { ok } = await verifyCityRollout(city, db);
  if (!ok) process.exit(1);
  console.log("\n  ✓ verify OK (index + neighborhood fences)");
}

async function phaseCoverage(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  const ng = require("./neighborhood-generator");
  const { ensureNeighborhoodCoverage, auditNeighborhoodCoverage } = require("./neighborhood-coverage");
  console.log(`\n══ coverage: ${city} ══\n`);
  await ng.refreshHotelCounts(city, db);
  const before = await auditNeighborhoodCoverage(city, db);
  console.log(`  before: ${before.hotels_in_areas}/${before.catalog_total} (${Math.round(before.coverage_pct * 100)}%)`);
  const cov = await ensureNeighborhoodCoverage(city, db, {
    geminiKey: process.env.GEMINI_KEY,
    unsplashKey: process.env.UNSPLASH_KEY,
    googlePlacesKey: process.env.GOOGLE_PLACES_KEY || null,
    pexelsKey: process.env.PEXELS_KEY || null,
    flickrKey: process.env.FLICKR_KEY || null,
  }, { log: console.log, maxRounds: 3 });
  console.log(`  after: ${cov.hotels_in_areas}/${cov.catalog_total} (${Math.round(cov.coverage_pct * 100)}%), supplemental=${cov.supplemental_added}`);
  if (!cov.ok) process.exit(1);
  console.log("\n  ✓ coverage OK");
}

async function phaseRebuildDistricts(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  if (city !== "London") {
    throw new Error("rebuild-districts is only implemented for London (12 tourist districts)");
  }
  const db = getDb();
  const { rebuildLondonCanonicalDistricts, enrichLondonDistrictVibes } = require("./london-canonical-districts");
  console.log(`\n══ rebuild-districts: ${city} (12 tourist areas) ══\n`);
  const result = await rebuildLondonCanonicalDistricts(db, { log: console.log });
  console.log("\n  counts:", result.byName);
  console.log(`\n  ✓ ${result.hood_count || 12} districts, ${result.hotels_in_areas}/${result.catalog_total} hotels assigned`);
  console.log("\n  enriching vibes + photos (Overpass + Unsplash)…");
  await enrichLondonDistrictVibes(db, {}, { log: console.log });
  console.log("\n  ✓ London district vibes ready — restart server.js and hard-refresh the browser");
}

async function phaseRepairFences(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  const ng = require("./neighborhood-generator");
  console.log(`\n══ repair-fences: ${city} ══\n`);
  const poly = await ng.backfillNeighborhoodPolygons(city, db, false);
  console.log("  polygon backfill:", poly);
  await ng.refreshHotelCounts(city, db);
  const curated = await ng.applyCuratedNeighborhoodFences(city, db);
  console.log("  curated fences:", curated);
  await ng.refreshHotelCounts(city, db);
  const { ok, issues } = await ng.verifyNeighborhoodFences(city, db);
  if (!ok) {
    console.error("\n  ✗ fence verify failed — add overrides to scripts/neighborhood-fence-overrides.js");
    process.exit(1);
  }
  console.log("\n  ✓ repair-fences done");
}

async function phaseGeoBackfill(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  applyIndexEnv();
  const quotaArg = getArg("quota");
  const opts = {};
  if (quotaArg) opts.quotaOverride = Number(quotaArg);

  console.log(`\n══ geo-backfill: ${city} quota=${opts.quotaOverride || "registry"} ══\n`);
  const result = await geoBackfillCityV2(city, opts);
  console.log("  result:", JSON.stringify(result, null, 2));

  if (result.totalIndexed > 0) {
    const db = getDb();
    const ng = require("./neighborhood-generator");
    await ng.applyCuratedNeighborhoodFences(city, db);
    console.log("  refreshed curated fence hotel_count");
  }

  console.log("\n  Next: node scripts/city-launch.js --city=" + city + " --phase=repair-fences");
  console.log("        node scripts/city-launch.js --city=" + city + " --phase=rebuild-search");
}

async function phaseRebuildSearch(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  console.log(`\n══ rebuild-search: ${city} ══\n`);
  const ok = await rebuildV2RoomTypesIndex(db, city, { label: "manual" });
  if (!ok) process.exit(1);
  const { count: rows } = await db
    .from("v2_room_types_index")
    .select("*", { count: "exact", head: true })
    .eq("city", city);
  const { count: hotels } = await db
    .from("v2_hotels_cache")
    .select("*", { count: "exact", head: true })
    .eq("city", city);
  console.log(`  v2_hotels_cache: ${hotels} | v2_room_types_index rows: ${rows}`);
  console.log("\n  ✓ rebuild-search done (restart local server.js to clear search phase-A cache)");
}

async function phaseReadiness(cityInput) {
  const cfg = resolveCityConfig(cityInput);
  const city = cfg.displayName;
  const db = getDb();
  const snap = await getRolloutSnapshot(db, city);
  const st = snap.v2_indexed_cities?.status;
  const c = snap.counts || {};

  const { data: nbhds } = await db
    .from("neighborhoods")
    .select("name, hotel_count, vibe_last_computed_at, polygon")
    .eq("city", city);
  const nbhdWithVibe = (nbhds || []).filter((n) => n.vibe_last_computed_at).length;
  const nbhdWithPoly = (nbhds || []).filter((n) => n.polygon).length;

  const checks = [
    { label: "V2 index complete", ok: st === "complete", detail: st || "none" },
    { label: "v2_hotels_cache", ok: c.v2_hotels >= getVerifyThresholds(cfg).minHotels, detail: c.v2_hotels },
    { label: "v2_room_types_index", ok: c.v2_room_types >= getVerifyThresholds(cfg).minRoomTypes, detail: c.v2_room_types },
    { label: "hotel_public rows", ok: (c.hotel_public_rows || 0) > 0, detail: c.hotel_public_rows || 0 },
    { label: "neighbourhoods with vibes", ok: nbhdWithVibe >= 5, detail: `${nbhdWithVibe}/${nbhds?.length || 0}` },
    { label: "neighbourhood polygons", ok: nbhdWithPoly >= 5, detail: `${nbhdWithPoly}/${nbhds?.length || 0}` },
  ];

  const ng = require("./neighborhood-generator");
  const fence = await ng.verifyNeighborhoodFences(city, db, { log: () => {} });
  checks.push({
    label: "neighbourhood fence QA",
    ok: fence.ok,
    detail: fence.ok ? "OK" : `${fence.issues.length} issue(s) — run --phase=repair-fences`,
  });

  try {
    const { auditNeighborhoodCoverage } = require("./neighborhood-coverage");
    const { getCoverageThreshold } = require("./city-registry");
    const audit = await auditNeighborhoodCoverage(city, db);
    const threshold = getCoverageThreshold(cfg);
    const covOk = (cfg.indexCap || 0) === 0 && cfg.minNeighborhoodCoveragePct == null
      ? true
      : audit.coverage_pct >= threshold;
    checks.push({
      label: "neighbourhood hotel coverage",
      ok: covOk,
      detail: covOk
        ? `${Math.round(audit.coverage_pct * 100)}% (${audit.hotels_in_areas}/${audit.catalog_total})`
        : `${Math.round(audit.coverage_pct * 100)}% — need ≥${Math.round(threshold * 100)}%; run --phase=coverage`,
    });
  } catch (e) {
    checks.push({ label: "neighbourhood hotel coverage", ok: false, detail: e.message });
  }

  console.log(`\n══ readiness: ${city} ══\n`);
  let allOk = true;
  for (const ch of checks) {
    const mark = ch.ok ? "✓" : "✗";
    console.log(`  ${mark} ${ch.label}: ${ch.detail}`);
    if (!ch.ok) allOk = false;
  }
  console.log("\n  Manual after green:");
  console.log("    • Restart Render so loadV2Cities() includes this city");
  console.log(`    • Boop smoke: https://www.travelbyvibe.com/?city=${encodeURIComponent(city)}`);
  console.log("    • node scripts/test-search-quality.js");
  if (!allOk) process.exit(1);
  console.log("\n  ✓ READINESS OK (except Render restart + QA)");
}

async function main() {
  const cityInput = getArg("city");
  const phase = getArg("phase") || "preflight";
  if (!cityInput) {
    console.error("Usage: node scripts/city-launch.js --city=London --phase=preflight|index|watch|classify-public|neighborhoods|verify|readiness|rebuild-search|repair-fences|geo-backfill|coverage|rebuild-districts");
    process.exit(1);
  }

  switch (phase) {
    case "preflight":
      await phasePreflight(cityInput);
      break;
    case "index":
      await phaseIndex(cityInput);
      break;
    case "watch":
      await phaseWatch(cityInput);
      break;
    case "classify-public":
      await phaseClassifyPublic(cityInput);
      break;
    case "neighborhoods":
      await phaseNeighborhoods(cityInput);
      break;
    case "verify":
      await phaseVerify(cityInput);
      break;
    case "readiness":
      await phaseReadiness(cityInput);
      break;
    case "rebuild-search":
      await phaseRebuildSearch(cityInput);
      break;
    case "repair-fences":
      await phaseRepairFences(cityInput);
      break;
    case "geo-backfill":
      await phaseGeoBackfill(cityInput);
      break;
    case "coverage":
      await phaseCoverage(cityInput);
      break;
    case "rebuild-districts":
      await phaseRebuildDistricts(cityInput);
      break;
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
