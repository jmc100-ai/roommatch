/**
 * classify-visual-style.js — incremental visual_style backfill for existing cities.
 *
 * Why this script exists
 * ----------------------
 * V2 captions deliberately do not auto-extract style facts as discrete booleans
 * (palette_minimalist is set on 83% of MX City hotels — useless as a
 * discriminator). The boop wizard's `stayVibe` answer (sleek_polished /
 * cozy_warm / vibrant_eclectic / moody_dark / classic_traditional) needs a
 * mutex-classified style fact per photo to drive useful ranking.
 *
 * This script does ONE pass over an existing city's photos, calls Gemini with a
 * tiny single-label prompt (no captioning, no other facts), and inserts ONE
 * fact row per photo with the winner. After this finishes,
 * rebuild_v2_room_types_index_city aggregates the per-photo votes into the
 * room-level facts JSON.
 *
 * Costs
 * -----
 *   ~$0.000038 per call (Gemini 2.5 Flash Lite, small prompt + single-token output)
 *   ~$2.40 for Mexico City (~63k unique photos)
 *
 * Runtime
 * -------
 *   ~1 hour at CAPTION_RATE_PER_MIN=1000 with PHOTO_CONCURRENCY=8.
 *
 * Idempotency
 * -----------
 * Skips any (hotel_id, room_type_id, photo_url) that already has a
 * `visual_style_*` row in v2_room_feature_facts. Safe to re-run.
 *
 * Usage
 * -----
 *   node scripts/classify-visual-style.js --city="Mexico City" [--limit=100]
 *
 *   POST /api/v2/classify-visual-style { city, secret, limit? }   (server entry)
 *
 * Future cities (London, NYC, etc.)
 * ---------------------------------
 * The full indexer (scripts/index-city-v2.js) now includes the VISUAL_STYLE_*
 * fields in its caption prompt, so newly-indexed cities populate these facts
 * automatically. This script is only needed for cities indexed BEFORE this
 * feature shipped — currently just Mexico City. Paris/KL are V1 and being
 * retired.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { buildVisualStyleClassifierPrompt, parseVisualStyleReply } = require("./fact-catalog");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY   = process.env.GEMINI_KEY;

// Defaults — overridable per-call via opts.concurrency / opts.rate_per_min.
// Render Starter shows actual throughput peaks around 6-8 r/s end-to-end
// (network + Gemini latency-bound), so 8 was a conservative start. Higher
// concurrency (24-32) saturates outbound bandwidth on Starter without
// hitting Gemini's per-key tier-2 rate. Override at call time when needed.
const DEFAULT_PHOTO_CONCURRENCY = parseInt(process.env.VS_PHOTO_CONCURRENCY || "8", 10);
const DEFAULT_RATE_PER_MIN      = parseInt(process.env.VS_RATE_PER_MIN || "1000", 10);

let _capWindow = Date.now();
let _capCount  = 0;

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

/**
 * Call Gemini 2.5 Flash Lite with the tiny classifier prompt. Returns the
 * winning fact_key (e.g. "visual_style_sleek_polished") or null when the model
 * can't classify (non-room photo, low confidence). Retries on 429/503.
 */
async function classifyOne(photoUrl, roomName, photoType, ratePerMin, retries = 4) {
  if (!GEMINI_KEY) return null;
  try {
    const cap = ratePerMin || DEFAULT_RATE_PER_MIN;
    const now = Date.now();
    if (now - _capWindow > 60000) { _capWindow = now; _capCount = 0; }
    if (_capCount >= cap) {
      const wait = 61000 - (now - _capWindow);
      await new Promise((r) => setTimeout(r, Math.max(500, wait)));
      _capWindow = Date.now();
      _capCount = 0;
    }
    _capCount++;

    const imgRes = await fetch(photoUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!imgRes.ok) return null;
    const b64  = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    const prompt = buildVisualStyleClassifierPrompt({ roomName, type: photoType });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
          // Single label output — keep maxOutputTokens tight to save cost.
          generationConfig: { maxOutputTokens: 16, temperature: 0 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!r.ok) {
      if ((r.status === 429 || r.status === 503) && retries > 0) {
        const attempt = 5 - retries;
        const delay = Math.min(attempt * attempt * 3000, 60000);
        await new Promise((res) => setTimeout(res, delay));
        return classifyOne(photoUrl, roomName, photoType, ratePerMin, retries - 1);
      }
      return null;
    }

    const d   = await r.json();
    const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    return parseVisualStyleReply(txt);
  } catch (_err) {
    if (retries > 0) return classifyOne(photoUrl, roomName, photoType, ratePerMin, retries - 1);
    return null;
  }
}

