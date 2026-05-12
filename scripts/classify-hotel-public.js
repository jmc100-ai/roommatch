/**
 * classify-hotel-public.js — hotel public-area photo classifier (Phase 1b).
 *
 * Why this exists
 * ---------------
 * V2 search now has a fact-based hotel-vibe score (`score_hotels_facts_v2`)
 * that aggregates per-photo facts to the hotel level. The strongest single
 * signal of hotel personality — the lobby, pool, bar, exterior — was being
 * thrown away because we never captioned or classified `v2_hotels_cache.hotel_photos`.
 * This script does ONE pass over a city's public-area photos and writes:
 *
 *   1. `v2_room_inventory` rows tagged with `room_name = '__hotel_public__'`
 *      and `photo_type` set to the dominant area (lobby / pool / bar / etc.).
 *   2. `v2_room_feature_facts` rows for both:
 *      • the 10 `area_*` facts (1 yes for each detected area, 0 for the rest)
 *      • the 5 `visual_style_*` facts (1 yes + 4 no for the winner; nothing
 *        when STYLE comes back as `unknown`)
 *
 * After the run, `rebuild_v2_room_types_index_city(city)` rolls up the
 * `__hotel_public__` pseudo-room into a row in v2_room_types_index that
 * sits alongside real room rows. `score_hotels_facts_v2` then reads both
 * pools from the raw facts table and blends them via the public-weight.
 *
 * Source data
 * -----------
 * Photos come from `v2_hotels_cache.hotel_photos` (JSONB array populated
 * by the indexer from LiteAPI's `/data/hotel` response). Each photo URL is
 * captioned at most once per hotel. We cap at HOTEL_PHOTOS_PER_HOTEL = 12
 * because LiteAPI sometimes returns 30+ near-duplicate exteriors that don't
 * add signal.
 *
 * Costs
 * -----
 *   Mexico City: ~3 500 hotels × ~8 public photos avg = ~28 000 photos
 *                × $0.000038/call ≈ $1.06 total
 *                ~35 min wall-clock at concurrency=24 / rate_per_min=1500.
 *
 * Idempotency
 * -----------
 * Skips any (hotel_id, photo_url) that already has an `area_*` row in
 * `v2_room_feature_facts`. Safe to re-run; only newly-added hotels or
 * photos get processed.
 *
 * Usage
 * -----
 *   node scripts/classify-hotel-public.js --city="Mexico City" [--limit=100]
 *
 *   POST /api/v2/classify-hotel-public { city, secret, limit?, concurrency?, rate_per_min? }
 *
 * Future cities
 * -------------
 * `scripts/index-city-v2.js` will be extended in a follow-up to caption and
 * classify hotel public photos inline during indexing, so newly-indexed
 * cities populate the facts automatically. This script is for cities indexed
 * BEFORE that integration ships (currently just Mexico City).
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const {
  buildHotelPublicClassifierPrompt,
  parseHotelPublicReply,
  AREA_FACT_KEYS,
  VISUAL_STYLE_FACT_KEYS,
} = require("./fact-catalog");

// Bump on prompt semantic changes so old rows can be detected/replaced.
//   v2-hp-1: initial hotel-public classifier prompt + 1y+9n area writes.
const EXTRACTOR_VERSION = "v2-hp-1";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY   = process.env.GEMINI_KEY;

const PUBLIC_ROOM_NAME    = "__hotel_public__"; // sentinel; matches RPC + rebuild aggregation
// Sentinel room_type_id for the pseudo-room. Must be non-NULL because the
// existing UNIQUE indexes on v2_room_inventory and v2_room_feature_facts
// include room_type_id, and Postgres treats NULLs as distinct in unique
// constraints by default — so NULL room_type_id would (a) make ON CONFLICT
// require an exact null-matching index that doesn't exist, and (b) silently
// duplicate rows on idempotent re-runs. The score_hotels_facts_v2 RPC and
// rebuild_v2_room_types_index_city aggregate by room_name, not room_type_id,
// so any non-null sentinel is safe here.
const PUBLIC_ROOM_TYPE_ID = "__public__";

// Per-hotel cap. LiteAPI returns up to ~30 photos for some chains; the
// first 12 cover lobby + restaurant + pool + facade with diminishing
// signal returns after that.
const HOTEL_PHOTOS_PER_HOTEL = parseInt(process.env.HP_PHOTOS_PER_HOTEL || "12", 10);

// Defaults match classify-visual-style.js so a single env knob set applies.
const DEFAULT_PHOTO_CONCURRENCY = parseInt(process.env.HP_PHOTO_CONCURRENCY || process.env.VS_PHOTO_CONCURRENCY || "8", 10);
const DEFAULT_RATE_PER_MIN      = parseInt(process.env.HP_RATE_PER_MIN      || process.env.VS_RATE_PER_MIN      || "1000", 10);

let _capWindow = Date.now();
let _capCount  = 0;

function getDb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

/**
 * Call Gemini with the hotel-public classifier prompt. Returns:
 *   { areas: string[], visualStyle: string | null, raw: string }
 * Retries on 429/503. Returns { areas: [], visualStyle: null, raw: "" } on
 * permanent failure so the caller still records "nothing detected" rather
 * than crashing the worker.
 */
