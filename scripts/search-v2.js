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

const { buildFactIntent, buildFactIntentLLM, scoreFactSet } = require("./fact-catalog");
const { normalizePolygonRing, pointInPolygon, bboxFromRing } = require("./neighborhood-vibe-data");

// ── Phase-A in-memory cache (per city, 5-minute TTL) ─────────────────────────
// Avoids re-fetching 3,500+ hotel cache rows + 9,600+ index rows on every search.
const _phaseACache = new Map(); // city → { ts, hotelRows, indexRows }
const PHASE_A_TTL_MS = 5 * 60 * 1000;

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

function parseMustHaves(raw) {
  if (!raw) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat_min, lat_max, lon_min, lon_max] = parts;
  return { lat_min, lat_max, lon_min, lon_max };
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

  const city      = await resolveCityName(cityInput, fetchClient, ["indexed_cities", "hotels_cache"]);
  const mustHaves = parseMustHaves(req.query.must_haves || "");
  // Use LLM-based NLP router (Gemini) to map query → weighted facts; falls back to regex
  const intent    = await buildFactIntentLLM(query, { mustHaves }, process.env.GEMINI_KEY || "");
  const hotelQuery = String(req.query.hotel_query || query).trim();
  const tokens    = tokenize(query);

  // ── Group size — room-level capacity penalty ───────────────────────────────
  // Read from boop_profile.answers.group_size; default "couple".
  let groupSize = "couple";
  try {
    const bp = req.query.boop_profile ? JSON.parse(req.query.boop_profile) : null;
    const gs = bp?.answers?.group_size;
    if (gs === "solo" || gs === "couple" || gs === "group") groupSize = gs;
  } catch (_) {}

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
  const rawNbhdW = parseFloat(process.env.VSEARCH_NBHD_RANK_WEIGHT || "0");
  const nbhdRankWeight = Number.isFinite(rawNbhdW) && rawNbhdW > 0 ? rawNbhdW : 0;

  // Detected fact keys (hard + soft from intent) — mirrors detectedFlagKeys in V1
  const detectedFactKeys = [
    ...(intent.hard_filters    || []).map((x) => x.fact_key),
    ...(intent.soft_preferences || []).map((x) => x.fact_key),
  ].filter(Boolean);
  const hasFlags = detectedFactKeys.length > 0;

  // intentType: "bathroom" when bathroom facts are in query (mirrors V1 extractIntentType)
  const intentType = detectedFactKeys.some((k) => BATHROOM_FACT_KEYS.has(k))
    ? "bathroom"
    : null;

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
    console.log(`[v2 perf] phase-A db: 0ms (cache hit)  hotels=${hotelRows.length} index_rows=${indexRows.length}`);
  } else {
    const [cacheResult, indexResult] = await Promise.all([
      fetchClient
        .from("v2_hotels_cache")
        .select("hotel_id, property_type")
        .eq("city", city),
      fetchClient
        .from("v2_room_types_index")
        .select("hotel_id,room_name,facts,photo_count")
        .eq("city", city)
        .limit(100000),
    ]);
    if (cacheResult.error) return { status: 500, body: { error: cacheResult.error.message } };
    if (indexResult.error)  return { status: 500, body: { error: indexResult.error.message } };
    hotelRows = cacheResult.data || [];
    indexRows = indexResult.data || [];
    setPhaseACache(city, hotelRows, indexRows);
    console.log(`[v2 perf] phase-A db: ${Date.now()-_t0}ms  hotels=${hotelRows.length} index_rows=${indexRows.length}`);
  }

  const hotelMeta = new Map((hotelRows).map((r) => [r.hotel_id, { property_type: r.property_type || "hotel" }]));
  const cityHotelIds   = [...hotelMeta.keys()];
  const eligibleHotelIds = hotelIdsByGeo
    ? cityHotelIds.filter((id) => hotelIdsByGeo.includes(id))
    : cityHotelIds;

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
  // roomTypeMap: hotel_id → [{ room_name, facts{} }]  (aggregated from index rows)
  const roomTypeMap = new Map(); // hotel_id → [{room_name, facts}]

  for (const row of indexRows) {
    if (!eligibleSet.has(row.hotel_id)) continue;
    const facts = row.facts || {};

    if (!roomTypeMap.has(row.hotel_id)) roomTypeMap.set(row.hotel_id, []);
    roomTypeMap.get(row.hotel_id).push({ room_name: row.room_name || "Room", facts });

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
        room_name:    rt.room_name,
        room_type_id: null, // not stored in index; resolved via photos in Phase B
        rawScore,
        factResult,
        features: rt.facts,
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

  console.log(`[v2 perf] scoring: ${Date.now()-_t0}ms  ranked=${rankedHotels.length}`);

  const topHotelIds = rankedHotels.slice(0, GALLERY_LIMIT).map((h) => h.hotel_id);

  // ── Neighbourhood BOOP blend (same as V1) ─────────────────────────────────
  let nbhdFitByHotelId = null;
  let nbhdPrimaryByHotel = new Map(); // hotel_id → neighborhood_id (ALL hotels)
  let nbhdHoodRows = [];              // neighborhood rows with id, name, vibe_short, attributes
  const boopParam = req.query.boop_profile;
  if (nbhdRankWeight > 0 && boopParam && rankedHotels.length) {
    try {
      const boopProfileForNbhd = JSON.parse(boopParam);
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
      if (nbhdFitByHotelId?.size) {
        console.log(`[v2] nbhd_boop_rank: weight=${nbhdRankWeight} nbhd_scores=${nbhdFitByHotelId.size} primary_assignments=${nbhdPrimaryByHotel.size}`);
      }
    } catch (_) {}
  }

  console.log(`[v2 perf] post-boop: ${Date.now()-_t0}ms`);

  // ── Phase B: photos + hotel-embed + score_hotels + primary-nbhd (all parallel) ──
  const hotelEmbedPromise = embedText(hotelQuery, process.env.GEMINI_KEY || "");

  // score_hotels needs the embedding — chain it off the embed promise so it
  // runs as soon as the embedding is ready without blocking the photo fetch.
  const hotelVibePromise = hotelEmbedPromise.then(embedding => {
    if (!embedding || !topHotelIds.length) return null;
    return fetchClient.rpc("score_hotels", {
      query_embedding: embedding,
      search_city:     city,
      hotel_ids:       topHotelIds,
    });
  });

  const needPrimaryNbhdRpc = nbhdPrimaryByHotel.size === 0;
  const phaseB = await Promise.all([
    fetchClient.rpc("get_v2_room_photos", { p_hotel_ids: topHotelIds, p_city: city, p_max_per_hotel: 10 }),
    hotelEmbedPromise,
    hotelVibePromise,
    ...(needPrimaryNbhdRpc
      ? [fetchClient.rpc("get_primary_nbhds_for_hotels", { p_hotel_ids: topHotelIds })]
      : []),
  ]);
  const [photosResult, hotelEmbedding, hotelVibeResult] = phaseB;
  const primaryNbhdRpcResult = needPrimaryNbhdRpc ? phaseB[3] : null;

  console.log(`[v2 perf] phase-B parallel (photos+embed+nbhd): ${Date.now()-_t0}ms  photos=${photosResult.data?.length}`);
  if (photosResult.error) return { status: 500, body: { error: photosResult.error.message } };

  // hotel-vibe score from parallel result
  const hotelVibeSimMap = new Map();
  let hotelSimMaxRaw = 0;
  let hotelVibeModel = "fallback_rating";
  if (hotelVibeResult && !hotelVibeResult.error && hotelVibeResult.data?.length) {
    hotelVibeModel = "score_hotels";
    for (const r of hotelVibeResult.data) {
      hotelVibeSimMap.set(r.hotel_id, r.similarity);
      if (r.similarity > hotelSimMaxRaw) hotelSimMaxRaw = r.similarity;
    }
  }
  const HOTEL_SIM_MAX  = hotelSimMaxRaw > 0 ? hotelSimMaxRaw : 0.9;
  const HOTEL_SIM_MIN  = Math.max(HOTEL_SIM_MAX - 0.30, 0);
  const hotelSimSpan   = Math.max(HOTEL_SIM_MAX - HOTEL_SIM_MIN, 1e-9);

  // Primary neighbourhood map — covers ALL hotels when BOOP was active.
  const primaryNbhdMap = new Map();
  if (nbhdPrimaryByHotel.size > 0 && nbhdHoodRows.length > 0) {
    // Use already-fetched data from applyNbhdBoopRank (covers all ranked hotels).
    const hoodById = new Map(nbhdHoodRows.map((h) => [h.id, h]));
    for (const [hotelId, nbhdId] of nbhdPrimaryByHotel) {
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
  } else if (primaryNbhdRpcResult && !primaryNbhdRpcResult.error) {
    // Fallback: no BOOP — use the Phase B RPC result (top 250 hotels only).
    for (const r of (primaryNbhdRpcResult.data || [])) {
      primaryNbhdMap.set(r.hotel_id, {
        id:         r.neighborhood_id,
        name:       r.name,
        vibe_short: r.vibe_short,
        attributes: r.attributes || null,
      });
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

  // Group photos by hotel, then by room
  const photosByHotel = new Map(); // hotel_id → [photo rows]
  for (const p of (photosResult.data || [])) {
    if (!photosByHotel.has(p.hotel_id)) photosByHotel.set(p.hotel_id, []);
    photosByHotel.get(p.hotel_id).push(p);
  }

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

  // Build hotel scores using photo-count penalty (mirrors V1 photoHotelScores logic)
  const hotelDisplayScores = new Map(); // hotel_id → { topScore, rankScore }

  for (const h of rankedHotels.slice(0, GALLERY_LIMIT)) {
    const allPhotos   = photosByHotel.get(h.hotel_id) || [];
    const totalPhotos = allPhotos.length;

    // Collect per-photo scores for mean-of-top-3 (mirrors V1 hotelScoreMap approach)
    // Each photo inherits the similarity of its room type.
    const allPhotoScores    = [];
    const intentPhotoScores = [];
    for (const p of allPhotos) {
      const sim = roomTypeSimMap.get(`${h.hotel_id}::${p.room_name}`) ?? h.rawSim;
      allPhotoScores.push(sim);
      if (!intentType || p.photo_type === intentType) intentPhotoScores.push(sim);
    }
    const scoringScores = intentPhotoScores.length > 0 ? intentPhotoScores : allPhotoScores;
    scoringScores.sort((a, b) => b - a);
    const rawScore = scoringScores.length > 0
      ? scoringScores.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, scoringScores.length)
      : h.rawSim;

    // Use boosted hotel sim as rankScore when flags are active (mirrors V1)
    const rankScore = hasFlags ? h.sBoosted : rawScore;
    let topScore = remap(rankScore);

    // Photo-count penalty: < 3 total photos → multiply by len/3 (exact V1)
    if (totalPhotos < 3) {
      topScore *= totalPhotos / 3;
      console.log(`[v2] photo-count penalty: ${h.hotel_id} only ${totalPhotos} photos → ${topScore.toFixed(1)}`);
    }

    hotelDisplayScores.set(h.hotel_id, { topScore, rankScore });
  }

  // For hotels outside GALLERY_LIMIT: no photo data, use room-type score directly
  for (const h of rankedHotels.slice(GALLERY_LIMIT)) {
    const rankScore = hasFlags ? h.sBoosted : h.rawSim;
    hotelDisplayScores.set(h.hotel_id, { topScore: remap(rankScore), rankScore });
  }

  // ── Final hotel sort (mirrors V1 allHotels.sort) ──────────────────────────
  const allHotels = rankedHotels.map((h) => {
    const { topScore } = hotelDisplayScores.get(h.hotel_id) || { topScore: 0 };
    return { hotel_id: h.hotel_id, topScore, sBoosted: h.sBoosted, rawSim: h.rawSim };
  });
  allHotels.sort((a, b) => b.topScore - a.topScore);

  if (nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0) {
    const w = nbhdRankWeight;
    allHotels.sort((a, b) => {
      const nbA = nbhdFitByHotelId.get(a.hotel_id) ?? 62;
      const nbB = nbhdFitByHotelId.get(b.hotel_id) ?? 62;
      const ca  = (1 - w) * (a.topScore / 100) + w * (nbA / 100);
      const cb  = (1 - w) * (b.topScore / 100) + w * (nbB / 100);
      if (Math.abs(cb - ca) > 1e-6) return cb - ca;
      return b.topScore - a.topScore;
    });
  }

  // ── Build response payload ─────────────────────────────────────────────────
  const hotels = allHotels.map(({ hotel_id: hotelId, topScore }) => {
    const meta       = hotelMeta.get(hotelId) || {};
    const score      = Math.round(topScore);
    const allPhotos  = photosByHotel.get(hotelId) || [];
    const hasPhotos  = allPhotos.length > 0;

    // hotelScore: same adaptive HOTEL_SIM_MIN/MAX/SPAN as V1
    const rawHotelSim = hotelVibeSimMap.get(hotelId);
    const hotelScore  = rawHotelSim != null
      ? Math.round(Math.max(0, Math.min(100, ((rawHotelSim - HOTEL_SIM_MIN) / hotelSimSpan) * 100)))
      : null;

    const primaryNbhd = primaryNbhdMap.get(hotelId) || null;
    const nbhdFitPct  = nbhdFitByHotelId?.get(hotelId);
    const propertyType = meta.property_type || "hotel";

    if (!hasPhotos) {
      return {
        id:           hotelId,
        name:         hotelId,      // live metadata injected by server.js fetchHotelMetaBatch
        address:      "",
        city,
        country:      "",
        starRating:   0,
        rating:       0,
        mainPhoto:    null,
        hotelPhotos:  [],
        roomTypes:    [],
        isMatched:    score > 0,
        vectorScore:  score,
        hotelScore,
        property_type: propertyType,
        primary_nbhd: primaryNbhd,
        ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
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

    const roomEntries = [...roomMap.entries()].map(([name, entry]) => {
      // flagMatch: confirmed fact hits from room-type facts (reliable, independent of photo order)
      const flagMatch = roomFlagMatchMap.get(`${hotelId}::${name}`) ?? 0;

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
        size:       "",
        beds:       "",
        amenities:  [],
      };
    });

    // ── Sort rooms: flagMatch DESC then score DESC (exact V1) ───────────────
    roomEntries.sort((a, b) => {
      if (hasFlags && b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
      return (b.score || 0) - (a.score || 0);
    });

    // Strip internal field before returning
    const roomTypes = roomEntries.map(({ flagMatch: _fm, ...rest }) => rest);

    return {
      id:          hotelId,
      name:        hotelId,        // live metadata injected by server.js fetchHotelMetaBatch
      address:     "",
      city,
      country:      "",
      starRating:   0,
      rating:       0,
      mainPhoto:    null,
      hotelPhotos:  [],
      roomTypes:    roomTypes.slice(0, 8),
      isMatched:    score > 0,
      vectorScore:  score,
      hotelScore,
      property_type: propertyType,
      primary_nbhd: primaryNbhd,
      ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
      score_breakdown: {
        v2_room_match: score,
        v2_hotel_vibe: hotelScore,
        sim_max:       parseFloat(SIM_MAX.toFixed(4)),
        sim_min:       parseFloat(SIM_MIN.toFixed(4)),
      },
    };
  });

  const nbhdBlendApplied = !!(nbhdFitByHotelId?.size > 0 && nbhdRankWeight > 0);

  console.log(
    `[v2] ranked: ${hotels.length} hotels | SIM_MAX=${SIM_MAX.toFixed(4)} SIM_MIN=${SIM_MIN.toFixed(4)} ` +
    `maxRaw=${maxRawSim.toFixed(4)} hotel_vibe=${hotelVibeModel}`
  );
  console.log(`[v2 perf] TOTAL: ${Date.now()-_t0}ms`);

  return {
    status: 200,
    body: {
      hotels,
      query,
      city,
      indexing:    false,
      indexStatus: "complete",
      stats: {
        search_version_used:      "v2",
        search_version_requested: String(req.query.search_version || "v2"),
        query_router:             intent,
        nlp_router:               intent.router_version || "v2-regex",
        ranked_hotels:            hotels.length,
        detected_fact_keys:       detectedFactKeys,
        intent_type:              intentType,
        sim_max:                  parseFloat(SIM_MAX.toFixed(4)),
        sim_min:                  parseFloat(SIM_MIN.toFixed(4)),
        max_raw_fact_score:       parseFloat(maxRawSim.toFixed(4)),
        hotel_vibe_model:         hotelVibeModel,
        nbhd_rank_weight_config:  Number.isFinite(rawNbhdW) ? rawNbhdW : undefined,
        nbhd_rank_weight_active:  nbhdRankWeight,
        nbhd_blend_applied:       nbhdBlendApplied,
        ...(nbhdBlendApplied ? { nbhd_rank_weight: nbhdRankWeight } : {}),
        ...(String(req.query.compare || "") === "1"
          ? { compare: { enabled: true, v2_top_ids: hotels.slice(0, 20).map((h) => h.id) } }
          : {}),
      },
    },
  };
}

module.exports = { runV2Search, invalidatePhaseACache };
