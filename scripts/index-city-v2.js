#!/usr/bin/env node
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { parseStructuredCaption } = require("./fact-catalog");

const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const BATCH_SIZE = 25;
const PHOTO_CONCURRENCY = 3;
const CAPTION_RATE_PER_MIN = 500;
let _capWindow = Date.now();
let _capCount = 0;

const COUNTRY_CODES = {
  "mexico city": "MX",
  "paris": "FR",
  "kuala lumpur": "MY",
  "london": "GB",
  "new york city": "US",
};

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase env");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function liteGet(path) {
  const url = `https://api.liteapi.travel/v3.0${path}`;
  const r = await fetch(url, { headers: { "X-API-Key": LITEAPI_KEY, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}

function classifyPhoto(photo, roomName = "") {
  const desc = [
    photo.imageDescription || "", photo.caption || "", photo.tag || "", photo.category || "", roomName || "",
  ].join(" ").toLowerCase();
  if (/bath|shower|sink|toilet|vanity|wc|jacuzzi|tub/.test(desc)) return "bathroom";
  if (/bed|sleep|pillow|duvet|headboard|bedroom/.test(desc)) return "bedroom";
  if (/living|lounge|sofa|sitting|couch/.test(desc)) return "living area";
  if (/view|balcony|terrace|panoram/.test(desc)) return "view";
  return "other";
}

async function geminiCaption(imageUrl, photoContext = {}, retries = 5) {
  if (!GEMINI_KEY) return null;
  try {
    const now = Date.now();
    if (now - _capWindow > 60000) { _capWindow = now; _capCount = 0; }
    if (_capCount >= CAPTION_RATE_PER_MIN) {
      const wait = 61000 - (now - _capWindow);
      await new Promise((resolve) => setTimeout(resolve, Math.max(500, wait)));
      _capWindow = Date.now();
      _capCount = 0;
    }
    _capCount++;

    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!imgRes.ok) return null;
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const isLikelyBath = /bath/i.test(photoContext.roomName || "") || photoContext.type === "bathroom";
    const prompt = [
      "Analyze this hotel room photo. For each field answer ONLY: yes | no | unknown",
      "Use EXACTLY these field names and format (one per line, no extra text):",
      "PHOTO_TYPE: bedroom|bathroom|living|view|other",
      // Bathroom (answer unknown if not a bathroom)
      "DOUBLE_SINKS: yes|no|unknown",
      "SOAKING_TUB: yes|no|unknown",
      "BATHTUB: yes|no|unknown",
      "RAINFALL_SHOWER: yes|no|unknown",
      "WALK_IN_SHOWER: yes|no|unknown",
      "HANDHELD_SHOWER_WAND: yes|no|unknown",
      "GLASS_BATHROOM_WALL: yes|no|unknown",
      "STONE_BATHROOM_SURFACES: yes|no|unknown",
      "NATURAL_LIGHT_BATHROOM: yes|no|unknown",
      "HEATED_TOWEL_RAIL: yes|no|unknown",
      "BIDET: yes|no|unknown",
      "SEPARATE_TOILET_DOOR: yes|no|unknown",
      "ANTI_FOG_MIRROR: yes|no|unknown",
      "MAKEUP_VANITY: yes|no|unknown",
      "TUB_AND_SHOWER_SEPARATE: yes|no|unknown",
      "COUNTER_SPACE_GENEROUS: yes|no|unknown",
      "ROLL_IN_SHOWER: yes|no|unknown",
      "GRAB_BARS: yes|no|unknown",
      // Bedroom / layout
      "KING_BED: yes|no|unknown",
      "CANOPY_BED: yes|no|unknown",
      "FLOOR_TO_CEILING_WINDOWS: yes|no|unknown",
      "PRIVATE_BALCONY: yes|no|unknown",
      "JULIETTE_BALCONY: yes|no|unknown",
      "HIGH_CEILINGS: yes|no|unknown",
      "OPEN_PLAN: yes|no|unknown",
      "LOFT_LAYOUT: yes|no|unknown",
      "WALK_IN_CLOSET: yes|no|unknown",
      "KITCHENETTE: yes|no|unknown",
      "SWIM_UP_ACCESS: yes|no|unknown",
      "SOFA_BED: yes|no|unknown",
      "DAYBED_WINDOW_NOOK: yes|no|unknown",
      "DINING_TABLE: yes|no|unknown",
      "FULL_LENGTH_MIRROR: yes|no|unknown",
      "DIVIDED_SEATING: yes|no|unknown",
      // Flooring & surfaces
      "HARDWOOD_FLOOR: yes|no|unknown",
      "STONE_MARBLE_FLOOR: yes|no|unknown",
      "POLISHED_CONCRETE_FLOOR: yes|no|unknown",
      "CARPET_FLOOR: yes|no|unknown",
      "AREA_RUGS: yes|no|unknown",
      "STATEMENT_WALLPAPER: yes|no|unknown",
      "EXPOSED_BRICK: yes|no|unknown",
      "EXPOSED_WOOD_BEAMS: yes|no|unknown",
      // Amenities
      "WORK_DESK: yes|no|unknown",
      "ESPRESSO_MACHINE: yes|no|unknown",
      "INDOOR_PLANTS: yes|no|unknown",
      "COCKTAIL_BAR_STATION: yes|no|unknown",
      "MINI_FRIDGE: yes|no|unknown",
      "MICROWAVE: yes|no|unknown",
      "LAUNDRY_IN_ROOM: yes|no|unknown",
      "RECORD_PLAYER: yes|no|unknown",
      "SMART_CONTROLS: yes|no|unknown",
      "INDIVIDUAL_THERMOSTAT: yes|no|unknown",
      "CEILING_FAN: yes|no|unknown",
      // Light & mood
      "HIGH_NATURAL_LIGHT: yes|no|unknown",
      "DIMMABLE_LIGHTING: yes|no|unknown",
      "WARM_LIGHTING: yes|no|unknown",
      "ACCENT_COVE_LIGHTING: yes|no|unknown",
      "FLOOR_LAMPS: yes|no|unknown",
      "READING_LIGHTS: yes|no|unknown",
      "BLACKOUT_SHUTTERS: yes|no|unknown",
      "STATEMENT_FIXTURE: yes|no|unknown",
      "ROMANTIC_LIGHTING: yes|no|unknown",
      // Style
      "MINIMALIST_STYLE: yes|no|unknown",
      "MOODY_DARK_STYLE: yes|no|unknown",
      "EARTH_TONE_PALETTE: yes|no|unknown",
      "VIBRANT_COLORFUL: yes|no|unknown",
      "ORGANIC_WOOD_HEAVY: yes|no|unknown",
      "MID_CENTURY_MODERN: yes|no|unknown",
      "VINTAGE_FURNITURE: yes|no|unknown",
      // Views
      "SKYLINE_VIEW: yes|no|unknown",
      "WATER_VIEW: yes|no|unknown",
      "GREEN_VIEW: yes|no|unknown",
      "COURTYARD_VIEW: yes|no|unknown",
      "LANDMARK_VIEW: yes|no|unknown",
      "HIGH_FLOOR: yes|no|unknown",
      "STREET_LEVEL_VIEW: yes|no|unknown",
      "BALCONY_FURNITURE: yes|no|unknown",
      "PRIVACY_SHEERS: yes|no|unknown",
      "",
      "STRICT RULES — read before answering:",
      "- DOUBLE_SINKS: yes ONLY when you can clearly see TWO separate sink basins/bowls each with its own faucet. A single wide rectangular trough sink = no. If only one faucet visible = no. When unsure = unknown.",
      "- SOAKING_TUB: yes ONLY for a deep freestanding or built-in soaking tub. A standard shallow bathtub = no for SOAKING_TUB but yes for BATHTUB.",
      "- WALK_IN_SHOWER: yes ONLY if the shower has no step-over barrier and you can walk straight in. A shower with a small lip or curb = no.",
      "- RAINFALL_SHOWER: yes ONLY if an overhead ceiling-mounted rainfall showerhead is clearly visible.",
      "- PRIVATE_BALCONY: yes ONLY if an outdoor balcony/terrace attached to this specific room is visible. A view photo without balcony railings = no.",
      "- FLOOR_TO_CEILING_WINDOWS: yes ONLY if windows extend from floor to ceiling or very close (>85% of wall height).",
      `Context: room="${photoContext.roomName || "unknown"}" type="${photoContext.type || "other"}"`,
      isLikelyBath ? "This is likely a bathroom — answer all bathroom fields carefully." : "Answer bathroom fields as unknown unless clearly visible.",
      "Only answer yes for features CLEARLY and UNAMBIGUOUSLY visible in this photo. When in doubt = unknown.",
    ].join("\n");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const txt = await r.text();
      if ((r.status === 429 || r.status === 503) && retries > 0) {
        const attempt = 6 - retries; // 1..5
        const delay = Math.min(attempt * attempt * 3000, 60000); // 3s, 12s, 27s, 48s, 60s cap
        await new Promise((resolve) => setTimeout(resolve, delay));
        return geminiCaption(imageUrl, photoContext, retries - 1);
      }
      console.warn(`[v2-index] caption HTTP ${r.status}: ${txt.slice(0, 120)}`);
      return null;
    }
    const d = await r.json();
    const cap = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    return cap;
  } catch (_) {
    if (retries > 0) return geminiCaption(imageUrl, photoContext, retries - 1);
    return null;
  }
}

