/**
 * Neighborhood coverage audit + supplemental Gemini generation for triaged mega cities.
 * Strict in-fence semantics — no nearest-centroid partition assignment.
 */

const { normalizePolygonRing } = require("./neighborhood-vibe-data");
const { resolveCityConfig } = require("./city-registry");

function getCoverageThreshold(cfg) {
  if (cfg.minNeighborhoodCoveragePct != null) return cfg.minNeighborhoodCoveragePct;
  if (cfg.tier === "mega" || cfg.tier === "large") return 0.70;
  if ((cfg.indexCap || 0) > 0) return 0.65;
  return 0.55;
}

function getCoverageStriveTarget(cfg) {
  const floor = getCoverageThreshold(cfg);
  if (cfg.tier === "mega" || (cfg.indexCap || 0) >= 3500) return Math.max(floor, 0.90);
  return floor;
}

function clusterOrphanHotels(hotels, maxClusters = 6, minPerCluster = 15) {
  if (!hotels?.length) return [];
  const cellSize = 0.025;
  const cells = new Map();
  for (const h of hotels) {
    const key = `${Math.floor(h.lat / cellSize)}:${Math.floor(h.lng / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(h);
  }
  return [...cells.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxClusters)
    .map(([, group]) => {
      const lats = group.map((h) => h.lat);
      const lngs = group.map((h) => h.lng);
      const lat_min = Math.min(...lats);
      const lat_max = Math.max(...lats);
      const lon_min = Math.min(...lngs);
      const lon_max = Math.max(...lngs);
      const pad = 0.008;
      return {
        hotel_count: group.length,
        centroid: {
          lat: lats.reduce((a, b) => a + b, 0) / lats.length,
          lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
        },
        bbox: {
          lat_min: lat_min - pad,
          lat_max: lat_max + pad,
          lon_min: lon_min - pad,
          lon_max: lon_max + pad,
        },
      };
    })
    .filter((c) => c.hotel_count >= minPerCluster);
}

async function loadHoodsWithCounts(city, db) {
  const { data, error } = await db
    .from("neighborhoods")
    .select("id, name, bbox, polygon, hotel_count")
    .eq("city", city);
  if (error) throw new Error(`load neighborhoods: ${error.message}`);
  return data || [];
}

function listOrphanHotels(hotelRows, hoods, city, hotelInsideResolvedFence) {
  const orphans = [];
  for (const h of hotelRows) {
    let inside = false;
    for (const hood of hoods) {
      const pr = normalizePolygonRing(hood.polygon);
      if (hotelInsideResolvedFence(h.lat, h.lng, city, hood.name, hood.bbox, pr)) {
        inside = true;
        break;
      }
    }
    if (!inside) orphans.push(h);
  }
  return orphans;
}

/** Legacy hook — London uses rebuildLondonCanonicalDistricts; other cities use Gemini supplemental pass. */
async function seedMissingNeighborhoodSeeds(_city, _db) {
  return { seeded: 0, synced: 0 };
}

function applyClusterFencesToGeminiItems(items, clusters) {
  const ng = require("./neighborhood-generator");
  const capped = items.slice(0, clusters.length);
  for (let i = 0; i < capped.length; i++) {
    capped[i].bbox = { ...clusters[i].bbox };
    capped[i].polygon = { ring: ng.bboxToOctagonRing(clusters[i].bbox) };
  }
  return capped;
}

/** Re-apply cluster bboxes to supplemental rows that Gemini left without usable fences. */
async function repairBrokenSupplementalFences(city, db, { log = console.log } = {}) {
  const ng = require("./neighborhood-generator");
  const hoods = await loadHoodsWithCounts(city, db);
  const broken = hoods.filter((h) => h.bbox?.lat_min == null || h.bbox?.lat_min === undefined);
  if (!broken.length) return { repaired: 0 };

  const hotelRows = await ng.loadCityHotelCoords(city, db);
  const orphans = listOrphanHotels(hotelRows, hoods, city, ng.hotelInsideResolvedFence);
  const clusters = clusterOrphanHotels(orphans, broken.length);
  if (!clusters.length) return { repaired: 0 };

  let repaired = 0;
  for (let i = 0; i < broken.length && i < clusters.length; i++) {
    const hood = broken[i];
    const cluster = clusters[i];
    const ring = ng.bboxToOctagonRing(cluster.bbox);
    const { error } = await db
      .from("neighborhoods")
      .update({ bbox: cluster.bbox, polygon: { ring } })
      .eq("id", hood.id);
    if (error) throw new Error(`repair fence ${hood.name}: ${error.message}`);
    log(`  repaired fence: ${hood.name} (cluster ~${cluster.hotel_count} hotels)`);
    repaired++;
  }
  return { repaired };
}

/**
 * @returns {Promise<{ catalog_total: number, hotels_in_areas: number, coverage_pct: number, sum_hood_counts: number, orphan_count: number, hood_count: number }>}
 */
async function auditNeighborhoodCoverage(city, db, preloaded = {}) {
  const ng = require("./neighborhood-generator");
  const hoods = preloaded.hoods || (await loadHoodsWithCounts(city, db));

  if (city === "London") {
    let catalog_total = preloaded.catalog_total;
    if (catalog_total == null) {
      const { count, error: countErr } = await db
        .from("v2_hotels_cache")
        .select("*", { count: "exact", head: true })
        .eq("city", city);
      if (countErr) throw new Error(countErr.message);
      catalog_total = count || 0;
    }
    const assigned = hoods.reduce((s, h) => s + (h.hotel_count || 0), 0);
    return {
      catalog_total,
      hotels_in_areas: assigned,
      coverage_pct: catalog_total ? assigned / catalog_total : 0,
      sum_hood_counts: assigned,
      orphan_count: Math.max(0, catalog_total - assigned),
      hood_count: hoods.length,
    };
  }

  const hotelRows = preloaded.hotelRows || (await ng.loadCityHotelCoords(city, db));
  const insideAny = new Set();
  for (const h of hotelRows) {
    for (const hood of hoods) {
      const pr = normalizePolygonRing(hood.polygon);
      if (ng.hotelInsideResolvedFence(h.lat, h.lng, city, hood.name, hood.bbox, pr)) {
        insideAny.add(h.hotel_id);
        break;
      }
    }
  }

  const catalog_total = hotelRows.length;
  const hotels_in_areas = insideAny.size;
  const coverage_pct = catalog_total ? hotels_in_areas / catalog_total : 0;
  const sum_hood_counts = hoods.reduce((s, h) => s + (h.hotel_count || 0), 0);

  return {
    catalog_total,
    hotels_in_areas,
    coverage_pct,
    sum_hood_counts,
    orphan_count: catalog_total - hotels_in_areas,
    hood_count: hoods.length,
  };
}

/**
 * If coverage is below city threshold, ask Gemini for 3–6 supplemental hoods from orphan clusters.
 */
async function ensureNeighborhoodCoverage(city, db, keys, { log = console.log, maxRounds = 1 } = {}) {
  const ng = require("./neighborhood-generator");
  const cfg = resolveCityConfig(city);
  const threshold = getCoverageThreshold(cfg);

  if (city === "London") {
    const { rebuildLondonCanonicalDistricts } = require("./london-canonical-districts");
    await rebuildLondonCanonicalDistricts(db, { log });
    const audit = await auditNeighborhoodCoverage(city, db);
    log(
      `  London: ${audit.hood_count} tourist districts, ` +
      `${audit.hotels_in_areas}/${audit.catalog_total} hotels assigned`,
    );
    return { ...audit, threshold, supplemental_added: 0, ok: audit.coverage_pct >= threshold };
  }

  const striveTarget = getCoverageStriveTarget(cfg);
  const clusterCap = cfg.tier === "mega" || (cfg.indexCap || 0) >= 3500 ? 12 : 6;
  const rounds = maxRounds || (striveTarget >= 0.9 ? 3 : 2);

  const seed = await seedMissingNeighborhoodSeeds(city, db, { log });
  if (seed.seeded) {
    await ng.applyCuratedNeighborhoodFences(city, db);
    await ng.refreshHotelCounts(city, db);
  }

  let audit = await auditNeighborhoodCoverage(city, db);
  log(
    `  coverage: ${audit.hotels_in_areas}/${audit.catalog_total} ` +
    `(${Math.round(audit.coverage_pct * 100)}%) — target ≥${Math.round(striveTarget * 100)}%`,
  );

  if (audit.coverage_pct >= striveTarget || audit.catalog_total < 50) {
    return { ...audit, threshold: striveTarget, supplemental_added: 0, ok: audit.coverage_pct >= threshold };
  }

  const geminiKey = keys?.geminiKey || process.env.GEMINI_KEY;
  if (!geminiKey) throw new Error("GEMINI_KEY required for supplemental neighborhoods");

  let supplemental_added = 0;
  for (let round = 0; round < rounds && audit.coverage_pct < striveTarget; round++) {
    const hoods = await loadHoodsWithCounts(city, db);
    const hotelRows = await ng.loadCityHotelCoords(city, db);
    const existingNames = hoods.map((h) => h.name);
    const orphans = listOrphanHotels(hotelRows, hoods, city, ng.hotelInsideResolvedFence);
    const clusters = clusterOrphanHotels(orphans, clusterCap, 10);

    if (!clusters.length) {
      log(`  coverage round ${round + 1}: no dense orphan clusters (≥15 hotels/cell) — stopping`);
      break;
    }

    log(`  coverage round ${round + 1}: ${orphans.length} orphans → ${clusters.length} cluster hint(s), calling Gemini…`);
    const prompt = ng.buildSupplementalNeighborhoodPrompt(city, cfg, clusters, existingNames);
    const raw = await ng.callGemini(prompt, geminiKey);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    let items;
    try {
      items = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`Supplemental Gemini JSON invalid for ${city}: ${e.message}`);
    }
    if (!Array.isArray(items)) throw new Error(`Supplemental Gemini did not return an array for ${city}`);

    const novel = items.filter((i) => i?.name && !existingNames.some((n) => n.toLowerCase() === String(i.name).toLowerCase()));
    if (!novel.length) {
      log(`  coverage round ${round + 1}: Gemini returned no new hood names — stopping`);
      break;
    }

    const toIngest = applyClusterFencesToGeminiItems(novel.slice(0, clusters.length), clusters);
    await ng.ingestGeminiNeighborhoodItems(
      city,
      toIngest,
      db,
      geminiKey,
      keys?.unsplashKey || process.env.UNSPLASH_KEY,
      keys?.googlePlacesKey || process.env.GOOGLE_PLACES_KEY || null,
      keys?.pexelsKey || process.env.PEXELS_KEY || null,
      keys?.flickrKey || process.env.FLICKR_KEY || null,
    );
    supplemental_added += toIngest.length;

    await repairBrokenSupplementalFences(city, db, { log });

    await ng.backfillNeighborhoodPolygons(city, db, false);
    await ng.applyCuratedNeighborhoodFences(city, db);
    await ng.refreshHotelCounts(city, db);

    audit = await auditNeighborhoodCoverage(city, db);
    log(
      `  coverage after supplemental: ${audit.hotels_in_areas}/${audit.catalog_total} ` +
      `(${Math.round(audit.coverage_pct * 100)}%)`,
    );
  }

  return {
    ...audit,
    threshold: striveTarget,
    supplemental_added,
    ok: audit.coverage_pct >= threshold,
  };
}

module.exports = {
  getCoverageThreshold,
  getCoverageStriveTarget,
  clusterOrphanHotels,
  listOrphanHotels,
  auditNeighborhoodCoverage,
  ensureNeighborhoodCoverage,
  repairBrokenSupplementalFences,
  applyClusterFencesToGeminiItems,
  seedMissingNeighborhoodSeeds,
};
