#!/usr/bin/env node
/**
 * Backfill hotel_profile_index for Mexico City using V2 data.
 * Uses hotel name + star rating + aggregated room feature summaries to produce
 * a blended embedding for each hotel, enabling score_hotels RPC to work
 * (replacing the fallback guest_rating×10 approach).
 *
 * Run:  node scripts/backfill-hotel-profile-mx.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const CITY = "Mexico City";
const COUNTRY_CODE = "MX";
const CONCURRENCY = 8;
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIM = 768;

// Rate limit: gemini-embedding-001 allows 1500 req/min on paid tier.
// We embed one text per hotel so 160 hotels = trivial.
let _embedWindow = Date.now();
let _embedCount = 0;
async function embedRateGate() {
  const now = Date.now();
  if (now - _embedWindow > 60000) { _embedWindow = now; _embedCount = 0; }
  if (_embedCount >= 1400) {
    const wait = 62000 - (now - _embedWindow);
    await new Promise(r => setTimeout(r, Math.max(500, wait)));
    _embedWindow = Date.now();
    _embedCount = 0;
  }
  _embedCount++;
}

async function embedText(text) {
  await embedRateGate();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const body = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
    outputDimensionality: EMBED_DIM,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini embed error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.embedding?.values || null;
}

function semaphore(limit) {
  let active = 0;
  const queue = [];
  return async function run(fn) {
    if (active >= limit) await new Promise(r => queue.push(r));
    active++;
    try { return await fn(); }
    finally {
      active--;
      if (queue.length) queue.shift()();
    }
  };
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  if (!GEMINI_KEY) throw new Error("Missing GEMINI_KEY");

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Load all hotels for the city
  const { data: hotels, error: hotelErr } = await db
    .from("v2_hotels_cache")
    .select("hotel_id, name, star_rating, guest_rating, address")
    .eq("city", CITY);
  if (hotelErr) throw hotelErr;
  console.log(`Loaded ${hotels.length} hotels for ${CITY}`);

  // Load all feature summaries grouped by hotel
  const { data: inventory, error: invErr } = await db
    .from("v2_room_inventory")
    .select("hotel_id, room_name, photo_type, feature_summary, caption")
    .eq("city", CITY)
    .not("feature_summary", "is", null);
  if (invErr) throw invErr;
  console.log(`Loaded ${inventory.length} inventory rows`);

  // Group feature summaries by hotel_id
  const summaryByHotel = new Map();
  for (const row of inventory) {
    if (!summaryByHotel.has(row.hotel_id)) summaryByHotel.set(row.hotel_id, { room: [], amenity: [] });
    const bucket = summaryByHotel.get(row.hotel_id);
    const isRoom = ["bedroom", "bathroom", "living"].includes(row.photo_type);
    const text = row.feature_summary || row.caption || "";
    if (text.length > 20) {
      if (isRoom) bucket.room.push(text.slice(0, 300));
      else bucket.amenity.push(text.slice(0, 300));
    }
  }

  let done = 0;
  let errors = 0;
  const run = semaphore(CONCURRENCY);

  const tasks = hotels.map(hotel => run(async () => {
    try {
      const buckets = summaryByHotel.get(hotel.hotel_id) || { room: [], amenity: [] };

      // Build hotel description text
      const starLabel = hotel.star_rating ? `${hotel.star_rating}-star` : "hotel";
      const descParts = [
        `${hotel.name}, ${starLabel} hotel in ${CITY}`,
        hotel.address ? `located at ${hotel.address}` : "",
        hotel.guest_rating ? `guest rating ${hotel.guest_rating}/10` : "",
      ].filter(Boolean);
      const descText = descParts.join(". ");

      // Build room profile text: take up to 5 representative room summaries
      const roomSample = buckets.room.slice(0, 5).join(" | ");
      const amenitySample = buckets.amenity.slice(0, 3).join(" | ");

      // Single blended text for embedding (description + room vibe + amenities)
      const profileText = [descText, roomSample, amenitySample]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);

      const embedding = await embedText(profileText);
      if (!embedding || embedding.length !== EMBED_DIM) {
        throw new Error(`Bad embedding length ${embedding?.length}`);
      }

      const { error: upsertErr } = await db.from("hotel_profile_index").upsert({
        hotel_id:           hotel.hotel_id,
        city:               CITY,
        country_code:       COUNTRY_CODE,
        description_embedding: embedding,
        room_avg:           embedding,  // approximation: same embedding for all slots
        amenity_avg:        embedding,
        blended:            embedding,
        room_photo_count:   buckets.room.length,
        amenity_photo_count: buckets.amenity.length,
        updated_at:         new Date().toISOString(),
      }, { onConflict: "hotel_id" });
      if (upsertErr) throw upsertErr;

      done++;
      if (done % 10 === 0 || done === hotels.length) {
        process.stdout.write(`\r  ${done}/${hotels.length} done, ${errors} errors`);
      }
    } catch (err) {
      errors++;
      console.error(`\n  [${hotel.hotel_id}] ${hotel.name}: ${err.message}`);
    }
  }));

  await Promise.all(tasks);
  console.log(`\nDone. ${done} upserted, ${errors} errors.`);

  // Verify: check score_hotels now works
  const { data: test } = await db.rpc("score_hotels", {
    query_embedding: new Array(EMBED_DIM).fill(0),
    search_city: CITY,
    hotel_ids: [hotels[0].hotel_id],
  });
  console.log(`score_hotels test result count: ${test?.length ?? 0} (expected > 0)`);
}

main().catch(err => { console.error(err); process.exit(1); });