async function classifyOne(photoUrl, ratePerMin, retries = 4) {
  if (!GEMINI_KEY) return { areas: [], visualStyle: null, raw: "" };
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
    if (!imgRes.ok) return { areas: [], visualStyle: null, raw: "" };
    const b64  = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    const prompt = buildHotelPublicClassifierPrompt({
      roomName: PUBLIC_ROOM_NAME,
      type:     "other",
    });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
          // ~48 tokens covers "AREAS: a,b,c,d\nSTYLE: x" comfortably.
          generationConfig: { maxOutputTokens: 64, temperature: 0 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!r.ok) {
      if ((r.status === 429 || r.status === 503) && retries > 0) {
        const attempt = 5 - retries;
        const delay = Math.min(attempt * attempt * 3000, 60000);
        await new Promise((res) => setTimeout(res, delay));
        return classifyOne(photoUrl, ratePerMin, retries - 1);
      }
      return { areas: [], visualStyle: null, raw: "" };
    }

    const d   = await r.json();
    const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    const parsed = parseHotelPublicReply(txt);
    return { ...parsed, raw: txt };
  } catch (_err) {
    if (retries > 0) return classifyOne(photoUrl, ratePerMin, retries - 1);
    return { areas: [], visualStyle: null, raw: "" };
  }
}

/**
 * Fetch hotels for the city with their public-photo arrays. Then exclude
 * (hotel_id, photo_url) pairs already classified (any existing area_* row).
 */
async function fetchPublicPhotosNeedingClassification(db, city) {
  const PAGE = 1000;

  // Step 1: every hotel + its hotel_photos array.
  const hotels = []; // { hotel_id, country_code, photos[] }
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("v2_hotels_cache")
      .select("hotel_id, country_code, hotel_photos")
      .eq("city", city)
      .order("hotel_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v2_hotels_cache page ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const arr = Array.isArray(row.hotel_photos) ? row.hotel_photos : [];
      // LiteAPI returns either an array of strings or an array of {url, ...}.
      // Normalize to a flat array of URL strings, then dedupe.
      const urls = [];
      for (const p of arr) {
        const u = typeof p === "string" ? p : (p && (p.url || p.link || p.urlHd) || "");
        if (typeof u === "string" && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
        if (urls.length >= HOTEL_PHOTOS_PER_HOTEL) break;
      }
      if (urls.length > 0) {
        hotels.push({ hotel_id: row.hotel_id, country_code: row.country_code || "", photos: urls });
      }
    }
    if (data.length < PAGE) break;
  }

  // Step 2: every (hotel_id, photo_url) already classified — any existing
  // area_* row counts as "done for this URL".
  const existing = new Set();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("v2_room_feature_facts")
      .select("hotel_id, photo_url")
      .eq("city", city)
      .like("fact_key", "area_%")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v2_room_feature_facts page ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(`${row.hotel_id}|${row.photo_url}`);
    if (data.length < PAGE) break;
  }

  // Step 3: filter to unclassified pairs.
  const toClassify = [];
  for (const h of hotels) {
    for (const url of h.photos) {
      if (existing.has(`${h.hotel_id}|${url}`)) continue;
      toClassify.push({ hotel_id: h.hotel_id, country_code: h.country_code, photo_url: url });
    }
  }
  return { toClassify, totalHotels: hotels.length };
}

