#!/usr/bin/env node
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const {
  parseStructuredCaption,
  buildHotelPublicClassifierPrompt,
  parseHotelPublicReply,
  AREA_FACT_KEYS,
  VISUAL_STYLE_FACT_KEYS,
} = require("./fact-catalog");

// How many of `v2_hotels_cache.hotel_photos` to caption per hotel. LiteAPI
// returns up to ~30 near-duplicates for chain hotels; the first 12 cover
// lobby + bar + pool + facade with diminishing returns after that.
const HOTEL_PUBLIC_PHOTOS_PER_HOTEL = 12;
// Extractor version stamp on hotel-public fact rows. Bump on prompt changes.
const HOTEL_PUBLIC_EXTRACTOR_VERSION = "v2-hp-1";
const HOTEL_PUBLIC_ROOM_NAME    = "__hotel_public__";
// Non-NULL sentinel for room_type_id on the pseudo-room. See
// scripts/classify-hotel-public.js for the rationale (Postgres treats NULLs
// as distinct in unique constraints, so a NULL room_type_id breaks both the
// ON CONFLICT spec and re-run idempotency).
const HOTEL_PUBLIC_ROOM_TYPE_ID = "__public__";

const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

// Throughput knobs. Bottleneck is Gemini vision calls (~0.5–1.5 s each).
// Memory on Render Starter (512 MB): cap simultaneous in-flight image buffers
// via V2_MAX_INFLIGHT_PHOTOS (each fetch ≈ 1–3 MB base64). Hotel-public photos
// are skipped during bulk index by default on Render — run classify-hotel-public
// after the city completes.
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return async function run(fn) {
    if (active >= max) await new Promise((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

const BATCH_SIZE = Math.max(
  1,
  Number(process.env.V2_BATCH_SIZE) || (process.env.RENDER ? 10 : 25),
);
const HOTEL_CONCURRENCY = Math.max(
  1,
  Number(process.env.V2_HOTEL_CONCURRENCY) || (process.env.RENDER ? 2 : 3),
);
// Legacy alias; global pool uses V2_MAX_INFLIGHT_PHOTOS.
const PHOTO_CONCURRENCY = Math.max(
  1,
  Number(process.env.V2_PHOTO_CONCURRENCY) || (process.env.RENDER ? 4 : 6),
);
const MAX_INFLIGHT_PHOTOS = Math.max(
  1,
  Number(process.env.V2_MAX_INFLIGHT_PHOTOS)
    || Math.min(PHOTO_CONCURRENCY * HOTEL_CONCURRENCY, process.env.RENDER ? 10 : 24),
);
const _photoGeminiSlot = createSemaphore(MAX_INFLIGHT_PHOTOS);
const SKIP_HOTEL_PUBLIC = process.env.V2_SKIP_HOTEL_PUBLIC === "1"
  || (process.env.V2_SKIP_HOTEL_PUBLIC !== "0" && !!process.env.RENDER);
const PROGRESS_EVERY_HOTELS = Math.max(5, Number(process.env.V2_PROGRESS_EVERY) || 25);
const CAPTION_RATE_PER_MIN = Math.max(100, Number(process.env.V2_CAPTION_RATE_PER_MIN) || 1500);
const MAX_IMAGE_BYTES = Math.max(400_000, Number(process.env.V2_MAX_IMAGE_BYTES) || 1_800_000);
let _capWindow = Date.now();
let _capCount = 0;
const _imageB64Cache = new Map();
const IMAGE_CACHE_MAX = 120;

async function fetchImageB64(imageUrl) {
  const cached = _imageB64Cache.get(imageUrl);
  if (cached) return cached;
  const imgRes = await fetch(imageUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!imgRes.ok) return null;
  const len = Number(imgRes.headers.get("content-length") || 0);
  if (len > MAX_IMAGE_BYTES) {
    console.warn(`[v2-index] skip oversized image (${len} B): ${imageUrl.slice(0, 80)}…`);
    return null;
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    console.warn(`[v2-index] skip oversized image (${buf.length} B): ${imageUrl.slice(0, 80)}…`);
    return null;
  }
  const out = {
    b64: buf.toString("base64"),
    mime: imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg",
  };
  if (_imageB64Cache.size >= IMAGE_CACHE_MAX) {
    const first = _imageB64Cache.keys().next().value;
    if (first) _imageB64Cache.delete(first);
  }
  _imageB64Cache.set(imageUrl, out);
  return out;
}

const {
  resolveCityConfig,
  passesCatalogFilter,
  listLiteapiCatalogCities,
} = require("./city-registry");
const {
  isInGeoZone,
  hotelListLatLng,
  passesRoomQuality,
} = require("./geo-index-helpers");
const { listGeoQuotaFences } = require("./neighborhood-fence-overrides");

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase env");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function liteGet(path, timeoutMs = 45000) {
  const url = `https://api.liteapi.travel/v3.0${path}`;
  const r = await fetch(url, {
    headers: { "X-API-Key": LITEAPI_KEY, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
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

/** Gemini vision call (no semaphore — caller must acquire _photoGeminiSlot). */
async function geminiCaptionInner(imageUrl, photoContext = {}, retries = 5) {
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

    const img = await fetchImageB64(imageUrl);
    if (!img) return null;
    const { b64, mime } = img;
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
      // Visual style enum — pick EXACTLY ONE as `yes`, the other four as `no` (mutex).
      // This drives the boop wizard's stayVibe ranking (sleek_polished etc.). Unlike
      // the other style booleans above (which Gemini over-extracts, hitting 80-98%
      // coverage and providing zero discrimination), the enum is forced single-choice
      // so the room-level majority vote can pick a winner.
      "VISUAL_STYLE_SLEEK_POLISHED: yes|no|unknown",
      "VISUAL_STYLE_COZY_WARM: yes|no|unknown",
      "VISUAL_STYLE_VIBRANT_ECLECTIC: yes|no|unknown",
      "VISUAL_STYLE_MOODY_DARK: yes|no|unknown",
      "VISUAL_STYLE_CLASSIC_TRADITIONAL: yes|no|unknown",
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
      "- VISUAL_STYLE_*: pick EXACTLY ONE as `yes`, the other four MUST be `no` (not `unknown`). Lean toward `unknown` for ALL FIVE when the room is a plain, generic, budget room with no clear aesthetic. Definitions:",
      "    • SLEEK_POLISHED      — high-end modern hotel aesthetic: REQUIRES ≥2 of {polished marble/stone/glass dominate, crisp uncluttered architectural lines, monochrome neutral palette, obvious post-2015 fit-out}. DISQUALIFIES: warm-wood headboards dominating the frame, printed/colorful bedspreads, dated furniture, ornate trim, brown/beige earth-tone walls, plain budget rooms.",
      "    • COZY_WARM           — warm traditional lived-in: REQUIRES ≥2 of {warm-tone palette dominates (brown/beige/cream/terracotta/honey wood), soft layered textiles, traditional homey furnishings}. DISQUALIFIES: clinical minimalist look, bold colours.",
      "    • VIBRANT_ECLECTIC    — REQUIRES ≥1 of {saturated bold wall colour, strong graphic pattern dominating, intentionally mixed-eras designer furnishings}. DISQUALIFIES: subdued neutral schemes.",
      "    • MOODY_DARK          — REQUIRES BOTH dominant dark walls/finishes AND dim dramatic low-key lighting. A dim photo of a light-walled room = no.",
      "    • CLASSIC_TRADITIONAL — REQUIRES ≥2 of {ornate mouldings/cornicing/panelling, antique-style carved/gilt furniture, brocade/damask/tufted upholstery or formal drapery}. DISQUALIFIES: contemporary minimalist look.",
      "  If the photo is not a room interior (exterior, map, food, etc.) OR is a plain generic budget room without a clear dominant aesthetic, answer all five visual styles as `unknown`.",
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
        return geminiCaptionInner(imageUrl, photoContext, retries - 1);
      }
      console.warn(`[v2-index] caption HTTP ${r.status}: ${txt.slice(0, 120)}`);
      return null;
    }
    const d = await r.json();
    const cap = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    return cap;
  } catch (_) {
    if (retries > 0) return geminiCaptionInner(imageUrl, photoContext, retries - 1);
    return null;
  }
}

async function geminiCaption(imageUrl, photoContext = {}, retries = 5) {
  return _photoGeminiSlot(() => geminiCaptionInner(imageUrl, photoContext, retries));
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

// ── Hotel public-area photo classifier (lobby/pool/bar/...) ─────────────────
// Re-uses the indexer's caption rate-gate by sharing the _capWindow/_capCount
// variables. Returns the parsed { areas, visualStyle } object or
// { areas: [], visualStyle: null } on permanent failure.
async function geminiClassifyPublicPhotoInner(imageUrl, retries = 4) {
  if (!GEMINI_KEY) return { areas: [], visualStyle: null };
  try {
    const now = Date.now();
    if (now - _capWindow > 60000) { _capWindow = now; _capCount = 0; }
    if (_capCount >= CAPTION_RATE_PER_MIN) {
      const wait = 61000 - (now - _capWindow);
      await new Promise((r) => setTimeout(r, Math.max(500, wait)));
      _capWindow = Date.now();
      _capCount = 0;
    }
    _capCount++;

    const img = await fetchImageB64(imageUrl);
    if (!img) return { areas: [], visualStyle: null };
    const { b64, mime } = img;
    const prompt = buildHotelPublicClassifierPrompt({
      roomName: HOTEL_PUBLIC_ROOM_NAME,
      type:     "other",
    });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
          generationConfig: { maxOutputTokens: 64, temperature: 0 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!r.ok) {
      if ((r.status === 429 || r.status === 503) && retries > 0) {
        const attempt = 5 - retries;
        const delay = Math.min(attempt * attempt * 3000, 60000);
        await new Promise((res) => setTimeout(res, delay));
        return geminiClassifyPublicPhotoInner(imageUrl, retries - 1);
      }
      return { areas: [], visualStyle: null };
    }

    const d   = await r.json();
    const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    return parseHotelPublicReply(txt);
  } catch (_err) {
    if (retries > 0) return geminiClassifyPublicPhotoInner(imageUrl, retries - 1);
    return { areas: [], visualStyle: null };
  }
}

async function geminiClassifyPublicPhoto(imageUrl, retries = 4) {
  return _photoGeminiSlot(() => geminiClassifyPublicPhotoInner(imageUrl, retries));
}

/**
 * Classify up to HOTEL_PUBLIC_PHOTOS_PER_HOTEL hotel-public photos for the
 * given hotel and persist inventory + fact rows. Per-hotel best-effort: a
 * single Gemini failure does not abort hotel indexing.
 */
async function processHotelPublicPhotos(db, { hotelId, city, cc, hotelPhotoUrls }) {
  const urls = (hotelPhotoUrls || []).slice(0, HOTEL_PUBLIC_PHOTOS_PER_HOTEL);
  if (!urls.length) return 0;
  let processed = 0;
  await Promise.all(urls.map(async (url) => {
    const { areas, visualStyle } = await geminiClassifyPublicPhoto(url);
    const stamp = new Date().toISOString();
    const dominantArea = areas.length > 0 ? areas[0].replace(/^area_/, "") : "other";

    await db.from("v2_room_inventory").upsert({
      hotel_id:        hotelId,
      city,
      country_code:    cc,
      room_name:       HOTEL_PUBLIC_ROOM_NAME,
      room_type_id:    HOTEL_PUBLIC_ROOM_TYPE_ID,
      photo_url:       url,
      photo_type:      dominantArea,
      caption:         null,
      feature_summary: null,
      source:          "hotel_public_classifier",
    }, { onConflict: "hotel_id,room_type_id,photo_url" });

    const factRows = [];
    for (const areaKey of AREA_FACT_KEYS) {
      factRows.push({
        hotel_id:          hotelId,
        room_type_id:      HOTEL_PUBLIC_ROOM_TYPE_ID,
        city,
        country_code:      cc,
        room_name:         HOTEL_PUBLIC_ROOM_NAME,
        photo_url:         url,
        fact_key:          areaKey,
        fact_value:        areas.includes(areaKey) ? 1 : 0,
        confidence:        0.85,
        source:            "hotel_public_classifier",
        extractor_version: HOTEL_PUBLIC_EXTRACTOR_VERSION,
        updated_at:        stamp,
      });
    }
    if (visualStyle) {
      for (const styleKey of VISUAL_STYLE_FACT_KEYS) {
        factRows.push({
          hotel_id:          hotelId,
          room_type_id:      HOTEL_PUBLIC_ROOM_TYPE_ID,
          city,
          country_code:      cc,
          room_name:         HOTEL_PUBLIC_ROOM_NAME,
          photo_url:         url,
          fact_key:          styleKey,
          fact_value:        styleKey === visualStyle ? 1 : 0,
          confidence:        0.85,
          source:            "hotel_public_classifier",
          extractor_version: HOTEL_PUBLIC_EXTRACTOR_VERSION,
          updated_at:        stamp,
        });
      }
    }
    if (factRows.length) await upsertV2Facts(db, factRows);
    processed++;
  }));
  return processed;
}

async function clearCityV2Data(db, city) {
  await db.from("v2_room_feature_facts").delete().eq("city", city);
  await db.from("v2_room_inventory").delete().eq("city", city);
  await db.from("v2_room_types_index").delete().eq("city", city);
  await db.from("v2_hotels_cache").delete().eq("city", city);
}

async function writeIndexProgress(db, city, progress) {
  const patch = {
    hotel_count: progress.indexed_in_cache ?? 0,
    photo_count: progress.photos_done ?? null,
    index_progress: progress,
    updated_at: new Date().toISOString(),
  };
  if (patch.photo_count == null) delete patch.photo_count;
  const { error } = await db.from("v2_indexed_cities").update(patch).eq("city", city);
  if (error) console.warn(`[v2-index] progress update failed: ${error.message}`);
}

/** Rebuild v2_room_types_index so /api/vsearch Phase A sees newly indexed hotels. */
async function rebuildV2RoomTypesIndex(db, city, { label = "final" } = {}) {
  console.log(`[v2-index] rebuilding v2_room_types_index for "${city}" (${label})…`);
  try {
    const { data: rebuildCount, error: rebuildErr } = await db.rpc(
      "rebuild_v2_room_types_index_city",
      { p_city: city },
    );
    if (rebuildErr) {
      console.error("[v2-index] rebuild index error:", rebuildErr.message);
      return false;
    }
    console.log(`[v2-index] rebuilt ${rebuildCount} room types in v2_room_types_index (${label})`);
    return true;
  } catch (rebuildEx) {
    console.error("[v2-index] rebuild index exception:", rebuildEx.message);
    return false;
  }
}

/**
 * Index one catalog hotel. Returns photos added; indexed=false when quality-filtered or detail fetch failed.
 */
async function processOneHotel(db, { hotel, city, cc, minRoomPhotos: minRoomPhotosArg = 2, geoQuality = null }) {
  const hotelId = String(hotel.id || hotel.hotelId);
  const detailRes = await liteGet(`/data/hotel?hotelId=${hotelId}`);
  if (!detailRes.ok) return { indexed: false, photosAdded: 0, skippedQuality: false };

  const detail = detailRes.data?.data || {};
  const minRoomPhotos = Math.max(1, Number(minRoomPhotosArg) || 2);
  if (!passesRoomQuality(detail, minRoomPhotos, geoQuality)) {
    return { indexed: false, photosAdded: 0, skippedQuality: true };
  }

  const mainPhoto = detail.main_photo || detail.mainPhoto || "";
  const hotelPhotos = (detail.hotelImages || [])
    .map((p) => p?.urlHd || p?.url || "")
    .filter(Boolean)
    .filter((u) => u !== mainPhoto)
    .slice(0, 8);

  const HOSTEL_RE = /\b(hostel|dormitory|dorm|bunk bed)\b/i;
  const VILLA_RE = /\bvilla\b/i;
  const VACHOME_RE = /\b(vacation home|vacation rental|house)\b/i;
  const ANY_RENTAL_RE = /\b(apartment|vacation home|vacation rental|house|villa|hostel|dormitory|dorm|bunk bed)\b/i;

  let property_type = "hotel";
  const liteApiType = detail.propertyType || detail.accommodationType || null;
  if (liteApiType) {
    const lt = liteApiType.toLowerCase();
    if (HOSTEL_RE.test(lt)) property_type = "hostel";
    else if (/\bvilla\b/.test(lt)) property_type = "villa";
    else if (/vacation home|vacation rental|house/.test(lt)) property_type = "vacation_home";
    else if (/apartment|rental/.test(lt)) property_type = "apartment";
  } else {
    const rooms = detail.rooms || [];
    if (rooms.length > 0) {
      const names = rooms.map((r) => r.roomName || r.name || "");
      if (names.some((n) => HOSTEL_RE.test(n))) property_type = "hostel";
      else {
        const rentalCount = names.filter((n) => ANY_RENTAL_RE.test(n)).length;
        if (rentalCount === rooms.length) {
          if (names.some((n) => VILLA_RE.test(n))) property_type = "villa";
          else if (names.some((n) => VACHOME_RE.test(n))) property_type = "vacation_home";
          else property_type = "apartment";
        }
      }
    }
  }

  await db.from("v2_hotels_cache").upsert({
    hotel_id: hotelId,
    city,
    country_code: cc,
    hotel_photos: hotelPhotos,
    lat: detail.location?.latitude ?? detail.lat ?? null,
    lng: detail.location?.longitude ?? detail.lng ?? null,
    property_type,
    cached_at: new Date().toISOString(),
  }, { onConflict: "hotel_id" });

  const MAX_PHOTOS_PER_ROOM = 8;
  const chosen = [];
  for (const room of detail.rooms || []) {
    const roomName = room.roomName || room.name || "Room";
    const roomTypeId = room.id || room.roomId || room.roomTypeId || null;
    const seenInRoom = new Set();
    let roomPhotoCount = 0;
    for (const p of room.photos || []) {
      if (roomPhotoCount >= MAX_PHOTOS_PER_ROOM) break;
      const url = p.url || p.hd_url || "";
      if (!url || seenInRoom.has(url)) continue;
      seenInRoom.add(url);
      chosen.push({ roomName, roomTypeId, url, type: classifyPhoto(p, roomName) });
      roomPhotoCount++;
    }
  }

  const captionCache = new Map();
  const getCaptionFor = (photo) => {
    const existing = captionCache.get(photo.url);
    if (existing) return existing;
    const p = (async () => {
      const cap = await geminiCaption(photo.url, { type: photo.type, roomName: photo.roomName });
      const detectedType = (cap?.match(/PHOTO[_ ]TYPE:\s*([^\n\r]+)/i)?.[1] || photo.type || "other").toLowerCase().trim();
      const facts = parseStructuredCaption(cap);
      return { caption: cap, detectedType, facts };
    })();
    captionCache.set(photo.url, p);
    return p;
  };

  let photosAdded = 0;
  const allFactRows = [];
  await Promise.all(chosen.map(async (photo) => {
    const { detectedType, facts } = await getCaptionFor(photo);
    await db.from("v2_room_inventory").upsert({
      hotel_id: hotelId, city, country_code: cc, room_name: photo.roomName,
      room_type_id: photo.roomTypeId || null, photo_url: photo.url, photo_type: detectedType, source: "vision",
    }, { onConflict: "hotel_id,room_type_id,photo_url" });
    const stamp = new Date().toISOString();
    for (const f of facts) {
      allFactRows.push({
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
        updated_at: stamp,
      });
    }
    photosAdded++;
  }));
  if (allFactRows.length) await upsertV2Facts(db, allFactRows);

  if (!SKIP_HOTEL_PUBLIC) {
    try {
      photosAdded += await processHotelPublicPhotos(db, { hotelId, city, cc, hotelPhotoUrls: hotelPhotos });
    } catch (e) {
      console.warn(`[v2-index] hotel-public classify failed for ${hotelId}: ${e.message}`);
    }
  }

  return { indexed: true, photosAdded, skippedQuality: false };
}

const LITEAPI_PAGE_SIZE = 1000;

async function fetchOneCityCatalogPage(cityName, cc, offset, pageSize) {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  if (cc) {
    params.set("countryCode", cc);
    params.set("cityName", cityName);
  } else {
    params.set("city", cityName);
  }
  let hotelsRes = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    hotelsRes = await liteGet(`/data/hotels?${params}`);
    if (hotelsRes.ok) break;
    const wait = Math.min(15000, 2000 * (attempt + 1));
    console.warn(
      `[v2-index] catalog ${cityName} offset=${offset} attempt ${attempt + 1} failed (${hotelsRes.status}) — retry in ${wait}ms`,
    );
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!hotelsRes?.ok) throw new Error(`LiteAPI /data/hotels failed ${hotelsRes?.status} for ${cityName} at offset ${offset}`);
  return hotelsRes.data?.data || [];
}

/**
 * Merge primary + satellite LiteAPI city lists (deduped by hotel id).
 * @param {import('./city-registry').CityConfig & object} cityCfg
 */
async function fetchMergedLiteapiCatalog(cityCfg, opts = {}) {
  const cc = cityCfg.countryCode;
  const catalogLimit = Math.max(1000, Number(opts.catalogLimit) || 50000);
  const minQueueSize = Math.max(0, Number(opts.minQueueSize) || 0);
  const fullScan = opts.fullScan === true;
  const cityNames = listLiteapiCatalogCities(cityCfg);
  const primary = cityCfg.liteapiCityName || cityCfg.displayName;
  const byId = new Map();
  let skippedStarFilter = 0;
  let catalogScanned = 0;

  for (const cityName of cityNames) {
    const isPrimary = cityName === primary;
    let offset = 0;
    const cityScanLimit = isPrimary ? catalogLimit : Math.min(catalogLimit, 5000);
    while (offset < cityScanLimit) {
      const pageSize = Math.min(LITEAPI_PAGE_SIZE, cityScanLimit - offset);
      const page = await fetchOneCityCatalogPage(cityName, cc, offset, pageSize);
      if (!page.length) break;
      for (const h of page) {
        catalogScanned++;
        if (passesCatalogFilter(h, cityCfg)) {
          if (!byId.has(h.id)) byId.set(h.id, h);
        } else {
          skippedStarFilter++;
        }
      }
      offset += page.length;
      if (page.length < pageSize) break;
      if (!fullScan && isPrimary && minQueueSize > 0 && byId.size >= minQueueSize) {
        console.log(
          `[v2-index] catalog scan early stop: queue=${byId.size} >= minQueueSize=${minQueueSize} at ${cityName} offset=${offset}`,
        );
        break;
      }
    }
    if (cityName !== primary) {
      console.log(`[v2-index] satellite catalog ${cityName}: merged total=${byId.size}`);
    }
  }

  return { hotels: [...byId.values()], skippedStarFilter, catalogScanned };
}

/** Walk LiteAPI catalog (primary + satellites), apply star filter, sort best-first. */
async function fetchAndSortCatalog(liteapiCity, cc, catalogLimit, cityCfg, opts = {}) {
  const { hotels, skippedStarFilter, catalogScanned } = await fetchMergedLiteapiCatalog(cityCfg, {
    catalogLimit,
    minQueueSize: opts.minQueueSize || 0,
    fullScan: false,
  });
  hotels.sort((a, b) => {
    const sa = Number(a.stars ?? a.starRating ?? 0);
    const sb = Number(b.stars ?? b.starRating ?? 0);
    if (sb !== sa) return sb - sa;
    return Number(b.rating ?? b.guestRating ?? 0) - Number(a.rating ?? a.guestRating ?? 0);
  });
  return { hotels, skippedStarFilter, catalogScanned };
}

/**
 * @param {string} city
 * @param {number} [limit] — max LiteAPI catalog rows to scan when building sorted queue
 * @param {boolean} [forceRebuild]
 * @param {{ indexCapOverride?: number }} [opts]
 */
async function reindexCityV2(city, limit = 200, forceRebuild = true, opts = {}) {
  if (!LITEAPI_KEY || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing required env vars");
  const cityCfg = resolveCityConfig(city);
  const displayCity = cityCfg.displayName;
  const liteapiCity = cityCfg.liteapiCityName;
  const cc = cityCfg.countryCode;
  const indexCap = Math.max(
    0,
    Number(opts.indexCapOverride ?? process.env.V2_INDEX_CAP ?? cityCfg.indexCap) || 0,
  );
  const minRoomPhotos = cityCfg.minRoomPhotos;

  const db = getDb();
  const started = new Date().toISOString();
  let resumeProgress = null;
  const existing = new Set();

  if (!forceRebuild) {
    const { data: row } = await db
      .from("v2_indexed_cities")
      .select("index_progress, photo_count")
      .eq("city", displayCity)
      .maybeSingle();
    resumeProgress = row?.index_progress || null;
    const { data: existingRows } = await db
      .from("v2_hotels_cache")
      .select("hotel_id")
      .eq("city", displayCity);
    for (const r of existingRows || []) existing.add(String(r.hotel_id));
  }

  const resumeHotelCount = resumeProgress?.indexed_in_cache ?? existing.size;

  await db.from("v2_indexed_cities").upsert({
    city: displayCity,
    country_code: cc,
    status: "indexing",
    hotel_count: resumeHotelCount,
    photo_count: resumeProgress?.photos_done ?? undefined,
    started_at: forceRebuild ? started : undefined,
    updated_at: started,
    last_error: null,
    index_progress: resumeProgress,
  }, { onConflict: "city" });

  if (forceRebuild) {
    await clearCityV2Data(db, displayCity);
    resumeProgress = null;
    existing.clear();
  }

  const minQueueSize = indexCap > 0 ? indexCap + Math.max(50, Math.floor(indexCap * 0.25)) : 0;
  console.log(
    `[v2-index] building sorted catalog for ${displayCity} (liteapi=${liteapiCity}, scan_limit=${limit}` +
    `${minQueueSize ? `, min_queue=${minQueueSize}` : ""})…`,
  );
  const { hotels: sortedHotels, skippedStarFilter: skippedStarBuilt } = await fetchAndSortCatalog(
    liteapiCity, cc, limit, cityCfg, { minQueueSize },
  );
  let queueOffset = forceRebuild ? 0 : (resumeProgress?.queue_offset || 0);
  let catalogScanned = resumeProgress?.catalog_scanned || 0;
  let hotelsSkippedQuality = resumeProgress?.skipped_quality || 0;
  let hotelsSkippedExisting = resumeProgress?.skipped_existing || 0;
  let hotelsSkippedStarFilter = resumeProgress?.skipped_star_filter ?? skippedStarBuilt;
  let hotelsFailed = resumeProgress?.hotels_failed || 0;
  let photosDone = resumeProgress?.photos_done || 0;
  let stoppedAtCap = false;
  let lastHeartbeat = Date.now();
  const HEARTBEAT_MS = Math.max(60_000, Number(process.env.V2_PROGRESS_HEARTBEAT_MS) || 180_000);
  const REBUILD_SEARCH_EVERY = Math.max(
    10,
    Number(process.env.V2_REBUILD_SEARCH_EVERY) || 50,
  );
  let lastSearchRebuildCount = resumeProgress?.indexed_in_cache ?? existing.size;

  const snapshotProgress = () => ({
    queue_offset: queueOffset,
    queue_total: sortedHotels.length,
    catalog_limit: limit,
    index_cap: indexCap,
    indexed_in_cache: existing.size,
    skipped_quality: hotelsSkippedQuality,
    skipped_existing: hotelsSkippedExisting,
    skipped_star_filter: hotelsSkippedStarFilter,
    hotels_failed: hotelsFailed,
    photos_done: photosDone,
    catalog_scanned: catalogScanned,
    stopped_at_cap: stoppedAtCap,
    quality_policy: {
      minStars: cityCfg.minStars,
      minGuestRating: cityCfg.minGuestRating,
      minRoomPhotos,
      indexCap,
    },
  });

  console.log(
    `[v2-index] ${displayCity}: scan_limit=${limit} queue=${sortedHotels.length} ` +
    `index_cap=${indexCap || "none"} min_stars=${cityCfg.minStars} ` +
    `batch=${BATCH_SIZE} hotel_conc=${HOTEL_CONCURRENCY} max_inflight_photos=${MAX_INFLIGHT_PHOTOS} ` +
    `skip_hotel_public=${SKIP_HOTEL_PUBLIC} skip_star_filter=${hotelsSkippedStarFilter} ` +
    `resume_queue_offset=${queueOffset} indexed_cache=${existing.size}`
  );

  while (queueOffset < sortedHotels.length) {
    if (indexCap > 0 && existing.size >= indexCap) {
      stoppedAtCap = true;
      break;
    }

    const slice = [];
    while (slice.length < HOTEL_CONCURRENCY && queueOffset < sortedHotels.length) {
      if (indexCap > 0 && existing.size >= indexCap) {
        stoppedAtCap = true;
        break;
      }
      slice.push(sortedHotels[queueOffset++]);
    }
    if (!slice.length) break;

    await Promise.all(slice.map(async (hotel) => {
      catalogScanned++;
      const hotelId = String(hotel.id || hotel.hotelId);
      if (existing.has(hotelId)) {
        hotelsSkippedExisting++;
        return;
      }
      try {
        const result = await processOneHotel(db, { hotel, city: displayCity, cc, minRoomPhotos });
        if (result.skippedQuality) hotelsSkippedQuality++;
        else if (result.indexed) {
          existing.add(hotelId);
          photosDone += result.photosAdded || 0;
        }
      } catch (e) {
        hotelsFailed++;
        console.warn(`[v2-index] hotel ${hotelId} failed: ${e.message}`);
      }
    }));

    const now = Date.now();
    if (catalogScanned % PROGRESS_EVERY_HOTELS === 0 || now - lastHeartbeat >= HEARTBEAT_MS) {
      lastHeartbeat = now;
      await writeIndexProgress(db, displayCity, snapshotProgress());
      if (existing.size - lastSearchRebuildCount >= REBUILD_SEARCH_EVERY) {
        const ok = await rebuildV2RoomTypesIndex(db, displayCity, {
          label: `incremental @ ${existing.size} hotels`,
        });
        if (ok) lastSearchRebuildCount = existing.size;
      }
      console.log(
        `[v2-index] progress ${displayCity}: queue=${queueOffset}/${sortedHotels.length} ` +
        `indexed=${existing.size}${indexCap ? `/${indexCap}` : ""} ` +
        `skip_star=${hotelsSkippedStarFilter} skip_quality=${hotelsSkippedQuality} ` +
        `skip_existing=${hotelsSkippedExisting} failed=${hotelsFailed}`
      );
    }
  }

  if (!stoppedAtCap && indexCap > 0 && existing.size >= indexCap) stoppedAtCap = true;

  await writeIndexProgress(db, displayCity, snapshotProgress());

  const hotelsDone = catalogScanned;
  console.log(
    `[v2-index] catalog pass done ${displayCity}: queue_processed=${catalogScanned}/${sortedHotels.length} ` +
    `indexed=${existing.size} stopped_at_cap=${stoppedAtCap} ` +
    `skipped_star=${hotelsSkippedStarFilter} skipped_quality=${hotelsSkippedQuality} ` +
    `failed=${hotelsFailed} photos=${photosDone}`
  );

  // Use a fresh client for all final steps — the long-lived `db` connection often expires
  // after multi-hour runs, causing silent failures on status updates and the index rebuild.
  const dbFinal = getDb();

  const [{ count: totalHotels }, { count: totalPhotos }] = await Promise.all([
    dbFinal.from("v2_hotels_cache").select("*", { count: "exact", head: true }).eq("city", displayCity),
    dbFinal.from("v2_room_inventory").select("*", { count: "exact", head: true }).eq("city", displayCity),
  ]);
  await dbFinal.from("v2_indexed_cities").update({
    status: "complete",
    hotel_count: totalHotels || 0,
    photo_count: totalPhotos || 0,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: null,
    index_progress: null,
  }).eq("city", displayCity);

  // Copy hotel spatial data to hotels_cache so neighbourhood RPC (get_primary_nbhds_for_hotels)
  // can assign hotels to neighbourhoods. Only copies hotel_id + coords — no LiteAPI content.
  try {
    const { data: v2Hotels } = await dbFinal.from("v2_hotels_cache")
      .select("hotel_id, city, country_code, lat, lng")
      .eq("city", displayCity)
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
  await rebuildV2RoomTypesIndex(dbFinal, displayCity, { label: "final" });
  const { count: indexCount } = await dbFinal
    .from("v2_room_types_index")
    .select("*", { count: "exact", head: true })
    .eq("city", displayCity);
  console.log(`[v2-index] v2_room_types_index now has ${indexCount} rows for ${displayCity}`);
  if (!indexCount) console.error("[v2-index] WARNING: index count is 0 after rebuild — manual rebuild may be needed");

  console.log(
    `[v2-index] done: ${hotelsDone} processed, ${hotelsSkippedQuality} skipped (quality filter), ` +
    `${photosDone} photos captioned`
  );
  return {
    city: displayCity,
    hotelsDone,
    hotelsSkippedQuality,
    hotelsSkippedStarFilter,
    photosDone,
    stoppedAtCap,
    indexCap,
    totalHotels: totalHotels || 0,
    totalPhotos: totalPhotos || 0,
  };
}

/**
 * Post-cap geographic backfill — index hotels inside curated geoQuota zones
 * (e.g. Heathrow 3 mi from T5) without raising the global indexCap.
 */
async function geoBackfillCityV2(city, opts = {}) {
  if (!LITEAPI_KEY || !SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing required env vars");
  const cityCfg = resolveCityConfig(city);
  const displayCity = cityCfg.displayName;
  const cc = cityCfg.countryCode;
  const zones = listGeoQuotaFences(displayCity);
  if (!zones.length) {
    console.log(`[geo-backfill] ${displayCity}: no geoQuota fences configured`);
    return { city: displayCity, zones: [], totalIndexed: 0, totalPhotos: 0 };
  }

  const db = getDb();
  const { data: existingRows } = await db
    .from("v2_hotels_cache")
    .select("hotel_id")
    .eq("city", displayCity);
  const existing = new Set((existingRows || []).map((r) => String(r.hotel_id)));

  console.log(`[geo-backfill] ${displayCity}: loading merged catalog (full scan)…`);
  const { hotels: catalog, catalogScanned } = await fetchMergedLiteapiCatalog(cityCfg, { fullScan: true });
  console.log(`[geo-backfill] catalog=${catalog.length} rows scanned=${catalogScanned} already_indexed=${existing.size}`);

  const zoneResults = [];
  let totalIndexed = 0;
  let totalPhotos = 0;
  let totalSkippedQuality = 0;

  for (const zone of zones) {
    const quota = Math.max(1, Number(opts.quotaOverride ?? zone.geoQuota) || 50);
    const candidates = catalog.filter((h) => {
      const id = String(h.id);
      if (existing.has(id)) return false;
      if (!passesCatalogFilter(h, cityCfg)) return false;
      const { lat, lng } = hotelListLatLng(h);
      return isInGeoZone(lat, lng, zone);
    });
    candidates.sort(
      (a, b) => Number(b.rating ?? b.guestRating ?? 0) - Number(a.rating ?? a.guestRating ?? 0)
        || Number(b.stars ?? b.starRating ?? 0) - Number(a.stars ?? a.starRating ?? 0),
    );

    console.log(
      `[geo-backfill] ${zone.hoodName}: candidates=${candidates.length} quota=${quota} ` +
      `(radius=${zone.geoRadiusMi}mi from ${zone.geoAnchor.lat},${zone.geoAnchor.lng})`,
    );

    let indexed = 0;
    let skippedQuality = 0;
    let photosAdded = 0;
    const geoQuality = zone.airportQuality
      ? {
        geoAnchor: zone.geoAnchor,
        geoRadiusMi: zone.geoRadiusMi,
        minHotelImages: zone.minHotelImages || 6,
      }
      : null;

    for (const hotel of candidates) {
      if (indexed >= quota) break;
      const result = await processOneHotel(db, {
        hotel,
        city: displayCity,
        cc,
        minRoomPhotos: cityCfg.minRoomPhotos,
        geoQuality,
      });
      if (result.indexed) {
        indexed++;
        photosAdded += result.photosAdded;
        existing.add(String(hotel.id));
        console.log(`[geo-backfill]   + ${hotel.id} ${(hotel.name || "").slice(0, 50)} (${result.photosAdded} photos)`);
      } else if (result.skippedQuality) {
        skippedQuality++;
      }
    }

    totalIndexed += indexed;
    totalPhotos += photosAdded;
    totalSkippedQuality += skippedQuality;
    zoneResults.push({
      hoodName: zone.hoodName,
      candidates: candidates.length,
      quota,
      indexed,
      skippedQuality,
      photosAdded,
    });
    console.log(`[geo-backfill] ${zone.hoodName}: indexed=${indexed}/${quota} skip_quality=${skippedQuality}`);
  }

  if (totalIndexed > 0) {
    await rebuildV2RoomTypesIndex(db, displayCity, { label: "geo-backfill" });
  }

  return {
    city: displayCity,
    zones: zoneResults,
    totalIndexed,
    totalPhotos,
    totalSkippedQuality,
  };
}

/** @type {Map<string, Promise<unknown>>} */
const _reindexJobs = new Map();

function isV2ReindexActive(city) {
  const cfg = resolveCityConfig(city);
  return _reindexJobs.has(cfg.displayName) || _reindexJobs.has(String(city || "").trim());
}

async function reindexCityV2Guarded(city, limit, forceRebuild, opts = {}) {
  const cfg = resolveCityConfig(city);
  const key = cfg.displayName;
  const inFlight = _reindexJobs.get(key);
  if (inFlight) {
    console.log(`[v2-index] ${key}: joined in-flight reindex`);
    return inFlight;
  }
  const job = reindexCityV2(city, limit, forceRebuild, opts)
    .catch(async (e) => {
      try {
        const db = getDb();
        await db.from("v2_indexed_cities").update({
          status: "failed",
          last_error: e.message,
          updated_at: new Date().toISOString(),
        }).eq("city", key);
      } catch (_) { /* ignore */ }
      throw e;
    })
    .finally(() => {
      _reindexJobs.delete(key);
    });
  _reindexJobs.set(key, job);
  return job;
}

module.exports = {
  reindexCityV2: reindexCityV2Guarded,
  isV2ReindexActive,
  _reindexJobs,
  fetchAndSortCatalog,
  fetchMergedLiteapiCatalog,
  geoBackfillCityV2,
  rebuildV2RoomTypesIndex,
};
