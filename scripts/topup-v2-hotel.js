#!/usr/bin/env node
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { extractFactsFromSignals } = require("./fact-catalog");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const MODELS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];

function db() { return createClient(SUPABASE_URL, SUPABASE_KEY); }

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

function classifyPhoto(photo, roomName = "") {
  const d = [photo.imageDescription || "", photo.caption || "", roomName].join(" ").toLowerCase();
  if (/bath|shower|sink|toilet|vanity|wc|tub/.test(d)) return "bathroom";
  if (/bed|sleep|headboard|bedroom/.test(d)) return "bedroom";
  if (/living|lounge|sofa|couch/.test(d)) return "living area";
  if (/view|balcony|terrace|panoram/.test(d)) return "view";
  return "other";
}

async function captionModel(url, roomName, coarseType, model) {
  const img = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!img.ok) return null;
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  const mime = img.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const prompt = [
    "Analyze this hotel room photo and return compact structured fields.",
    "PHOTO TYPE: bathroom|bedroom|living area|view|other",
    "SINKS: none|single sink|double sinks|triple sinks",
    "BATHTUB: none|bathtub|soaking tub|clawfoot",
    "SHOWER: none|walk-in shower|rainfall shower|both walk-in and rainfall",
    "BALCONY OR TERRACE: yes|no",
    "WINDOWS: floor-to-ceiling windows|standard windows|unknown",
    "DISTINCTIVE FEATURES: comma-separated concrete features only",
    `Context room name: ${roomName || "unknown"}`,
    `Context coarse type: ${coarseType || "other"}`,
  ].join("\n");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
      generationConfig: { maxOutputTokens: 220, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function caption(url, roomName, coarseType) {
  for (const m of MODELS) {
    const out = await captionModel(url, roomName, coarseType, m);
    if (out) return out;
  }
  return null;
}

function summary(caption) {
  if (!caption) return null;
  return caption
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => /^(PHOTO TYPE|SINKS|BATHTUB|SHOWER|BALCONY OR TERRACE|WINDOWS|DISTINCTIVE FEATURES)/i.test(l))
    .join("\n");
}

async function run(hotelId, city = "Mexico City") {
  const d = db();
  const detail = await liteGet(`/data/hotel?hotelId=${hotelId}`);
  if (!detail.ok) throw new Error("LiteAPI detail failed");
  const rooms = detail.data?.data?.rooms || [];
  const photos = [];
  for (const r of rooms) {
    const rn = r.roomName || r.name || "Room";
    const rt = r.id || r.roomId || r.roomTypeId || null;
    for (const p of (r.photos || [])) {
      const url = p.url || p.hd_url || "";
      if (!url) continue;
      photos.push({ roomName: rn, roomTypeId: rt, url, type: classifyPhoto(p, rn) });
    }
  }
  const { data: existing } = await d.from("v2_room_inventory").select("photo_url").eq("hotel_id", hotelId).eq("city", city);
  const seen = new Set((existing || []).map((x) => x.photo_url));
  const missing = photos.filter((p) => !seen.has(p.url));
  let added = 0;
  for (const m of missing) {
    const cap = await caption(m.url, m.roomName, m.type);
    const sum = summary(cap);
    const det = (cap?.match(/PHOTO TYPE:\s*([^\n\r]+)/i)?.[1] || m.type || "other").toLowerCase();
    await d.from("v2_room_inventory").upsert({
      hotel_id: hotelId, city, room_name: m.roomName, room_type_id: m.roomTypeId || null,
      photo_url: m.url, photo_type: det, caption: cap, feature_summary: sum, source: "vision",
    }, { onConflict: "hotel_id,photo_url" });
    const factRows = extractFactsFromSignals({
      featureFlags: {}, featureSummary: sum, caption: cap, roomName: m.roomName, photoType: det,
    }).map((f) => ({
      hotel_id: hotelId,
      room_type_id: m.roomTypeId || null,
      city,
      room_name: m.roomName,
      photo_url: m.url,
      fact_key: f.fact_key,
      fact_value: f.fact_value,
      confidence: f.confidence,
      source: f.source || "vision",
      extractor_version: "v2-facts-1",
      updated_at: new Date().toISOString(),
    }));
    if (factRows.length) {
      await d.from("v2_room_feature_facts").upsert(factRows, {
        onConflict: "hotel_id,room_type_id,photo_url,fact_key",
      });
    }
    added++;
  }
  console.log(JSON.stringify({ hotelId, totalSourcePhotos: photos.length, added }, null, 2));
}

if (require.main === module) {
  const hidArg = process.argv.find((a) => a.startsWith("--hotel-id="));
  const cityArg = process.argv.find((a) => a.startsWith("--city="));
  if (!hidArg) { console.error("Missing --hotel-id"); process.exit(1); }
  const hotelId = hidArg.split("=")[1];
  const city = cityArg ? cityArg.split("=")[1] : "Mexico City";
  run(hotelId, city).catch((e) => { console.error(e.message); process.exit(1); });
}
