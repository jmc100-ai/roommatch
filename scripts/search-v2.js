/**
 * search-v2.js — V2 fact-based search, scoring mirroring V1 exactly.
 *
 * The ONLY difference from V1:
 *   Room similarity = LLM fact match (0–1) instead of cosine vector similarity.
 *
 * Everything else is identical to V1:
 *   - Soft flag coverage boost  (covMult / missPen env vars)
 *   - Adaptive SIM_MAX / SIM_MIN / simSpan remapping
 *   - Mean-of-top-3 scoring for hotel display score
 *   - Photo-count penalty  (< 3 photos → score × len/3)
 *   - Room-level remapping + penalty
 *   - Neighbourhood BOOP blend sort (applyNbhdBoopRank)
 *   - HOTEL_SIM adaptive remapping for hotelScore
 */

const { buildFactIntent, buildFactIntentLLM, scoreFactSet, mergeStayVibeIntoIntent, STAY_VIBE_TO_VISUAL_STYLE } = require("./fact-catalog");
const { buildMatchBreakdown } = require("../lib/match-breakdown");
const { factsMeetMustRequirements } = require("../lib/featured-room");
const {
  buildMustHaveSpecFromDealbreakers,
  normalizeMustHaveSpec,
  resolveMustRequireSpec,
  specFingerprint,
} = require("../lib/must-have-spec");
const { normalizePolygonRing, pointInPolygon, bboxFromRing } = require("./neighborhood-vibe-data");

function slimStubsEnabled() {
  return process.env.VSEARCH_SLIM_STUBS === "1" || process.env.VSEARCH_SLIM_STUBS === "true";
}

function compactTailEnabled() {
  const v = process.env.VSEARCH_COMPACT_TAIL;
  if (v === "0" || v === "false") return false;
  return v === "1" || v === "true" || v == null || v === "";
}

function fullPayloadLimit() {
  return Math.max(50, Math.min(500, parseInt(process.env.VSEARCH_FULL_PAYLOAD_LIMIT || "250", 10)));
}

function fullRatesEmbedEnabled() {
  const v = process.env.VSEARCH_FULL_RATES_EMBED;
  if (v === "0" || v === "false") return false;
  return v === "1" || v === "true" || v == null || v === "";
}

function bookableRankEnabled() {
  const v = process.env.VSEARCH_BOOKABLE_RANK;
  if (v === "0" || v === "false") return false;
  return v === "1" || v === "true" || v == null || v === "";
}

function bookablePayloadEnabled() {
  const v = process.env.VSEARCH_BOOKABLE_PAYLOAD;
  if (v === "0" || v === "false") return false;
  return v === "1" || v === "true" || v == null || v === "";
}

function matchBreakdownTopN() {
  return Math.max(0, Math.min(250, parseInt(process.env.VSEARCH_MATCH_BREAKDOWN_TOPN || "25", 10)));
}

/** Minimal stub rows within the top-N full-payload window (no match_breakdown). */
function slimStubPayload(h) {
  const out = {
    id: h.id,
    vectorScore: h.vectorScore,
    isMatched: h.isMatched,
    property_type: h.property_type,
    roomTypes: [],
  };
  if (h.hotelScore != null) out.hotelScore = h.hotelScore;
  if (h.nbhd_fit_pct != null) out.nbhd_fit_pct = h.nbhd_fit_pct;
  if (h.mainPhoto) out.mainPhoto = h.mainPhoto;
  if (h.name) out.name = h.name;
  if (h.starRating) out.starRating = h.starRating;
  if (h.rating) out.rating = h.rating;
  if (h.address) out.address = h.address;
  if (h.hotel_must_haves_met != null) out.hotel_must_haves_met = h.hotel_must_haves_met;
  if (h.featured_room) out.featured_room = h.featured_room;
  if (h.price != null) out.price = h.price;
  if (h.roomPrices && Object.keys(h.roomPrices).length) out.roomPrices = h.roomPrices;
  if (h.primary_nbhd) {
    out.primary_nbhd = { id: h.primary_nbhd.id, name: h.primary_nbhd.name };
    if (h.nbhd_fit_pct == null && h.primary_nbhd.vibe_short) {
      out.primary_nbhd.vibe_short = h.primary_nbhd.vibe_short;
    }
  }
  return out;
}

/** Unbookable rows stashed for avail-OFF merge — keep roomTypes when phase-B loaded them. */
function unbookableStashPayload(h) {
  const out = compactTailPayload(h);
  if ((h.roomTypes || []).length > 0) out.roomTypes = h.roomTypes;
  return out;
}

/** Rank 251+ — scores + identity fields; room gallery lazy-loaded on scroll. */
function compactTailPayload(h) {
  const out = {
    id: h.id,
    vectorScore: h.vectorScore,
    isMatched: h.isMatched,
    property_type: h.property_type,
    roomTypes: [],
  };
  if (h.hotelScore != null) out.hotelScore = h.hotelScore;
  if (h.nbhd_fit_pct != null) out.nbhd_fit_pct = h.nbhd_fit_pct;
  if (h.name) out.name = h.name;
  if (h.mainPhoto) out.mainPhoto = h.mainPhoto;
  if (h.starRating) out.starRating = h.starRating;
  if (h.rating) out.rating = h.rating;
  if (h.address) out.address = h.address;
  if (h.hotel_must_haves_met != null) out.hotel_must_haves_met = h.hotel_must_haves_met;
  if (h.featured_room) out.featured_room = h.featured_room;
  if (h.price != null) out.price = h.price;
  if (h.roomPrices && Object.keys(h.roomPrices).length) out.roomPrices = h.roomPrices;
  if (h.primary_nbhd) {
    out.primary_nbhd = { id: h.primary_nbhd.id, name: h.primary_nbhd.name };
    if (h.primary_nbhd.vibe_short) out.primary_nbhd.vibe_short = h.primary_nbhd.vibe_short;
  }
  return out;
}

function deprioritizeStubHotels(hotels, depth = 50) {
  const { deprioritizeStubHotels: deprioritize } = require("../lib/v2-server-rank");
  return deprioritize(hotels, depth);
}

function shapeVsearchHotelPayload(hotels) {
  const limit = fullPayloadLimit();
  if (compactTailEnabled()) {
    return hotels.map((h, idx) => {
      if (idx < limit) {
        return (h.roomTypes || []).length > 0 ? h : slimStubPayload(h);
      }
      return compactTailPayload(h);
    });
  }
  if (slimStubsEnabled()) {
    return hotels.map((h) => ((h.roomTypes || []).length > 0 ? h : slimStubPayload(h)));
  }
  return hotels;
}

// ── Phase-A in-memory cache (per city, 5-minute TTL) ─────────────────────────
// Avoids re-fetching 3,500+ hotel cache rows + 9,600+ index rows on every search.
const _phaseACache = new Map(); // city → { ts, hotelRows, indexRows }
const PHASE_A_TTL_MS = Math.max(60_000, Math.min(60 * 60 * 1000,
  parseInt(process.env.PHASE_A_TTL_MS || "900000", 10)));

