/**
 * L2 cache for neighbourhood BOOP scoring (id→match% per profile, hotel→nbhd per city).
 */

const crypto = require("crypto");

const SCORING_VERSION = "nbhd-v3";
const PRIMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const _primaryL1 = new Map(); // city → { ts, data: Map }

function cacheEnabled() {
  return process.env.NBHD_BOOP_CACHE === "1" || process.env.NBHD_BOOP_CACHE === "true";
}

function stableJson(obj) {
  if (!obj || typeof obj !== "object") return "{}";
  const keys = Object.keys(obj).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

function buildProfileCacheKey(city, boopProfile) {
  const answers = boopProfile?.answers || {};
  const prefs = boopProfile?.prefs || {};
  const deal = [...(boopProfile?.dealbreakers || [])].sort().join(",");
  const ft = String(boopProfile?.freetext || "").trim().toLowerCase();
  const payload = [
    SCORING_VERSION,
    city,
    answers.nbhdScene || "",
    answers.trip || "",
    answers.group_size || "",
    stableJson(prefs),
    deal,
    ft,
  ].join("|");
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return `${SCORING_VERSION}|${city}|${hash}`;
}

async function readIdToMatch(supabase, cacheKey) {
  if (!cacheEnabled() || !supabase) return null;
  const { data, error } = await supabase
    .from("v2_nbhd_boop_cache")
    .select("id_to_match, scoring_version")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data?.id_to_match) return null;
  if (data.scoring_version !== SCORING_VERSION) return null;
  supabase.rpc("v2_nbhd_boop_cache_touch", { p_key: cacheKey }).then(() => {}, () => {});
  const map = new Map();
  for (const [k, v] of Object.entries(data.id_to_match)) {
    map.set(Number(k), Number(v));
  }
  return map;
}

async function writeIdToMatch(supabase, cacheKey, city, idToMatch) {
  if (!cacheEnabled() || !supabase || !idToMatch?.size) return;
  const obj = {};
  for (const [k, v] of idToMatch) obj[String(k)] = v;
  await supabase.from("v2_nbhd_boop_cache").upsert(
    {
      cache_key: cacheKey,
      city,
      scoring_version: SCORING_VERSION,
      id_to_match: obj,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  );
}

async function readPrimaryByCity(supabase, city) {
  const l1 = _primaryL1.get(city);
  if (l1 && Date.now() - l1.ts < PRIMARY_TTL_MS) return l1.data;

  if (!cacheEnabled() || !supabase) return null;
  const { data, error } = await supabase
    .from("v2_nbhd_primary_by_city")
    .select("primary_by_hotel, updated_at")
    .eq("city", city)
    .maybeSingle();
  if (error || !data?.primary_by_hotel) return null;

  const map = new Map();
  for (const [hid, nid] of Object.entries(data.primary_by_hotel)) {
    map.set(hid, Number(nid));
  }
  _primaryL1.set(city, { ts: Date.now(), data: map });
  return map;
}

async function writePrimaryByCity(supabase, city, primaryByHotel) {
  if (!primaryByHotel?.size) return;
  _primaryL1.set(city, { ts: Date.now(), data: primaryByHotel });

  if (!cacheEnabled() || !supabase) return;
  const obj = {};
  for (const [k, v] of primaryByHotel) obj[k] = v;
  await supabase.from("v2_nbhd_primary_by_city").upsert(
    {
      city,
      primary_by_hotel: obj,
      hotel_count: primaryByHotel.size,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "city" }
  );
}

module.exports = {
  SCORING_VERSION,
  cacheEnabled,
  buildProfileCacheKey,
  readIdToMatch,
  writeIdToMatch,
  readPrimaryByCity,
  writePrimaryByCity,
};
