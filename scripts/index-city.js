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
const MAX_PHOTOS   = 5; // per room type
const BATCH_SIZE   = 20; // concurrent hotel detail fetches

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

// ── Rate limiter — 800 req/min on paid Gemini tier (leave headroom) ───────────
let _geminiCount = 0;
let _geminiWindow = Date.now();
async function geminiThrottle() {
  const now = Date.now();
  if (now - _geminiWindow > 60000) { _geminiCount = 0; _geminiWindow = now; }
  if (_geminiCount >= 700) {
    const wait = 62000 - (now - _geminiWindow);
    console.log(`  [rate] pausing ${Math.round(wait/1000)}s for Gemini rate limit...`);
    await new Promise(r => setTimeout(r, wait));
    _geminiCount = 0; _geminiWindow = Date.now();
  }
  _geminiCount++;
}

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

async function geminiCaption(imageUrl) {
  try {
    await geminiThrottle();
    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) return null;
    const b64  = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    const prompt = `Describe this hotel room photo for a search index. Be specific. Mention:
- Sinks: how many, type (vessel, undermount, pedestal)
- Bathtub: type (soaking, freestanding, jetted, clawfoot) or none
- Shower: type (walk-in, rainfall, glass enclosure, over-bath) or none
- Flooring: material and colour (marble, hardwood, tile, carpet)
- Lighting: style (warm, bright, natural light, dim, pendant)
- Windows: size (floor-to-ceiling, large, small, none visible)
- Bed: type if visible (king, queen, twin, bunk)
- Furniture: notable pieces (desk, armchair, chaise, sofa, ottoman)
- Style: (modern, classic, minimalist, luxury, boutique, rustic)
- Anything distinctive: (city view, Eiffel Tower view, yellow walls, exposed brick)
Max 80 words. No preamble, just the description.`;

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
          generationConfig: { maxOutputTokens: 150, temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(25000),
      }
    );
    if (!gr.ok) {
      const err = await gr.text();
      console.warn(`  [gemini] caption ${gr.status}: ${err.slice(0,80)}`);
      return null;
    }
    const gd = await gr.json();
    return gd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch(e) {
    console.warn(`  [gemini] caption error: ${e.message}`);
    return null;
  }
}

async function geminiEmbed(text) {
  try {
    await geminiThrottle();
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.embedding?.values || null;
  } catch(e) {
    console.warn(`  [gemini] embed error: ${e.message}`);
    return null;
  }
}

function classifyPhoto(photo, roomName) {
  const desc = [
    photo.imageDescription || "",
    photo.imageClass1 || "",
    photo.imageClass2 || "",
    roomName || "",
  ].join(" ").toLowerCase();
  if (/bath|shower|sink|toilet|vanity|wc|spa/.test(desc))    return "bathroom";
  if (/bed|sleep|pillow|duvet|headboard/.test(desc))          return "bedroom";
  if (/living|lounge|sofa|sitting|couch/.test(desc))          return "living";
  if (/view|balcony|terrace|panoram/.test(desc))              return "view";
  return "other";
}

// ── Main export (called from server.js) and CLI entry point ───────────────────
async function indexCity(city, limit = 200) {
  const cc = COUNTRY_CODES[city.toLowerCase()] || "";
  console.log(`\n[indexer] Starting: ${city} (${cc}) — limit ${limit}`);

  // Mark as indexing
  await supabase.from("indexed_cities").upsert({
    city, country_code: cc, status: "indexing",
    hotel_count: 0, photo_count: 0,
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
        if (!roomMap.has(rName)) roomMap.set(rName, { bathroom: [], other: [] });
        const bucket = roomMap.get(rName);
        for (const photo of (room.photos || [])) {
          const url = photo.url || photo.hd_url || "";
          if (!url) continue;
          const type = classifyPhoto(photo, rName);
          if (type === "bathroom") bucket.bathroom.push({ url, type });
          else bucket.other.push({ url, type });
        }
      }

      // Select up to MAX_PHOTOS per room type (bathrooms first)
      const toProcess = [];
      for (const [rName, buckets] of roomMap) {
        const selected = [
          ...buckets.bathroom.slice(0, 3),  // up to 3 bathroom photos
          ...buckets.other.slice(0, 2),     // up to 2 other photos
        ].slice(0, MAX_PHOTOS);
        for (const p of selected) toProcess.push({ roomName: rName, ...p });
      }

      // Skip already-indexed photos
      const { data: existing } = await supabase
        .from("room_embeddings")
        .select("photo_url")
        .eq("hotel_id", hotelId)
        .in("photo_url", toProcess.map(p => p.url));
      const seen = new Set((existing || []).map(e => e.photo_url));
      const fresh = toProcess.filter(p => !seen.has(p.url));

      if (!fresh.length) { hotelsDone++; return; }

      // Caption + embed + store each photo sequentially
      let embedded = 0;
      for (const photo of fresh) {
        const caption = await geminiCaption(photo.url);
        if (!caption) continue;

        const embedding = await geminiEmbed(caption);
        if (!embedding) continue;

        const { error } = await supabase.from("room_embeddings").upsert({
          hotel_id: hotelId, city, country_code: cc,
          room_name: photo.roomName, photo_url: photo.url,
          photo_type: photo.type, caption, embedding,
          star_rating: stars, guest_rating: rating,
        }, { onConflict: "hotel_id,photo_url" });

        if (!error) { embedded++; totalEmbeds++; }
        else console.warn(`  [db] ${error.message}`);
      }

      hotelsDone++;
      console.log(`[indexer] [${hotelsDone}/${hotels.length}] ${hotelName.slice(0,35)} — ${embedded} embeddings`);
    }));

    // Update progress
    await supabase.from("indexed_cities").update({
      hotel_count: hotelsDone, photo_count: totalEmbeds,
      updated_at: new Date().toISOString(),
    }).eq("city", city);
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