/**
 * Fetch ALL photos for a city that don't yet have a visual_style_* fact row.
 * Uses pagination because Supabase/PostgREST caps default responses at 1k rows
 * and we need to scan 70k+ rows for Mexico City.
 */
async function fetchPhotosNeedingClassification(db, city) {
  // Step 1: pull every photo row for the city.
  const PAGE = 1000;
  const inventory = []; // { hotel_id, room_type_id, room_name, photo_url, photo_type }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("v2_room_inventory")
      .select("hotel_id, room_type_id, room_name, photo_url, photo_type")
      .eq("city", city)
      .order("hotel_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v2_room_inventory page ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    inventory.push(...data);
    if (data.length < PAGE) break;
  }

  // Step 2: pull every (hotel_id, photo_url) that already has any visual_style_* row.
  const existing = new Set(); // key = `${hotel_id}|${photo_url}`
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("v2_room_feature_facts")
      .select("hotel_id, photo_url, fact_key")
      .eq("city", city)
      .like("fact_key", "visual_style_%")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v2_room_feature_facts page ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(`${row.hotel_id}|${row.photo_url}`);
    if (data.length < PAGE) break;
  }

  // Step 3: filter to unclassified. We classify per UNIQUE photo_url within a
  // hotel (LiteAPI commonly shares the same image across sibling rooms; we
  // expand the fact rows back across all (room_type_id) duplicates below).
  const seenInHotel = new Set();
  const toClassify = [];
  for (const row of inventory) {
    if (existing.has(`${row.hotel_id}|${row.photo_url}`)) continue;
    const dedup = `${row.hotel_id}|${row.photo_url}`;
    if (seenInHotel.has(dedup)) continue;
    seenInHotel.add(dedup);
    toClassify.push(row);
  }
  return { toClassify, inventory };
}

