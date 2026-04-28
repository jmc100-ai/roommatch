#!/usr/bin/env node
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { extractFactsFromSignals } = require("./fact-catalog");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const GEMINI_KEY = process.env.GEMINI_KEY || "";
const MODELS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];
const CONCURRENCY = 2;
const RATE_PER_MIN = 120;
let _capWindow = Date.now();
let _capCount = 0;

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase env");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function rateGate() {
  const now = Date.now();
  if (now - _capWindow > 60000) { _capWindow = now; _capCount = 0; }
  if (_capCount >= RATE_PER_MIN) {
    const wait = 61000 - (now - _capWindow);
    await new Promise((r) => setTimeout(r, Math.max(500, wait)));
    _capWindow = Date.now();
    _capCount = 0;
  }
  _capCount++;
}

async function captionWithModel(imageUrl, roomName, coarseType, model, retries = 2) {
  try {
    await rateGate();
    const imgRes = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
    if (!imgRes.ok) return null;
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";
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
      `Context room name: ${roomName || "unknown"}`,
      `Context coarse type: ${coarseType || "other"}`,
      "Only include details clearly visible. If uncertain, use unknown/none.",
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
    if (!r.ok) {
      const txt = await r.text();
      if ((r.status === 429 || r.status === 503) && retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, (3 - retries) * 2500 + 2500));
        return captionWithModel(imageUrl, roomName, coarseType, model, retries - 1);
      }
      if (r.status === 503) return "__MODEL_BUSY__";
      console.warn(`[v2-backfill] ${model} HTTP ${r.status}: ${txt.slice(0, 120)}`);
      return null;
    }
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (_) {
    if (retries > 0) return captionWithModel(imageUrl, roomName, coarseType, model, retries - 1);
    return null;
  }
}

async function geminiCaption(imageUrl, roomName, coarseType) {
  for (const model of MODELS) {
    const out = await captionWithModel(imageUrl, roomName, coarseType, model);
    if (out && out !== "__MODEL_BUSY__") return out;
  }
  return null;
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

async function run(city = "Mexico City", limit = 12000) {
  const db = getDb();
  let processed = 0;
  let updated = 0;
  let failed = 0;
  while (processed < limit) {
    const { data: rows, error } = await db
      .from("v2_room_inventory")
      .select("id,hotel_id,room_type_id,room_name,photo_url,photo_type,city,country_code")
      .eq("city", city)
      .or("caption.is.null,caption.eq.")
      .limit(200);
    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (row) => {
        processed++;
        const cap = await geminiCaption(row.photo_url, row.room_name, row.photo_type);
        if (!cap) { failed++; return; }
        const summary = extractFeatureSummary(cap);
        const detectedType = (cap.match(/PHOTO TYPE:\s*([^\n\r]+)/i)?.[1] || row.photo_type || "other").toLowerCase();
        const { error: upErr } = await db
          .from("v2_room_inventory")
          .update({ caption: cap, feature_summary: summary, photo_type: detectedType })
          .eq("id", row.id);
        if (upErr) { failed++; return; }

        const factRows = extractFactsFromSignals({
          featureFlags: {},
          featureSummary: summary,
          caption: cap,
          roomName: row.room_name,
          photoType: detectedType,
        }).map((f) => ({
          hotel_id: row.hotel_id,
          room_type_id: row.room_type_id || null,
          city: row.city,
          country_code: row.country_code || null,
          room_name: row.room_name || "Room",
          photo_url: row.photo_url,
          fact_key: f.fact_key,
          fact_value: f.fact_value,
          confidence: f.confidence,
          source: f.source || "vision",
          extractor_version: "v2-facts-1",
          updated_at: new Date().toISOString(),
        }));
        if (factRows.length) {
          await db.from("v2_room_feature_facts").upsert(factRows, {
            onConflict: "hotel_id,room_type_id,photo_url,fact_key",
          });
        }
        updated++;
      }));
    }
    console.log(`[v2-backfill] processed=${processed} updated=${updated} failed=${failed}`);
  }
  console.log(`[v2-backfill] done city=${city} processed=${processed} updated=${updated} failed=${failed}`);
}

if (require.main === module) {
  const cityArg = process.argv.find((a) => a.startsWith("--city="));
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const city = cityArg ? cityArg.split("=")[1] : "Mexico City";
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 12000;
  run(city, limit).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { run };
