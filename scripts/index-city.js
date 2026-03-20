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

const LITEAPI_KEY  = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY   = process.env.GEMINI_KEY  || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const MAX_PHOTOS         = 10; // per room type
const BATCH_SIZE         = 20; // concurrent hotel detail fetches
const PHOTO_CONCURRENCY  = 5;  // concurrent Gemini calls per hotel

if (!LITEAPI_KEY || !GEMINI_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[indexer] Missing required env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

PHOTO TYPE: (bedroom / bathroom / living area / view / other)

BATHROOM:
SINKS: (no sink visible / one sink / two sinks / three or more sinks)
COUNTER SPACE: (no counter / small counter / large counter / very large counter)
BATHTUB: (no bathtub / soaking tub / freestanding tub / clawfoot tub / built-in tub / hot tub / jacuzzi)
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
          generationConfig: { maxOutputTokens: 300, temperature: 0.1 }
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
  const cc = COUNTRY_CODES[city.toLowerCase()] || "";
  console.log(`\n[indexer] Starting: ${city} (${cc}) — limit ${limit}`);

  // Mark as indexing — reset stop_requested flag
  await supabase.from("indexed_cities").upsert({
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

      // Cache hotel
      await supabase.from("hotels_cache").upsert({
        hotel_id: hotelId, city, country_code: cc,
        name: detail.name || hotelName,
        address: detail.address || "",
        star_rating: stars, guest_rating: rating,
        main_photo: detail.main_photo || detail.mainPhoto || "",
        cached_at: new Date().toISOString(),
      }, { onConflict: "hotel_id" });

      // Collect photos per room type
      const roomMap = new Map();
      for (const room of (detail.rooms || [])) {
        const rName = room.roomName || room.name || "Room";
        if (!roomMap.has(rName)) roomMap.set(rName, { bathroom: [], other: [], meta: {
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

      // Select up to MAX_PHOTOS per room type (bathrooms first), hard cap 20 per hotel
      if (!roomMap.size) { console.log(`  [hotel] ${hotelName.slice(0,30)}: no rooms found`); hotelsDone++; return; }
      const toProcess = [];
      for (const [rName, buckets] of roomMap) {
        if (toProcess.length >= 60) break;   // hard cap: max 60 photos per hotel
        const selected = [
          ...buckets.bathroom.slice(0, 5),   // up to 5 bathroom photos
          ...buckets.other.slice(0, 5),      // up to 5 other photos
        ].slice(0, MAX_PHOTOS);
        for (const p of selected) {
          if (toProcess.length >= 60) break;
          toProcess.push({ roomName: rName, meta: buckets.meta, ...p });
        }
      }

      // Skip already-indexed photos
      const { data: existing } = await supabase
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

        // Step 2: Embed the hybrid text
        const embedding = await geminiEmbed(hybridText);
        if (!embedding) { console.warn(`  [pipeline] embed FAILED`); return; }

        // Step 3: Store
        const { error } = await supabase.from("room_embeddings").upsert({
          hotel_id: hotelId, city, country_code: cc,
          hotel_name: hotelName,
          room_name: photo.roomName, photo_url: photo.url,
          photo_type: detectedType,  // use Gemini-detected type
          caption: hybridText,
          embedding,
          star_rating: stars, guest_rating: rating,
        }, { onConflict: "hotel_id,photo_url" });

        if (!error) {
          embedded++; totalEmbeds++;
        } else {
          console.warn(`  [db] insert error: ${error.message}`, error.details, error.hint);
        }
        })); // end Promise.all photo chunk
      } // end photo chunk loop

      hotelsDone++;
      console.log(`[indexer] [${hotelsDone}/${hotels.length}] ${hotelName.slice(0,35)} — ${embedded} embeddings`);
    }));

    // Update progress
    await supabase.from("indexed_cities").update({
      hotel_count: hotelsDone, photo_count: totalEmbeds,
      updated_at: new Date().toISOString(),
    }).eq("city", city);

    // Check for cancellation request between batches
    const { data: cityCheck } = await supabase
      .from("indexed_cities")
      .select("stop_requested")
      .eq("city", city)
      .single();
    if (cityCheck?.stop_requested) {
      console.log(`[indexer] ⛔ Stop requested for ${city} — exiting after ${hotelsDone} hotels`);
      await supabase.from("indexed_cities").update({
        status:     "cancelled",
        last_error: `Cancelled after ${hotelsDone} hotels, ${totalEmbeds} embeddings`,
        updated_at: new Date().toISOString(),
      }).eq("city", city);
      return { hotelsDone, totalEmbeds, cancelled: true };
    }
  }

  // Mark complete
  await supabase.from("indexed_cities").update({
    status: "complete", hotel_count: hotelsDone, photo_count: totalEmbeds,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("city", city);

  console.log(`[indexer] ✅ ${city} complete — ${hotelsDone} hotels, ${totalEmbeds} embeddings`);
  return { hotelsDone, totalEmbeds };
}

module.exports = { indexCity };

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const get  = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i+1] : null; };
  const city  = get("city")  || "Paris";
  const limit = parseInt(get("limit") || "200");
  indexCity(city, limit)
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