function getPhaseACache(city) {
  const entry = _phaseACache.get(city);
  if (entry && Date.now() - entry.ts < PHASE_A_TTL_MS) return entry;
  return null;
}
function setPhaseACache(city, hotelRows, indexRows) {
  _phaseACache.set(city, { ts: Date.now(), hotelRows, indexRows });
}
function invalidatePhaseACache(city) {
  if (city) _phaseACache.delete(city);
  else _phaseACache.clear();
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Legacy BOOP / V1 flag names → V2 fact_catalog keys */
const MUST_HAVE_ALIASES = {
  balcony: "private_balcony",
  work_desk: "ergonomic_workspace",
};

/** Merge room photos from v2_room_inventory when the facts RPC missed them. */
async function backfillRoomPhotosFromInventory(fetchClient, hotelIds, city, photosByHotel) {
  const need = hotelIds.filter((id) => !(photosByHotel.get(id) || []).length);
  if (!need.length) return 0;
  const { data, error } = await fetchClient
    .from("v2_room_inventory")
    .select("hotel_id, room_name, room_type_id, photo_url, photo_type")
    .in("hotel_id", need)
    .eq("city", city)
    .neq("room_name", "__hotel_public__")
    .limit(15000);
  if (error) {
    console.warn(`[v2] inventory_photo_backfill: ${error.message}`);
    return 0;
  }
  let added = 0;
  const seen = new Set();
  for (const row of data || []) {
    if (!row?.photo_url || !row.hotel_id) continue;
    const key = `${row.hotel_id}::${row.room_name}::${row.photo_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!photosByHotel.has(row.hotel_id)) photosByHotel.set(row.hotel_id, []);
    photosByHotel.get(row.hotel_id).push({
      hotel_id:     row.hotel_id,
      room_name:    row.room_name || "Room",
      room_type_id: row.room_type_id,
      photo_url:    row.photo_url,
      photo_type:   row.photo_type || "other",
    });
    added++;
  }
  if (added) {
    console.log(`[v2] inventory_photo_backfill: ${need.length} hotel(s), ${added} photo row(s)`);
  }
  return added;
}

function parseMustHaves(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((k) => MUST_HAVE_ALIASES[k] || k);
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat_min, lat_max, lon_min, lon_max] = parts;
  return { lat_min, lat_max, lon_min, lon_max };
}

function parseBoopProfile(req) {
  try {
    if (!req.query.boop_profile) return null;
    return JSON.parse(req.query.boop_profile);
  } catch {
    return null;
  }
}

function parsePolygon(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const ring = normalizePolygonRing(parsed);
    return ring?.length >= 4 ? ring : null;
  } catch {
    return null;
  }
}

function tokenize(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function textScore(tokens, roomName, hotelName) {
  if (!tokens.length) return 0.5;
  const text = `${roomName || ""} ${hotelName || ""}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (text.includes(t)) hits++;
  return hits / tokens.length;
}

async function embedText(text, geminiKey) {
  if (!text || !geminiKey) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const vals = d?.embedding?.values;
    if (!Array.isArray(vals) || vals.length === 0) return null;
    return vals.slice(0, 768);
  } catch {
    return null;
  }
}

// Bathroom-specific facts — drives intentType detection and photo bias
const BATHROOM_FACT_KEYS = new Set([
  "double_sinks", "soaking_tub", "rainfall_shower", "handheld_wand",
  "separate_toilet_door", "glass_wall_bathroom", "bidet_washlet",
  "natural_light_bathroom", "stone_surfaces", "anti_fog_mirror",
  "makeup_vanity", "heated_towel_rack",
]);

// For high-ambiguity facts: a single "yes" photo is only trusted when no-votes don't
// outnumber it. If yes=1 and no>=2, require a second yes to confirm.
// (yes=1, no=0 → confirm; yes=1, no=1 → confirm; yes=1, no≥2 → wait for second yes;
//  yes≥2 → always confirm regardless of no count)
const REQUIRE_MULTI_PHOTO = new Set([
  "double_sinks", "soaking_tub", "rainfall_shower", "walk_in_shower",
  "private_balcony", "floor_to_ceiling_windows",
]);

// ── main export ───────────────────────────────────────────────────────────────

async function runV2Search({ req, supabase, supabaseAdmin, resolveCityName }) {
  const query     = String(req.query.query || "").trim();
  const cityInput = String(req.query.city  || "").trim();
  if (!query || !cityInput)
    return { status: 400, body: { error: "query and city required" } };

  const fetchClient = supabaseAdmin || supabase;
  if (!fetchClient)
    return { status: 500, body: { error: "Supabase not configured" } };

  const _t0Total = Date.now();
  const _perf = {};
  const mustHaves = parseMustHaves(req.query.must_haves || "");
  const boopProfile = parseBoopProfile(req);
  const prelimMustSpec = boopProfile?.mustHaveSpec?.length
    ? normalizeMustHaveSpec(boopProfile.mustHaveSpec)
    : buildMustHaveSpecFromDealbreakers(boopProfile?.dealbreakers || []);
  const mustHaveSpecFingerprint = specFingerprint(prelimMustSpec);

  // Start NLP intent before city resolution — intent only needs query + supabase,
  // not the canonical city name. Overlaps resolveCityName (~50–200ms) with L2/LLM.
  const _t0Intent = Date.now();
  const intentPromise = buildFactIntentLLM(
    query,
    { mustHaves, mustHaveSpecFingerprint, supabase: fetchClient },
    process.env.GEMINI_KEY || ""
  ).then((i) => {
    _perf.nlp_intent_ms = Date.now() - _t0Intent;
    if (_perf.nlp_intent_ms > 50) {
      console.log(`[v2 perf] nlp intent: ${_perf.nlp_intent_ms}ms (router=${i.router_version || "regex"})`);
    }
    return i;
  });

  const _t0City = Date.now();
  const city = await resolveCityName(cityInput, fetchClient, ["indexed_cities", "hotels_cache"]);
  _perf.resolve_city_ms = Date.now() - _t0City;
  const hotelQuery = String(req.query.hotel_query || query).trim();
  const tokens    = tokenize(query);

  // ── Group size — room-level capacity penalty ───────────────────────────────
  // Read from boop_profile.answers.group_size; default "couple".
  // Also read stayVibe so we can apply a HOTEL-level property-type penalty
  // (Fix 3 for lp114339-class bugs: hostel ranks #1 for sleek_polished
  // queries because rooms tie at sim_max and there's no tiebreaker).
  let groupSize = "couple";
  let stayVibe  = null;
  let priceMatters = 0;
  let luxuryPref = 0;
  if (boopProfile) {
    const gs = boopProfile.answers?.group_size;
    if (gs === "solo" || gs === "couple" || gs === "group") groupSize = gs;
    const sv = boopProfile.answers?.stayVibe;
    if (typeof sv === "string" && sv.length > 0) stayVibe = sv;
    const pm = Number(boopProfile.answers?.priceMatters);
    if (Number.isFinite(pm)) priceMatters = Math.max(-100, Math.min(100, Math.round(pm)));
    const lp = Number(boopProfile.prefs?.luxury);
    if (Number.isFinite(lp)) luxuryPref = lp;
  }

  // Hotel-level property-type fit. Multiplicative penalty applied to topScore
  // so the polished/luxury preference from BOOP actually downranks hostels +
  // apartments instead of silently dropping into a sim-score tie at 100.
  //
  // Values are gentle enough to not nuke valid budget options; the goal is
  // tiebreaking, not exclusion. Default (no boop) returns 1.0 — only the
  // active "Hotels only" property-type filter does explicit exclusion.
  function propertyTypePenalty(propertyType) {
    if (!stayVibe) return 1.0;
    // Value-seeking on the price slider: do not downrank hostels (often the budget pick).
    if (priceMatters > 0 && propertyType === "hostel") return 1.0;
    if (propertyType === "hostel") {
      if (stayVibe === "sleek_polished")  return 0.72;
      if (stayVibe === "cozy_warm")       return 0.85;
      if (stayVibe === "distinct_unique") return 0.85;
      return 1.0;
    }
    if (propertyType === "apartment" || propertyType === "apartment_rental" ||
        propertyType === "vacation_home" || propertyType === "villa") {
      if (stayVibe === "sleek_polished")  return 0.90;
      return 1.0;
    }
    return 1.0;
  }

  // Returns a [0-1] multiplier to apply to rawScore based on group size fit.
  //
  // Primary: reads Gemini-classified boolean facts from v2_room_types_index
  //   (is_apartment, is_multi_bedroom, is_hostel_dorm) — language-agnostic.
  // Fallback: regex on room name for rooms not yet classified (pre-backfill).
  function groupSizePenalty(facts, roomName) {
    // Determine classification source
    const hasGeminiFacts = facts &&
      (facts.is_apartment !== undefined ||
       facts.is_multi_bedroom !== undefined ||
       facts.is_hostel_dorm !== undefined);

    let isMultiBed, isApartment, isDorm;

    if (hasGeminiFacts) {
      isMultiBed  = facts.is_multi_bedroom === true;
      isApartment = facts.is_apartment     === true;
      isDorm      = facts.is_hostel_dorm   === true;
    } else {
      // Regex fallback for rooms not yet classified by backfill-room-types.js
      const n = (roomName || "").toLowerCase();
      isMultiBed  = /\b([2-9]|two|three|four|five)\s*-?\s*bedroom\b|\b[2-9][\s-]?br\b/.test(n);
      isApartment = /\bapartment\b/.test(n) ||
                    /\bfamily\s+(room|suite|apartment)\b/.test(n);
      isDorm      = /\b(dormitory|hostel\s*bed|bunk\s*bed|dorm\b|bed\s+in\s+\d+[\s-]*bed|mixed\s+dorm)\b/.test(n);
    }

    if (groupSize === "solo") {
      if (isMultiBed)  return 0.10;
      if (isApartment) return 0.35;
      if (isDorm)      return 0.15;
      return 1;
    }
    if (groupSize === "couple") {
      if (isMultiBed)  return 0.12;
      if (isApartment) return 0.40;
      if (isDorm)      return 0.12;
      return 1;
    }
    if (groupSize === "group") {
      // Groups welcome apartments and multi-bed; only penalise hostel dorm beds
      if (isDorm) return 0.35;
      return 1;
    }
    return 1;
  }

  // ── Env tuning knobs (same names/defaults as V1) ──────────────────────────
  const GALLERY_LIMIT = 250;
  const covMult = parseFloat(process.env.SOFT_FLAG_COVERAGE_MULT   || "0.28");
  const missPen = parseFloat(process.env.SOFT_FLAG_MISS_PENALTY    || "0.08");
  const rawNbhdW = parseFloat(process.env.VSEARCH_NBHD_RANK_WEIGHT || "0.58");
  // `let` not `const`: when the user expressed an explicit nbhdScene preference
  // in Boop, we boost this 1.28× (capped at 0.62) below — same rule V1 applies
  // in server.js. Without the boost, room match dominates so heavily that a 100%
  // room match in an 85% nbhd-fit area beats an 82% room match in a 95% nbhd-fit
  // area, even when the user explicitly told us neighbourhood matters.
  let nbhdRankWeight = Number.isFinite(rawNbhdW) && rawNbhdW > 0 ? rawNbhdW : 0;

  // ── Geo pre-filter (polygon preferred, then bbox) ─────────────────────────
  let hotelIdsByGeo = null;
  const polygonRing = parsePolygon(req.query.polygon || "");
  const bbox        = parseBbox(req.query.bbox || "");

  if (polygonRing?.length >= 4) {
    const pb = bboxFromRing(polygonRing);
    if (pb?.lat_min != null) {
      const { data: polyHotels } = await fetchClient
        .from("hotels_cache")
        .select("hotel_id,lat,lng")
        .eq("city", city)
        .gte("lat", pb.lat_min).lte("lat", pb.lat_max)
        .gte("lng", pb.lon_min).lte("lng", pb.lon_max);
      const inside = (polyHotels || []).filter(
        (h) => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng)) &&
               pointInPolygon(Number(h.lat), Number(h.lng), polygonRing)
      );
      hotelIdsByGeo = inside.map((h) => h.hotel_id);
      console.log(`[v2] polygon filter: ${hotelIdsByGeo.length} hotels`);
      if (!hotelIdsByGeo.length) hotelIdsByGeo = null;
    }
  } else if (bbox) {
    const { data: bboxHotels } = await fetchClient
      .from("hotels_cache")
      .select("hotel_id")
      .eq("city", city)
      .gte("lat", bbox.lat_min).lte("lat", bbox.lat_max)
      .gte("lng", bbox.lon_min).lte("lng", bbox.lon_max);
    hotelIdsByGeo = (bboxHotels || []).map((h) => h.hotel_id);
    console.log(`[v2] bbox filter: ${hotelIdsByGeo.length} hotels`);
    if (!hotelIdsByGeo.length) hotelIdsByGeo = null;
  }

  // ── Phase A: load pre-aggregated room-type index + hotel IDs ─────────────
  const _t0 = Date.now();
  let hotelRows, indexRows;
  const cached = getPhaseACache(city);
  if (cached) {
    hotelRows = cached.hotelRows;
    indexRows = cached.indexRows;
    _perf.phase_a_ms = 0;
    console.log(`[v2 perf] phase-A db: 0ms (cache hit)  hotels=${hotelRows.length} index_rows=${indexRows.length}`);
  } else {
    const [cacheResult, indexResult] = await Promise.all([
      fetchClient
        .from("v2_hotels_cache")
        .select("hotel_id, property_type")
        .eq("city", city),
      fetchClient
        .from("v2_room_types_index")
        .select("hotel_id,room_name,facts,photo_count,photo_type_counts")
        .eq("city", city)
        .limit(100000),
    ]);
    if (cacheResult.error) return { status: 500, body: { error: cacheResult.error.message } };
    if (indexResult.error)  return { status: 500, body: { error: indexResult.error.message } };
    hotelRows = cacheResult.data || [];
    indexRows = indexResult.data || [];
    setPhaseACache(city, hotelRows, indexRows);
    _perf.phase_a_ms = Date.now() - _t0;
    console.log(`[v2 perf] phase-A db: ${_perf.phase_a_ms}ms  hotels=${hotelRows.length} index_rows=${indexRows.length}`);
  }

  // Resolve the NLP intent now — it has been running in parallel since the top
  // of this function. Cache hits are synchronous; uncached Gemini calls have
  // typically completed by the time we reach this point (overlapped with
  // resolveCityName + geo prefilter + phase-A DB).
  let intent = await intentPromise;

  // Inject visual_style soft preference from boop_profile.answers.stayVibe.
  // This bypasses the LLM/regex query parser (which deliberately doesn't pick
  // visual_style facts from free text — they only come from the wizard
  // selection). Without this injection, queries like "sleek modern minimalist"
  // produced detected_fact_keys=[] → every room got the same baseline 0.725
  // score → adaptive remap collapsed everything to 94-100% match.
  const stayVibeFact = STAY_VIBE_TO_VISUAL_STYLE[String(stayVibe || "").toLowerCase()];
  if (stayVibe) {
    intent = mergeStayVibeIntoIntent(intent, stayVibe);
  }

  // Detected fact keys (hard + soft from intent) — mirrors detectedFlagKeys in V1
  const detectedFactKeys = [
    ...(intent.hard_filters    || []).map((x) => x.fact_key),
    ...(intent.soft_preferences || []).map((x) => x.fact_key),
  ].filter(Boolean);
  const hasFlags = detectedFactKeys.length > 0;
  const hardFilterKeys = (intent.hard_filters || []).map((x) => x.fact_key).filter(Boolean);
  // BOOP mustHaveSpec (OR groups) + flat must_haves + LLM hard_filters (deduped).
  const mustRequireSpec = resolveMustRequireSpec({
    boopProfile,
    mustHavesQuery: mustHaves,
    hardFilterKeys,
  });

  // intentType: "bathroom" when bathroom facts are in query (mirrors V1 extractIntentType)
  const intentType = detectedFactKeys.some((k) => BATHROOM_FACT_KEYS.has(k))
    ? "bathroom"
    : null;

  const hotelMeta = new Map((hotelRows).map((r) => [r.hotel_id, { property_type: r.property_type || "hotel" }]));
  const cityHotelIds   = [...hotelMeta.keys()];
  const eligibleHotelIds = hotelIdsByGeo
    ? cityHotelIds.filter((id) => hotelIdsByGeo.includes(id))
    : cityHotelIds;

  // ── Full-city rates: start ASAP (parallel with scoring + phase B) ─────────
  const {
    fetchRatesForHotelIds,
    parseRatesNights,
    sanitizeRatesCurrency,
    getCachedRates,
  } = require("../lib/lite-rates");
  const { buildFullRatesCacheKey } = require("../lib/rates-snapshot");
  const {
    applyBookableRank,
    buildDatedDisplayOrder,
    isHotelBookable,
    attachRatesToHotel,
  } = require("../lib/bookable-rank");
  const ratesDateCtx = parseRatesNights(
    String(req.query.checkin || "").trim(),
    String(req.query.checkout || "").trim()
  );
  const ratesCurrency = sanitizeRatesCurrency(req.query.currency);
  const ratesCacheKey = ratesDateCtx
    ? buildFullRatesCacheKey(city, ratesDateCtx.checkin, ratesDateCtx.checkout, ratesCurrency)
    : null;
  let fullCityRatesPromise = null;
  let ratesTailPending = false;
  let embeddedRatesResult = null;

  if (ratesDateCtx && cityHotelIds.length) {
    const cachedFull = getCachedRates(ratesCacheKey);
    if (cachedFull) {
      embeddedRatesResult = {
        ...cachedFull,
        cache_hit: true,
        wall_ms: 0,
        hotel_ids_fetched: cityHotelIds.length,
      };
      fullCityRatesPromise = Promise.resolve(embeddedRatesResult);
    } else {
      ratesTailPending = true;
      const tRates0 = Date.now();
      fullCityRatesPromise = fetchRatesForHotelIds(
        cityHotelIds,
        ratesDateCtx.checkin,
        ratesDateCtx.checkout,
        ratesCurrency,
        { skipDetail: true, cacheKey: ratesCacheKey, supabase: fetchClient }
      )
        .then((r) => {
          _perf.rates_full_ms = Date.now() - tRates0;
          return r;
        })
        .catch((err) => {
          console.warn("[v2 rates] full-city failed:", err.message);
          return null;
        });
    }
  }

  if (!eligibleHotelIds.length) {
    return {
      status: 200,
      body: {
        hotels: [], query, city, indexing: false, indexStatus: "complete",
        stats: { search_version_used: "v2", ranked_hotels: 0 },
      },
    };
  }

  const eligibleSet = new Set(eligibleHotelIds);

  // ── Build per-room confirmed facts + hotel coverage from the pre-built index ─
  // hotelFactHits: hotel_id → Set of fact_keys confirmed true (for coverage boost)
  const hotelFactHits = new Map();
  // roomTypeMap: hotel_id → [{ room_name, facts, photo_count, photo_type_counts }]
  // photo_count + photo_type_counts feed the unified photo-aware hotel scoring
  // below so every hotel (not just top-GALLERY_LIMIT) is ranked on the same scale.
  const roomTypeMap = new Map();

  for (const row of indexRows) {
    if (!eligibleSet.has(row.hotel_id)) continue;
    const facts = row.facts || {};

    if (!roomTypeMap.has(row.hotel_id)) roomTypeMap.set(row.hotel_id, []);
    roomTypeMap.get(row.hotel_id).push({
      room_name:         row.room_name || "Room",
      facts,
      photo_count:       row.photo_count || 0,
      photo_type_counts: row.photo_type_counts || {},
    });

    // Build hotel-level fact hits for coverage scoring
    for (const [fk, fv] of Object.entries(facts)) {
      if (fv === true) {
        if (!hotelFactHits.has(row.hotel_id)) hotelFactHits.set(row.hotel_id, new Set());
        hotelFactHits.get(row.hotel_id).add(fk);
      }
    }
  }

  // ── Coverage map: hotel_id → fraction of detectedFactKeys present (mirrors V1 coverageMap) ─
  const coverageMap = new Map();
  if (hasFlags) {
    for (const hotelId of eligibleHotelIds) {
      const hits = hotelFactHits.get(hotelId);
      const c = hits
        ? detectedFactKeys.filter((fk) => hits.has(fk)).length / detectedFactKeys.length
        : 0;
      coverageMap.set(hotelId, c);
    }
  }

  // ── Compute per-room-type raw fact scores (0–1) ────────────────────────────
  // rawScore = 0.8 × factMatchScore + 0.2 × textScore
  const byHotel = new Map(); // hotel_id → [{ room_name, room_type_id, rawScore, factResult, features }]

  for (const [hotelId, rooms] of roomTypeMap.entries()) {
    for (const rt of rooms) {
      const factResult = scoreFactSet(rt.facts, intent);
      const txt        = textScore(tokens, rt.room_name, /* hotelName */ undefined);
      const rawScore   = Math.max(0, Math.min(1,
        (0.8 * factResult.total_score + 0.2 * txt) * groupSizePenalty(rt.facts, rt.room_name)
      ));

      if (!byHotel.has(hotelId)) byHotel.set(hotelId, []);
      byHotel.get(hotelId).push({
        room_name:         rt.room_name,
        room_type_id:      null, // not stored in index; resolved via photos in Phase B
        rawScore,
        factResult,
        features:          rt.facts,
        photo_count:       rt.photo_count,
        photo_type_counts: rt.photo_type_counts,
      });
    }
  }

  // ── Hotel-level raw sim = MAX room rawScore (mirrors V1 hotelSimMap = max cosine per hotel) ─
  // hotelSimMap: hotel_id → { rawSim, sBoosted, roomRows[] }
  const hotelSimMap = new Map();
  for (const [hotelId, rows] of byHotel.entries()) {
    const rawSim = Math.max(...rows.map((r) => r.rawScore));
    hotelSimMap.set(hotelId, { rawSim, sBoosted: rawSim, roomRows: rows });
  }

  const maxRawSim = hotelSimMap.size
    ? Math.max(...[...hotelSimMap.values()].map((h) => h.rawSim))
    : 0;

  // ── Soft flag coverage boost (exact V1 formula) ────────────────────────────
  if (hasFlags) {
    let withCov = 0;
    for (const [hotelId, h] of hotelSimMap.entries()) {
      const c = coverageMap.get(hotelId) ?? 0;
      if (c > 0) withCov++;
      let boosted = h.rawSim * (1 + covMult * c);
      boosted *= (1 - missPen * (1 - c));
      h.sBoosted = Math.min(0.999, boosted);
    }
    console.log(
      `[v2] soft_flags: cov_mult=${covMult} miss_penalty=${missPen} ` +
      `detected=[${detectedFactKeys.join(",")}] hotels_with_coverage=${withCov}/${hotelSimMap.size}`
    );
  }

  // ── Sort by sBoosted → pick top GALLERY_LIMIT ──────────────────────────────
  let rankedHotels = [...hotelSimMap.entries()]
    .map(([hotel_id, h]) => ({ hotel_id, rawSim: h.rawSim, sBoosted: h.sBoosted, roomRows: h.roomRows }))
    .sort((a, b) => b.sBoosted - a.sBoosted);

  if (!rankedHotels.length) {
    return {
      status: 200,
      body: {
        hotels: [], query, city, indexing: false, indexStatus: "complete",
        stats: { search_version_used: "v2", ranked_hotels: 0 },
      },
    };
  }

  _perf.scoring_ms = Date.now() - _t0;
  console.log(`[v2 perf] scoring: ${_perf.scoring_ms}ms  ranked=${rankedHotels.length}`);

  // Initial top set by room-match (sBoosted). When nbhd-boop runs below, we
  // recompute this so the post-boop top — i.e. the hotels that will actually
  // appear in the user's results — is the set we score / fetch photos for.
  // Mutable on purpose; see post-boop reshuffle.
  let topHotelIds = rankedHotels.slice(0, GALLERY_LIMIT).map((h) => h.hotel_id);

  // ── Neighbourhood BOOP blend (same as V1) ─────────────────────────────────
  let nbhdFitByHotelId = null;
  let nbhdPrimaryByHotel = new Map(); // hotel_id → neighborhood_id (ALL hotels)
  let nbhdHoodRows = [];              // neighborhood rows with id, name, vibe_short, attributes
  let nbhdCacheHit = false;
  const boopParam = req.query.boop_profile;
  if (nbhdRankWeight > 0 && boopParam && rankedHotels.length) {
    try {
      const boopProfileForNbhd = JSON.parse(boopParam);

      // nbhdScene-aware boost (mirrors V1 server.js ~line 2625). When the user
      // picked an explicit neighbourhood scene (buzz_central, calm_central,
      // hip_local, leafy_local, scenic_open), they told us neighbourhood matters
      // — bump the blend weight by 25% so a hotel in their preferred area can
      // outrank a hotel with marginally better room match in a different area.
      // Capped at 0.62 — higher values collapse leafy_local lists to a single hood.
      if (boopProfileForNbhd?.answers?.nbhdScene) {
        const boosted = Math.min(0.62, nbhdRankWeight * 1.28);
        if (boosted > nbhdRankWeight) {
          console.log(`[v2] nbhd_rank_weight boost: ${nbhdRankWeight.toFixed(3)} → ${boosted.toFixed(3)} (nbhdScene=${boopProfileForNbhd.answers.nbhdScene})`);
          nbhdRankWeight = boosted;
        }
      }

      // Pass similarity values as V1 expects (0-1 range)
      const rankedLite = rankedHotels.map((r) => ({
        hotel_id:   r.hotel_id,
        similarity: r.sBoosted,
      }));
      const { applyNbhdBoopRank } = require("../lib/nbhd-vibe-rank");
      const nbhdMaxHotels = parseInt(process.env.VSEARCH_NBHD_RANK_MAX_HOTELS || "5000", 10);
      const nbhdResult = await applyNbhdBoopRank(
        fetchClient, city, rankedLite, boopProfileForNbhd,
        {
          weight:         nbhdRankWeight,
          neutralPct:     parseFloat(process.env.VSEARCH_NBHD_NEUTRAL_PCT || "62"),
          maxHotels:      nbhdMaxHotels,
          rpcChunk:       nbhdMaxHotels, // single RPC call — faster than many small batches
          rpcConcurrency: 1,
        }
      );
      nbhdFitByHotelId   = nbhdResult.nbhdFitByHotelId;
      nbhdPrimaryByHotel = nbhdResult.primaryByHotel;
      nbhdHoodRows       = nbhdResult.hoodRows;
      nbhdCacheHit       = !!nbhdResult.nbhd_cache_hit;
      if (nbhdFitByHotelId?.size) {
        console.log(`[v2] nbhd_boop_rank: weight=${nbhdRankWeight} nbhd_scores=${nbhdFitByHotelId.size} primary_assignments=${nbhdPrimaryByHotel.size}`);

        // Post-boop topHotelIds reshuffle.
        //
        // The final result order (lines below) blends room match with nbhd
        // fit via `(1 - w) * primarySignal + w * nbhd_fit_pct`. With nbhd
        // weight set high (default 0.58 from .env), a hotel at position
        // ~2000 by pure room match but with near-100% nbhd fit can leapfrog
        // hotels in the top 250.
        //
        // If we don't re-pick topHotelIds here, those promoted hotels:
        //   - won't have photos fetched         → render with no photos
        //   - won't be in `hotelVibeRawMap`     → hotelScore = null
        //   - won't be in `primaryNbhdMap`      → no neighbourhood chip
        //   - won't be in `photoFactSet`        → photos can't be reordered
        //                                         by query-matching facts
        //
        // Rerank by the same blend the final sort uses (using raw sBoosted
        // as a stand-in for primarySignal — we don't yet have hotelVibePct
        // here; the small mismatch only matters for borderline picks at the
        // edge of GALLERY_LIMIT, which is fine).
        const w = nbhdRankWeight;
        const NEUTRAL_NBHD = parseFloat(process.env.VSEARCH_NBHD_NEUTRAL_PCT || "62") / 100;
        const rerankedTop = rankedHotels
          .map((r) => {
            const nb = (nbhdFitByHotelId.get(r.hotel_id) ?? (NEUTRAL_NBHD * 100)) / 100;
            return { hotel_id: r.hotel_id, blended: (1 - w) * r.sBoosted + w * nb };
          })
          .sort((a, b) => b.blended - a.blended)
          .slice(0, GALLERY_LIMIT)
          .map((r) => r.hotel_id);

        const before = new Set(topHotelIds);
        const after = new Set(rerankedTop);
        const promoted = rerankedTop.filter((id) => !before.has(id)).length;
        const demoted = topHotelIds.filter((id) => !after.has(id)).length;
        topHotelIds = rerankedTop;
        if (promoted > 0) {
          console.log(`[v2] nbhd_reshuffle: promoted=${promoted} demoted=${demoted} (top ${GALLERY_LIMIT})`);
        }
      }
    } catch (_) {}
  }

  _perf.post_boop_ms = Date.now() - _t0;
  console.log(`[v2 perf] post-boop: ${_perf.post_boop_ms}ms`);

  // ── Phase B: photos + hotel-vibe-facts + primary-nbhd (all parallel) ──
  //
  // Hotel-vibe scoring uses `score_hotels_facts_v2` (facts coverage of the
  // user's soft preferences, aggregated to hotel level from per-photo facts)
  // and replaces the legacy `score_hotels` (text-embedding cosine against
  // `hotel_profile_index`, which was never populated for any V2 city and
  // permanently produced `hotel_vibe_model="fallback_rating"`). The new
  // model mirrors the room scoring: facts + soft prefs + adaptive remap.
  //
  // Fact weights are built from intent.soft_preferences (which already
  // includes the stayVibe-injected visual_style_* fact). We intentionally
  // exclude hard_filters from the hotel-level model because hard filters
  // apply at room level (e.g. must_haves like "balcony"); the hotel score
  // should reflect aesthetic / area fit, not room-level binary requirements.
  const factWeightsRaw = {};
  for (const sp of (intent.soft_preferences || [])) {
    if (sp && sp.fact_key && Number.isFinite(sp.weight) && sp.weight > 0) {
      factWeightsRaw[sp.fact_key] = Math.max(0, Math.min(1, sp.weight));
    }
  }
  const hasHotelFactSignal = Object.keys(factWeightsRaw).length > 0;
  const hotelVibePromise = (hasHotelFactSignal && topHotelIds.length)
    ? fetchClient.rpc("score_hotels_facts_v2", {
        p_city:          city,
        p_hotel_ids:     topHotelIds,
        p_fact_weights:  factWeightsRaw,
        p_public_weight: Number(process.env.HOTEL_VIBE_PUBLIC_WEIGHT ?? "1"),
      })
    : Promise.resolve(null);

  const phaseBPromises = [
    fetchClient.rpc("get_v2_room_photos", { p_hotel_ids: topHotelIds, p_city: city, p_max_per_hotel: 10 }),
    hotelVibePromise,
    // Always RPC for visible hotels — BOOP primary-by-city cache may hold stale
    // neighborhood ids after regen; labels must not depend on that cache alone.
    fetchClient.rpc("get_primary_nbhds_for_hotels", { p_hotel_ids: topHotelIds }),
  ];
  const phaseB = await Promise.all(phaseBPromises);
  const [photosResult, hotelVibeResult, primaryNbhdRpcResult] = phaseB;

  _perf.phase_b_ms = Date.now() - _t0;
  console.log(`[v2 perf] phase-B parallel (photos+vibe+nbhd): ${_perf.phase_b_ms}ms  photos=${photosResult.data?.length}`);
  if (photosResult.error) return { status: 500, body: { error: photosResult.error.message } };

  // ── Hotel-vibe scoring (facts-based, mirrors room model) ───────────────────
  // `hotelVibeRawMap` holds the score_hotels_facts_v2 raw_score (0..1) per
  // hotel, with Phase-2 auxiliary priors (star, guest, photo-completeness)
  // folded in BEFORE adaptive remap. `hotelSimMaxRaw` is the result-set max
  // used for the same SIM_MAX/SIM_MIN adaptive window the room scoring uses.
  const hotelVibeRawMap = new Map(); // hotelId → adjusted raw score (0..1)
  const hotelVibeCovMap = new Map(); // hotelId → { room_coverage, public_coverage } (debug, not on payload by default)
  let hotelSimMaxRaw = 0;
  let hotelVibeModel = "fallback_rating";

  if (hotelVibeResult && !hotelVibeResult.error && hotelVibeResult.data?.length) {
    hotelVibeModel = "v2_facts";

    // ── Phase 2 auxiliary priors (small nudges; all clamped) ─────────────────
    // star_prior:   ±0.10 around 3-star centre.
    //               Only applied when stayVibe says "sleek_polished" OR
    //               "classic_traditional" — both inherently luxury-leaning.
    //               Otherwise neutral (0). Keeps cozy/eclectic/moody scoring
    //               clean from a star bias the user didn't ask for.
    // guest_prior: ±0.06 around 7.5/10 centre. Applied universally — well-
    //               reviewed hotels are slightly preferred regardless of
    //               vibe (this matches user mental models).
    // photo_completeness: hotels with fewer than 6 indexed photos take a
    //               linear penalty up to ×0.5. Mirrors the room-scoring
    //               photo-count penalty so sparse catalogue hotels can't
    //               leapfrog rich ones on a strong single fact.
    // When price matters is important, do not nudge 5★ up via star prior — it
    // fights the value-seeking penalty applied to display scores below.
    const wantsLuxuryPrior =
      priceMatters <= 32 &&
      (stayVibe === "sleek_polished" || stayVibe === "classic_traditional");

    const STAR_PRIOR_W   = parseFloat(process.env.HOTEL_VIBE_STAR_PRIOR   ?? "0.10");
    const GUEST_PRIOR_W  = parseFloat(process.env.HOTEL_VIBE_GUEST_PRIOR  ?? "0.06");
    const PHOTO_MIN      = parseInt(  process.env.HOTEL_VIBE_PHOTO_MIN    ?? "6",  10);

    for (const r of hotelVibeResult.data) {
      const meta = hotelMeta.get(r.hotel_id) || {};
      let adj = Math.max(0, Math.min(1, Number(r.raw_score) || 0));

      // Star prior (centred on 3-star). Hotels with no star_rating get 0.
      const star = Number(meta.star_rating) || 0;
      if (wantsLuxuryPrior && star > 0) {
        const starDelta = STAR_PRIOR_W * Math.max(-1, Math.min(1, (star - 3) / 2));
        adj = Math.max(0, Math.min(1, adj + starDelta));
      }

      // Guest prior (centred on 7.5/10).
      const guest = Number(meta.guest_rating) || 0;
      if (guest > 0) {
        const guestDelta = GUEST_PRIOR_W * Math.max(-1, Math.min(1, (guest - 7.5) / 2.5));
        adj = Math.max(0, Math.min(1, adj + guestDelta));
      }

      // Photo-completeness penalty: < PHOTO_MIN indexed photos scales the
      // raw score down linearly. total_room_photos + total_public_photos
      // is the natural denominator.
      const totalPhotos = (r.total_room_photos || 0) + (r.total_public_photos || 0);
      if (totalPhotos < PHOTO_MIN) {
        adj *= Math.max(0, totalPhotos / PHOTO_MIN);
      }

      hotelVibeRawMap.set(r.hotel_id, adj);
      hotelVibeCovMap.set(r.hotel_id, {
        room:   r.room_coverage   || {},
        public: r.public_coverage || {},
      });
      if (adj > hotelSimMaxRaw) hotelSimMaxRaw = adj;
    }
  }

  const HOTEL_SIM_MAX  = hotelSimMaxRaw > 0 ? hotelSimMaxRaw : 0.9;
  const HOTEL_SIM_MIN  = Math.max(HOTEL_SIM_MAX - 0.30, 0);
  const hotelSimSpan   = Math.max(HOTEL_SIM_MAX - HOTEL_SIM_MIN, 1e-9);

  // Primary neighbourhood map — fresh RPC for visible hotels; BOOP cache for tail.
  const primaryNbhdMap = new Map();
  if (primaryNbhdRpcResult && !primaryNbhdRpcResult.error) {
    for (const r of (primaryNbhdRpcResult.data || [])) {
      primaryNbhdMap.set(r.hotel_id, {
        id:         r.neighborhood_id,
        name:       r.name,
        vibe_short: r.vibe_short,
        attributes: r.attributes || null,
      });
    }
  } else if (primaryNbhdRpcResult?.error) {
    console.warn(`[v2] get_primary_nbhds_for_hotels error (non-fatal): ${primaryNbhdRpcResult.error.message}`);
  }
  if (nbhdPrimaryByHotel.size > 0 && nbhdHoodRows.length > 0) {
    const hoodById = new Map(nbhdHoodRows.map((h) => [h.id, h]));
    for (const [hotelId, nbhdId] of nbhdPrimaryByHotel) {
      if (primaryNbhdMap.has(hotelId)) continue;
      const hood = hoodById.get(nbhdId);
      if (hood) {
        primaryNbhdMap.set(hotelId, {
          id:         nbhdId,
          name:       hood.name,
          vibe_short: hood.vibe_short,
          attributes: hood.attributes || null,
        });
      }
    }
  }

  // ── Photo-level fact hit set (for photo ordering, same as V1 feature_flags) ─
  // Build: `hotel_id::photo_url::fact_key` → true
  let photoFactSet = new Set();
  if (hasFlags && topHotelIds.length) {
    const { data: photoFacts, error: pfErr } = await fetchClient
      .from("v2_room_feature_facts")
      .select("hotel_id,photo_url,fact_key,fact_value")
      .in("hotel_id", topHotelIds)
      .in("fact_key", detectedFactKeys)
      .eq("city", city)
      .eq("fact_value", 1);
    if (!pfErr) {
      for (const pf of (photoFacts || [])) {
        if (pf.photo_url) photoFactSet.add(`${pf.hotel_id}::${pf.photo_url}::${pf.fact_key}`);
      }
    }
  }

  // roomFlagMatchMap: `hotelId::roomName` → count of detectedFactKeys confirmed TRUE
  // Computed from room-type-level features (byHotel), NOT from photo order.
  // This is reliable regardless of how many photos we loaded or their DB ordering.
  const roomFlagMatchMap = new Map();
  if (hasFlags) {
    for (const [hotelId, rows] of byHotel.entries()) {
      for (const r of rows) {
        const hits = detectedFactKeys.filter((fk) => r.features[fk] === true).length;
        const key = `${hotelId}::${r.room_name}`;
        const prev = roomFlagMatchMap.get(key) ?? 0;
        if (hits > prev) roomFlagMatchMap.set(key, hits);
      }
    }
  }

  // Group photos by hotel, then by room — skip __hotel_public__ pseudo-rows
  // (those are lobby/pool/bar photos used for hotel-vibe scoring only; they
  // must never appear as a "room type" in the card photo strip).
  const photosByHotel = new Map(); // hotel_id → [photo rows]
  for (const p of (photosResult.data || [])) {
    if (p.room_name === '__hotel_public__') continue;
    if (!photosByHotel.has(p.hotel_id)) photosByHotel.set(p.hotel_id, []);
    photosByHotel.get(p.hotel_id).push(p);
  }
  await backfillRoomPhotosFromInventory(
    fetchClient,
    topHotelIds.filter((id) => !(photosByHotel.get(id) || []).length),
    city,
    photosByHotel
  );

  // ── Adaptive score remapping (exact V1 constants) ─────────────────────────
  const SIM_MAX  = maxRawSim > 0 ? maxRawSim : 0.9;
  const SIM_MIN  = Math.max(SIM_MAX - 0.30, 0);
  const simSpan  = Math.max(SIM_MAX - SIM_MIN, 1e-9);

  function remap(rawScore) {
    return Math.max(0, Math.min(100, ((rawScore - SIM_MIN) / simSpan) * 100));
  }

  // ── Build hotel objects (mirrors V1 allHotels loop) ────────────────────────
  const needsBathroomBias = detectedFactKeys.some((k) => BATHROOM_FACT_KEYS.has(k));

  // roomTypeSimMap: `hotel_id::roomName` → rawScore  (mirrors V1 roomTypeSimMap for room scoring)
  const roomTypeSimMap = new Map();
  for (const [hotelId, rows] of byHotel.entries()) {
    for (const r of rows) {
      const prev = roomTypeSimMap.get(`${hotelId}::${r.room_name}`) ?? 0;
      if (r.rawScore > prev) roomTypeSimMap.set(`${hotelId}::${r.room_name}`, r.rawScore);
    }
  }

  // ── Unified hotel display scoring ──────────────────────────────────────────
  // topScore is the MAX effective per-room display score, defined to match
  // exactly what the user sees on the room cards below (roomEntries):
  //
  //   effective_room_score = remap(r.rawScore) × (photos<3 ? photos/3 : 1)
  //   topScore = max(effective_room_score) over all rooms in the hotel
  //
  // History / why this formula:
  //
  //   Pre-May-2026 we used h.sBoosted (coverage-boosted MAX rawScore). Once
  //   a hotel's best room hit rawSim ≥ ~0.64 with full coverage (×1.28),
  //   sBoosted lifted above SIM_MAX so dozens of hotels clamped at
  //   topScore=100, and ranking devolved to the 1-pt HOTEL_VIBE_BLEND_WEIGHT
  //   delta — Casa Independencia (50% room) outranking Casa Herrmann (77%).
  //
  //   The first fix (e7456fd) switched to photoMeanScore (mean of top-3
  //   photo-weighted rawScores, walked across rooms sorted by rawScore).
  //   That solved the saturation but introduced a new asymmetry: the
  //   per-room display applies a photo-count penalty (×photos/3 when <3),
  //   but photoMeanScore did NOT — so a hotel with one BEST room of 2
  //   high-similarity photos got vec=81 while the room itself displayed
  //   only 67% (penalised). That ranked El Diplomatico (King Room 67%, 2
  //   photos) above Novotel (best room 90%, 3+ photos) in the same
  //   neighbourhood, contradicting what the user could see on screen.
  //
  //   This formula collapses both display & ranking onto the SAME number
  //   the user reads off the best-matching room card. No more "vec=81 but
  //   topRoom=67" disconnect. Hotels with sparse top rooms are correctly
  //   penalised at the hotel level; hotels with deep, high-scoring top
  //   rooms (Novotel) ride their per-room display score directly into rank.
  //
  // rankScore (raw, 0..1) = the rawScore of the room that won the max — used
  // as a tiebreaker downstream when topScore clamps at 100.
  //
  // Soft-flag coverage signal is preserved via (a) hotelVibePct (explicit
  // facts coverage at hotel level, blended at 0.20), (b) sBoosted is still
  // used at line ~454 to pick the top GALLERY_LIMIT hotels into Phase B so
  // coverage-rich hotels still get photo-loaded, and (c) the user's
  // HyDE-derived query embedding already encodes facts into rawScore.
  const hotelDisplayScores = new Map();

  let penalisedCount = 0;
  for (const h of rankedHotels) {
    const rooms = byHotel.get(h.hotel_id) || [];
    let totalAll = 0;
    let totalIntent = 0;
    for (const r of rooms) {
      totalAll += r.photo_count || 0;
      if (intentType) totalIntent += (r.photo_type_counts?.[intentType] || 0);
    }
    const useIntent = !!intentType && totalIntent > 0;

    // Find the best room by EFFECTIVE per-room display score (mirrors the
    // exact formula in roomEntries below). Walk in rawScore-descending order
    // so the first room that produces a non-penalised effective score wins,
    // but penalised candidates can still take the lead over weaker rooms
    // with no penalty.
    let bestEffective = 0;
    let bestRoomRaw = h.rawSim || 0;
    let bestRoomPhotos = 0;
    if (totalAll > 0) {
      const sortedRooms = rooms.slice().sort((a, b) => (b.rawScore || 0) - (a.rawScore || 0));
      for (const r of sortedRooms) {
        if (mustRequireSpec.length && !factsMeetMustRequirements(r.features, mustRequireSpec)) continue;
        // Penalty uses TOTAL photo_count, matching roomEntries' use of
        // entry.photos.length (which is total photos for the room, not
        // intent-filtered). useIntent only affects the SKIP filter so we
        // don't pick a room with 0 intent-type photos as the best.
        const totalPhotos = r.photo_count || 0;
        if (totalPhotos === 0) continue;
        if (useIntent) {
          const intentPhotos = r.photo_type_counts?.[intentType] || 0;
          if (intentPhotos === 0) continue;
        }
        const photoMul = totalPhotos < 3 ? (totalPhotos / 3) : 1;
        const effective = remap(r.rawScore || 0) * photoMul;
        if (effective > bestEffective) {
          bestEffective = effective;
          bestRoomRaw = r.rawScore || 0;
          bestRoomPhotos = totalPhotos;
        }
      }
    }

    // rankScore stays in raw space (0..1) for tiebreaker compatibility.
    const rankScore = bestRoomRaw;
    let topScore = bestEffective;

    // The per-room photo-count penalty applied above already covers sparse-
    // top-room hotels, so we only fall back to a hotel-wide totalAll<3
    // penalty when NO room produced an effective score (eg. all rooms had
    // 0 photo_count due to a stale index). In that case bestEffective=0
    // and the penalty is a no-op anyway, so this is purely defensive.
    if (totalAll < 3 && bestEffective === 0) {
      penalisedCount++;
    }

    // Property-type fit penalty (Fix 3): downrank hostels/apartments when
    // boop stayVibe says polished. Without this, dozens of hotels tie at
    // topScore=100 after remap clamps everything at sim_max, and insertion
    // order from the DB query decides which one shows #1.
    const ptype = hotelMeta.get(h.hotel_id)?.property_type || "hotel";
    const ptPenalty = propertyTypePenalty(ptype);
    if (ptPenalty !== 1.0) topScore *= ptPenalty;

    hotelDisplayScores.set(h.hotel_id, { topScore, rankScore });
  }
  if (penalisedCount > 0) {
    console.log(`[v2] photo-count penalty applied to ${penalisedCount} hotels (< 3 indexed photos)`);
  }

  // ── Final hotel sort (mirrors V1 allHotels.sort) ──────────────────────────
  //
  // Display-score is `topScore` (room-level match). We additionally compute
  // `hotelVibePct` (0..100, from adaptive remap of the facts-coverage
  // raw_score) and blend it into the primary sort signal:
  //
  //   blended = (1 - W_blend) * topScore + W_blend * hotelVibePct
  //
  // `HOTEL_VIBE_BLEND_WEIGHT` env (default 0.20) controls how much the
  // hotel vibe nudges the primary ranking. The room score remains the
  // dominant signal; hotel vibe breaks ties and shifts mid-pack ordering.
  // When `hotel_vibe_model = "fallback_rating"` (no facts signal), the
  // blend collapses to topScore-only via hotelVibePct=null.
  //
  // Tiebreaker stack: blended → hotelVibePct → guest_rating → star_rating
  //                   → hotel_id alpha. Eliminates the "arbitrary which
  //                   hotel is #1 when 10 tie at vectorScore=100" complaint.
  const HOTEL_VIBE_BLEND_WEIGHT = Math.max(0, Math.min(1,
    parseFloat(process.env.HOTEL_VIBE_BLEND_WEIGHT ?? "0.20")
  ));
  const allHotels = rankedHotels.map((h) => {
    const { topScore, rankScore } = hotelDisplayScores.get(h.hotel_id) || { topScore: 0, rankScore: 0 };
    const rawHotelSim = hotelVibeRawMap.get(h.hotel_id);
    const hotelVibePct = rawHotelSim != null
      ? Math.max(0, Math.min(100, ((rawHotelSim - HOTEL_SIM_MIN) / hotelSimSpan) * 100))
      : null;
    const meta = hotelMeta.get(h.hotel_id) || {};
    return {
      hotel_id:     h.hotel_id,
      topScore,
      // rawRoom is the pre-remap, pre-penalty rawScore of the room that
      // produced the hotel's max effective per-room display score. Used as a
      // finer-grained tiebreaker when topScore clamps at 100 for multiple
      // hotels at or above SIM_MAX.
      rawRoom:      Number(rankScore) || 0,
      hotelVibePct,
      // rawHotelVibe is the pre-remap, pre-clamp facts-coverage score
      // (0..1). Two hotels can both have hotelVibePct=100 (both clamped)
      // but differ on rawHotelVibe — this is the natural tiebreaker.
      rawHotelVibe: rawHotelSim != null ? rawHotelSim : -1,
      sBoosted:     h.sBoosted,
      rawSim:       h.rawSim,
      // guest_rating / star_rating come only from live LiteAPI (lazy fetch
      // after sort) so they're 0 here. Kept for completeness / Phase 2
      // priors that read hotelMeta separately.
      guest_rating: Number(meta.guest_rating) || 0,
      star_rating:  Number(meta.star_rating)  || 0,
    };
  });

  // Helper: combined primary sort signal.
  //
  // Three cases:
  //   1. hotelVibePct != null      — hotel was scored. Blend room+vibe.
  //   2. hotelVibePct == null AND hotelVibeModel == "v2_facts"
  //                                — global vibe signal exists but this
  //                                  hotel sat outside topHotelIds, so we
  //                                  don't have a coverage number for it.
  //                                  Treat as zero coverage so it can't
  //                                  outrank scored hotels just because
  //                                  we didn't compute its hVP. Without
  //                                  this branch an unscored hotel with
  //                                  topScore=100 gets primarySignal=100,
  //                                  beating a scored hotel with hVP=89
  //                                  (primarySignal=97.8) — the exact
  //                                  "9/10 unscored in top 10" bug.
  //   3. hotelVibePct == null AND no global signal — there is no hotel-
  //                                  vibe signal AT ALL for this query,
  //                                  so falling back to topScore alone
  //                                  is correct (every hotel is in the
  //                                  same boat).
  function primarySignal(h) {
    if (h.hotelVibePct != null) {
      return (1 - HOTEL_VIBE_BLEND_WEIGHT) * h.topScore + HOTEL_VIBE_BLEND_WEIGHT * h.hotelVibePct;
    }
    if (hotelVibeModel === "v2_facts") {
      return (1 - HOTEL_VIBE_BLEND_WEIGHT) * h.topScore;
    }
    return h.topScore;
  }

  // Deterministic tiebreaker stack. The first two signals can clamp at
  // their adaptive-remap ceiling so many hotels collide there; the raw
  // pre-remap scores are the actual discriminators.
  //   primarySignal (post-remap blended)
  //   → rawHotelVibe (pre-remap facts coverage 0..1)
  //   → rawRoom      (pre-remap room rankScore)
  //   → guest_rating (0 unless persisted; placeholder for future)
  //   → star_rating  (0 unless persisted)
  //   → hotel_id alphabetical (stable across reloads).
  function compareHotels(a, b) {
    const sa = primarySignal(a);
    const sb = primarySignal(b);
    if (Math.abs(sb - sa) > 1e-6) return sb - sa;

    if (Math.abs(b.rawHotelVibe - a.rawHotelVibe) > 1e-9) return b.rawHotelVibe - a.rawHotelVibe;
    if (Math.abs(b.rawRoom      - a.rawRoom)      > 1e-9) return b.rawRoom      - a.rawRoom;

    if (b.guest_rating !== a.guest_rating) return b.guest_rating - a.guest_rating;
    if (b.star_rating  !== a.star_rating)  return b.star_rating  - a.star_rating;

    return a.hotel_id.localeCompare(b.hotel_id);
  }
  allHotels.sort(compareHotels);

  if (nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0) {
    const w = nbhdRankWeight;
    allHotels.sort((a, b) => {
      const nbA = nbhdFitByHotelId.get(a.hotel_id) ?? 62;
      const nbB = nbhdFitByHotelId.get(b.hotel_id) ?? 62;
      const ca  = (1 - w) * (primarySignal(a) / 100) + w * (nbA / 100);
      const cb  = (1 - w) * (primarySignal(b) / 100) + w * (nbB / 100);
      if (Math.abs(cb - ca) > 1e-6) return cb - ca;
      // Same deterministic tiebreaker stack as the non-nbhd path.
      return compareHotels(a, b);
    });
  }

  // ── DEBUG: top-15 ranking dump (temporary) ──────────────────────────────
  // Logs the exact components that drive the final hotel ordering so we can
  // diagnose "hotel A ranks above hotel B even though room/hotel/nbhd scores
  // suggest the opposite". Fires only for the visible top so the log stays
  // small. Grep "[v2-rank-debug]" to find.
  try {
    const wDbg = (nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0) ? nbhdRankWeight : 0;
    const HVB  = HOTEL_VIBE_BLEND_WEIGHT;
    const dbgRows = allHotels.slice(0, 15).map((h, i) => {
      const nb        = nbhdFitByHotelId?.get(h.hotel_id);
      const ps        = primarySignal(h);
      const blended   = wDbg > 0
        ? ((1 - wDbg) * (ps / 100) + wDbg * ((nb ?? 62) / 100)) * 100
        : ps;
      const primaryNbhdObj = primaryNbhdMap.get(h.hotel_id);
      const primaryNbhd = primaryNbhdObj?.name || "—";
      return `  #${String(i + 1).padStart(2)} ${h.hotel_id.padEnd(12)} `
        + `top=${h.topScore.toFixed(1).padStart(5)} `
        + `hVP=${h.hotelVibePct == null ? " null" : h.hotelVibePct.toFixed(1).padStart(5)} `
        + `primary=${ps.toFixed(2).padStart(6)} `
        + `nbhd_fit=${(nb == null ? "—" : nb.toFixed(1).padStart(5))} `
        + `blended=${blended.toFixed(2).padStart(6)} `
        + `rawRoom=${(h.rawRoom || 0).toFixed(4)} `
        + `rawHV=${h.rawHotelVibe.toFixed(4)} `
        + `nbhd="${primaryNbhd}"`;
    });
    console.log(
      `[v2-rank-debug] final-sort top-15 (HVB=${HVB.toFixed(2)} nbhdW=${wDbg.toFixed(3)} `
      + `SIM_MAX=${SIM_MAX.toFixed(4)} SIM_MIN=${SIM_MIN.toFixed(4)} `
      + `HOTEL_SIM_MAX=${HOTEL_SIM_MAX.toFixed(4)} HOTEL_SIM_MIN=${HOTEL_SIM_MIN.toFixed(4)}):\n`
      + dbgRows.join("\n")
    );
  } catch (e) {
    console.log(`[v2-rank-debug] log failed: ${e.message}`);
  }

  // Phase B fetched room photos only for `topHotelIds` (pre-final-sort pick).
  // Final ordering uses primarySignal + optional nbhd blend — different from
  // the pre-sort nbhd reshuffle — so hotels can land in the top N visible
  // results without ever receiving a photo RPC row → empty roomTypes while
  // vectorScore still reflects index facts. Backfill photos for whoever sits
  // in the final top GALLERY_LIMIT but is missing from photosByHotel.
  const finalTopIds = allHotels.slice(0, GALLERY_LIMIT).map((h) => h.hotel_id);
  const missingPhotoIds = finalTopIds.filter((id) => (photosByHotel.get(id) || []).length === 0);
  if (missingPhotoIds.length) {
    const extraResult = await fetchClient.rpc("get_v2_room_photos", {
      p_hotel_ids:     missingPhotoIds,
      p_city:          city,
      p_max_per_hotel: 10,
    });
    if (extraResult.error) {
      console.warn(`[v2] photo_backfill: ${extraResult.error.message}`);
    } else {
      for (const p of (extraResult.data || [])) {
        if (p.room_name === '__hotel_public__') continue;
        if (!photosByHotel.has(p.hotel_id)) photosByHotel.set(p.hotel_id, []);
        photosByHotel.get(p.hotel_id).push(p);
      }
      if (hasFlags && missingPhotoIds.length) {
        const { data: photoFacts, error: pfErr } = await fetchClient
          .from("v2_room_feature_facts")
          .select("hotel_id,photo_url,fact_key,fact_value")
          .in("hotel_id", missingPhotoIds)
          .in("fact_key", detectedFactKeys)
          .eq("city", city)
          .eq("fact_value", 1);
        if (!pfErr) {
          for (const pf of (photoFacts || [])) {
            if (pf.photo_url) photoFactSet.add(`${pf.hotel_id}::${pf.photo_url}::${pf.fact_key}`);
          }
        }
      }
      console.log(`[v2] photo_backfill: ${missingPhotoIds.length} hotel(s) in final top ${GALLERY_LIMIT} had no Phase-B photos — merged ${(extraResult.data || []).length} rows`);
    }
    await backfillRoomPhotosFromInventory(fetchClient, missingPhotoIds, city, photosByHotel);
  }

  // After backfill, demote final visible-top hotels that still have no indexed room photos.
  const NO_ROOM_PHOTO_PENALTY = parseFloat(process.env.VSEARCH_NO_PHOTO_PENALTY || "0.88");
  const finalTopIdSet = new Set(allHotels.slice(0, GALLERY_LIMIT).map((h) => h.hotel_id));
  if (NO_ROOM_PHOTO_PENALTY > 0 && NO_ROOM_PHOTO_PENALTY < 1) {
    let penalized = 0;
    for (const h of allHotels) {
      if (!finalTopIdSet.has(h.hotel_id)) continue;
      if (!(photosByHotel.get(h.hotel_id) || []).length) {
        h.topScore *= NO_ROOM_PHOTO_PENALTY;
        penalized++;
      }
    }
    if (penalized) {
      console.log(`[v2] no_room_photo_penalty: ${penalized} hotel(s) × ${NO_ROOM_PHOTO_PENALTY} (post-backfill re-sort)`);
      allHotels.sort(compareHotels);
      if (nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0) {
        const w = nbhdRankWeight;
        allHotels.sort((a, b) => {
          const nbA = nbhdFitByHotelId.get(a.hotel_id) ?? 62;
          const nbB = nbhdFitByHotelId.get(b.hotel_id) ?? 62;
          const ca  = (1 - w) * (primarySignal(a) / 100) + w * (nbA / 100);
          const cb  = (1 - w) * (primarySignal(b) / 100) + w * (nbB / 100);
          if (Math.abs(cb - ca) > 1e-6) return cb - ca;
          return compareHotels(a, b);
        });
      }
    }
  }

  // LiteAPI catalog photos from v2_hotels_cache — fallback thumbnails until
  // synchronous meta fetch sets mainPhoto on each hotel payload.
  const catalogHeroByHotel = new Map();
  if (finalTopIds.length) {
    const { data: cacheRows, error: cacheErr } = await fetchClient
      .from("v2_hotels_cache")
      .select("hotel_id, hotel_photos")
      .in("hotel_id", finalTopIds)
      .eq("city", city);
    if (cacheErr) {
      console.warn(`[v2] catalog_hero: ${cacheErr.message}`);
    } else {
      for (const row of cacheRows || []) {
        const urls = (Array.isArray(row.hotel_photos) ? row.hotel_photos : []).filter(Boolean);
        if (urls.length) catalogHeroByHotel.set(row.hotel_id, urls);
      }
      if (catalogHeroByHotel.size) {
        console.log(`[v2] catalog_hero: ${catalogHeroByHotel.size}/${finalTopIds.length} hotels in top ${GALLERY_LIMIT}`);
      }
    }
  }

  const breakdownCtx = {
    nbhdRankWeight: nbhdFitByHotelId?.size > 0 ? nbhdRankWeight : 0,
    mustHaveKeys: mustHaves,
    mustHaveSpec: mustRequireSpec,
    hardFilterKeys,
    detectedFactKeys,
    hotelFactHits,
    hotelVibeCovMap,
    nbhdHoodRows,
    stayVibe,
    factWeightsRaw,
  };
  function matchBreakdownFor(hotelId, topScore, hotelScore, primaryNbhd, nbhdFitPct, featuredRoom, featuredRoomFacts) {
    return buildMatchBreakdown({
      hotelId,
      topScore,
      hotelScore,
      nbhdFitPct,
      ...breakdownCtx,
      primaryNbhd,
      featuredRoom,
      featuredRoomFacts,
    });
  }

  /** Index-level must (v2_room_types_index facts) — works without Phase-B photos. */
  function hotelMustMetFromIndex(hotelId) {
    if (!mustRequireSpec.length) return undefined;
    const rooms = roomTypeMap.get(hotelId) || [];
    return rooms.some((r) => factsMeetMustRequirements(r.facts, mustRequireSpec));
  }

  // ── Build response payload ─────────────────────────────────────────────────
  const NBHD_NEUTRAL_PCT = parseFloat(process.env.VSEARCH_NBHD_NEUTRAL_PCT || "62");
  function resolveNbhdFitPct(hotelId) {
    if (!nbhdFitByHotelId?.size) return undefined;
    const v = nbhdFitByHotelId.get(hotelId);
    return v != null ? v : NBHD_NEUTRAL_PCT;
  }

  let hotels = allHotels.map(({ hotel_id: hotelId, topScore, hotelVibePct, rawHotelVibe, rawRoom }) => {
    const meta       = hotelMeta.get(hotelId) || {};
    const score      = Math.round(topScore);
    const allPhotos  = photosByHotel.get(hotelId) || [];
    const hasPhotos  = allPhotos.length > 0;

    // Hotel-level vibe score (0-100). Displays the RAW facts coverage so
    // top hotels naturally differentiate (a 98% coverage hotel reads 98,
    // not 100 from an adaptive-remap clamp). The SORT still blends the
    // adaptive-remapped hotelVibePct with topScore via primarySignal so
    // ranking quality is consistent across queries with different score
    // distributions — but the displayed number is the honest absolute.
    // null when no facts signal exists for this query.
    const hotelScore = rawHotelVibe != null && rawHotelVibe >= 0
      ? Math.round(Math.max(0, Math.min(1, rawHotelVibe)) * 100)
      : null;

    const primaryNbhd = primaryNbhdMap.get(hotelId) || null;
    const nbhdFitPct  = resolveNbhdFitPct(hotelId);
    const propertyType = meta.property_type || "hotel";

    if (!hasPhotos) {
      const catalogUrls = catalogHeroByHotel.get(hotelId) || [];
      const hotelMustFromIndex = hotelMustMetFromIndex(hotelId);
      return {
        id:           hotelId,
        name:         "", // real name from LiteAPI merged in server.js (never use raw id as title)
        address:      "",
        city,
        country:      "",
        starRating:   0,
        rating:       0,
        mainPhoto:    catalogUrls[0] || null,
        hotelPhotos:  catalogUrls.slice(0, 8),
        roomTypes:    [],
        isMatched:    score > 0,
        vectorScore:  score,
        hotelScore,
        property_type: propertyType,
        primary_nbhd: primaryNbhd,
        ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
        ...(hotelVibePct != null ? { hotelVibePct: Math.round(hotelVibePct * 10) / 10 } : {}),
        ...(mustRequireSpec.length ? { hotel_must_haves_met: !!hotelMustFromIndex } : {}),
        match_breakdown: matchBreakdownFor(hotelId, score, hotelScore, primaryNbhd, nbhdFitPct, null),
        score_breakdown: {
          v2_room_match: score,
          v2_hotel_vibe: hotelScore,
          v2_hotel_vibe_pct: hotelVibePct != null ? Math.round(hotelVibePct * 10) / 10 : null,
          raw_room: rawRoom != null ? parseFloat(Number(rawRoom).toFixed(6)) : 0,
          raw_hotel_vibe: rawHotelVibe >= 0 ? parseFloat(rawHotelVibe.toFixed(6)) : null,
          sim_max:       parseFloat(SIM_MAX.toFixed(4)),
          sim_min:       parseFloat(SIM_MIN.toFixed(4)),
        },
      };
    }

    // ── Group photos by room (mirrors V1 roomMap) ───────────────────────────
    // Load ALL photos first (no per-room limit here) so fact-matching photos
    // are never dropped before sorting. Truncation happens AFTER we sort.
    const roomMap = new Map(); // roomName → { photos[], roomTypeId }
    for (const p of allPhotos) {
      const rName = p.room_name || "Room";
      if (!roomMap.has(rName)) roomMap.set(rName, { photos: [], roomTypeId: p.room_type_id || null });
      const entry = roomMap.get(rName);
      // photo-level fact match count (mirrors V1 countPhotoFlagMatches)
      let matchCount = 0;
      for (const fk of detectedFactKeys) {
        if (photoFactSet.has(`${hotelId}::${p.photo_url}::${fk}`)) matchCount++;
      }
      entry.photos.push({
        url:        p.photo_url,
        photo_type: p.photo_type || "other",
        sim:        roomTypeSimMap.get(`${hotelId}::${rName}`) ?? 0,
        matchCount,
      });
    }

    // Sort photos within each room: fact match count DESC, bathroom bias, then sim DESC.
    // Then truncate to the display limit AFTER sorting so confirmed-fact photos are first.
    const PHOTOS_PER_ROOM = 10;
    for (const entry of roomMap.values()) {
      entry.photos.sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        if (needsBathroomBias) {
          const aBath = a.photo_type === "bathroom" ? 1 : 0;
          const bBath = b.photo_type === "bathroom" ? 1 : 0;
          if (bBath !== aBath) return bBath - aBath;
        }
        return b.sim - a.sim;
      });
      entry.photos = entry.photos.slice(0, PHOTOS_PER_ROOM);
    }

    // ── Room entries + flagMatch (mirrors V1 roomEntries) ──────────────────
    const roomRows = byHotel.get(hotelId) || [];
    const roomScoreByName = new Map();
    for (const r of roomRows) {
      const prev = roomScoreByName.get(r.room_name) ?? 0;
      if (r.rawScore > prev) roomScoreByName.set(r.room_name, r.rawScore);
    }

    const roomRowsForHotel = byHotel.get(hotelId) || [];
    const featuresByRoomName = new Map();
    for (const r of roomRowsForHotel) {
      const prev = featuresByRoomName.get(r.room_name);
      if (!prev || (r.rawScore || 0) > (prev.rawScore || 0)) {
        featuresByRoomName.set(r.room_name, r);
      }
    }

    const roomEntries = [...roomMap.entries()].map(([name, entry]) => {
      // flagMatch: confirmed fact hits from room-type facts (reliable, independent of photo order)
      const flagMatch = roomFlagMatchMap.get(`${hotelId}::${name}`) ?? 0;
      const rowFacts = featuresByRoomName.get(name)?.features || {};
      const must_haves_met = factsMeetMustRequirements(rowFacts, mustRequireSpec);

      // Per-room score: mean of top-3 intent-type photos (mirrors V1 roomScore logic)
      const intentPhotos = intentType
        ? entry.photos.filter((p) => p.photo_type === intentType)
        : [];
      const scoringPhotos = intentPhotos.length > 0 ? intentPhotos : entry.photos;
      const sims = scoringPhotos.map((p) => p.sim).sort((a, b) => b - a);
      const rawRoom = sims.length > 0
        ? sims.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, sims.length)
        : (roomScoreByName.get(name) ?? 0);

      let roomScore = remap(rawRoom);
      // Room-level photo-count penalty (< 3 photos → multiply by len/3)
      if (entry.photos.length < 3) roomScore *= entry.photos.length / 3;

      return {
        name,
        roomTypeId: entry.roomTypeId,
        photos:     entry.photos.map((p) => p.url),
        score:      Math.round(roomScore),
        flagMatch,
        must_haves_met,
        size:       "",
        beds:       "",
        amenities:  [],
      };
    });

    // ── Sort rooms: must-haves met → flagMatch → score ───────────────────────
    roomEntries.sort((a, b) => {
      if (mustRequireSpec.length && b.must_haves_met !== a.must_haves_met) {
        return (b.must_haves_met ? 1 : 0) - (a.must_haves_met ? 1 : 0);
      }
      if (hasFlags && b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
      return (b.score || 0) - (a.score || 0);
    });

    // Strip internal field before returning
    const roomTypes = roomEntries.map(({ flagMatch: _fm, ...rest }) => rest);
    const featuredRoom = roomTypes[0]
      ? {
          name:        roomTypes[0].name,
          score:       roomTypes[0].score,
          roomTypeId:  roomTypes[0].roomTypeId,
          must_haves_met: roomTypes[0].must_haves_met,
        }
      : null;

    const hotelMustHavesMet = mustRequireSpec.length
      ? (hotelMustMetFromIndex(hotelId) || roomTypes.some((rt) => rt.must_haves_met === true))
      : undefined;

    const featuredRoomFacts = roomTypes[0]
      ? (featuresByRoomName.get(roomTypes[0].name)?.features || null)
      : null;

    const catalogUrls = catalogHeroByHotel.get(hotelId) || [];

    return {
      id:          hotelId,
      name:        "", // real name from LiteAPI merged in server.js (never use raw id as title)
      address:     "",
      city,
      country:      "",
      starRating:   0,
      rating:       0,
      mainPhoto:    null,
      hotelPhotos:  catalogUrls.slice(0, 8),
      roomTypes:    roomTypes.slice(0, 8),
      featured_room: featuredRoom,
      ...(hotelMustHavesMet != null ? { hotel_must_haves_met: hotelMustHavesMet } : {}),
      isMatched:    score > 0,
      vectorScore:  score,
      hotelScore,
      property_type: propertyType,
      primary_nbhd: primaryNbhd,
      ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
      match_breakdown: matchBreakdownFor(hotelId, score, hotelScore, primaryNbhd, nbhdFitPct, featuredRoom, featuredRoomFacts),
      ...(hotelVibePct != null ? { hotelVibePct: Math.round(hotelVibePct * 10) / 10 } : {}),
      score_breakdown: {
        v2_room_match: score,
        v2_hotel_vibe: hotelScore,
        v2_hotel_vibe_pct: hotelVibePct != null ? Math.round(hotelVibePct * 10) / 10 : null,
        raw_room: rawRoom != null ? parseFloat(Number(rawRoom).toFixed(6)) : 0,
        raw_hotel_vibe: rawHotelVibe >= 0 ? parseFloat(rawHotelVibe.toFixed(6)) : null,
        sim_max:       parseFloat(SIM_MAX.toFixed(4)),
        sim_min:       parseFloat(SIM_MIN.toFixed(4)),
      },
    };
  });

  const beforeDedupe = hotels.length;
  const seenIds = new Set();
  hotels = hotels.filter((h) => {
    const id = String(h.id ?? "").trim();
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  if (hotels.length !== beforeDedupe) {
    console.warn(`[v2] deduped ${beforeDedupe - hotels.length} duplicate hotel_id row(s) in vsearch payload`);
  }

  const rankedTotal = hotels.length;
  let bookableCount = rankedTotal;
  let unbookableVibeCount = 0;
  let bookableFirst = false;
  let bookableOrderIds = null;
  let bookableOrdered = null;
  let sortSource = "server_vibe";

  // Await full-city rates before shaping payload (no 8s partial embed when enabled).
  if (ratesDateCtx && cityHotelIds.length && fullCityRatesPromise && !embeddedRatesResult) {
    if (fullRatesEmbedEnabled()) {
      const tWait = Date.now();
      embeddedRatesResult = await fullCityRatesPromise;
      _perf.rates_embed_wait_ms = Date.now() - tWait;
      ratesTailPending = false;
    } else if (ratesTailPending) {
      const waitMs = Math.max(0, Math.min(15000,
        parseInt(process.env.VSEARCH_RATES_WAIT_MS || "8000", 10)));
      const tWait = Date.now();
      const raced = await Promise.race([
        fullCityRatesPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
      ]);
      _perf.rates_embed_wait_ms = Date.now() - tWait;
      if (raced?.pricedCount > 0) {
        embeddedRatesResult = raced;
        ratesTailPending = false;
      }
    }
  }

  if (ratesDateCtx && cityHotelIds.length && embeddedRatesResult) {
    _perf.rates_embed_ms = embeddedRatesResult.wall_ms ?? _perf.rates_full_ms ?? 0;
    _perf.rates_embed_count = embeddedRatesResult.pricedCount ?? 0;
    _perf.rates_cache_hit = !!embeddedRatesResult.cache_hit;
    _perf.rates_tail_pending = ratesTailPending;
    if (embeddedRatesResult.main_chunks) _perf.rates_main_chunks = embeddedRatesResult.main_chunks;
    const scope = embeddedRatesResult.cache_hit
      ? "full-city cache"
      : ratesTailPending ? "partial wait" : "full-city";
    console.log(
      `[v2 rates] embed ${scope}: ${embeddedRatesResult.pricedCount}/${cityHotelIds.length} priced` +
      ` in ${_perf.rates_embed_ms}ms` +
      (embeddedRatesResult.cache_hit ? " (cache hit)" : "") +
      (_perf.rates_embed_wait_ms ? ` wait=${_perf.rates_embed_wait_ms}ms` : "") +
      (ratesTailPending ? " tail=pending" : "")
    );
  } else if (ratesTailPending) {
    _perf.rates_tail_pending = true;
    console.log(`[v2 rates] tail pending (${cityHotelIds.length} catalog ids, wait budget exhausted)`);
  }

  const requireFreeCancel = !!(boopProfile?.dealbreakers || []).includes("free_cancellation");
  const fullRatesReady = embeddedRatesResult && !ratesTailPending && (embeddedRatesResult.pricedCount || 0) > 0;

  if (bookableRankEnabled() && fullRatesReady) {
    for (const h of hotels) {
      if (isHotelBookable(h.id, embeddedRatesResult)) {
        attachRatesToHotel(h, embeddedRatesResult);
      }
    }
    const br = applyBookableRank(hotels, embeddedRatesResult, { requireFreeCancel });
    unbookableVibeCount = br.unbookableVibeCount;
    bookableCount = br.bookableCount;
    bookableOrdered = buildDatedDisplayOrder(br.hotels, {
      nbhd_rank_weight: nbhdRankWeight,
      nbhd_blend_applied: !!(nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0),
    }, boopProfile);
    bookableOrderIds = bookableOrdered.map((h) => h.id);
    bookableFirst = bookableCount > 0;
    sortSource = "server_bookable";
    console.log(
      `[v2 bookable] ${bookableCount} bookable / ${rankedTotal} ranked` +
      (unbookableVibeCount ? ` (${unbookableVibeCount} unbookable vibe matches omitted when avail filter on)` : "")
    );
  }

  const breakdownTopN = matchBreakdownTopN();
  let unbookableCompact = [];
  let vibeRankIds = null;
  const useBookablePayload = !!(bookablePayloadEnabled() && bookableFirst && bookableOrdered?.length);

  if (useBookablePayload) {
    vibeRankIds = hotels.map((h) => h.id);
    const bookableIdSet = new Set(bookableOrderIds.map((id) => String(id)));
    unbookableCompact = hotels
      .filter((h) => !bookableIdSet.has(String(h.id)))
      .map(unbookableStashPayload);

    let bookableHotels = bookableOrdered;

    if (breakdownTopN >= 0) {
      bookableHotels.forEach((h, idx) => {
        if (idx >= breakdownTopN && h.match_breakdown) delete h.match_breakdown;
      });
    }
    hotels = deprioritizeStubHotels(bookableHotels, 50);
    hotels = shapeVsearchHotelPayload(hotels);
    console.log(
      `[v2 payload] bookable-only: ${hotels.length} in body, ${unbookableCompact.length} stashed unbookable`
    );
  } else {
    if (breakdownTopN >= 0) {
      hotels.forEach((h, idx) => {
        if (idx >= breakdownTopN && h.match_breakdown) delete h.match_breakdown;
      });
    }
    hotels = deprioritizeStubHotels(hotels, 50);
    hotels = shapeVsearchHotelPayload(hotels);
  }

  const nbhdBlendApplied = !!(nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0);

  console.log(
    `[v2] ranked: ${hotels.length} hotels | SIM_MAX=${SIM_MAX.toFixed(4)} SIM_MIN=${SIM_MIN.toFixed(4)} ` +
    `maxRaw=${maxRawSim.toFixed(4)} hotel_vibe=${hotelVibeModel}` +
    (hotelVibeModel === "v2_facts"
      ? ` HV_MAX=${HOTEL_SIM_MAX.toFixed(4)} HV_BLEND=${HOTEL_VIBE_BLEND_WEIGHT.toFixed(2)} (${hotelVibeRawMap.size} hotels scored)`
      : "")
  );
  _perf.total_since_phase_a_ms = Date.now() - _t0;
  _perf.wall_ms = Date.now() - _t0Total;

  console.log(
    `[v2 perf] TOTAL: ${_perf.total_since_phase_a_ms}ms (since phase-A) | wall: ${_perf.wall_ms}ms (since handler entry)`
  );

  const ratesAsOf = embeddedRatesResult && fullRatesReady
    ? new Date().toISOString()
    : undefined;

  return {
    status: 200,
    body: {
      hotels,
      query,
      city,
      indexing:    false,
      indexStatus: "complete",
      ...(unbookableCompact.length ? { unbookable_compact: unbookableCompact } : {}),
      ...(vibeRankIds?.length ? { vibe_rank_ids: vibeRankIds } : {}),
      ...(embeddedRatesResult && ratesDateCtx
        ? {
            rates: useBookablePayload
              ? {
                  embedded: true,
                  full_city: !ratesTailPending,
                  partial: !!ratesTailPending,
                  tail_pending: !!ratesTailPending,
                  cache_hit: !!embeddedRatesResult.cache_hit,
                  hotels_only: true,
                  pricedCount: embeddedRatesResult.pricedCount || 0,
                  currency: embeddedRatesResult.currency,
                  nights: embeddedRatesResult.nights,
                  hotel_ids_fetched: embeddedRatesResult.hotel_ids_fetched,
                }
              : {
                  prices: embeddedRatesResult.prices || {},
                  roomPrices: embeddedRatesResult.roomPrices || {},
                  roomNames: embeddedRatesResult.roomNames || {},
                  offerIds: embeddedRatesResult.offerIds || {},
                  roomFreeCancel: embeddedRatesResult.roomFreeCancel || {},
                  hotelFreeCancel: embeddedRatesResult.hotelFreeCancel || {},
                  currency: embeddedRatesResult.currency,
                  nights: embeddedRatesResult.nights,
                  pricedCount: embeddedRatesResult.pricedCount || 0,
                  hotel_ids_fetched: embeddedRatesResult.hotel_ids_fetched,
                  embedded: true,
                  full_city: !ratesTailPending,
                  partial: !!ratesTailPending,
                  tail_pending: !!ratesTailPending,
                  cache_hit: !!embeddedRatesResult.cache_hit,
                },
          }
        : {}),
      stats: {
        perf_ms: _perf,
        search_version_used:      "v2",
        search_version_requested: String(req.query.search_version || "v2"),
        query_router:             intent,
        nlp_router:               intent.router_version || "v2-regex",
        ranked_hotels:            hotels.length,
        ranked_total:             rankedTotal,
        bookable_count:           bookableCount,
        unbookable_vibe_count:    unbookableVibeCount,
        bookable_first:           bookableFirst,
        sort_source:              sortSource,
        ...(bookableOrderIds?.length ? { bookable_order_ids: bookableOrderIds } : {}),
        ...(ratesAsOf ? { rates_as_of: ratesAsOf } : {}),
        ...(bookableOrderIds?.[0]
          ? { hero_hotel_id: bookableOrderIds[0] }
          : hotels[0]?.id
            ? { hero_hotel_id: hotels[0].id }
            : {}),
        detected_fact_keys:       detectedFactKeys,
        intent_type:              intentType,
        sim_max:                  parseFloat(SIM_MAX.toFixed(4)),
        sim_min:                  parseFloat(SIM_MIN.toFixed(4)),
        max_raw_fact_score:       parseFloat(maxRawSim.toFixed(4)),
        hotel_vibe_model:         hotelVibeModel,
        hotel_vibe_sim_max:       hotelVibeModel === "v2_facts" ? parseFloat(HOTEL_SIM_MAX.toFixed(4)) : null,
        hotel_vibe_sim_min:       hotelVibeModel === "v2_facts" ? parseFloat(HOTEL_SIM_MIN.toFixed(4)) : null,
        hotel_vibe_blend_weight:  hotelVibeModel === "v2_facts" ? HOTEL_VIBE_BLEND_WEIGHT : null,
        hotel_vibe_fact_weights:  hotelVibeModel === "v2_facts" ? factWeightsRaw : null,
        nbhd_rank_weight_config:  Number.isFinite(rawNbhdW) ? rawNbhdW : undefined,
        nbhd_rank_weight_active:  nbhdRankWeight,
        nbhd_blend_applied:       nbhdBlendApplied,
        slim_stubs:               slimStubsEnabled(),
        compact_tail:             compactTailEnabled(),
        bookable_payload:         useBookablePayload,
        full_payload_limit:       compactTailEnabled() ? fullPayloadLimit() : null,
        nbhd_cache_hit:           nbhdCacheHit,
        price_matters:            priceMatters,
        luxury_pref:              luxuryPref,
        price_matters_star_penalty_applied: false,
        stay_vibe: stayVibe || null,
        stay_vibe_fact_key: stayVibeFact || null,
        ...(typeof _perf.rates_embed_ms === "number"
          ? { rates_embed_ms: _perf.rates_embed_ms, rates_embed_count: _perf.rates_embed_count ?? 0 }
          : {}),
        ...(nbhdBlendApplied ? { nbhd_rank_weight: nbhdRankWeight } : {}),
        client_resort_note: bookableFirst
          ? "Dated search: API order is final bookable Best Match; client must not re-sort on first paint."
          : "API hotel order uses server primarySignal; the UI re-sorts with Best Match (room vibe % + nbhd blend + Boop price guards).",
        ...(String(req.query.compare || "") === "1"
          ? { compare: { enabled: true, v2_top_ids: hotels.slice(0, 20).map((h) => h.id) } }
          : {}),
      },
    },
  };
}

/** Warm phase-A DB cache + nbhd primary map during Boop wizard. */
async function warmV2City(supabase, city) {
  const fetchClient = supabase;
  if (!fetchClient || !city) return { ok: false, reason: "missing_city" };

  if (!getPhaseACache(city)) {
    const [cacheResult, indexResult] = await Promise.all([
      fetchClient.from("v2_hotels_cache").select("hotel_id, property_type").eq("city", city),
      fetchClient
        .from("v2_room_types_index")
        .select("hotel_id,room_name,facts,photo_count,photo_type_counts")
        .eq("city", city)
        .limit(100000),
    ]);
    if (!cacheResult.error && cacheResult.data?.length) {
      setPhaseACache(city, cacheResult.data, indexResult.data || []);
    }
  }

  const { readPrimaryByCity } = require("../lib/nbhd-boop-cache");
  await readPrimaryByCity(fetchClient, city);

  await fetchClient.from("neighborhoods").select("id").eq("city", city).limit(1);

  return {
    ok: true,
    phase_a_cached: !!getPhaseACache(city),
    hotels: getPhaseACache(city)?.hotelRows?.length || 0,
  };
}

module.exports = { runV2Search, invalidatePhaseACache, warmV2City };
