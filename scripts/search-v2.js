const { buildFactIntent, scoreFactSet } = require("./fact-catalog");

function parseMustHaves(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat_min, lat_max, lon_min, lon_max] = parts;
  return { lat_min, lat_max, lon_min, lon_max };
}

function normalizeText(s) {
  return String(s || "").toLowerCase();
}

function tokenize(query) {
  return normalizeText(query)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

async function embedText(text, geminiKey) {
  if (!text || !geminiKey) return null;
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
}

function textScore(tokens, roomName, hotelName) {
  if (!tokens.length) return 0.5;
  const text = `${roomName || ""} ${hotelName || ""}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (text.includes(t)) hits++;
  return hits / tokens.length;
}

async function runV2Search({
  req,
  supabase,
  supabaseAdmin,
  resolveCityName,
}) {
  const query = String(req.query.query || "").trim();
  const cityInput = String(req.query.city || "").trim();
  if (!query || !cityInput) return { status: 400, body: { error: "query and city required" } };
  const fetchClient = supabaseAdmin || supabase;
  if (!fetchClient) return { status: 500, body: { error: "Supabase not configured" } };

  const city = await resolveCityName(cityInput, fetchClient, ["indexed_cities", "hotels_cache"]);
  const mustHaves = parseMustHaves(req.query.must_haves || "");
  const intent = buildFactIntent(query, { mustHaves });
  const hotelQuery = String(req.query.hotel_query || query).trim();
  const tokens = tokenize(query);

  let hotelIdsByGeo = null;
  const bbox = parseBbox(req.query.bbox || "");
  if (bbox) {
    const { data: bboxHotels } = await fetchClient
      .from("hotels_cache")
      .select("hotel_id")
      .eq("city", city)
      .gte("lat", bbox.lat_min)
      .lte("lat", bbox.lat_max)
      .gte("lng", bbox.lon_min)
      .lte("lng", bbox.lon_max);
    hotelIdsByGeo = (bboxHotels || []).map((h) => h.hotel_id);
  }

  const { data: cacheRows, error: cacheErr } = await fetchClient
    .from("v2_hotels_cache")
    .select("hotel_id,name,address,star_rating,guest_rating,main_photo,hotel_photos")
    .eq("city", city);
  if (cacheErr) return { status: 500, body: { error: cacheErr.message } };
  const hotelMeta = new Map((cacheRows || []).map((r) => [r.hotel_id, r]));
  const cityHotelIds = [...hotelMeta.keys()];
  const eligibleHotelIds = hotelIdsByGeo ? cityHotelIds.filter((id) => hotelIdsByGeo.includes(id)) : cityHotelIds;
  if (!eligibleHotelIds.length) {
    return {
      status: 200,
      body: {
        hotels: [],
        query,
        city,
        indexing: false,
        indexStatus: "complete",
        stats: {
          search_version_used: "v2",
          search_version_requested: String(req.query.search_version || "v2"),
          query_router: intent,
          ranked_hotels: 0,
        },
      },
    };
  }

  const { data: roomFacts, error: roomErr } = await fetchClient
    .from("v2_room_feature_facts")
    .select("hotel_id,room_type_id,room_name,fact_key,fact_value,confidence")
    .eq("city", city)
    .in("hotel_id", eligibleHotelIds.slice(0, 5000));
  if (roomErr) return { status: 500, body: { error: roomErr.message } };

  const roomFeatureMap = new Map(); // hotel::roomTypeId::roomName -> { facts:{} }
  for (const rf of (roomFacts || [])) {
    const key = `${rf.hotel_id}::${rf.room_type_id || ""}::${rf.room_name || "Room"}`;
    if (!roomFeatureMap.has(key)) {
      roomFeatureMap.set(key, {
        hotel_id: rf.hotel_id,
        room_type_id: rf.room_type_id || null,
        room_name: rf.room_name || "Room",
        facts: {},
      });
    }
    if (rf.fact_value === 1) roomFeatureMap.get(key).facts[rf.fact_key] = true;
  }

  const byHotel = new Map();
  for (const rt of roomFeatureMap.values()) {
    const features = rt.facts || {};
    const fact = scoreFactSet(features, intent);
    const text = textScore(tokens, rt.room_name, hotelMeta.get(rt.hotel_id)?.name);
    const total = Math.max(0, Math.min(1, 0.8 * fact.total_score + 0.2 * text));
    const score = Math.round(total * 100);
    const row = {
      room_name: rt.room_name || "Room",
      room_type_id: rt.room_type_id || null,
      room_score: score,
      fact,
      features,
    };
    if (!byHotel.has(rt.hotel_id)) byHotel.set(rt.hotel_id, []);
    byHotel.get(rt.hotel_id).push(row);
  }

  const ranked = [];
  for (const [hotelId, rows] of byHotel.entries()) {
    rows.sort((a, b) => b.room_score - a.room_score);
    const best = rows[0]?.room_score || 0;
    const meta = hotelMeta.get(hotelId) || {};
    ranked.push({ hotel_id: hotelId, room_rows: rows, vectorScore: best, hotelScore: null });
  }
  ranked.sort((a, b) => b.vectorScore - a.vectorScore);
  const topHotelIds = ranked.slice(0, 250).map((r) => r.hotel_id);

  // Plug in hotel-vibe model for V2 hotelScore.
  let hotelScoreMap = new Map();
  try {
    const hotelEmbedding = await embedText(hotelQuery, process.env.GEMINI_KEY || "");
    if (hotelEmbedding && topHotelIds.length) {
      const hs = await fetchClient.rpc("score_hotels", {
        query_embedding: hotelEmbedding,
        search_city: city,
        hotel_ids: topHotelIds,
      });
      if (!hs.error) {
        let maxRaw = 0;
        for (const r of (hs.data || [])) {
          if (r.similarity > maxRaw) maxRaw = r.similarity;
        }
        const maxS = maxRaw > 0 ? maxRaw : 0.9;
        const minS = Math.max(maxS - 0.3, 0);
        const span = Math.max(maxS - minS, 1e-9);
        for (const r of (hs.data || [])) {
          const pct = Math.round(Math.max(0, Math.min(100, ((r.similarity - minS) / span) * 100)));
          hotelScoreMap.set(r.hotel_id, pct);
        }
      }
    }
  } catch (_) {}

  const { data: photosData, error: photosErr } = await fetchClient
    .from("v2_room_inventory")
    .select("hotel_id,room_name,room_type_id,photo_url,photo_type")
    .in("hotel_id", topHotelIds)
    .eq("city", city);
  if (photosErr) return { status: 500, body: { error: photosErr.message } };
  const primaryNbhdResult = await fetchClient.rpc("get_primary_nbhds_for_hotels", { p_hotel_ids: topHotelIds });
  const primaryNbhdMap = new Map();
  if (!primaryNbhdResult.error) {
    for (const r of (primaryNbhdResult.data || [])) {
      primaryNbhdMap.set(r.hotel_id, {
        id: r.neighborhood_id,
        name: r.name,
        vibe_short: r.vibe_short,
        attributes: r.attributes || null,
      });
    }
  }
  const photosByHotel = new Map();
  for (const p of (photosData || [])) {
    if (!photosByHotel.has(p.hotel_id)) photosByHotel.set(p.hotel_id, []);
    photosByHotel.get(p.hotel_id).push(p);
  }

  // Preserve BOOP neighborhood blend behavior from V1.
  let nbhdFitByHotelId = null;
  const rawNbhdW = parseFloat(process.env.VSEARCH_NBHD_RANK_WEIGHT || "0");
  const nbhdRankWeight = Number.isFinite(rawNbhdW) && rawNbhdW > 0 ? rawNbhdW : 0;
  const boopParam = req.query.boop_profile;
  if (nbhdRankWeight > 0 && boopParam && topHotelIds.length) {
    try {
      const boopProfileForNbhd = JSON.parse(boopParam);
      const rankedHotelsLite = ranked.slice(0, 250).map((r) => ({ hotel_id: r.hotel_id, similarity: r.vectorScore / 100 }));
      const { applyNbhdBoopRank } = require("../lib/nbhd-vibe-rank");
      nbhdFitByHotelId = await applyNbhdBoopRank(fetchClient, city, rankedHotelsLite, boopProfileForNbhd, {
        weight: nbhdRankWeight,
        neutralPct: parseFloat(process.env.VSEARCH_NBHD_NEUTRAL_PCT || "62"),
        maxHotels: parseInt(process.env.VSEARCH_NBHD_RANK_MAX_HOTELS || "5000", 10),
      });
    } catch (_) {}
  }

  const hotels = ranked.slice(0, 250).map((h) => {
    const meta = hotelMeta.get(h.hotel_id) || {};
    const allPhotos = photosByHotel.get(h.hotel_id) || [];
    const roomMap = new Map();
    for (const p of allPhotos) {
      const room = p.room_name || "Room";
      if (!roomMap.has(room)) roomMap.set(room, { photos: [], roomTypeId: p.room_type_id || null });
      const e = roomMap.get(room);
      if (e.photos.length < 10) e.photos.push(p.photo_url);
    }
    const roomTypes = h.room_rows.slice(0, 8).map((r) => {
      const e = roomMap.get(r.room_name) || { photos: [], roomTypeId: null };
      return {
        name: r.room_name,
        roomTypeId: r.room_type_id || e.roomTypeId,
        photos: e.photos,
        score: r.room_score,
        size: "",
        beds: "",
        amenities: [],
      };
    });
    const fallbackHotelScore = Math.max(0, Math.min(100, Math.round((Number(meta.guest_rating) || 0) * 10)));
    return {
      id: h.hotel_id,
      name: meta.name || h.hotel_id,
      address: meta.address || "",
      city,
      country: "",
      starRating: meta.star_rating || 0,
      rating: meta.guest_rating || 0,
      mainPhoto: meta.main_photo || null,
      hotelPhotos: meta.hotel_photos || [],
      roomTypes,
      isMatched: h.vectorScore > 0,
      vectorScore: h.vectorScore,
      hotelScore: hotelScoreMap.get(h.hotel_id) ?? fallbackHotelScore,
      primary_nbhd: primaryNbhdMap.get(h.hotel_id) || null,
      ...(nbhdFitByHotelId?.has(h.hotel_id) ? { nbhd_fit_pct: nbhdFitByHotelId.get(h.hotel_id) } : {}),
      score_breakdown: {
        v2_room_match: h.vectorScore,
        v2_hotel_vibe: hotelScoreMap.get(h.hotel_id) ?? fallbackHotelScore,
      },
    };
  });

  const out = {
    hotels,
    query,
    city,
    indexing: false,
    indexStatus: "complete",
    stats: {
      search_version_used: "v2",
      search_version_requested: String(req.query.search_version || "v2"),
      query_router: intent,
      ranked_hotels: hotels.length,
      hotel_vibe_model: hotelScoreMap.size > 0 ? "score_hotels" : "fallback_rating",
    },
  };

  if (String(req.query.compare || "") === "1") {
    out.stats.compare = {
      enabled: true,
      v2_top_ids: hotels.slice(0, 20).map((h) => h.id),
    };
  }
  return { status: 200, body: out };
}

module.exports = { runV2Search };
