/**
 * Server-side neighbourhood BOOP match (same math as client picker).
 * Used to blend neighbourhood fit into /api/vsearch ranking when boop_profile is sent.
 */

const {
  buildProfileCacheKey,
  readIdToMatch,
  writeIdToMatch,
  readPrimaryByCity,
  writePrimaryByCity,
} = require("./nbhd-boop-cache");

function textHasAny(text, arr) {
  const t = (text || "").toLowerCase();
  return arr.some((k) => t.includes(k));
}

// Map street_energy string (DB attribute) → 0–100 numeric score
const STREET_ENERGY_SCORE = {
  "very lively": 90,
  lively: 70,
  moderate: 50,
  quiet: 30,
  minimal: 10,
};

/**
 * @param {string|null|undefined} nbhdScene Boop `answers.nbhdScene`; when `leafy_local`,
 *        the `green` axis weights street trees over park polygons (keep in sync with client/app.js).
 */
function deriveNbhdSignals(h, nbhdScene) {
  const e = h.vibe_elements || {};
  const poi = (h.attributes?.poi_counts) || {};
  const attrStr = h.attributes || {};
  const tags = (h.tags || []).map((t) => String(t).toLowerCase());
  const txt = `${h.vibe_short || ""} ${h.vibe_long || ""}`.toLowerCase();
  const leafyGreen = nbhdScene === "leafy_local";
  const greenParkW = leafyGreen ? 0.18 : 0.38;
  const greenStreetW = leafyGreen ? 0.76 : 0.52;

  const rawParks = Number(e.parks?.score || 0);
  const gs = String(attrStr.green_spaces || "").toLowerCase();
  const greenAttrNum = { lots: 88, some: 62, minimal: 35 }[gs];
  const effectiveParks =
    greenAttrNum == null || gs === "lots"
      ? rawParks
      : gs === "some"
        ? Math.min(rawParks, Math.round(rawParks * 0.22 + greenAttrNum * 0.78))
        : gs === "minimal"
          ? Math.min(rawParks, Math.round(rawParks * 0.14 + greenAttrNum * 0.86))
          : rawParks;

  // Prefer vibe_elements scores (0-100) when available; fall back to raw poi_counts.
  // street_feel is not a POI count — derive it from the street_energy string attribute.
  const streetFeel =
    Number(e.street_feel?.score || 0) ||
    STREET_ENERGY_SCORE[(attrStr.street_energy || "").toLowerCase()] ||
    50;

  // Quality-adjusted score — prefers vibe_elements (0-100) for feel/comfort dimensions.
  const v = (k) => {
    if (k === "parks") return effectiveParks;
    const fromVibe = Number(e[k]?.score || 0);
    if (fromVibe > 0) return fromVibe;
    if (k === "street_feel") return streetFeel;
    return Number(poi[k] || 0);
  };

  // Raw POI count — for quantity-sensitive dimensions (iconic, cultural density, centrality).
  // vibe_elements scores are quality/accessibility-adjusted and can over-rank compact areas
  // with very accessible landmarks over denser areas (e.g. Reforma icon_spots score=100
  // despite only 63 landmarks vs Centro's 104). Raw count correctly reflects how iconic
  // or culturally dense a neighbourhood actually is.
  const pRaw = (k) => Number(poi[k] || 0) || Number(e[k]?.score || 0);

  // Raw signals — intentionally NOT clamped to 100 here so that poi_counts (which
  // can exceed 100 for busy neighbourhoods) survive into normalizeSignalsByCity,
  // which performs city-wide min-max scaling before any BOOP math.
  const natureBonus = tags.includes("nature") ? 12 : 0;
  // Text-based bonus for "central" signal — checks vibe text AND a dedicated "central" tag.
  const centralTextBonus = (textHasAny(txt, ["central", "heart", "iconic", "boulevard"]) || tags.includes("central")) ? 14 : 0;
  const s = {
    walkability: v("street_feel") * 0.55 + v("cafes") * 0.2 + v("parks") * 0.25,
    // OSM park polygons can dominate boulevards; greenery = street-scale trees. For
    // "Leafy & residential" we tilt toward greenery so Chapultepec-scale parks do not
    // beat true tree-lined neighbourhoods on the green axis alone.
    green:       v("parks") * greenParkW + v("greenery") * greenStreetW + natureBonus,
    // cafes and restaurants as separate dims so hip_local weights work on the server side too.
    cafes:       v("cafes") * 0.7 + pRaw("cafes") * 0.3,
    restaurants: v("restaurants") * 0.7 + pRaw("restaurants") * 0.3,
    foodie:      v("restaurants") * 0.65 + v("cafes") * 0.35,
    // culture: text + tags bonus so Centro/Coyoacán with "culture" tag score higher.
    culture:     pRaw("museums") * 0.55 + pRaw("icon_spots") * 0.45 + (tags.includes("culture") ? 16 : 0),
    shopping:    v("shops") * 0.9 + (tags.includes("shopping") ? 12 : 0),
    nightlife:   v("street_feel") * 0.4 + v("restaurants") * 0.35 + (tags.includes("nightlife") ? 18 : 0),
    calm:
      v("greenery") * 0.42 +
      v("parks") * 0.18 +
      (100 - v("street_feel")) * 0.32 +
      v("cafes") * 0.08 -
      pRaw("icon_spots") * 0.12 -
      v("restaurants") * 0.02 +
      (streetFeel <= 40 ? 14 : 0),
    central:     pRaw("icon_spots") * 0.55 + v("street_feel") * 0.25 + centralTextBonus,
    local:       v("cafes") * 0.35 + v("street_feel") * 0.35 + v("restaurants") * 0.3 + (tags.includes("returning") ? 10 : 0),
    iconic:      pRaw("icon_spots") * 0.9 + (textHasAny(txt, ["iconic", "landmark"]) ? 10 : 0),
    // luxury: tags-first; "upscale" tag is a synonym added to Polanco alongside "luxury".
    luxury:      v("shops") * 0.55 + ((tags.includes("luxury") || tags.includes("upscale")) ? 30 : 0),
    touristy:    pRaw("icon_spots") * 0.55 + (textHasAny(txt, ["touristy", "tourist"]) ? 18 : 0),
  };
  // Only enforce floor at 0; normalizeSignalsByCity will cap and scale.
  Object.keys(s).forEach((k) => { s[k] = Math.max(0, Math.round(s[k])); });
  return s;
}