function extractFeatureSummary(caption) {
  if (!caption) return null;
  // New format: every line is FIELD: yes|no|unknown — pass through all of them.
  // Also handles old format (PHOTO TYPE / SINKS / BATHTUB…) as a fallback.
  const keep = caption
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => /^[A-Z_]+:\s+\S/.test(l));
  return keep.length ? keep.join("\n") : caption.trim() || null;
}

async function upsertV2Facts(db, rows) {
  if (!rows.length) return;
  // Deduplicate by conflict key before upserting — same photo_url+fact_key in one batch
  // causes "ON CONFLICT DO UPDATE command cannot affect row a second time" in Postgres.
  const seen = new Set();
  const deduped = rows.filter(r => {
    const k = `${r.hotel_id}|${r.room_type_id}|${r.photo_url}|${r.fact_key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const { error } = await db.from("v2_room_feature_facts").upsert(deduped, {
    onConflict: "hotel_id,room_type_id,photo_url,fact_key",
  });
  if (error) throw error;
}

async function clearCityV2Data(db, city) {
  await db.from("v2_room_feature_facts").delete().eq("city", city);
  await db.from("v2_room_inventory").delete().eq("city", city);
  await db.from("v2_hotels_cache").delete().eq("city", city);
}

async function reindexCityV2(city, limit = 200, forceRebuild = true) {
  if (!LITEAPI_KEY || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing required env vars");
  const db = getDb();
  const cc = COUNTRY_CODES[String(city || "").toLowerCase()] || "";
  const started = new Date().toISOString();
  await db.from("v2_indexed_cities").upsert({
    city, country_code: cc, status: "indexing", hotel_count: 0, photo_count: 0, started_at: started, updated_at: started, last_error: null,
  }, { onConflict: "city" });

  if (forceRebuild) await clearCityV2Data(db, city);

  // Paginate LiteAPI /data/hotels — max 1000 per request, loop until we reach `limit`.
  const LITEAPI_PAGE_SIZE = 1000;
  const hotels = [];
  let offset = 0;
  while (hotels.length < limit) {
    const pageSize = Math.min(LITEAPI_PAGE_SIZE, limit - hotels.length);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (cc) { params.set("countryCode", cc); params.set("cityName", city); } else { params.set("city", city); }
    const hotelsRes = await liteGet(`/data/hotels?${params}`);
    if (!hotelsRes.ok) throw new Error(`LiteAPI /data/hotels failed ${hotelsRes.status}`);
    const page = hotelsRes.data?.data || [];
    if (!page.length) break;
    hotels.push(...page);
    offset += page.length;
    console.log(`[v2-index] fetched ${hotels.length} hotels (page ${page.length}, target ${limit})`);
    if (page.length < pageSize) break; // last page
  }
  console.log(`[v2-index] total hotels from LiteAPI: ${hotels.length}`);

  let targetHotels = hotels;
  if (!forceRebuild) {
    const { data: existingRows } = await db
      .from("v2_hotels_cache")
      .select("hotel_id")
      .eq("city", city);
    const existing = new Set((existingRows || []).map((r) => String(r.hotel_id)));
    targetHotels = hotels.filter((h) => !existing.has(String(h.id || h.hotelId)));
  }

  let hotelsDone = 0;
  let hotelsSkippedQuality = 0;
  let photosDone = 0;
  for (let i = 0; i < targetHotels.length; i += BATCH_SIZE) {
    const batch = targetHotels.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (hotel) => {
      const hotelId = hotel.id || hotel.hotelId;
      const detailRes = await liteGet(`/data/hotel?hotelId=${hotelId}`);
      if (!detailRes.ok) { hotelsDone++; return; }
      const detail = detailRes.data?.data || {};

      // Quality filter: skip hotels with no room having ≥2 photos.
      // Low-photo properties produce unreliable facts; filtering keeps the index clean.
      const hasQualityRoom = (detail.rooms || []).some(
        (room) => (room.photos || []).length >= 2
      );
      if (!hasQualityRoom) {
        hotelsSkippedQuality++;
        hotelsDone++;
        return;
      }

      const stars = hotel.starRating || detail.starRating || 0;
      const rating = hotel.rating || hotel.guestRating || detail.rating || 0;
      const mainPhoto = detail.main_photo || detail.mainPhoto || "";
      const hotelPhotos = (detail.hotelImages || [])
        .map((p) => p?.urlHd || p?.url || "")
        .filter(Boolean)
        .filter((u) => u !== mainPhoto)
        .slice(0, 8);

      // Classify property type: prefer LiteAPI field, fall back to room-name heuristics.
      const RENTAL_RE = /\b(apartment|vacation home|vacation rental|house|villa|hostel|dormitory|dorm|bunk bed)\b/i;
      const HOSTEL_RE = /\b(hostel|dormitory|dorm|bunk bed)\b/i;
      let property_type = "hotel";
      const liteApiType = detail.propertyType || detail.accommodationType || null;
      if (liteApiType) {
        const lt = liteApiType.toLowerCase();
        if (/hostel/.test(lt) || /dormitory/.test(lt)) property_type = "hostel";
        else if (/apartment|rental|villa|vacation/.test(lt)) property_type = "apartment_rental";
      } else {
        const rooms = detail.rooms || [];
        if (rooms.length > 0) {
          const rentalCount = rooms.filter(r => RENTAL_RE.test(r.roomName || r.name || "")).length;
          const hostelCount = rooms.filter(r => HOSTEL_RE.test(r.roomName || r.name || "")).length;
          if (rentalCount === rooms.length) {
            property_type = hostelCount > 0 ? "hostel" : "apartment_rental";
          }
        }
      }

      // Only write columns that remain after ToS cleanup (name/address/ratings/main_photo dropped).
      // Display metadata (name, photo, ratings) is fetched live from LiteAPI at search time.
      await db.from("v2_hotels_cache").upsert({
        hotel_id: hotelId, city, country_code: cc,
        hotel_photos: hotelPhotos,
        lat: detail.location?.latitude ?? detail.lat ?? null,
        lng: detail.location?.longitude ?? detail.lng ?? null,
        property_type,
        cached_at: new Date().toISOString(),
      }, { onConflict: "hotel_id" });

      const MAX_PHOTOS_PER_ROOM = 5;  // cap per room type to ensure coverage across all rooms
      const chosen = [];
      const seenUrls = new Set();
      for (const room of (detail.rooms || [])) {
        const roomName = room.roomName || room.name || "Room";
        const roomTypeId = room.id || room.roomId || room.roomTypeId || null;
        let roomPhotoCount = 0;
        for (const p of (room.photos || [])) {
          if (roomPhotoCount >= MAX_PHOTOS_PER_ROOM) break;
          const url = p.url || p.hd_url || "";
          if (!url || seenUrls.has(url)) continue;
          seenUrls.add(url);
          chosen.push({ roomName, roomTypeId, url, type: classifyPhoto(p, roomName) });
          roomPhotoCount++;
        }
        // No global PHOTO_LIMIT_PER_HOTEL break — every room type gets its fair share
      }

      for (let j = 0; j < chosen.length; j += PHOTO_CONCURRENCY) {
        const chunk = chosen.slice(j, j + PHOTO_CONCURRENCY);
        await Promise.all(chunk.map(async (photo) => {
          const cap = await geminiCaption(photo.url, { type: photo.type, roomName: photo.roomName });
          const summary = extractFeatureSummary(cap);
          // New format uses PHOTO_TYPE: (underscore), old used PHOTO TYPE: (space) — handle both
          const detectedType = (cap?.match(/PHOTO[_ ]TYPE:\s*([^\n\r]+)/i)?.[1] || photo.type || "other").toLowerCase().trim();
          await db.from("v2_room_inventory").upsert({
            hotel_id: hotelId, city, country_code: cc, room_name: photo.roomName, room_type_id: photo.roomTypeId || null,
            photo_url: photo.url, photo_type: detectedType, source: "vision",
          }, { onConflict: "hotel_id,photo_url" });
          const factRows = parseStructuredCaption(cap).map((f) => ({
            hotel_id: hotelId,
            room_type_id: photo.roomTypeId || null,
            city,
            country_code: cc,
            room_name: photo.roomName,
            photo_url: photo.url,
            fact_key: f.fact_key,
            fact_value: f.fact_value,
            confidence: f.confidence,
            source: f.source || "vision",
            extractor_version: "v2-facts-1",
            updated_at: new Date().toISOString(),
          }));
          await upsertV2Facts(db, factRows);
          photosDone++;
        }));
      }
      hotelsDone++;
    }));

    await db.from("v2_indexed_cities").update({
      hotel_count: hotelsDone, photo_count: photosDone, updated_at: new Date().toISOString(),
    }).eq("city", city);
  }

  // Use a fresh client for all final steps — the long-lived `db` connection often expires
  // after multi-hour runs, causing silent failures on status updates and the index rebuild.
  const dbFinal = getDb();

  const [{ count: totalHotels }, { count: totalPhotos }] = await Promise.all([
    dbFinal.from("v2_hotels_cache").select("*", { count: "exact", head: true }).eq("city", city),
    dbFinal.from("v2_room_inventory").select("*", { count: "exact", head: true }).eq("city", city),
  ]);
  await dbFinal.from("v2_indexed_cities").update({
    status: "complete",
    hotel_count: totalHotels || 0,
    photo_count: totalPhotos || 0,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: null,
  }).eq("city", city);

  // Copy hotel spatial data to hotels_cache so neighbourhood RPC (get_primary_nbhds_for_hotels)
  // can assign hotels to neighbourhoods. Only copies hotel_id + coords — no LiteAPI content.
  try {
    const { data: v2Hotels } = await dbFinal.from("v2_hotels_cache")
      .select("hotel_id, city, country_code, lat, lng")
      .eq("city", city)
      .not("lat", "is", null);
    if (v2Hotels?.length) {
      const rows = v2Hotels.map(h => ({ hotel_id: h.hotel_id, city: h.city, country_code: h.country_code, lat: h.lat, lng: h.lng }));
      const { error: cpErr } = await dbFinal.from("hotels_cache").upsert(rows, { onConflict: "hotel_id" });
      if (cpErr) console.error("[v2-index] hotels_cache copy error:", cpErr.message);
      else console.log(`[v2-index] copied ${rows.length} hotels to hotels_cache for neighbourhood matching`);
    }
  } catch (cpEx) {
    console.error("[v2-index] hotels_cache copy exception:", cpEx.message);
  }

  // Auto-rebuild v2_room_types_index (pre-aggregated per-room facts for fast Phase A search).
  console.log(`[v2-index] rebuilding v2_room_types_index for "${city}"...`);
  try {
    const { data: rebuildCount, error: rebuildErr } = await dbFinal.rpc(
      "rebuild_v2_room_types_index_city",
      { p_city: city }
    );
    if (rebuildErr) {
      console.error("[v2-index] rebuild index error:", rebuildErr.message);
    } else {
      console.log(`[v2-index] rebuilt ${rebuildCount} room types in v2_room_types_index`);
      // Verify the rebuild actually landed — if still 0 something is wrong
      const { count: indexCount } = await dbFinal
        .from("v2_room_types_index")
        .select("*", { count: "exact", head: true })
        .eq("city", city);
      console.log(`[v2-index] v2_room_types_index now has ${indexCount} rows for ${city}`);
      if (!indexCount) console.error("[v2-index] WARNING: index count is 0 after rebuild — manual rebuild may be needed");
    }
  } catch (rebuildEx) {
    console.error("[v2-index] rebuild index exception:", rebuildEx.message);
  }

  console.log(
    `[v2-index] done: ${hotelsDone} processed, ${hotelsSkippedQuality} skipped (quality filter), ` +
    `${photosDone} photos captioned`
  );
  return {
    city, hotelsDone, hotelsSkippedQuality, photosDone,
    totalHotels: totalHotels || 0, totalPhotos: totalPhotos || 0,
  };
}

module.exports = { reindexCityV2 };