/**
 * Persist an inventory row plus all fact rows for one classified photo.
 * Buffers rows for batched upserts at the caller.
 */
function buildRowsForPhoto({ city, hotelId, countryCode, photoUrl, areas, visualStyle }) {
  const stamp = new Date().toISOString();
  const dominantArea = areas.length > 0
    ? areas[0].replace(/^area_/, "")
    : "other";

  const inventoryRow = {
    hotel_id:        hotelId,
    city,
    country_code:    countryCode,
    room_name:       PUBLIC_ROOM_NAME,
    room_type_id:    PUBLIC_ROOM_TYPE_ID,
    photo_url:       photoUrl,
    photo_type:      dominantArea,
    caption:         null,            // not needed; facts are the durable artifact
    feature_summary: null,
    source:          "hotel_public_classifier",
  };

  const factRows = [];

  // area_* facts: 1 yes per detected area, 0 for the rest.
  for (const areaKey of AREA_FACT_KEYS) {
    const isYes = areas.includes(areaKey);
    factRows.push({
      hotel_id:          hotelId,
      room_type_id:      PUBLIC_ROOM_TYPE_ID,
      city,
      country_code:      countryCode,
      room_name:         PUBLIC_ROOM_NAME,
      photo_url:         photoUrl,
      fact_key:          areaKey,
      fact_value:        isYes ? 1 : 0,
      confidence:        0.85,
      source:            "hotel_public_classifier",
      extractor_version: EXTRACTOR_VERSION,
      updated_at:        stamp,
    });
  }

  // visual_style_* facts: write 1 yes + 4 no only when a winner was picked.
  // When STYLE = unknown (no winner), skip — same convention as the room
  // classifier. The rebuild aggregation handles missing rows correctly.
  if (visualStyle) {
    for (const styleKey of VISUAL_STYLE_FACT_KEYS) {
      const isWinner = styleKey === visualStyle;
      factRows.push({
        hotel_id:          hotelId,
        room_type_id:      PUBLIC_ROOM_TYPE_ID,
        city,
        country_code:      countryCode,
        room_name:         PUBLIC_ROOM_NAME,
        photo_url:         photoUrl,
        fact_key:          styleKey,
        fact_value:        isWinner ? 1 : 0,
        confidence:        0.85,
        source:            "hotel_public_classifier",
        extractor_version: EXTRACTOR_VERSION,
        updated_at:        stamp,
      });
    }
  }

  return { inventoryRow, factRows };
}

