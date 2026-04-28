#!/usr/bin/env node
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { extractFactsFromSignals } = require("./fact-catalog");

const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const BATCH_SIZE = 12;
const PHOTO_LIMIT_PER_HOTEL = 60;
const PHOTO_CONCURRENCY = 5;

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

async function geminiCaption(imageUrl, photoContext = {}) {
  if (!GEMINI_KEY) return null;
  const prompt = [
    "Analyze this hotel room photo and return compact structured fields.",
    "Use exact lines:",
    "PHOTO TYPE: bathroom|bedroom|living area|view|other",
    "SINKS: none|single sink|double sinks|triple sinks",
    "BATHTUB: none|bathtub|soaking tub|clawfoot",
    "SHOWER: none|walk-in shower|rainfall shower|both walk-in and rainfall",
    "BALCONY OR TERRACE: yes|no",
    "WINDOWS: floor-to-ceiling windows|standard windows|unknown",
    "DISTINCTIVE FEATURES: comma-separated concrete features only",
    `Context room name: ${photoContext.roomName || "unknown"}`,
    `Context coarse type: ${photoContext.type || "other"}`,
  ].join("\n");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: null }, { file_data: { mime_type: "image/jpeg", file_uri: imageUrl } }] }],
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

function extractFeatureSummary(caption) {
  if (!caption) return null;
  const keep = caption
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => /^(PHOTO TYPE|SINKS|BATHTUB|SHOWER|BALCONY OR TERRACE|WINDOWS|DISTINCTIVE FEATURES)/i.test(l));
  return keep.length ? keep.join("\n") : null;
}

async function upsertV2Facts(db, rows) {
  if (!rows.length) return;
  const { error } = await db.from("v2_room_feature_facts").upsert(rows, {
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

  const params = new URLSearchParams({ limit: String(limit) });
  if (cc) { params.set("countryCode", cc); params.set("cityName", city); } else { params.set("city", city); }
  const hotelsRes = await liteGet(`/data/hotels?${params}`);
  if (!hotelsRes.ok) throw new Error(`LiteAPI /data/hotels failed ${hotelsRes.status}`);
  const hotels = (hotelsRes.data?.data || []);

  let hotelsDone = 0;
  let photosDone = 0;
  for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
    const batch = hotels.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (hotel) => {
      const hotelId = hotel.id || hotel.hotelId;
      const detailRes = await liteGet(`/data/hotel?hotelId=${hotelId}`);
      if (!detailRes.ok) { hotelsDone++; return; }
      const detail = detailRes.data?.data || {};
      const stars = hotel.starRating || detail.starRating || 0;
      const rating = hotel.rating || hotel.guestRating || detail.rating || 0;
      const mainPhoto = detail.main_photo || detail.mainPhoto || "";
      const hotelPhotos = (detail.hotelImages || [])
        .map((p) => p?.urlHd || p?.url || "")
        .filter(Boolean)
        .filter((u) => u !== mainPhoto)
        .slice(0, 8);
      await db.from("v2_hotels_cache").upsert({
        hotel_id: hotelId, city, country_code: cc, name: detail.name || hotel.name || hotelId,
        address: detail.address || "", star_rating: stars, guest_rating: rating, main_photo: mainPhoto,
        hotel_photos: hotelPhotos, lat: detail.location?.latitude ?? detail.lat ?? null, lng: detail.location?.longitude ?? detail.lng ?? null,
        cached_at: new Date().toISOString(),
      }, { onConflict: "hotel_id" });

      const chosen = [];
      for (const room of (detail.rooms || [])) {
        const roomName = room.roomName || room.name || "Room";
        const roomTypeId = room.id || room.roomId || room.roomTypeId || null;
        for (const p of (room.photos || [])) {
          const url = p.url || p.hd_url || "";
          if (!url) continue;
          chosen.push({ roomName, roomTypeId, url, type: classifyPhoto(p, roomName) });
          if (chosen.length >= PHOTO_LIMIT_PER_HOTEL) break;
        }
        if (chosen.length >= PHOTO_LIMIT_PER_HOTEL) break;
      }

      for (let j = 0; j < chosen.length; j += PHOTO_CONCURRENCY) {
        const chunk = chosen.slice(j, j + PHOTO_CONCURRENCY);
        await Promise.all(chunk.map(async (photo) => {
          const cap = await geminiCaption(photo.url, { type: photo.type, roomName: photo.roomName });
          const summary = extractFeatureSummary(cap);
          const detectedType = (cap?.match(/PHOTO TYPE:\s*([^\n\r]+)/i)?.[1] || photo.type || "other").toLowerCase();
          await db.from("v2_room_inventory").upsert({
            hotel_id: hotelId, city, country_code: cc, room_name: photo.roomName, room_type_id: photo.roomTypeId || null,
            photo_url: photo.url, photo_type: detectedType, caption: cap, feature_summary: summary, source: "vision",
          }, { onConflict: "hotel_id,photo_url" });
          const factRows = extractFactsFromSignals({
            featureFlags: {},
            featureSummary: summary,
            caption: cap,
            roomName: photo.roomName,
            photoType: detectedType,
          }).map((f) => ({
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

  await db.from("v2_indexed_cities").update({
    status: "complete", hotel_count: hotelsDone, photo_count: photosDone,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("city", city);
  return { city, hotelsDone, photosDone };
}

module.exports = { reindexCityV2 };