async function upsertVisualStyleFacts(db, rows) {
  if (!rows.length) return;
  // Dedup conflict key inside the batch to avoid "cannot affect row twice".
  const seen = new Set();
  const deduped = rows.filter((r) => {
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

async function rebuildIndex(db, city) {
  console.log(`[vs-classify] rebuilding v2_room_types_index for "${city}"...`);
  const { data, error } = await db.rpc("rebuild_v2_room_types_index_city", { p_city: city });
  if (error) {
    console.error("[vs-classify] rebuild error:", error.message);
    return null;
  }
  return data;
}

/**
 * Main entry point. `opts.limit` caps the number of photos classified per run
 * (useful for testing). `opts.skipRebuild` lets the server endpoint skip the
 * final RPC and call it separately.
 */
async function classifyVisualStyleForCity(city, opts = {}) {
  const db = getDb();
  const cc = opts.country_code || "";
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : Infinity;
  const concurrency = Math.max(1, Number(opts.concurrency) || DEFAULT_PHOTO_CONCURRENCY);
  const ratePerMin  = Math.max(60, Number(opts.rate_per_min) || DEFAULT_RATE_PER_MIN);
  const started = Date.now();

  console.log(`[vs-classify] city="${city}" concurrency=${concurrency} rate/min=${ratePerMin}`);

  const { toClassify, inventory } = await fetchPhotosNeedingClassification(db, city);
  console.log(`[vs-classify] inventory=${inventory.length} photos, to-classify=${toClassify.length} unique photo URLs`);

  // Build a quick lookup so a winning fact for (hotel_id, photo_url) can fan
  // out to every (hotel_id, room_type_id, photo_url) duplicate at insert time.
  const dupesByPhoto = new Map(); // `${hotel_id}|${photo_url}` → [inventory rows]
  for (const row of inventory) {
    const k = `${row.hotel_id}|${row.photo_url}`;
    if (!dupesByPhoto.has(k)) dupesByPhoto.set(k, []);
    dupesByPhoto.get(k).push(row);
  }

  const work = toClassify.slice(0, limit);
  let done = 0, classified = 0, unknown = 0;
  const t0 = Date.now();

  // Adaptive log cadence — every ~5% or every 500 photos (whichever is smaller).
  // The old `i % 200` gate produced one log every ~7 min at low throughput which
  // made it hard to spot whether the run was alive or stuck.
  const logEvery = Math.max(50, Math.min(500, Math.floor(work.length / 20)));
  let nextLogAt = logEvery;

  for (let i = 0; i < work.length; i += concurrency) {
    const chunk = work.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(async (row) => {
      const winner = await classifyOne(row.photo_url, row.room_name, row.photo_type, ratePerMin);
      return { row, winner };
    }));

    const factRows = [];
    for (const { row, winner } of results) {
      done++;
      if (!winner) { unknown++; continue; }
      classified++;
      // Fan out the winning fact across every duplicate room_type_id within
      // the same hotel that shares this photo_url. One Gemini call → up to
      // ~3 fact rows (LiteAPI often duplicates an image across sibling rooms).
      const dupes = dupesByPhoto.get(`${row.hotel_id}|${row.photo_url}`) || [row];
      for (const d of dupes) {
        factRows.push({
          hotel_id:      d.hotel_id,
          room_type_id:  d.room_type_id || null,
          city,
          country_code: cc,
          room_name:    d.room_name,
          photo_url:    d.photo_url,
          fact_key:     winner,
          fact_value:   1,
          confidence:   0.85,
          source:       "vision_classifier",
          extractor_version: "v2-vs-1",
          updated_at:   new Date().toISOString(),
        });
      }
    }
    if (factRows.length) await upsertVisualStyleFacts(db, factRows);

    if (done >= nextLogAt || done === work.length) {
      const dt = (Date.now() - t0) / 1000;
      const rate = dt > 0 ? (done / dt).toFixed(1) : "—";
      const eta  = work.length > done && dt > 0 ? Math.round((work.length - done) / (done / dt)) : 0;
      console.log(`[vs-classify] ${done}/${work.length} classified=${classified} unknown=${unknown} ${rate}/s ETA ~${eta}s`);
      nextLogAt = done + logEvery;
    }
  }

  const summary = {
    city,
    photos_in_city: inventory.length,
    photos_attempted: work.length,
    photos_classified: classified,
    photos_unknown: unknown,
    elapsed_seconds: Math.round((Date.now() - started) / 1000),
  };

  if (!opts.skipRebuild) {
    const rebuiltRows = await rebuildIndex(db, city);
    summary.index_rows_rebuilt = rebuiltRows;
  }

  console.log("[vs-classify] done", summary);
  return summary;
}

// CLI entry: `node scripts/classify-visual-style.js --city="Mexico City"`
if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, dflt = null) => {
    const m = args.find((a) => a.startsWith(`--${name}=`));
    return m ? m.split("=").slice(1).join("=") : dflt;
  };
  const city  = arg("city", "Mexico City");
  const limit = arg("limit", null);
  const cc    = arg("country_code", null);
  const conc  = arg("concurrency", null);
  const rpm   = arg("rate_per_min", null);
  classifyVisualStyleForCity(city, {
    limit:  limit ? parseInt(limit, 10) : undefined,
    country_code: cc || undefined,
    concurrency: conc ? parseInt(conc, 10) : undefined,
    rate_per_min: rpm ? parseInt(rpm, 10) : undefined,
  })
    .then((r) => { console.log("RESULT", JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error("ERROR", e.message); process.exit(1); });
}

module.exports = { classifyVisualStyleForCity };