function normalizeSignalsByCity(hoods, nbhdScene) {
  if (!hoods?.length) return {};
  const dims = [
    "walkability",
    "green",
    "cafes",
    "restaurants",
    "foodie",
    "culture",
    "shopping",
    "nightlife",
    "calm",
    "central",
    "local",
    "iconic",
    "luxury",
    "touristy",
  ];
  const raw = hoods.map((h) => ({ name: h.name, s: deriveNbhdSignals(h, nbhdScene) }));
  const minMax = {};
  for (const d of dims) {
    const vals = raw.map((r) => r.s[d]);
    minMax[d] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  const normByName = {};
  for (const r of raw) {
    const out = {};
    for (const d of dims) {
      const { min, max } = minMax[d];
      out[d] = max - min < 0.0001 ? 50 : Math.round(((r.s[d] - min) / (max - min)) * 100);
    }
    normByName[r.name] = out;
  }
  return normByName;
}

function mergeBoopFreetextIntoPrefs(prefs, freetext) {
  const t = (freetext || "").toLowerCase();
  if (!t.trim()) return { ...(prefs || {}) };
  const out = { ...(prefs || {}) };
  const add = (delta) => {
    for (const [k, v] of Object.entries(delta)) {
      out[k] = (out[k] || 0) + v;
    }
  };
  if (/\b(quiet|calm|peaceful|tranquil|serene|leafy|residential)\b/.test(t)) add({ calm: 5, nightlife: -3 });
  if (/\b(lively|nightlife|bars|clubs|party|late[-\s]?night|buzzing)\b/.test(t)) add({ nightlife: 6, calm: -3 });
  if (/\b(walkable|walkability|walking distance|stroll|pedestrian)\b/.test(t)) add({ walkability: 5 });
  if (/\b(central|downtown|city centre|city center|heart of)\b/.test(t)) add({ central: 5, iconic: 3 });
  if (/\b(local|authentic|neighbourhood|neighborhood|off the beaten)\b/.test(t)) add({ local: 6, central: -2 });
  if (/\b(luxury|luxurious|upscale|five[-\s]?star|5[-\s]?star|boutique)\b/.test(t)) add({ luxury: 5 });
  if (/\b(budget|affordable|cheap|value|economical)\b/.test(t)) add({ luxury: -5 });
  if (/\b(museum|museums|culture|cultural|art gallery|theatre|theater|historic)\b/.test(t))
    add({ culture: 5, iconic: 2 });
  if (/\b(nature|park|parks|garden|green|trees|outdoor)\b/.test(t)) add({ green: 5, calm: 2 });
  if (/\b(shop|shopping|retail|boutiques)\b/.test(t)) add({ shopping: 4 });
  if (/\b(café|cafe|coffee|brunch)\b/.test(t)) add({ cafes: 4 });
  if (/\b(view|views|skyline|rooftop|waterfront|river|canal)\b/.test(t)) add({ iconic: 3, calm: 1 });
  return out;
}

/** City-normalized 0–100; higher = busier (nightlife, landmarks, low calm, etc.). */
function busynessScore(sig, h) {
  const pick = (k, fallback = 50) => {
    const v = sig[k];
    return typeof v === "number" ? Math.max(0, Math.min(100, v)) : fallback;
  };
  const weighted = [
    [pick("nightlife"), 0.20],
    [pick("central"), 0.18],
    [pick("iconic"), 0.16],
    [100 - pick("calm"), 0.16],
    [pick("touristy"), 0.10],
    [pick("luxury"), 0.08],
    [pick("walkability"), 0.06],
    [pick("shopping"), 0.06],
  ];
  let sum = 0;
  let wSum = 0;
  for (const [v, w] of weighted) {
    sum += v * w;
    wSum += w;
  }
  let score = wSum > 0 ? sum / wSum : 50;

  if (h) {
    const se = String(h.attributes?.street_energy || "").toLowerCase();
    const energyBoost = {
      "very lively": 16,
      lively: 10,
      moderate: 2,
      quiet: -10,
      minimal: -14,
    }[se];
    if (energyBoost) score += energyBoost;

    const tags = (h.tags || []).map((t) => String(t).toLowerCase());
    if (tags.includes("business")) score += 12;
    if (tags.includes("first-timers")) score += 8;
    if (tags.includes("central")) score += 8;
    if (tags.includes("iconic")) score += 6;
    if (tags.includes("nightlife")) score += 4;
    if (tags.includes("central") && tags.includes("nightlife")) score += 10;

    const txt = `${h.vibe_short || ""} ${h.vibe_long || ""}`.toLowerCase();
    if (/\b(lively nightlife|business hub|grand central boulevard|monuments|bustling|busy streets)\b/.test(txt)) {
      score += 10;
    }
    if (/\b(calm local pace|village feel|residential|leafy|quiet|liveable|tree-lined)\b/.test(txt)) {
      score -= 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/** Quiet & residential: scale fit down when OSM/Gemini signals say the area is busy. */
const LEAFY_BUSYNESS_PENALTY_MULT = 0.48;

function applyLeafyBusynessPenalty(fit, sig, nbhdScene, h) {
  if (nbhdScene !== "leafy_local") return fit;
  const busy = busynessScore(sig, h) / 100;
  return Math.max(0, fit * (1 - busy * LEAFY_BUSYNESS_PENALTY_MULT));
}

function computeBoopMatch(h, profile, normByName) {
  if (!profile || !profile.prefs) return null;
  const scene = profile?.answers?.nbhdScene || null;
  const sig = normByName[h.name] || deriveNbhdSignals(h, scene);
  const prefs = profile.prefs || {};

  let sum = 0;
  let denom = 0;
  for (const [k, wRaw] of Object.entries(prefs)) {
    if (typeof sig[k] !== "number") continue;
    const w = Number(wRaw);
    if (!Number.isFinite(w) || w === 0) continue;
    const importance = Math.abs(w);
    const x = Math.max(0, Math.min(1, sig[k] / 100));
    const fit = w >= 0 ? x : 1 - x;
    sum += importance * fit;
    denom += importance;
  }
  let fit = denom > 0 ? sum / denom : 0.5;

  const db = new Set(profile.dealbreakers || []);
  if (db.has("noisy")) fit -= (1 - (sig.calm ?? 50) / 100) * 0.2;
  if (db.has("far")) fit -= (1 - (sig.central ?? 50) / 100) * 0.16;
  if (db.has("touristy")) fit -= ((sig.touristy ?? 50) / 100) * 0.18;
  if (db.has("lowFood")) fit -= (1 - (sig.foodie ?? 50) / 100) * 0.18;

  fit = applyLeafyBusynessPenalty(fit, sig, scene, h);
  fit = Math.max(0, Math.min(1, fit));
  return fit;
}

/** @returns {Map<number, number>} neighborhood id → match % (45–99) */
function buildNeighborhoodMatchById(hoods, boopProfile) {
  const mergedPrefs = mergeBoopFreetextIntoPrefs(boopProfile.prefs || {}, boopProfile.freetext || "");
  const profileForMatch = {
    prefs: mergedPrefs,
    dealbreakers: boopProfile.dealbreakers || [],
    answers: boopProfile.answers || {},
  };
  const nbhdScene = boopProfile.answers?.nbhdScene || null;
  const norm = normalizeSignalsByCity(hoods, nbhdScene);
  const ranked = hoods.map((h) => ({ ...h, _boop_raw: computeBoopMatch(h, profileForMatch, norm) }));
  const vals = ranked.map((h) => h._boop_raw).filter((v) => typeof v === "number");
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const idToMatch = new Map();
  for (const h of ranked) {
    const v = typeof h._boop_raw === "number" ? h._boop_raw : 0.5;
    let pct;
    if (max - min < 0.0001) pct = 75;
    else {
      const rel = (v - min) / (max - min);
      pct = 45 + rel * 50;
    }
    const rounded = Math.round(Math.max(0, Math.min(99, pct)));
    if (h.id != null) idToMatch.set(h.id, rounded);
  }
  return idToMatch;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Re-rank Phase-A hotel list and return per-hotel neighbourhood fit % (picker scale).
 * @param {*} fetchClient supabase client
 * @param {string} city resolved city name
 * @param {{ hotel_id: string, similarity: number, s_boosted?: number }[]} rankedHotels mutates sort + adds nbhd_fit_pct
 * @param {{ prefs?: object, dealbreakers?: string[], freetext?: string }} boopProfile
 * @param {{ weight: number, neutralPct: number, maxHotels: number, rpcChunk: number, rpcConcurrency: number }} opts
 * @returns {Promise<{nbhdFitByHotelId: Map<string,number>, primaryByHotel: Map<string,number>, hoodRows: object[]}>}
 */
async function applyNbhdBoopRank(fetchClient, city, rankedHotels, boopProfile, opts) {
  const weight = opts.weight;
  const neutralPct = Math.max(0, Math.min(100, opts.neutralPct ?? 62));
  const maxHotels = opts.maxHotels ?? 5000;
  const rpcChunk = opts.rpcChunk ?? 250;
  const rpcConcurrency = opts.rpcConcurrency ?? 4;

  const nbhdFitByHotelId = new Map();
  const _emptyResult = { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows: [], nbhd_cache_hit: false };
  if (!rankedHotels.length || weight <= 0 || !boopProfile) return _emptyResult;

  const cacheKey = buildProfileCacheKey(city, boopProfile);
  let idToMatch = await readIdToMatch(fetchClient, cacheKey);
  let primaryByHotel = await readPrimaryByCity(fetchClient, city);
  let hoodRows = [];
  let cacheHit = !!(idToMatch?.size && primaryByHotel?.size);

  if (!idToMatch?.size) {
    const { data: hoodRowsData, error: hoodErr } = await fetchClient
      .from("neighborhoods")
      .select("id, name, vibe_elements, tags, vibe_short, vibe_long, attributes")
      .eq("city", city);

    if (hoodErr || !hoodRowsData?.length) {
      return { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows: [], nbhd_cache_hit: false };
    }
    hoodRows = hoodRowsData;
    idToMatch = buildNeighborhoodMatchById(hoodRows, boopProfile);
    if (!idToMatch.size) return { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows, nbhd_cache_hit: false };
    writeIdToMatch(fetchClient, cacheKey, city, idToMatch).catch(() => {});
  } else if (!hoodRows.length) {
    const { data: hoodRowsData } = await fetchClient
      .from("neighborhoods")
      .select("id, name, vibe_elements, tags, vibe_short, vibe_long, attributes")
      .eq("city", city);
    hoodRows = hoodRowsData || [];
  }

  if (!primaryByHotel?.size) {
    primaryByHotel = new Map();
    const hotelIdsAll = rankedHotels.map((h) => h.hotel_id);
    const hotelIdsRpc = hotelIdsAll.slice(0, maxHotels);
    const batches = chunk(hotelIdsRpc, rpcChunk);
    for (let i = 0; i < batches.length; i += rpcConcurrency) {
      const slice = batches.slice(i, i + rpcConcurrency);
      const results = await Promise.all(
        slice.map((batch) => fetchClient.rpc("get_primary_nbhds_for_hotels", { p_hotel_ids: batch }))
      );
      for (const { data, error } of results) {
        if (error) {
          console.warn("[nbhd-vibe-rank] get_primary_nbhds_for_hotels:", error.message);
          continue;
        }
        for (const r of data || []) {
          primaryByHotel.set(r.hotel_id, r.neighborhood_id);
        }
      }
    }
    writePrimaryByCity(fetchClient, city, primaryByHotel).catch(() => {});
    cacheHit = false;
  }

  const neutralFit = neutralPct;
  const hotelIdsAll = rankedHotels.map((h) => h.hotel_id);

  for (const h of rankedHotels) {
    let nbhdFit = neutralFit;
    const nid = primaryByHotel.get(h.hotel_id);
    if (nid != null && idToMatch.has(nid)) nbhdFit = idToMatch.get(nid);
    h.nbhd_fit_pct = nbhdFit;
    nbhdFitByHotelId.set(h.hotel_id, nbhdFit);
  }

  for (const hid of hotelIdsAll.slice(maxHotels)) {
    if (!nbhdFitByHotelId.has(hid)) nbhdFitByHotelId.set(hid, neutralFit);
  }

  const w = weight;
  for (const h of rankedHotels) {
    const room = h.s_boosted ?? h.similarity;
    h._room_rank = room;
    const nbhdNorm = (nbhdFitByHotelId.get(h.hotel_id) ?? neutralFit) / 100;
    h._combined_phase_a = (1 - w) * room + w * nbhdNorm;
  }

  rankedHotels.sort((a, b) => {
    const d = (b._combined_phase_a ?? 0) - (a._combined_phase_a ?? 0);
    if (Math.abs(d) > 1e-9) return d;
    return (b._room_rank ?? 0) - (a._room_rank ?? 0);
  });

  return { nbhdFitByHotelId, primaryByHotel, hoodRows, nbhd_cache_hit: cacheHit };
}

module.exports = {
  applyNbhdBoopRank,
  mergeBoopFreetextIntoPrefs,
  deriveNbhdSignals,
  normalizeSignalsByCity,
  buildNeighborhoodMatchById,
  busynessScore,
  applyLeafyBusynessPenalty,
  LEAFY_BUSYNESS_PENALTY_MULT,
};