async function upsertInventory(db, rows) {
  if (!rows.length) return;
  // Dedupe to avoid "cannot affect row twice" on the unique (hotel_id, room_type_id, photo_url) index.
  const seen = new Set();
  const deduped = rows.filter((r) => {
    const k = `${r.hotel_id}|${r.room_type_id || ""}|${r.photo_url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const { error } = await db.from("v2_room_inventory").upsert(deduped, {
    onConflict: "hotel_id,room_type_id,photo_url",
  });
  if (error) throw error;
}

async function upsertFacts(db, rows) {
  if (!rows.length) return;
  const seen = new Set();
  const deduped = rows.filter((r) => {
    const k = `${r.hotel_id}|${r.room_type_id || ""}|${r.photo_url}|${r.fact_key}`;
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
  console.log(`[hp-classify] rebuilding v2_room_types_index for "${city}"...`);
  const { data, error } = await db.rpc("rebuild_v2_room_types_index_city", { p_city: city });
  if (error) {
    console.error("[hp-classify] rebuild error:", error.message);
    return null;
  }
  return data;
}

async function classifyHotelPublicForCity(city, opts = {}) {
  const db = getDb();
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : Infinity;
  const concurrency = Math.max(1, Number(opts.concurrency) || DEFAULT_PHOTO_CONCURRENCY);
  const ratePerMin  = Math.max(60, Number(opts.rate_per_min) || DEFAULT_RATE_PER_MIN);
  const started = Date.now();

  console.log(`[hp-classify] city="${city}" concurrency=${concurrency} rate/min=${ratePerMin} cap/hotel=${HOTEL_PHOTOS_PER_HOTEL}`);

  const { toClassify, totalHotels } = await fetchPublicPhotosNeedingClassification(db, city);
  console.log(`[hp-classify] hotels=${totalHotels} to-classify=${toClassify.length} public photos`);

  const work = toClassify.slice(0, limit);
  let done = 0, withAreas = 0, withStyle = 0, noSignal = 0;
  const t0 = Date.now();

  const FLUSH_EVERY = 50;
  const logEvery = Math.max(50, Math.min(500, Math.floor(work.length / 20)));
  let nextLogAt = logEvery;
  let pendingInv = [];
  let pendingFacts = [];
  let cursor = 0;

  const flush = async () => {
    if (pendingInv.length === 0 && pendingFacts.length === 0) return;
    const inv = pendingInv;   pendingInv = [];
    const facts = pendingFacts; pendingFacts = [];
    try {
      // Inventory must be written BEFORE facts because facts reference photos
      // that the rebuild expects to find in inventory for photo_type_counts.
      if (inv.length)   await upsertInventory(db, inv);
      if (facts.length) await upsertFacts(db, facts);
    } catch (e) {
      console.warn("[hp-classify] upsert error:", e.message);
    }
  };

  const worker = async (_workerId) => {
    while (true) {
      const i = cursor++;
      if (i >= work.length) return;
      const row = work[i];
      const t = Date.now();
      const { areas, visualStyle } = await classifyOne(row.photo_url, ratePerMin);
      const dt = Date.now() - t;
      done++;

      if (areas.length > 0) withAreas++;
      if (visualStyle)      withStyle++;
      if (areas.length === 0 && !visualStyle) noSignal++;

      const { inventoryRow, factRows } = buildRowsForPhoto({
        city,
        hotelId:     row.hotel_id,
        countryCode: row.country_code || "",
        photoUrl:    row.photo_url,
        areas,
        visualStyle,
      });
      pendingInv.push(inventoryRow);
      pendingFacts.push(...factRows);

      if (pendingInv.length >= FLUSH_EVERY) await flush();

      if (done >= nextLogAt || done === work.length) {
        const total = (Date.now() - t0) / 1000;
        const rate = total > 0 ? (done / total).toFixed(1) : "—";
        const eta  = work.length > done && total > 0 ? Math.round((work.length - done) / (done / total)) : 0;
        console.log(`[hp-classify] ${done}/${work.length} areas=${withAreas} style=${withStyle} none=${noSignal} ${rate}/s last=${dt}ms ETA ~${eta}s`);
        nextLogAt = done + logEvery;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, k) => worker(k)));
  await flush();

  const summary = {
    city,
    hotels_with_public_photos: totalHotels,
    photos_attempted: work.length,
    photos_with_area:  withAreas,
    photos_with_style: withStyle,
    photos_no_signal:  noSignal,
    elapsed_seconds:   Math.round((Date.now() - started) / 1000),
  };

  if (!opts.skipRebuild) {
    const rebuiltRows = await rebuildIndex(db, city);
    summary.index_rows_rebuilt = rebuiltRows;
  }

  console.log("[hp-classify] done", summary);
  return summary;
}

// CLI: `node scripts/classify-hotel-public.js --city="Mexico City" [--limit=N]`
if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, dflt = null) => {
    const m = args.find((a) => a.startsWith(`--${name}=`));
    return m ? m.split("=").slice(1).join("=") : dflt;
  };
  const city  = arg("city", "Mexico City");
  const limit = arg("limit", null);
  const conc  = arg("concurrency", null);
  const rpm   = arg("rate_per_min", null);
  classifyHotelPublicForCity(city, {
    limit:        limit ? parseInt(limit, 10) : undefined,
    concurrency:  conc  ? parseInt(conc,  10) : undefined,
    rate_per_min: rpm   ? parseInt(rpm,   10) : undefined,
  })
    .then((r) => { console.log("RESULT", JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error("ERROR", e.message); process.exit(1); });
}

module.exports = { classifyHotelPublicForCity };
