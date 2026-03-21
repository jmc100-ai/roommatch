#!/usr/bin/env node
/**
 * RoomMatch — scripts/backfill-room-ids.js
 *
 * Backfills room_type_id for existing rows in room_embeddings that predate
 * the per-room pricing feature.  Calls LiteAPI /data/hotel for each hotel,
 * matches room names, and UPDATEs matching rows.
 *
 * Run locally:
 *   node scripts/backfill-room-ids.js --city Paris --dry-run
 *   node scripts/backfill-room-ids.js --city Paris
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const LITEAPI_KEY  = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!LITEAPI_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[backfill] Missing required env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args    = process.argv.slice(2);
const get     = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i+1] : null; };
const city    = get("city") || "Paris";
const dryRun  = args.includes("--dry-run");

if (dryRun) console.log("[backfill] DRY RUN — no DB writes");

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

// Normalize a room name for matching: lowercase, collapse whitespace, strip punctuation
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Score how well two room names match (0 = no match, higher = better)
function matchScore(dbName, liteName) {
  const a = norm(dbName), b = norm(liteName);
  if (a === b) return 3;                    // exact
  if (a.includes(b) || b.includes(a)) return 2;  // substring
  // Word overlap
  const wa = new Set(a.split(" ")), wb = new Set(b.split(" "));
  const overlap = [...wa].filter(w => wb.has(w) && w.length > 2).length;
  return overlap >= 2 ? 1 : 0;
}

async function run() {
  console.log(`\n[backfill] Starting for city: ${city}`);

  // 1. Get all (hotel_id, room_name) pairs missing room_type_id
  const { data: rows, error } = await supabase
    .from("room_embeddings")
    .select("hotel_id, room_name")
    .eq("city", city)
    .is("room_type_id", null);

  if (error) { console.error("[backfill] DB error:", error.message); process.exit(1); }
  if (!rows?.length) { console.log("[backfill] Nothing to backfill — all rows have room_type_id"); return; }

  // Group by hotel_id
  const byHotel = new Map();
  for (const row of rows) {
    const key = row.hotel_id;
    if (!byHotel.has(key)) byHotel.set(key, new Set());
    byHotel.get(key).add(row.room_name);
  }

  console.log(`[backfill] ${rows.length} rows across ${byHotel.size} hotels need room_type_id`);

  let totalUpdated = 0, totalFailed = 0;

  for (const [hotelId, roomNames] of byHotel) {
    // Fetch room types from LiteAPI
    const res = await liteGet(`/data/hotel?hotelId=${hotelId}`);
    if (!res.ok) {
      console.warn(`  [${hotelId}] LiteAPI ${res.status} — skipping`);
      totalFailed += roomNames.size;
      continue;
    }

    const liteRooms = (res.data?.data?.rooms || []).map(r => ({
      id:   r.id || r.roomId || r.roomTypeId || null,
      name: r.roomName || r.name || "",
    })).filter(r => r.id);

    if (!liteRooms.length) {
      console.warn(`  [${hotelId}] No rooms with IDs from LiteAPI — skipping`);
      totalFailed += roomNames.size;
      continue;
    }

    // For each DB room name, find the best-matching LiteAPI room
    let hotelUpdated = 0;
    for (const dbRoomName of roomNames) {
      let best = null, bestScore = 0;
      for (const lr of liteRooms) {
        const s = matchScore(dbRoomName, lr.name);
        if (s > bestScore) { bestScore = s; best = lr; }
      }

      if (!best || bestScore === 0) {
        console.warn(`  [${hotelId}] No match for "${dbRoomName}" (candidates: ${liteRooms.map(r=>r.name).join(", ")})`);
        totalFailed++;
        continue;
      }

      console.log(`  [${hotelId}] "${dbRoomName}" → "${best.name}" (id: ${best.id}, score: ${bestScore})`);

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("room_embeddings")
          .update({ room_type_id: best.id })
          .eq("hotel_id", hotelId)
          .eq("room_name", dbRoomName)
          .is("room_type_id", null);

        if (upErr) {
          console.error(`  [${hotelId}] UPDATE error:`, upErr.message);
          totalFailed++;
        } else {
          hotelUpdated++;
          totalUpdated++;
        }
      } else {
        totalUpdated++;
      }
    }

    console.log(`[backfill] ${hotelId}: ${hotelUpdated}/${roomNames.size} rooms matched`);

    // Small pause to avoid hammering LiteAPI
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n[backfill] Done — ${totalUpdated} rooms updated, ${totalFailed} unmatched`);
  if (dryRun) console.log("[backfill] DRY RUN — re-run without --dry-run to apply changes");
}

run().catch(e => { console.error(e); process.exit(1); });
