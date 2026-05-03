#!/usr/bin/env node
/**
 * backfill-room-types.js
 *
 * Classifies every room type in v2_room_types_index for a city using Gemini
 * text API (no vision — just the room name). Adds three boolean classification
 * facts directly into the facts JSONB column:
 *
 *   is_apartment    — apartment / vacation-rental unit (not a hotel room/suite)
 *   is_multi_bedroom — 2+ separate bedrooms
 *   is_hostel_dorm  — hostel dorm / bunk bed / shared sleeping space
 *
 * These facts are language-agnostic (Gemini understands "Habitación doble",
 * "2BR", "Zweizimmerwohnung", etc.) and replace the brittle regex in
 * groupSizePenalty().
 *
 * After a full reindex (rebuild_v2_room_types_index_city), re-run this script
 * to restore the classification facts. It skips rooms that already have them.
 *
 * Usage:
 *   node scripts/backfill-room-types.js --city="Mexico City"
 *   node scripts/backfill-room-types.js --city="Mexico City" --force  (reclassify all)
 *
 * Or via API:
 *   POST /api/v2/backfill-room-types  { city, secret, force }
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const GEMINI_KEY   = process.env.GEMINI_KEY   || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const BATCH_SIZE   = 40;   // room names per Gemini call (smaller = fewer truncations)
const CONCURRENCY  = 3;    // parallel Gemini requests
const GEMINI_MODEL = "gemini-2.5-flash-lite";

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase env vars");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ── Gemini text classification ────────────────────────────────────────────────

async function classifyBatch(roomNames) {
  if (!GEMINI_KEY) throw new Error("Missing GEMINI_KEY");

  const numbered = roomNames.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const prompt = [
    "Classify each hotel/accommodation room name below into three boolean categories.",
    "",
    "Return a JSON array with EXACTLY one object per room, in the SAME ORDER as the input.",
    "Each object has EXACTLY these fields (no room_name field — match by position):",
    '  "is_apartment": true if this is an apartment or vacation-rental unit',
    '    (e.g. "2BR apartment", "studio apartment", "flat", "departamento", "apartamento",',
    '     "apartament", "wohnung", any room called "apartment"). false for hotel rooms,',
    '    suites, penthouses, studios that are clearly hotel-branded.',
    '  "is_multi_bedroom": true if the room has 2 or more SEPARATE bedrooms',
    '    (e.g. "two-bedroom", "2BR", "3BR", "2 Bedrooms"). false for studio, 1-bedroom,',
    '    or standard hotel rooms. "twin share" and "double" are NOT multi-bedroom.',
    '  "is_hostel_dorm": true ONLY for hostel dormitory, bunk bed, or shared dorm.',
    "",
    `The array MUST have exactly ${roomNames.length} elements.`,
    "Return valid JSON array only. No markdown, no explanation.",
    "",
    "Room names:",
    numbered,
  ].join("\n");

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }

  const d = await r.json();
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "[]";
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Response is not an array");
    if (parsed.length !== roomNames.length) {
      console.warn(`[backfill-rt] length mismatch: sent ${roomNames.length}, got ${parsed.length} — padding with nulls`);
      // Pad to expected length so positional lookup stays correct
      while (parsed.length < roomNames.length) parsed.push(null);
    }
    return parsed;
  } catch (e) {
    console.warn("[backfill-rt] JSON parse error:", e.message, "\nRaw:", raw.slice(0, 300));
    return [];
  }
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function classifyBatchWithRetry(roomNames, retries = 6) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await classifyBatch(roomNames);
    } catch (err) {
      if (attempt === retries) throw err;
      // 503 / overload: back off longer (15s, 30s, 45s, 60s, 60s)
      const is503 = err.message.includes("503") || err.message.includes("UNAVAILABLE") || err.message.includes("overload");
      const delay = is503
        ? Math.min(attempt * 15000, 60000)
        : Math.min(attempt * attempt * 2000, 30000);
      console.warn(`[backfill-rt] batch failed (attempt ${attempt}): ${err.message.slice(0, 80)} — retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return [];
}

// ── Main export ───────────────────────────────────────────────────────────────

async function backfillRoomTypes(city, { force = false } = {}) {
  if (!city) throw new Error("city is required");
  const db = getDb();
  const t0 = Date.now();

  // Load all room types for this city
  const { data: rows, error } = await db
    .from("v2_room_types_index")
    .select("id,hotel_id,room_name,facts")
    .eq("city", city);

  if (error) throw new Error(`DB load error: ${error.message}`);
  if (!rows?.length) return { city, processed: 0, skipped: 0, elapsed_ms: 0, message: "No room types found" };

  // Filter to rooms that need classification (unless force)
  const toClassify = force
    ? rows
    : rows.filter((r) => {
        const f = r.facts || {};
        return f.is_apartment === undefined && f.is_multi_bedroom === undefined && f.is_hostel_dorm === undefined;
      });

  const alreadyDone = rows.length - toClassify.length;
  console.log(`[backfill-rt] ${city}: ${rows.length} room types total, ${toClassify.length} to classify (${alreadyDone} already done)`);

  if (!toClassify.length) {
    return { city, processed: 0, skipped: alreadyDone, elapsed_ms: Date.now() - t0, message: "All rooms already classified" };
  }

  // Chunk into batches
  const batches = [];
  for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
    batches.push(toClassify.slice(i, i + BATCH_SIZE));
  }

  let processed = 0;
  let errors = 0;

  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (batch) => {
      // Deduplicate + trim — build a deduped ordered list for Gemini,
      // then map results back to original rows by position.
      const trimmedNames = batch.map((r) => r.room_name?.trim() || "");
      const uniqueNames  = [...new Set(trimmedNames.filter(Boolean))];
      let classifications;
      try {
        classifications = await classifyBatchWithRetry(uniqueNames);
      } catch (err) {
        console.error(`[backfill-rt] batch error: ${err.message}`);
        errors += batch.length;
        return;
      }

      // Positional lookup: uniqueNames[i] → classifications[i]
      const byUniqueName = new Map(
        uniqueNames.map((name, i) => [name, classifications[i]])
      );

      // Update each row in v2_room_types_index
      await Promise.all(batch.map(async (row) => {
        const cls = byUniqueName.get(row.room_name?.trim());
        if (!cls || cls === null) {
          // Gemini returned null (length mismatch padding) or missing — skip, will retry on next --force run
          console.warn(`[backfill-rt] no classification for: "${row.room_name}"`);
          errors++;
          return;
        }

        const classificationFacts = {
          is_apartment:     Boolean(cls.is_apartment),
          is_multi_bedroom: Boolean(cls.is_multi_bedroom),
          is_hostel_dorm:   Boolean(cls.is_hostel_dorm),
        };
        const mergedFacts = { ...(row.facts || {}), ...classificationFacts };

        const { error: upErr } = await db
          .from("v2_room_types_index")
          .update({ facts: mergedFacts })
          .eq("id", row.id);

        if (upErr) {
          console.error(`[backfill-rt] update error for "${row.room_name}": ${upErr.message}`);
          errors++;
        } else {
          processed++;
        }
      }));
    }));

    const done = Math.min((i + CONCURRENCY) * BATCH_SIZE, toClassify.length);
    console.log(`[backfill-rt] ${done}/${toClassify.length} classified (${errors} errors)`);
  }

  const elapsed_ms = Date.now() - t0;
  console.log(`[backfill-rt] done: ${processed} classified, ${errors} errors, ${elapsed_ms}ms`);
  return { city, processed, skipped: alreadyDone, errors, elapsed_ms };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const cityArg = (args.find((a) => a.startsWith("--city=")) || "").replace("--city=", "");
  const force   = args.includes("--force");

  if (!cityArg) {
    console.error("Usage: node scripts/backfill-room-types.js --city=\"Mexico City\" [--force]");
    process.exit(1);
  }

  backfillRoomTypes(cityArg, { force })
    .then((result) => {
      console.log("Result:", JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal:", err.message);
      process.exit(1);
    });
}

module.exports = { backfillRoomTypes };
