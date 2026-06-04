/**
 * Per-hotel vibe match breakdown for detail UI (vsearch payload + client fallback).
 */

const { FACT_DESCRIPTIONS } = require("../scripts/fact-catalog");
const { deriveNbhdSignals, normalizeSignalsByCity } = require("./nbhd-vibe-rank");

const FACT_LABEL_OVERRIDES = {
  private_balcony: "Balcony or view",
  ergonomic_workspace: "Work desk",
  double_sinks: "Double sinks",
  walk_in_shower: "Walk-in shower",
  rainfall_shower: "Rainfall shower",
  soaking_tub: "Soaking tub",
  bathtub: "Bathtub",
  visual_style_sleek_polished: "Sleek & polished",
  visual_style_cozy_warm: "Warm & cozy",
  visual_style_vibrant_eclectic: "Distinct & characterful",
  visual_style_moody_dark: "Moody & dramatic",
  visual_style_classic_traditional: "Classic & traditional",
  area_pool: "Pool",
  area_bar: "Bar / lounge",
  area_rooftop: "Rooftop",
  area_spa: "Spa",
  area_lobby: "Lobby style",
};

function humanizeFactKey(factKey) {
  if (!factKey) return "";
  if (FACT_LABEL_OVERRIDES[factKey]) return FACT_LABEL_OVERRIDES[factKey];
  const desc = FACT_DESCRIPTIONS[factKey];
  if (desc) {
    const short = String(desc).split(/[,.]/)[0].trim();
    if (short.length <= 42) return short.charAt(0).toUpperCase() + short.slice(1);
  }
  return String(factKey)
    .replace(/^visual_style_/, "")
    .replace(/^area_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function combinedFactCoverage(cov, factKey) {
  if (!cov) return null;
  const room = cov.room?.[factKey];
  const pub = cov.public?.[factKey];
  if (room != null && pub != null) return Math.max(Number(room) || 0, Number(pub) || 0);
  if (room != null) return Number(room) || 0;
  if (pub != null) return Number(pub) || 0;
  return null;
}

/**
 * @param {object} p
 * @returns {object|null}
 */
function buildMatchBreakdown(p) {
  const {
    hotelId,
    topScore = 0,
    hotelScore = null,
    nbhdFitPct = null,
    nbhdRankWeight = 0,
    mustHaveKeys = [],
    hardFilterKeys = [],
    detectedFactKeys = [],
    hotelFactHits,
    hotelVibeCovMap,
    primaryNbhd,
    nbhdHoodRows = [],
    stayVibe = null,
    factWeightsRaw = {},
    featuredRoom = null,
  } = p;

  const roomPct = Math.round(Math.max(0, Math.min(100, Number(topScore) || 0)));
  const hotelPct = hotelScore != null ? Math.round(hotelScore) : null;
  const nbhdPct = nbhdFitPct != null ? Math.round(nbhdFitPct) : null;
  const wNbhd = nbhdRankWeight > 0 && nbhdPct != null ? nbhdRankWeight : 0;
  const overallPct = wNbhd > 0
    ? Math.round((1 - wNbhd) * roomPct + wNbhd * nbhdPct)
    : roomPct;

  const hits = hotelFactHits?.get?.(hotelId) || null;
  const mustKeys = [...new Set([...mustHaveKeys, ...hardFilterKeys].filter(Boolean))];
  const must_haves = mustKeys.map((fact_key) => {
    let status = hits?.has(fact_key) ? "met" : "none";
    if (featuredRoom && mustKeys.length) {
      status = featuredRoom.must_haves_met ? "met" : "none";
    }
    return {
      fact_key,
      label: humanizeFactKey(fact_key),
      status,
    };
  });
  const metCount = must_haves.filter((m) => m.status === "met").length;

  const queryOnlyKeys = detectedFactKeys.filter((fk) => fk && !mustKeys.includes(fk));
  const query_features = queryOnlyKeys.slice(0, 10).map((fact_key) => {
    const cov = combinedFactCoverage(hotelVibeCovMap?.get?.(hotelId), fact_key);
    let pct = hits?.has(fact_key) ? 100 : 0;
    if (cov != null) pct = Math.round(Math.max(0, Math.min(1, cov)) * 100);
    return { fact_key, label: humanizeFactKey(fact_key), pct };
  });

  const cov = hotelVibeCovMap?.get?.(hotelId);
  const hotel_character_facts = Object.entries(factWeightsRaw || {})
    .filter(([, w]) => Number(w) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([fact_key, weight]) => {
      const c = combinedFactCoverage(cov, fact_key);
      return {
        fact_key,
        label: humanizeFactKey(fact_key),
        pct: c != null ? Math.round(c * 100) : (hits?.has(fact_key) ? 100 : 0),
        weight: Math.round(weight * 100) / 100,
      };
    })
    .filter((row) => row.pct > 0 || row.weight >= 0.5);

  let nbhd_signals = null;
  if (primaryNbhd?.name && nbhdHoodRows.length) {
    const hood = nbhdHoodRows.find(
      (h) => h.id === primaryNbhd.id || h.name === primaryNbhd.name
    );
    if (hood) {
      const norm = normalizeSignalsByCity(nbhdHoodRows, stayVibe);
      const sig = norm[hood.name] || deriveNbhdSignals(hood, stayVibe);
      nbhd_signals = {
        walkability: sig.walkability ?? 0,
        trendy_cafes: Math.round(((sig.cafes || 0) + (sig.restaurants || 0)) / 2),
        culture_landmarks: Math.round(((sig.culture || 0) + (sig.iconic || 0)) / 2),
        nightlife: sig.nightlife ?? 0,
        calm_green: Math.round(((sig.calm || 0) + (sig.green || 0)) / 2),
      };
    }
  }

  const hasContent =
    roomPct > 0 ||
    hotelPct != null ||
    nbhdPct != null ||
    must_haves.length > 0 ||
    query_features.length > 0 ||
    hotel_character_facts.length > 0 ||
    nbhd_signals != null;

  if (!hasContent) return null;

  return {
    overall_pct: overallPct,
    room_pct: roomPct,
    hotel_pct: hotelPct,
    nbhd_pct: nbhdPct,
    must_haves_summary: mustKeys.length
      ? { met: metCount, total: mustKeys.length }
      : null,
    must_haves,
    query_features,
    hotel_character_facts,
    nbhd_signals,
    primary_nbhd_name: primaryNbhd?.name || null,
  };
}

module.exports = { buildMatchBreakdown, humanizeFactKey };
