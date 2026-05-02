/**
 * Server-side neighbourhood BOOP match (same math as client picker).
 * Used to blend neighbourhood fit into /api/vsearch ranking when boop_profile is sent.
 */

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

function deriveNbhdSignals(h) {
  const e = h.vibe_elements || {};
  const poi = (h.attributes?.poi_counts) || {};
  const attrStr = h.attributes || {};
  const tags = (h.tags || []).map((t) => String(t).toLowerCase());
  const txt = `${h.vibe_short || ""} ${h.vibe_long || ""}`.toLowerCase();

  // Prefer vibe_elements scores (0-100) when available; fall back to raw poi_counts.
  // street_feel is not a POI count — derive it from the street_energy string attribute.
  const streetFeel =
    Number(e.street_feel?.score || 0) ||
    STREET_ENERGY_SCORE[(attrStr.street_energy || "").toLowerCase()] ||
    50;

  const v = (k) => {
    const fromVibe = Number(e[k]?.score || 0);
    if (fromVibe > 0) return fromVibe;
    if (k === "street_feel") return streetFeel;
    return Number(poi[k] || 0);
  };

  // Raw signals — intentionally NOT clamped to 100 here so that poi_counts (which
  // can exceed 100 for busy neighbourhoods) survive into normalizeSignalsByCity,
  // which performs city-wide min-max scaling before any BOOP math.
  const s = {
    walkability: v("street_feel") * 0.55 + v("cafes") * 0.2 + v("parks") * 0.25,
    green:       v("parks") * 0.9 + (tags.includes("nature") ? 15 : 0),
    foodie:      v("restaurants") * 0.65 + v("cafes") * 0.35,
    culture:     v("museums") * 0.55 + v("icon_spots") * 0.45,
    shopping:    v("shops") * 0.9 + (tags.includes("shopping") ? 12 : 0),
    nightlife:   v("street_feel") * 0.4 + v("restaurants") * 0.35 + (tags.includes("nightlife") ? 18 : 0),
    calm:        v("parks") * 0.5 + v("cafes") * 0.25 + (streetFeel <= 40 ? 20 : 0),
    central:     v("icon_spots") * 0.55 + v("street_feel") * 0.25 + (textHasAny(txt, ["central", "heart", "iconic"]) ? 14 : 0),
    local:       v("cafes") * 0.35 + v("street_feel") * 0.35 + v("restaurants") * 0.3 + (tags.includes("returning") ? 10 : 0),
    iconic:      v("icon_spots") * 0.9 + (textHasAny(txt, ["iconic", "landmark"]) ? 10 : 0),
    luxury:      v("shops") * 0.55 + (tags.includes("luxury") ? 28 : 0),
    touristy:    v("icon_spots") * 0.55 + (textHasAny(txt, ["touristy", "tourist"]) ? 18 : 0),
  };
  // Only enforce floor at 0; normalizeSignalsByCity will cap and scale.
  Object.keys(s).forEach((k) => { s[k] = Math.max(0, Math.round(s[k])); });
  return s;
}

function normalizeSignalsByCity(hoods) {
  if (!hoods?.length) return {};
  const dims = [
    "walkability",
    "green",
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
  const raw = hoods.map((h) => ({ name: h.name, s: deriveNbhdSignals(h) }));
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

function computeBoopMatch(h, profile, normByName) {
  if (!profile || !profile.prefs) return null;
  const sig = normByName[h.name] || deriveNbhdSignals(h);
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

  fit = Math.max(0, Math.min(1, fit));
  return fit;
}

/** @returns {Map<number, number>} neighborhood id → match % (45–99) */
function buildNeighborhoodMatchById(hoods, boopProfile) {
  const mergedPrefs = mergeBoopFreetextIntoPrefs(boopProfile.prefs || {}, boopProfile.freetext || "");
  const profileForMatch = {
    prefs: mergedPrefs,
    dealbreakers: boopProfile.dealbreakers || [],
  };
  const norm = normalizeSignalsByCity(hoods);
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
  const _emptyResult = { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows: [] };
  if (!rankedHotels.length || weight <= 0 || !boopProfile) return _emptyResult;

  const { data: hoodRows, error: hoodErr } = await fetchClient
    .from("neighborhoods")
    .select("id, name, vibe_elements, tags, vibe_short, vibe_long, attributes")
    .eq("city", city);

  if (hoodErr || !hoodRows?.length) return { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows: [] };

  const idToMatch = buildNeighborhoodMatchById(hoodRows, boopProfile);
  if (!idToMatch.size) return { nbhdFitByHotelId, primaryByHotel: new Map(), hoodRows };

  const neutralFit = neutralPct;
  const hotelIdsAll = rankedHotels.map((h) => h.hotel_id);
  const hotelIdsRpc = hotelIdsAll.slice(0, maxHotels);

  const primaryByHotel = new Map();
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

  return { nbhdFitByHotelId, primaryByHotel, hoodRows };
}

module.exports = {
  applyNbhdBoopRank,
  mergeBoopFreetextIntoPrefs,
  deriveNbhdSignals,
  buildNeighborhoodMatchById,
};
