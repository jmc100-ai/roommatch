#!/usr/bin/env node
/**
 * RoomMatch — scripts/index-city.js
 * Batch ingestion: fetch hotels → caption room photos → embed → store in Supabase
 *
 * Triggered via: POST /api/index-city { city, limit }
 * Or locally:    node scripts/index-city.js --city Paris --limit 200
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { extractFactsFromSignals } = require("./fact-catalog");

const LITEAPI_KEY  = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY   = process.env.GEMINI_KEY  || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const MAX_PHOTOS         = 15; // per room type (5 bathroom + 10 other)
const BATCH_SIZE         = 20; // concurrent hotel detail fetches
const PHOTO_CONCURRENCY  = 5;  // concurrent Gemini calls per hotel
const DB_CONCURRENCY     = 3;  // max concurrent DB upserts — keeps connection pool safe

// Simple semaphore to cap concurrent DB writes
let dbSlots = DB_CONCURRENCY;
const dbQueue = [];
function acquireDb() {
  return new Promise(resolve => {
    if (dbSlots > 0) { dbSlots--; resolve(); }
    else dbQueue.push(resolve);
  });
}
function releaseDb() {
  if (dbQueue.length > 0) { dbQueue.shift()(); }
  else dbSlots++;
}

// Supabase client created lazily — avoids killing the server if env vars
// are momentarily missing at module load time (process.exit at module scope
// would take down the entire Express server that require()s this file).
let supabase = null;
function getSupabase() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("[indexer] SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

const COUNTRY_CODES = {
  "paris":"FR","nice":"FR","lyon":"FR","marseille":"FR","bordeaux":"FR",
  "london":"GB","edinburgh":"GB","manchester":"GB","liverpool":"GB",
  "barcelona":"ES","madrid":"ES","seville":"ES","valencia":"ES",
  "rome":"IT","milan":"IT","florence":"IT","venice":"IT","naples":"IT",
  "amsterdam":"NL","rotterdam":"NL",
  "berlin":"DE","munich":"DE","hamburg":"DE","frankfurt":"DE","cologne":"DE",
  "vienna":"AT","salzburg":"AT","zurich":"CH","geneva":"CH","bern":"CH",
  "brussels":"BE","bruges":"BE","prague":"CZ","budapest":"HU",
  "warsaw":"PL","krakow":"PL","athens":"GR","lisbon":"PT","porto":"PT",
  "oslo":"NO","stockholm":"SE","copenhagen":"DK","helsinki":"FI","dublin":"IE",
  "istanbul":"TR","reykjavik":"IS",
  "new york city":"US","new york":"US","nyc":"US","los angeles":"US",
  "chicago":"US","miami":"US","san francisco":"US","las vegas":"US",
  "seattle":"US","boston":"US","washington dc":"US","austin":"US",
  "denver":"US","nashville":"US","atlanta":"US","dallas":"US","houston":"US",
  "new orleans":"US","tacoma":"US","portland":"US","san diego":"US",
  "toronto":"CA","vancouver":"CA","montreal":"CA",
  "mexico city":"MX","cancun":"MX","tulum":"MX",
  "rio de janeiro":"BR","sao paulo":"BR","buenos aires":"AR",
  "bogota":"CO","lima":"PE","santiago":"CL",
  "tokyo":"JP","osaka":"JP","kyoto":"JP","seoul":"KR",
  "beijing":"CN","shanghai":"CN","hong kong":"HK","taipei":"TW",
  "singapore":"SG","kuala lumpur":"MY","bangkok":"TH","phuket":"TH",
  "bali":"ID","jakarta":"ID","hanoi":"VN","ho chi minh city":"VN",
  "mumbai":"IN","delhi":"IN","bangalore":"IN","goa":"IN",
  "dubai":"AE","abu dhabi":"AE","doha":"QA",
  "tel aviv":"IL","cairo":"EG","marrakech":"MA",
  "cape town":"ZA","nairobi":"KE",
  "sydney":"AU","melbourne":"AU","auckland":"NZ","queenstown":"NZ",
};

// Extracts the structural feature fields from a hybrid caption, dropping the irrelevant
// visual-style sections (VIEWS & LIGHT, SPACE & LAYOUT, FLOORING & DECOR, FURNITURE)
// and the Room type metadata line. Keeps PHOTO TYPE header + BATHROOM + BEDROOM +
// NOTABLE FEATURES — the only fields needed for structural penalty detection at search time.
// Produces a focused feature summary from a structured caption.
// Keeps only POSITIVE/PRESENT values — filters out "no", "unknown", "none",
// "no X visible", and "not visible". Drops FLOORING & DECOR entirely (wall
// colours, styles) since those are aesthetic noise for feature queries.
// This shorter, signal-dense text produces much better cosine similarity for
// specific feature queries like "double sinks" or "soaking tub".
// photoType-aware: each photo type only embeds its own relevant sections so
// the resulting vector isn't diluted by unrelated fields.
// Must stay in sync with extractFeatureSummary() in server.js.
function extractFeatureSummary(caption, photoType = null) {
  if (!caption) return null;

  const PHOTO_TYPE_SKIP = {
    'bathroom':    ['BEDROOM', 'FURNITURE'],
    'bedroom':     ['BATHROOM'],
    'living area': ['BATHROOM', 'BEDROOM'],
    'view':        ['BATHROOM', 'BEDROOM', 'FURNITURE', 'NOTABLE FEATURES'],
  };
  const skipExtra = photoType ? (PHOTO_TYPE_SKIP[photoType] || []) : [];
  const SKIP_SECTIONS = new Set(['FLOORING & DECOR', ...skipExtra]);
  // Values that carry no useful signal for feature matching
  const SKIP_VALUES = new Set(['no', 'none', 'unknown', 'standard', 'standard ceiling', 'moderate light']);

  const lines = caption.split('\n');
  const kept  = [];
  let skipSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Section header: all-caps label ending with ":" and nothing after (e.g. "BATHROOM:")
    const secMatch = line.match(/^([A-Z][A-Z &]+):$/);
    if (secMatch) {
      skipSection = SKIP_SECTIONS.has(secMatch[1]);
      continue; // never include section header labels in output
    }
    if (skipSection) continue;

    // Always keep the header line that identifies photo type + room
    if (line.startsWith('PHOTO TYPE:') && line.includes('|')) { kept.push(line); continue; }

    // Keep room metadata line
    if (line.startsWith('Room type:')) { kept.push(line); continue; }

    // For key: value field lines, strip out negatives / unknowns
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const value = line.slice(colonIdx + 1).trim().toLowerCase();
      if (!value) continue;
      if (SKIP_VALUES.has(value)) continue;
      if (value.startsWith('no ')) continue;      // "no bathtub", "no bed visible"
      if (value.includes('not visible')) continue; // "no view visible"
      // Normalise vocabulary to match common user query terms so embeddings
      // land close to user queries (e.g. users say "double sinks", Gemini says "two sinks").
      const normalised = line
        .replace(/:\s*two sinks\b/i,       ': double sinks')
        .replace(/:\s*one sink\b/i,        ': single sink')
        .replace(/:\s*three sinks\b/i,     ': triple sinks')
        .replace(/:\s*shower over bath\b/i,': shower over bath, rainfall shower');
      kept.push(normalised);
    }
  }

  return kept.length > 1 ? kept.join('\n') : null;
}

// Must stay in sync with extractFeatureFlags() in server.js.
function extractFeatureFlags(featureSummary) {
  if (!featureSummary) return {};
  const f = featureSummary;
  const flags = {};

  // Bathroom
  if (/^SINKS:\s*double sinks/im.test(f))                                              flags.double_sinks = true;
  if (/^BATHTUB:/im.test(f))                                                           flags.bathtub = true;
  if (/^BATHTUB:\s*soaking tub/im.test(f))                                            flags.soaking_tub = true;
  if (/^BATHTUB:\s*clawfoot/im.test(f))                                               flags.clawfoot_tub = true;
  if (/^SHOWER:\s*walk-in shower/im.test(f))                                          flags.walk_in_shower = true;
  if (/^SHOWER:.*rainfall shower/im.test(f) ||
      /^DISTINCTIVE FEATURES:.*rainfall shower/im.test(f))                            flags.rainfall_shower = true;
  if (/^IN-ROOM HOT TUB OR JACUZZI:\s*yes/im.test(f) ||
      /^BATHTUB:\s*(?:jacuzzi|hot tub)/im.test(f))                                    flags.in_room_jacuzzi = true;
  if (/^BIDET:\s*yes/im.test(f))                                                      flags.bidet = true;
  if (/^SEPARATE TOILET ROOM:\s*yes/im.test(f))                                       flags.separate_toilet_room = true;
  if (/^DESK:\s*(?:small|large) desk/im.test(f))                                      flags.work_desk = true;

  // Bedroom / Closet
  if (/^BED:.*\bking\b/im.test(f))                                                    flags.king_bed = true;
  if (/^BED:.*four[- ]poster/im.test(f))                                              flags.four_poster_bed = true;
  if (/^BED:.*\btwins?\b/im.test(f))                                                  flags.twin_beds = true;
  if (/^WALK-IN CLOSET:\s*yes/im.test(f))                                             flags.walk_in_closet = true;

  // Space
  if (/^SEPARATE LIVING AREA:\s*yes/im.test(f))                                       flags.separate_living_area = true;
  if (/^CEILING HEIGHT:\s*(?:high ceilings|vaulted ceiling)/im.test(f))              flags.high_ceilings = true;
  if (/^WINDOWS:\s*floor-to-ceiling windows/im.test(f))                              flags.floor_to_ceiling_windows = true;

  // Outdoor
  if (/^BALCONY OR TERRACE:\s*yes/im.test(f))                                        flags.balcony = true;
  if (/^DISTINCTIVE FEATURES:.*\bterrace\b/im.test(f))                               flags.terrace = true;

  // Views
  if (/^VIEW:\s*city view/im.test(f))                                                 flags.city_view = true;
  if (/^VIEW:\s*(?:Eiffel Tower|landmark|Big Ben|Tower Bridge|Empire State|monument)/im.test(f)) flags.landmark_view = true;
  if (/^VIEW:\s*garden view/im.test(f))                                               flags.garden_view = true;
  if (/^VIEW:\s*(?:river view|seine|thames|hudson|canal view)/im.test(f))             flags.river_view = true;
  if (/^VIEW:\s*courtyard view/im.test(f))                                            flags.courtyard_view = true;
  if (/^VIEW:\s*pool view/im.test(f))                                                 flags.pool_view = true;
  if (/^VIEW:\s*(?:sea view|ocean view)/im.test(f))                                   flags.sea_view = true;
  if (/^VIEW:\s*mountain view/im.test(f))                                             flags.mountain_view = true;

  // Features
  if (/^FIREPLACE:\s*yes/im.test(f))                                                  flags.fireplace = true;
  if (/^DISTINCTIVE FEATURES:.*\bprivate pool\b/im.test(f))                          flags.private_pool = true;
  if (/^SOFA:\s*yes/im.test(f))                                                       flags.sofa = true;
  if (/^CHAISE LOUNGE:\s*yes/im.test(f))                                              flags.chaise_lounge = true;
  if (/^DINING TABLE:\s*yes/im.test(f))                                               flags.dining_table = true;

  return flags;
}

async function upsertRoomFacts(db, base, factRows) {
  if (!Array.isArray(factRows) || factRows.length === 0) return;
  const payload = factRows.map((r) => ({
    hotel_id: base.hotel_id,
    room_type_id: base.room_type_id,
    city: base.city,
    country_code: base.country_code || null,
    fact_key: r.fact_key,
    fact_value: r.fact_value,
    confidence: r.confidence,
    source: r.source || "vision",
    supplier_value: null,
    vision_value: r.fact_value,
    supplier_confidence: null,
    vision_confidence: r.confidence,
    extractor_version: "facts-v2-1",
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from("room_feature_facts").upsert(payload, {
    onConflict: "hotel_id,room_type_id,fact_key",
  });
  if (error) {
    // Non-fatal while migration is rolling out.
    console.warn(`[facts] upsert skipped: ${error.message}`);
  }
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Caption (vision): 500 req/min ceiling to leave headroom
let _capCount = 0, _capWindow = Date.now();
async function captionThrottle() {
  const now = Date.now();
  if (now - _capWindow > 60000) { _capCount = 0; _capWindow = now; }
  if (_capCount >= 500) {
    const wait = 62000 - (now - _capWindow);
    console.log(`  [rate] caption limit, pausing ${Math.round(wait/1000)}s...`);
    await new Promise(r => setTimeout(r, wait));
    _capCount = 0; _capWindow = Date.now();
  }
  _capCount++;
}

// Embed: 1000 req/min ceiling
let _embedCount = 0, _embedWindow = Date.now();
async function embedThrottle() {
  const now = Date.now();
  if (now - _embedWindow > 60000) { _embedCount = 0; _embedWindow = now; }
  if (_embedCount >= 1000) {
    const wait = 62000 - (now - _embedWindow);
    console.log(`  [rate] embed limit, pausing ${Math.round(wait/1000)}s...`);
    await new Promise(r => setTimeout(r, wait));
    _embedCount = 0; _embedWindow = Date.now();
  }
  _embedCount++;
}

// Keep geminiThrottle as alias for caption (used in geminiCaption)
const geminiThrottle = captionThrottle;

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

async function geminiCaption(imageUrl, photoContext = {}, retries = 3) {
  try {
    await geminiThrottle();
    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) return null;
    const b64  = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    const { roomName = "hotel room" } = photoContext;

    const prompt = `You are analyzing a hotel room photo for a search index. The photo is from a room called "${roomName}".

First identify what type of photo this is, then answer ALL items below based ONLY on what you can clearly see. Write "unknown" if you cannot clearly see something. Do not guess.

IMPORTANT: For search-critical fields — SINKS count, BATHTUB type, BALCONY, FIREPLACE, WINDOWS size — be conservative. Only report a specific value when you are confident. If the photo angle, framing, or lighting leaves any doubt, use "unknown". A wrong value here is worse than "unknown".

PHOTO TYPE: (bedroom / bathroom / living area / view / other)

BATHROOM:
SINKS: (no sink visible / one sink / two sinks / three or more sinks) — only use "two sinks" or higher if you can clearly count distinct, separate sink basins; if the framing or angle makes the count uncertain, use "unknown"
COUNTER SPACE: (no counter / small counter / large counter / very large counter)
BATHTUB: (no bathtub / soaking tub / freestanding tub / clawfoot tub / built-in tub / hot tub / jacuzzi) — only use a specific type if the bathtub shape is clearly visible
SHOWER: (no shower / walk-in shower / rainfall shower / steam shower / shower over bath)
BIDET: (yes / no)
SEPARATE TOILET ROOM: (yes / no)

BEDROOM:
BED: (king bed / queen bed / twin beds / bunk beds / four-poster bed / canopy bed / no bed visible)
WALK-IN CLOSET: (yes / no)

VIEWS & LIGHT:
NATURAL LIGHT: (bright natural light / moderate light / dark room)
WINDOWS: (floor-to-ceiling windows / large windows / small windows / no windows visible)
VIEW: (city view / ocean view / garden view / pool view / mountain view / no view visible / or specific e.g. Eiffel Tower view)
BALCONY OR TERRACE: (yes / no)

SPACE & LAYOUT:
SIZE IMPRESSION: (very spacious / spacious / standard / small / cosy)
CEILING HEIGHT: (very high ceilings / high ceilings / standard ceiling)
SEPARATE LIVING AREA: (yes / no)

FLOORING & DECOR:
FLOORING: describe material and colour (e.g. white marble / dark hardwood / light hardwood / beige carpet / grey tile)
WALL COLOUR: (white / cream / grey / dark / navy / green / exposed brick / or describe)
STYLE 1: (Modern / Contemporary / Classic / Traditional / Luxury / Opulent / Minimalist / Boutique / Eclectic / Art Deco / Mid-Century Modern / Scandinavian / Nordic / Industrial / Rustic / Farmhouse / Mediterranean / Asian / Zen / Baroque / Ornate)
STYLE 2: (same options / none)
COLOR MOOD: (light and airy / warm and cosy / dark and moody / bright and colorful)

FURNITURE:
SOFA: (yes / no)
ARMCHAIR: (yes / no)
CHAISE LOUNGE: (yes / no)
DESK: (no desk / small desk / large desk)
DINING TABLE: (yes / no)

NOTABLE FEATURES:
FIREPLACE: (yes / no)
COFFEE MACHINE: (yes / no)
TV: (yes / no)
IN-ROOM HOT TUB OR JACUZZI: (yes / no)
DISTINCTIVE FEATURES: list any other notable details visible or write "none"

Reply with ONLY the filled-in list above. No extra commentary.`;

    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: prompt }
          ]}],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    const rawText = await gr.text();
    if (!gr.ok) {
      if ((gr.status === 503 || gr.status === 429) && retries > 0) {
        const wait = Math.pow(2, 4 - retries) * 2000; // 4s, 8s, 16s exponential
        console.warn(`  [gemini] ${gr.status} — retrying in ${wait/1000}s (${retries} left)`);
        await new Promise(r => setTimeout(r, wait));
        return geminiCaption(imageUrl, photoContext, retries - 1);
      }
      console.warn(`  [gemini] caption ${gr.status}: ${rawText.slice(0,200)}`);
      return null;
    }

    let gd;
    try { gd = JSON.parse(rawText); }
    catch(e) { console.warn(`  [gemini] JSON parse failed: ${rawText.slice(0,100)}`); return null; }

    // Log full response structure on first call to diagnose issues
    if (!geminiCaption._logged) {
      geminiCaption._logged = true;
      console.log(`  [gemini] sample response keys: ${Object.keys(gd).join(', ')}`);
      console.log(`  [gemini] candidates[0] keys: ${Object.keys(gd?.candidates?.[0] || {}).join(', ')}`);
      console.log(`  [gemini] finish reason: ${gd?.candidates?.[0]?.finishReason}`);
      console.log(`  [gemini] parts: ${JSON.stringify(gd?.candidates?.[0]?.content?.parts?.map(p => Object.keys(p)))}`);
    }

    const caption = gd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!caption) {
      const reason = gd?.candidates?.[0]?.finishReason || 'unknown';
      console.warn(`  [gemini] empty caption, finishReason: ${reason}`);
    }
    return caption || null;
  } catch(e) {
    console.warn(`  [gemini] caption error: ${e.message}`);
    return null;
  }
}

async function geminiEmbed(text) {
  try {
    await embedThrottle();
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const raw = await r.text();
    if (!r.ok) {
      console.warn(`  [embed] HTTP ${r.status}: ${raw.slice(0, 200)}`);
      return null;
    }
    let d;
    try { d = JSON.parse(raw); } catch(e) {
      console.warn(`  [embed] JSON parse failed: ${raw.slice(0, 100)}`);
      return null;
    }
    const values = d?.embedding?.values;
    if (!values) {
      console.warn(`  [embed] no values in response, keys: ${Object.keys(d).join(', ')}`);
      return null;
    }
    // Truncate to 768 dims — pgvector indexes cap at 2000, Matryoshka truncation is valid
    return values.slice(0, 768);
  } catch(e) {
    console.warn(`  [embed] exception: ${e.message}`);
    return null;
  }
}

// Hotel-level amenity photo types — distinct from room photo_types.
// Must stay in sync with rebuild_hotel_profile_index_city() photo_type filter.
const AMENITY_PHOTO_TYPES = ['lobby', 'bar', 'restaurant', 'pool', 'spa', 'exterior', 'fitness'];

// Heuristic classifier for hotel-level amenity photos based on LiteAPI caption
// + imageClass* metadata. Returns one of AMENITY_PHOTO_TYPES or null (skip).
// Gemini confirms/overrides this at caption time.
function classifyAmenityPhoto(photo) {
  const desc = [
    photo.imageDescription || "", photo.imageClass1 || "", photo.imageClass2 || "",
    photo.tag || "", photo.category || "", photo.caption || "",
    photo.type || "", photo.label || "",
  ].join(" ").toLowerCase();
  if (/lobby|reception|entrance|concierge|foyer/.test(desc))       return 'lobby';
  if (/bar|lounge(?! chair)|cocktail|drinks/.test(desc))           return 'bar';
  if (/restaurant|dining|breakfast|buffet|meal|food/.test(desc))   return 'restaurant';
  if (/pool|swim/.test(desc))                                      return 'pool';
  if (/spa|sauna|hammam|wellness|steam room/.test(desc))           return 'spa';
  if (/gym|fitness|workout/.test(desc))                            return 'fitness';
  if (/exterior|facade|facade|entrance|building|outside|terrace\b|courtyard/.test(desc)) return 'exterior';
  return null; // skip — too ambiguous to embed as a hotel-level vibe signal
}

// Caption an amenity (hotel-level) photo. Uses a shorter prompt focused on
// atmosphere + style (not room-feature checklists). Returns { caption, type }
// where `type` is the Gemini-confirmed amenity type.
async function geminiCaptionAmenity(imageUrl, hintType, retries = 3) {
  try {
    await captionThrottle();
    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) return null;
    const b64  = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    const hintLine = hintType
      ? `LiteAPI metadata suggests this is a hotel ${hintType} photo (use this as a hint, but correct the TYPE field if you see something else).`
      : `LiteAPI metadata did not classify this photo.`;

    const prompt = `You are analyzing a HOTEL-LEVEL (not room-level) photo — lobby, bar, restaurant, pool, spa, exterior, or fitness centre. ${hintLine}

Return ONLY the filled-in list below. No commentary.

TYPE: (lobby / bar / restaurant / pool / spa / exterior / fitness / other)
VIBE: 3-5 adjectives that capture the atmosphere (e.g. "polished modern minimalist" or "opulent baroque gilded" or "casual airy tropical")
STYLE: (Modern / Contemporary / Classic / Traditional / Luxury / Opulent / Minimalist / Boutique / Eclectic / Art Deco / Mid-Century / Scandinavian / Industrial / Rustic / Mediterranean / Asian / Zen / Baroque / Ornate / Tropical)
MATERIALS: key materials visible (e.g. "marble, brass, velvet" or "concrete, steel, wood")
COLOR MOOD: (light and airy / warm and cosy / dark and moody / bright and colorful / monochrome)
NOTABLE: any standout feature (e.g. "grand chandelier", "rooftop terrace", "infinity pool", "fireplace"). Write "none" if nothing stands out.`;

    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: prompt }
          ]}],
          generationConfig: { maxOutputTokens: 200, temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(25000),
      }
    );
    const rawText = await gr.text();
    if (!gr.ok) {
      if ((gr.status === 503 || gr.status === 429) && retries > 0) {
        const wait = Math.pow(2, 4 - retries) * 2000;
        console.warn(`  [gemini·amenity] ${gr.status} — retrying in ${wait/1000}s (${retries} left)`);
        await new Promise(r => setTimeout(r, wait));
        return geminiCaptionAmenity(imageUrl, hintType, retries - 1);
      }
      console.warn(`  [gemini·amenity] ${gr.status}: ${rawText.slice(0,200)}`);
      return null;
    }
    let gd;
    try { gd = JSON.parse(rawText); }
    catch(e) { console.warn(`  [gemini·amenity] JSON parse failed: ${rawText.slice(0,100)}`); return null; }

    const caption = gd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!caption) return null;

    // Extract Gemini-confirmed type. Fall back to hint if parse fails.
    const typeMatch = caption.match(/TYPE:\s*([a-z ]+)/i)?.[1]?.trim().toLowerCase() || "";
    const confirmed = AMENITY_PHOTO_TYPES.find(t => typeMatch.includes(t));
    const finalType = confirmed || hintType || 'other';
    return { caption, type: finalType };
  } catch(e) {
    console.warn(`  [gemini·amenity] error: ${e.message}`);
    return null;
  }
}

// Process one hotel's amenity photos + description. Shared between the main
// indexer's per-hotel loop and the 'amenity_only' backfill mode.
async function processHotelAmenities({ db, hotelId, hotelName, city, cc, detail, stars, rating }) {
  // 1. Collect amenity photos (up to 10 per hotel).
  const mainPhotoUrl = detail.main_photo || detail.mainPhoto || "";
  const rawHotelPhotos = [
    ...(detail.hotelImages || []),
    ...(detail.photos      || []),
    ...(detail.images      || []),
    ...(detail.gallery     || []),
    ...(detail.hotelPhotos || []),
  ];

  // Normalise to [{ url, ...rawMeta }] and dedupe by URL
  const seenUrls = new Set();
  const photoObjs = [];
  for (const p of rawHotelPhotos) {
    const url = typeof p === 'string' ? p : (p?.urlHd || p?.url || p?.hd_url || p?.imageUrl || "");
    if (!url || seenUrls.has(url)) continue;
    if (url === mainPhotoUrl) continue;
    seenUrls.add(url);
    photoObjs.push(typeof p === 'string' ? { url } : { ...p, url });
    if (photoObjs.length >= 12) break;
  }

  // 2. Classify — skip photos we can't confidently bucket (too ambiguous).
  //    Gemini may still re-classify below; the hint helps.
  const candidates = [];
  for (const p of photoObjs) {
    const hint = classifyAmenityPhoto(p);
    candidates.push({ url: p.url, hint });
    if (candidates.length >= 10) break;
  }
  if (!candidates.length) return { amenityCount: 0, descEmbedded: false };

  // 3. Skip already-indexed amenity photos (idempotent re-runs)
  const { data: existing } = await db
    .from("room_embeddings")
    .select("photo_url")
    .eq("hotel_id", hotelId)
    .in("photo_url", candidates.map(c => c.url));
  const seenUrls2 = new Set((existing || []).map(e => e.photo_url));
  const fresh = candidates.filter(c => !seenUrls2.has(c.url));

  // 4. Caption + embed + upsert each fresh amenity photo.
  let amenityCount = 0;
  for (let i = 0; i < fresh.length; i += PHOTO_CONCURRENCY) {
    const chunk = fresh.slice(i, i + PHOTO_CONCURRENCY);
    await Promise.all(chunk.map(async (p) => {
      const cap = await geminiCaptionAmenity(p.url, p.hint);
      if (!cap) return;
      const embedText = `AMENITY TYPE: ${cap.type}\n${cap.caption}`;
      const embedding = await geminiEmbed(embedText);
      if (!embedding) return;
      await acquireDb();
      try {
        const { error } = await db.from("room_embeddings").upsert({
          hotel_id: hotelId, city, country_code: cc,
          hotel_name: hotelName,
          room_name: null,
          room_type_id: null,
          photo_url: p.url,
          photo_type: cap.type,    // lobby / bar / pool / ...
          caption: embedText,
          feature_summary: null,   // amenity photos don't populate room-level flags
          feature_flags: {},
          embedding,
          feature_embedding: embedding,  // same vector — blended vs room logic is handled upstream
          star_rating: stars, guest_rating: rating,
        }, { onConflict: "hotel_id,photo_url" });
        if (!error) amenityCount++;
        else console.warn(`  [amenity·db] ${error.message}`);
      } finally {
        releaseDb();
      }
    }));
  }

  // 5. Description + description_embedding (one per hotel)
  const desc = (detail.description || detail.hotelDescription || "").trim();
  let descEmbedded = false;
  if (desc) {
    // Only re-embed if description changed or embedding missing
    const { data: existingHotel } = await db
      .from("hotels_cache")
      .select("description, description_embedding")
      .eq("hotel_id", hotelId)
      .single();
    const needsEmbed = !existingHotel?.description_embedding || existingHotel?.description !== desc;
    if (needsEmbed) {
      const truncated = desc.slice(0, 2000); // cap on prompt size
      const descVec = await geminiEmbed(truncated);
      if (descVec) {
        await acquireDb();
        try {
          const { error } = await db.from("hotels_cache").update({
            description: truncated,
            description_embedding: descVec,
            cached_at: new Date().toISOString(),
          }).eq("hotel_id", hotelId);
          if (!error) descEmbedded = true;
        } finally {
          releaseDb();
        }
      }
    }
  }

  return { amenityCount, descEmbedded };
}

function classifyPhoto(photo, roomName, photoIndex = 0) {
  // Check all available LiteAPI metadata fields
  const desc = [
    photo.imageDescription || "",
    photo.imageClass1      || "",
    photo.imageClass2      || "",
    photo.tag              || "",
    photo.category         || "",
    photo.caption          || "",
    photo.type             || "",
    photo.label            || "",
    roomName               || "",
  ].join(" ").toLowerCase();

  // Strong keyword matches first
  if (/bath|shower|sink|toilet|vanity|wc|jacuzzi|tub|sauna/.test(desc)) return "bathroom";
  if (/bed|sleep|pillow|duvet|headboard|bedroom/.test(desc))              return "bedroom";
  if (/living|lounge|sofa|sitting|couch/.test(desc))                      return "living";
  if (/view|balcony|terrace|panoram/.test(desc))                          return "view";

  // Fallback: use photo index position within a room type
  // LiteAPI typically orders: main room first, bathroom later
  // Photos at index 0-1 are usually bedroom/main, 2+ may be bathroom
  // We intentionally return "other" so both bedroom + bathroom get selected
  return "other";
}

// ── Main export (called from server.js) and CLI entry point ───────────────────
async function indexCity(city, limit = 200) {
  if (!LITEAPI_KEY || !GEMINI_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    const missing = [
      !LITEAPI_KEY && 'LITEAPI_PROD_KEY',
      !GEMINI_KEY  && 'GEMINI_KEY',
      !SUPABASE_URL && 'SUPABASE_URL',
      !SUPABASE_KEY && 'SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY)',
    ].filter(Boolean).join(', ');
    throw new Error(`[indexer] Missing required env vars: ${missing}`);
  }
  console.log(`[indexer] Using ${process.env.SUPABASE_SERVICE_KEY ? 'service' : 'anon'} key for Supabase`);
  const db = getSupabase();
  const cc = COUNTRY_CODES[city.toLowerCase()] || "";
  console.log(`\n[indexer] Starting: ${city} (${cc}) — limit ${limit}`);

  // Mark as indexing — reset stop_requested flag
  await db.from("indexed_cities").upsert({
    city, country_code: cc, status: "indexing",
    hotel_count: 0, photo_count: 0,
    stop_requested: false,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "city" });

  // Fetch hotel list
  const params = new URLSearchParams({ limit });
  if (cc) { params.set("countryCode", cc); params.set("cityName", city); }
  else    { params.set("city", city); }

  const hotelsRes = await liteGet(`/data/hotels?${params}`);
  if (!hotelsRes.ok) throw new Error(`LiteAPI hotels failed: ${hotelsRes.status}`);

  const hotels = (hotelsRes.data?.data || [])
    .sort((a,b) => (b.starRating||0) - (a.starRating||0)); // best hotels first

  console.log(`[indexer] ${hotels.length} hotels fetched`);

  let hotelsDone = 0, totalEmbeds = 0;

  // Process in batches
  for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
    const batch = hotels.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (hotel) => {
      const hotelId   = hotel.id || hotel.hotelId;
      const hotelName = hotel.name || "Hotel";
      const stars     = hotel.starRating || hotel.stars || 0;
      const rating    = hotel.rating || hotel.guestRating || 0;

      // Fetch room detail
      const detailRes = await liteGet(`/data/hotel?hotelId=${hotelId}`);
      if (!detailRes.ok) { hotelsDone++; return; }
      const detail = detailRes.data?.data || {};

      // Cache hotel (lat/lng: try LiteAPI location fields, fallback handled in backfill-latlng.js)
      const hotelLat = detail.location?.latitude ?? detail.location?.lat ?? detail.latitude ?? detail.lat ?? null;
      const hotelLng = detail.location?.longitude ?? detail.location?.lng ?? detail.longitude ?? detail.lng ?? null;

      // Capture hotel-level gallery photos (exterior, lobby, bar, pool etc.) — Option B.
      // LiteAPI returns these in various top-level fields depending on API version.
      // We try every known field name and deduplicate. These are NOT room photos.
      const mainPhotoUrl = detail.main_photo || detail.mainPhoto || "";
      // hotelImages is the confirmed LiteAPI field (url/urlHd/caption/order/defaultImage).
      // Fallback fields tried in case the response shape varies across API versions.
      const rawHotelPhotos = [
        ...(detail.hotelImages   || []),
        ...(detail.photos        || []),
        ...(detail.images        || []),
        ...(detail.gallery       || []),
        ...(detail.hotelPhotos   || []),
      ];
      const hotelPhotos = rawHotelPhotos
        .map(p => (typeof p === "string" ? p : p?.urlHd || p?.url || p?.hd_url || p?.imageUrl || ""))
        .filter(Boolean)
        .filter(u => u !== mainPhotoUrl)   // don't duplicate main photo
        .slice(0, 8);                      // store up to 8 hotel-level photos

      await db.from("hotels_cache").upsert({
        hotel_id: hotelId, city, country_code: cc,
        name: detail.name || hotelName,
        address: detail.address || "",
        star_rating: stars, guest_rating: rating,
        main_photo: mainPhotoUrl,
        hotel_photos: hotelPhotos,
        lat: hotelLat,
        lng: hotelLng,
        cached_at: new Date().toISOString(),
      }, { onConflict: "hotel_id" });

      // Collect photos per room type, capturing the LiteAPI room type ID for exact rate matching
      const roomMap = new Map();
      for (const room of (detail.rooms || [])) {
        const rName  = room.roomName || room.name || "Room";
        const rId    = room.id || room.roomId || room.roomTypeId || null;
        if (!roomMap.has(rName)) roomMap.set(rName, { bathroom: [], other: [], roomTypeId: rId, meta: {
          size:      room.roomSizeSquare ? `${room.roomSizeSquare}${room.roomSizeUnit||'sqm'}` : null,
          beds:      (room.bedTypes||[]).map(b=>`${b.quantity}x ${b.bedType}`).join(', ') || null,
          amenities: (room.roomAmenities||[]).slice(0,10).map(a=>a.name).filter(Boolean),
        }});
        const bucket = roomMap.get(rName);
        for (const photo of (room.photos || [])) {
          const url = photo.url || photo.hd_url || "";
          if (!url) continue;
          const type = classifyPhoto(photo, rName);
          if (type === "bathroom") bucket.bathroom.push({ url, type });
          else bucket.other.push({ url, type });
        }
      }

      // Select up to MAX_PHOTOS per room type, hard cap 90 per hotel
      if (!roomMap.size) { console.log(`  [hotel] ${hotelName.slice(0,30)}: no rooms found`); hotelsDone++; return; }
      const toProcess = [];
      for (const [rName, buckets] of roomMap) {
        if (toProcess.length >= 90) break;   // hard cap: max 90 photos per hotel
        const selected = [
          ...buckets.bathroom.slice(0, 5),   // up to 5 bathroom photos
          ...buckets.other.slice(0, 10),     // up to 10 other photos
        ].slice(0, MAX_PHOTOS);
        for (const p of selected) {
          if (toProcess.length >= 60) break;
          toProcess.push({ roomName: rName, roomTypeId: buckets.roomTypeId, meta: buckets.meta, ...p });
        }
      }

      // Skip already-indexed photos
      const { data: existing } = await db
        .from("room_embeddings")
        .select("photo_url")
        .eq("hotel_id", hotelId)
        .in("photo_url", toProcess.map(p => p.url));
      const seen = new Set((existing || []).map(e => e.photo_url));
      const fresh = toProcess.filter(p => !seen.has(p.url));

      console.log(`  [hotel] ${hotelName.slice(0,30)}: ${toProcess.length} photos selected, ${fresh.length} new to process`);
      if (!fresh.length) { hotelsDone++; return; }

      // Caption + embed + store photos concurrently in chunks of PHOTO_CONCURRENCY
      let embedded = 0;
      for (let pi = 0; pi < fresh.length; pi += PHOTO_CONCURRENCY) {
        const photoChunk = fresh.slice(pi, pi + PHOTO_CONCURRENCY);
        await Promise.all(photoChunk.map(async (photo) => {
        // Step 1: Caption
        const caption = await geminiCaption(photo.url, { type: photo.type, roomName: photo.roomName });
        if (!caption) { console.warn(`  [pipeline] caption FAILED for ${photo.url.slice(-40)}`); return; }

        // Build hybrid text: structured caption + room metadata
        // This anchors the embedding with reliable metadata alongside the visual description
        const m = photo.meta || {};
        const metaParts = [
          `Room type: ${photo.roomName}`,
          m.size      ? `Size: ${m.size}` : null,
          m.beds      ? `Beds: ${m.beds}` : null,
          m.amenities?.length ? `Amenities: ${m.amenities.join(', ')}` : null,
        ].filter(Boolean).join('. ');

        // Extract first valid type — handles "bathroom / bedroom" multi-answers by taking first match
        const rawTypeStr = (caption.match(/PHOTO TYPE:\s*([^\n\r]+)/i)?.[1] || "").trim().toLowerCase();
        const validTypes = ["bathroom", "living area", "bedroom", "view", "other"];
        const detectedType = validTypes.find(t => rawTypeStr.includes(t)) || "other";
        const photoTypeStr = `PHOTO TYPE: ${detectedType} | ROOM: ${photo.roomName || "unknown"}`;
        const hybridText = metaParts
          ? `${photoTypeStr}
${caption}
${metaParts}`
          : `${photoTypeStr}
${caption}`;

        // Step 2: Embed full hybrid text AND the shorter feature_summary in parallel.
        // feature_embedding uses only key room features (sinks, bathtub, shower, etc.)
        // without flooring/decor/furniture noise — gives much better cosine similarity
        // for specific feature queries like "double sinks" or "soaking tub".
        const featureSummaryText = extractFeatureSummary(hybridText, detectedType);
        const featureFlags = featureSummaryText ? extractFeatureFlags(featureSummaryText) : {};
        const [embedding, featureEmbedding] = await Promise.all([
          geminiEmbed(hybridText),
          featureSummaryText ? geminiEmbed(featureSummaryText) : Promise.resolve(null),
        ]);
        if (!embedding) { console.warn(`  [pipeline] embed FAILED`); return; }

        // Step 3: Store — acquire semaphore to cap concurrent DB writes
        await acquireDb();
        let error;
        try {
          ({ error } = await db.from("room_embeddings").upsert({
            hotel_id: hotelId, city, country_code: cc,
            hotel_name: hotelName,
            room_name: photo.roomName,
            room_type_id: photo.roomTypeId || null,
            photo_url: photo.url,
            photo_type: detectedType,  // use Gemini-detected type
            caption: hybridText,
            feature_summary: featureSummaryText,
            feature_flags: featureFlags,
            embedding,
            feature_embedding: featureEmbedding || null,
            star_rating: stars, guest_rating: rating,
          }, { onConflict: "hotel_id,photo_url" }));
        } finally {
          releaseDb();
        }

        if (!error) {
          embedded++; totalEmbeds++;
          try {
            const factRows = extractFactsFromSignals({
              featureFlags,
              featureSummary: featureSummaryText,
              caption: hybridText,
              roomName: photo.roomName,
              photoType: detectedType,
            });
            await upsertRoomFacts(db, {
              hotel_id: hotelId,
              room_type_id: photo.roomTypeId || null,
              city,
              country_code: cc,
            }, factRows);
          } catch (factErr) {
            console.warn(`  [facts] extraction failed: ${factErr.message}`);
          }
        } else {
          console.warn(`  [db] insert error: ${error.message}`, error.details, error.hint);
        }
        })); // end Promise.all photo chunk
      } // end photo chunk loop

      // Hotel-level amenity photos + description (BOOP v4 hotel-vibe signal).
      // Non-fatal: if this fails the room indexing still counts.
      let amenityEmbedded = 0;
      try {
        const amenityResult = await processHotelAmenities({
          db, hotelId, hotelName, city, cc, detail, stars, rating,
        });
        amenityEmbedded = amenityResult.amenityCount || 0;
        totalEmbeds += amenityEmbedded;
      } catch (e) {
        console.warn(`  [amenity] ${hotelName.slice(0,30)} failed: ${e.message}`);
      }

      hotelsDone++;
      console.log(`[indexer] [${hotelsDone}/${hotels.length}] ${hotelName.slice(0,35)} — ${embedded} room + ${amenityEmbedded} amenity embeddings`);

      // Keep both index tables current (best-effort, non-blocking)
      if (embedded > 0) {
        db.rpc("refresh_hotel_index_entry", { p_hotel_id: hotelId, p_city: city, p_country_code: cc || null })
          .then(({ error: e }) => { if (e) console.warn(`  [hotels_index] ${hotelId}: ${e.message}`); })
          .catch(() => {});
        db.rpc("refresh_room_types_index_entry", { p_hotel_id: hotelId, p_city: city, p_country_code: cc || null })
          .then(({ error: e }) => { if (e) console.warn(`  [room_types_index] ${hotelId}: ${e.message}`); })
          .catch(() => {});
      }
    }));

    // Update progress
    await db.from("indexed_cities").update({
      hotel_count: hotelsDone, photo_count: totalEmbeds,
      updated_at: new Date().toISOString(),
    }).eq("city", city);

    // Check for cancellation request between batches
    const { data: cityCheck } = await db
      .from("indexed_cities")
      .select("stop_requested")
      .eq("city", city)
      .single();
    if (cityCheck?.stop_requested) {
      console.log(`[indexer] ⛔ Stop requested for ${city} — exiting after ${hotelsDone} hotels`);
      await db.from("indexed_cities").update({
        status:     "cancelled",
        last_error: `Cancelled after ${hotelsDone} hotels, ${totalEmbeds} embeddings`,
        updated_at: new Date().toISOString(),
      }).eq("city", city);
      return { hotelsDone, totalEmbeds, cancelled: true };
    }
  }

  // Mark complete
  await db.from("indexed_cities").update({
    status: "complete", hotel_count: hotelsDone, photo_count: totalEmbeds,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("city", city);

  console.log(`[indexer] ✅ ${city} complete — ${hotelsDone} hotels, ${totalEmbeds} embeddings`);

  // Rebuild room_types_index so feature-flag searches work immediately for this city
  console.log(`[indexer] rebuilding room_types_index for ${city}...`);
  const { data: rebuildCount, error: rebuildErr } = await db.rpc("rebuild_room_types_index_city", { p_city: city });
  if (rebuildErr) {
    console.error(`[indexer] rebuild error: ${rebuildErr.message}`);
  } else {
    console.log(`[indexer] room_types_index rebuilt: ${rebuildCount} rows`);
  }

  // Rebuild hotel_profile_index so Hotel Vibe scores work for BOOP v4 searches.
  // Non-fatal: if the RPC doesn't exist yet (pre-migration) we log and move on.
  console.log(`[indexer] rebuilding hotel_profile_index for ${city}...`);
  const { data: hpiCount, error: hpiErr } = await db.rpc("rebuild_hotel_profile_index_city", { p_city: city });
  if (hpiErr) {
    console.warn(`[indexer] hotel_profile_index rebuild error (non-fatal): ${hpiErr.message}`);
  } else {
    console.log(`[indexer] hotel_profile_index rebuilt: ${hpiCount} rows`);
  }

  // Auto-generate neighborhoods if none exist; refresh hotel_count if they do
  try {
    const { generateNeighborhoods, refreshHotelCounts } = require("./neighborhood-generator");
    const { count: nCount } = await db
      .from("neighborhoods")
      .select("id", { count: "exact", head: true })
      .eq("city", city);
    if ((nCount ?? 0) === 0) {
      console.log(`[indexer] generating neighborhoods for ${city}...`);
      await generateNeighborhoods(city, db, process.env.GEMINI_KEY, process.env.UNSPLASH_KEY);
      console.log(`[indexer] neighborhoods generated for ${city}`);
    } else {
      console.log(`[indexer] refreshing neighborhood hotel_count for ${city}...`);
      await refreshHotelCounts(city, db);
    }
  } catch (e) {
    console.error(`[indexer] neighborhood step failed (non-fatal): ${e.message}`);
  }

  return { hotelsDone, totalEmbeds };
}

// ── indexCityAmenities ────────────────────────────────────────────────────────
// Incremental pass: for each hotel already in hotels_cache for the city,
// fetch /data/hotel/{id}, extract hotel-level amenity photos + description,
// caption + embed them, and append to room_embeddings + hotels_cache.
// Skips anything already embedded (idempotent). Leaves room photos untouched.
//
// Used by:
//   - /api/index-city-amenities endpoint (backfill existing cities for BOOP v4)
//   - CLI: node scripts/index-city.js --mode amenity_only --city Paris
async function indexCityAmenities(city, opts = {}) {
  if (!LITEAPI_KEY || !GEMINI_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(`[amenity_only] Missing required env vars`);
  }
  const db = getSupabase();
  const cc = COUNTRY_CODES[city.toLowerCase()] || "";
  const limit = opts.limit ?? null;

  console.log(`\n[amenity_only] Starting: ${city} ${limit ? `(limit ${limit})` : '(all hotels)'}`);

  // Load hotels for this city (optionally limited) — process in batches
  let q = db
    .from("hotels_cache")
    .select("hotel_id,name,star_rating,guest_rating")
    .eq("city", city)
    .order("star_rating", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data: hotels, error } = await q;
  if (error) throw new Error(`hotels_cache read: ${error.message}`);
  if (!hotels?.length) {
    console.log(`[amenity_only] No hotels found in hotels_cache for ${city}. Run full index first.`);
    return { hotelsDone: 0, amenityEmbeds: 0, descEmbeds: 0 };
  }
  console.log(`[amenity_only] ${hotels.length} hotels to scan`);

  let hotelsDone = 0, amenityEmbeds = 0, descEmbeds = 0;

  for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
    const batch = hotels.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (h) => {
      try {
        const detailRes = await liteGet(`/data/hotel?hotelId=${h.hotel_id}`);
        if (!detailRes.ok) return;
        const detail = detailRes.data?.data || {};
        const r = await processHotelAmenities({
          db,
          hotelId:   h.hotel_id,
          hotelName: h.name || detail.name || "Hotel",
          city, cc,
          detail,
          stars:  h.star_rating  || 0,
          rating: h.guest_rating || 0,
        });
        amenityEmbeds += r.amenityCount || 0;
        if (r.descEmbedded) descEmbeds += 1;
      } catch (e) {
        console.warn(`  [amenity_only] ${h.hotel_id}: ${e.message}`);
      } finally {
        hotelsDone++;
      }
    }));
    console.log(`[amenity_only] progress: ${hotelsDone}/${hotels.length} hotels · ${amenityEmbeds} amenity photos · ${descEmbeds} descriptions`);
  }

  // Rebuild the blended hotel_profile_index now that fresh embeddings exist
  console.log(`[amenity_only] rebuilding hotel_profile_index for ${city}...`);
  const { data: hpiCount, error: hpiErr } = await db.rpc("rebuild_hotel_profile_index_city", { p_city: city });
  if (hpiErr) console.warn(`[amenity_only] hpi rebuild error: ${hpiErr.message}`);
  else console.log(`[amenity_only] hotel_profile_index rebuilt: ${hpiCount} rows`);

  console.log(`[amenity_only] ✅ ${city} — ${hotelsDone} hotels, ${amenityEmbeds} amenity embeds, ${descEmbeds} descriptions`);
  return { hotelsDone, amenityEmbeds, descEmbeds, hpiCount };
}

module.exports = { indexCity, indexCityAmenities };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const get  = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i+1] : null; };
  const mode  = get("mode") || "full";
  const city  = get("city")  || "Paris";
  const limit = parseInt(get("limit") || "200");
  const run = mode === "amenity_only"
    ? indexCityAmenities(city, { limit: isNaN(limit) ? null : limit })
    : indexCity(city, limit);
  run.then(() => process.exit(0))
     .catch(e => { console.error(e); process.exit(1); });
}
