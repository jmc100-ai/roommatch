/**
 * RoomMatch — server.js
 * Room-search for hotel discovery + hotel detail for full room inventory
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const crypto  = require("crypto");
const fs      = require("fs");
// Load .env from the repo root (next to server.js), not process.cwd() — IDEs/tasks
// often start Node from another folder, which breaks local env on localhost.
require("dotenv").config({ path: path.join(__dirname, ".env") });

// ── Sentry (server) ───────────────────────────────────────────────────────────
// Init must happen before other requires that throw, so errors during boot are
// captured. Activates only when SENTRY_DSN_SERVER is set; otherwise no-ops.
const Sentry = require("@sentry/node");
const SENTRY_RELEASE = process.env.RENDER_GIT_COMMIT
  ? `roommatch@${String(process.env.RENDER_GIT_COMMIT).slice(0, 7)}`
  : "roommatch@local";
if (process.env.SENTRY_DSN_SERVER) {
  // Strip URL query/fragment + auth headers from breadcrumbs and events so we
  // never ship search queries or cookies into Sentry.
  const stripPii = (val) => {
    if (val == null) return val;
    if (typeof val !== "string") return val;
    return val.split("?")[0].split("#")[0];
  };
  Sentry.init({
    dsn: process.env.SENTRY_DSN_SERVER,
    environment: process.env.SENTRY_ENV || "production",
    release: SENTRY_RELEASE,
    tracesSampleRate: 0,
    integrations: [Sentry.expressIntegration()],
    beforeSend(event) {
      try {
        if (event.request) {
          if (event.request.url)         event.request.url         = stripPii(event.request.url);
          if (event.request.query_string) event.request.query_string = "";
          if (event.request.headers) {
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
            delete event.request.headers["x-api-key"];
          }
        }
      } catch (_) {}
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      try {
        if (breadcrumb?.data?.url) breadcrumb.data.url = stripPii(breadcrumb.data.url);
      } catch (_) {}
      return breadcrumb;
    },
  });
  console.log(`[sentry] enabled (${process.env.SENTRY_ENV || "production"}, ${SENTRY_RELEASE})`);
}

// ── PostHog (server) ──────────────────────────────────────────────────────────
// Mirrors a small set of high-signal events server-side so we still see them
// when ad-blockers strip the browser SDK. Activates only when POSTHOG_API_KEY.
const { PostHog: _PostHog } = require("posthog-node");
let posthog = null;
if (process.env.POSTHOG_API_KEY) {
  posthog = new _PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10000,
  });
  console.log(`[posthog] server enabled (host=${process.env.POSTHOG_HOST || "us.i.posthog.com"})`);
}
function trackServer(distinctId, event, properties) {
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: distinctId || "anon",
      event,
      properties: {
        ...(properties || {}),
        $lib: "roommatch-server",
        release: SENTRY_RELEASE,
        env: process.env.SENTRY_ENV || "production",
      },
    });
  } catch (e) {
    console.warn("[posthog] capture failed:", e.message);
  }
}

const { createClient } = require("@supabase/supabase-js");

// Lazy-load heavy pipeline modules so we bind PORT quickly (Render "port scan" / health checks).
function loadIndexCity() {
  return require("./scripts/index-city").indexCity;
}
function loadIndexCityAmenities() {
  return require("./scripts/index-city").indexCityAmenities;
}
function loadNeighborhoodGenerator() {
  return require("./scripts/neighborhood-generator");
}
function loadBackfillLatlng() {
  return require("./scripts/backfill-latlng");
}
function loadIndexCityV2() {
  return require("./scripts/index-city-v2").reindexCityV2;
}
const {
  normalizePolygonRing,
  pointInPolygon,
  bboxFromRing,
} = require("./scripts/neighborhood-vibe-data");
const { runV2Search, invalidatePhaseACache } = require("./scripts/search-v2");

// ── Password gate helpers ─────────────────────────────────────────────────────
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const SITE_PASSWORD_HASH = SITE_PASSWORD
  ? crypto.createHash("sha256").update(SITE_PASSWORD + "rm-salt-2026").digest("hex")
  : "";

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.split("=");
    out[k.trim()] = decodeURIComponent(v.join("=").trim());
  }
  return out;
}

function loginHtml(error = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>TravelByVibe</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0c0c0e; font-family: 'DM Sans', sans-serif; color: #e8e4dc; }
    .card { background: #18181c; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px;
            padding: 48px 40px; width: 100%; max-width: 380px; text-align: center; }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 300;
         letter-spacing: 0.05em; margin-bottom: 8px; color: #c9a96e; }
    p.sub { font-size: 13px; color: rgba(232,228,220,0.5); margin-bottom: 32px; }
    input[type=password] { width: 100%; padding: 12px 16px; background: #0c0c0e;
      border: 1px solid rgba(201,169,110,0.3); border-radius: 8px; color: #e8e4dc;
      font-family: 'DM Sans', sans-serif; font-size: 15px; margin-bottom: 16px; outline: none; }
    input[type=password]:focus { border-color: rgba(201,169,110,0.7); }
    button { width: 100%; padding: 12px; background: linear-gradient(135deg, #c9a96e, #a8893d);
             border: none; border-radius: 8px; color: #0c0c0e; font-family: 'DM Sans', sans-serif;
             font-size: 14px; font-weight: 500; letter-spacing: 0.08em; cursor: pointer; }
    .error { color: #e87070; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>TravelBy<span style="color:#c9a96e">Vibe</span></h1>
    <p class="sub">Enter the code from your invite email</p>
    <form method="POST" action="/auth">
      <input type="password" name="password" placeholder="Beta code" autofocus autocomplete="current-password"/>
      <button type="submit">Continue</button>
      ${error ? `<p class="error">${error}</p>` : ""}
    </form>
  </div>
</body>
</html>`;
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// ── V2-city routing ────────────────────────────────────────────────────────
// Cities fully indexed through the V2 pipeline use v2_hotels_cache instead of
// hotels_cache. This set is loaded once at startup and can be refreshed.
const _v2Cities = new Set();
async function loadV2Cities() {
  const db = supabaseAdmin || supabase;
  if (!db) return;
  try {
    const { data } = await db
      .from("v2_indexed_cities")
      .select("city")
      .eq("status", "complete");
    _v2Cities.clear();
    for (const row of data || []) _v2Cities.add(normalizeCity(row.city));
    console.log(`[v2-cities] loaded: [${[..._v2Cities].join(", ")}]`);
  } catch (e) {
    console.warn("[v2-cities] load failed (non-fatal):", e.message);
  }
}
function normalizeCity(c) { return (c || "").trim().toLowerCase(); }
/** Returns "v2_hotels_cache" for V2-indexed cities, "hotels_cache" otherwise. */
function hotelsCacheFor(city) {
  return _v2Cities.has(normalizeCity(city)) ? "v2_hotels_cache" : "hotels_cache";
}

const app         = express();
// Render terminates TLS at its proxy and forwards X-Forwarded-* headers; this
// makes req.ip / cookie Secure detection / rate limiting key off the real
// client IP instead of the proxy.
app.set("trust proxy", 1);
// Use production key if set, fall back to sandbox
const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const IS_PROD     = !!process.env.LITEAPI_PROD_KEY;

// LiteAPI /hotels/rates request knob: how many rate offers to ask for per
// hotel. Empirically confirmed (Mexico City, 2026-05-10) that LiteAPI's
// response saturates at ~1.7 distinct mappedRoomIds per priced hotel
// regardless of cap — going from 20 -> 100 -> 200 returned essentially
// identical histograms (0:0 ~1:230 ~2-3:243 ~4-5:15 ~6+:0). Extra slots
// just get filled with more rate-plan variants of the same rooms.
// 60 is the sweet spot: captures the structural ceiling LiteAPI gives us
// at ~⅓ the payload of 200. D3 (extra-rate rows on the client, see
// roomNames in /api/rates response) does the real "fill the card" work.
// Clamped 10-300 as a guardrail.
const LITEAPI_MAX_RATES_PER_HOTEL = Math.max(10, Math.min(300,
  Number(process.env.LITEAPI_MAX_RATES_PER_HOTEL) || 60));
/** ISO 4217 codes accepted for GET /api/rates and /api/hotel-rates ?currency= */
const RATES_CURRENCY_ALLOW = new Set(["EUR", "USD", "GBP", "CAD", "AUD", "MXN"]);
function sanitizeRatesCurrency(q) {
  const c = String(q || "").trim().toUpperCase();
  return RATES_CURRENCY_ALLOW.has(c) ? c : "USD";
}
const PORT        = process.env.PORT || 3000;

// Keep health check fast and dependency-free for Render startup probes.
app.get("/api/health", (_, res) => {
  res.status(200).type("text/plain").send("ok");
});
app.head("/api/health", (_, res) => {
  res.status(200).end();
});

app.get("/api/public-config", (_req, res) => {
  res.json({
    clipSearchEnabled: String(process.env.CLIP_SEARCH_ENABLED || "").toLowerCase() === "true",
    // Telemetry — these are public-by-design (DSNs are safe to expose; PostHog
    // project keys are public).
    sentryDsn:        process.env.SENTRY_DSN_CLIENT || "",
    posthogKey:       process.env.POSTHOG_PROJECT_KEY || "",
    posthogHost:      process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    // Operational toggles
    betaBanner:       process.env.BETA_BANNER || "",
    release:          SENTRY_RELEASE,
    env:              process.env.SENTRY_ENV || "production",
  });
});

// Bind PORT before the rest of this file runs (huge tables + routes). Render scans the
// container port immediately; waiting until EOF made probes time out intermittently.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[boot] listening on 0.0.0.0:${PORT}`);
  console.log(`[config] Using ${IS_PROD ? "PRODUCTION" : "SANDBOX"} LiteAPI key`);
  loadV2Cities();
  const nbhdW = parseFloat(process.env.VSEARCH_NBHD_RANK_WEIGHT || "0.22");
  console.log(
    `[config] VSEARCH_NBHD_RANK_WEIGHT=${Number.isFinite(nbhdW) ? nbhdW : "invalid"} (parsed from env; 0 or missing → blend off)`
  );
  console.log(`TravelByVibe on port ${PORT}`);
  const KEEPALIVE_ENABLED = String(process.env.RENDER_KEEPALIVE || "").toLowerCase() === "true";
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL && KEEPALIVE_ENABLED) {
    console.log(`[keepalive] pinging ${RENDER_URL} every 10 min`);
    setInterval(async () => {
      try {
        await fetch(`${RENDER_URL}/api/health`);
        console.log("[keepalive] ping ok");
      } catch (e) {
        console.warn("[keepalive] ping failed:", e.message);
      }
    }, 10 * 60 * 1000);
  } else if (RENDER_URL) {
    console.log("[keepalive] disabled (set RENDER_KEEPALIVE=true to enable)");
  }
});

// ── In-memory hotel metadata cache (replaces hotels_cache DB reads for display) ──
// Stores name, main photo, ratings fetched live from LiteAPI; NOT persisted to DB.
// TTL: 4 hours. Only top-N hotels per search are fetched (those with photo data).
// LiteAPI property ids look like `lp` + hex — never treat as a guest-facing hotel name.
function isPlaceholderHotelTitle(name, hotelId) {
  const n = String(name ?? "").trim();
  const id = String(hotelId ?? "").trim();
  if (!n) return true;
  if (id && n === id) return true;
  return /^lp[0-9a-f]{6,}$/i.test(n);
}

function resolveHotelNameFromMeta(meta, hotelId, fallbackName) {
  const mName = String(meta?.name ?? "").trim();
  if (mName && !isPlaceholderHotelTitle(mName, hotelId)) return mName;
  const fb = String(fallbackName ?? "").trim();
  if (fb && !isPlaceholderHotelTitle(fb, hotelId)) return fb;
  return "";
}

const _hotelMetaCache = new Map(); // hotelId → { name, mainPhoto, starRating, guestRating, address, expiresAt }
// 24h: hotel name/photo/star/rating barely change. Reduces LiteAPI re-fetch frequency
// across the day; instance restarts still cause a one-time cold load (see prefetchHotelMetaBackground).
const HOTEL_META_TTL_MS = 24 * 60 * 60 * 1000;

function extractLiteHotelName(h) {
  if (!h || typeof h !== "object") return "";
  const parts = [
    h.name,
    h.hotelName,
    h.title,
    h.propertyName,
    h.property_name,
    h.hotel?.name,
    h.accommodation?.name,
  ];
  for (const p of parts) {
    if (typeof p === "string" && p.trim().length > 0) return p.trim();
  }
  return "";
}

async function fetchHotelMetaBatch(hotelIds) {
  const normalized = [...new Set((hotelIds || []).map((id) => String(id).trim()).filter(Boolean))];
  const out = {};
  for (const id of normalized) out[id] = _hotelMetaCache.get(id) || null;

  if (!LITEAPI_KEY) {
    if (normalized.length) console.warn("[hotel-meta] LITEAPI_KEY missing — cannot resolve hotel names");
    return out;
  }

  const needed = normalized.filter((id) => {
    const c = _hotelMetaCache.get(id);
    return !c || c.expiresAt < Date.now();
  });
  if (needed.length) {
    console.log(`[hotel-meta] fetching ${needed.length} hotels from LiteAPI`);
    // CHUNK=200: prefer a single parallel wave to LiteAPI over multiple sequential
    // batches. LiteAPI handles parallel requests fine on a paid key; the prior
    // CHUNK=50 caused ~3s sequential blocking on cold caches when fetching 250.
    const CHUNK = 200;
    for (let i = 0; i < needed.length; i += CHUNK) {
      const results = await Promise.allSettled(needed.slice(i, i + CHUNK).map(async (hotelIdRaw) => {
        const hotelId = String(hotelIdRaw).trim();
        const r = await fetch(
          `https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(hotelId)}`,
          { headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" } }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        let h = d?.data;
        if (Array.isArray(h)) h = h[0];
        if (!h || typeof h !== "object") throw new Error("no data");
        const rawDesc = h.hotelDescription || h.description || h.longDescription || "";
        const cleanDesc = typeof rawDesc === "string"
          ? rawDesc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const rawFacilities = h.hotelFacilities || h.amenities || h.facilities || [];
        const amenities = Array.isArray(rawFacilities)
          ? rawFacilities.map(f => (typeof f === "string" ? f : f?.name || f?.facilityName || "")).filter(Boolean)
          : [];
        const rawNm = extractLiteHotelName(h);
        _hotelMetaCache.set(hotelId, {
          name:        !isPlaceholderHotelTitle(rawNm, hotelId) ? (rawNm || null) : null,
          mainPhoto:   h.main_photo  || h.mainPhoto  || h.hotelImages?.[0]?.url || null,
          starRating:  h.starRating  || h.star_rating || 0,
          guestRating: h.rating      || h.guestRating || h.guest_rating || 0,
          address:     typeof h.address === "string" ? h.address : (h.address?.line1 || ""),
          description: cleanDesc,
          amenities,
          checkIn:     h.checkInOut?.checkIn  || h.checkIn  || null,
          checkOut:    h.checkInOut?.checkOut || h.checkOut || null,
          expiresAt:   Date.now() + HOTEL_META_TTL_MS,
        });
        return hotelId;
      }));
      const ok  = results.filter(r => r.status === "fulfilled").length;
      const err = results.filter(r => r.status === "rejected").length;
      if (err > 0) console.warn(`[hotel-meta] chunk ${i}-${i+CHUNK}: ${ok} ok, ${err} errors`);
    }
  }
  for (const id of normalized) out[id] = _hotelMetaCache.get(id) || null;
  return out;
}

// Fire-and-forget warming. Used after vsearch sends its response so the next
// user (and the client's lazy-load follow-up call) finds these IDs already in
// _hotelMetaCache. Errors are swallowed — the worst case is a cache miss.
function prefetchHotelMetaBackground(hotelIds) {
  if (!Array.isArray(hotelIds) || !hotelIds.length) return;
  const needed = hotelIds.map((id) => String(id).trim()).filter(Boolean).filter((id) => {
    const c = _hotelMetaCache.get(id);
    return !c || c.expiresAt < Date.now();
  });
  if (!needed.length) return;
  const t0 = Date.now();
  fetchHotelMetaBatch(needed)
    .then(() => console.log(`[hotel-meta] background warm: ${needed.length} hotels in ${Date.now()-t0}ms`))
    .catch(e => console.warn(`[hotel-meta] background warm failed: ${e.message}`));
}

/** UI caption only ("Neutral" when |pm| <= 32); ranking uses every slider step. */
const BOOP_PRICE_MATTERS_NEUTRAL_BAND = 32;
/** Max points off blended score at |pm|=100 for 5★ / top-tier $ (value-seeking). */
const BOOP_PRICE_VALUE_PENALTY_MAX = 24;
/** Extra shave for 4–5★ when value-seeking (on top of tier lean). */
const BOOP_PRICE_LUXURY_STAR_EXTRA = 5;
/** Max points added at |pm|=100 when splurging. */
const BOOP_PRICE_SPLURGE_BONUS_MAX = 14;
const BOOP_PRICE_ROOM_GAP_GUARD = 10;

function boopPriceValuePenaltyMax(pm) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (p <= 0) return BOOP_PRICE_VALUE_PENALTY_MAX;
  const t = Math.abs(p) / 100;
  return BOOP_PRICE_VALUE_PENALTY_MAX + t * 16;
}

function boopPriceRoomGapGuard(pm) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (p <= 0) return BOOP_PRICE_ROOM_GAP_GUARD;
  const t = Math.abs(p) / 100;
  return Math.max(4, Math.round(BOOP_PRICE_ROOM_GAP_GUARD * (1 - 0.55 * t)));
}

/** When value-seeking, block weak-nbhd hotels beating strong-nbhd peers on price alone. */
const BOOP_PRICE_NBHD_GAP_GUARD = 16;
/** Room lead required before a weak-nbhd hotel may override the nbhd guard. */
const BOOP_PRICE_NBHD_ROOM_YIELD_GAP = 22;
/** At |pm|=100, multiply nbhd blend weight by (1 + this) — neighbourhood stays decisive. */
const BOOP_PRICE_NBHD_WEIGHT_BOOST = 0.30;
const BOOP_VALUE_LUXURY_PREF_BLOCK = 15;

/** 0–1: how “luxury / pricey” for value penalty (5★ = 1, 1★ = small). */
function valueSeekingLuxuryLean(h, pct) {
  if (pct && h.price != null && Number.isFinite(Number(h.price))) {
    const p = Number(h.price);
    return Math.max(0, Math.min(1, (p - pct.p10) / pct.range));
  }
  const s = Number(h.starRating);
  if (Number.isFinite(s) && s > 0) {
    if (s >= 4.5) return 1.0;
    if (s >= 3.5) return 0.72;
    if (s >= 2.5) return 0.42;
    if (s >= 1.5) return 0.24;
    return 0.14;
  }
  const hv = Number(h.hotelScore);
  if (Number.isFinite(hv) && hv >= 82) return 0.88;
  if (Number.isFinite(hv) && hv >= 70) return 0.62;
  return 0.45;
}

function boopPriceMattersStrength(pm) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  return Math.abs(p) / 100;
}

/** 0–100: higher = better for value seekers (cheap stars or low nightly $). */
function hotelPriceValueScore(h, pct) {
  if (pct && h.price != null && Number.isFinite(Number(h.price))) {
    const p = Number(h.price);
    return Math.max(0, Math.min(100, ((pct.p90 - p) / pct.range) * 100));
  }
  const s = Number(h.starRating);
  if (Number.isFinite(s) && s > 0) {
    return Math.max(0, Math.min(100, ((5 - Math.min(s, 5)) / 4) * 100));
  }
  return 50;
}

/** 0–100: higher = splurge / luxury lean (high stars or high nightly $). */
function hotelPriceSplurgeScore(h, pct) {
  if (pct && h.price != null && Number.isFinite(Number(h.price))) {
    const p = Number(h.price);
    return Math.max(0, Math.min(100, ((p - pct.p10) / pct.range) * 100));
  }
  const s = Number(h.starRating);
  if (Number.isFinite(s) && s > 0) {
    return Math.max(0, Math.min(100, (Math.min(s, 5) / 5) * 100));
  }
  return 50;
}

function v2BestRoomScore(h) {
  const rooms = h.roomTypes || [];
  if (rooms.length) {
    const best = Math.max(0, ...rooms.map((r) => r.score || 0));
    if (best > 0) return best;
  }
  return h.vectorScore || 0;
}

/** 0–1 luxury lean (stars / $). Splurge path only. */
function hotelPriceExpensiveness(h, pct) {
  return valueSeekingLuxuryLean(h, pct);
}

/** Subtract luxury penalty from room+nbhd blend when slider is right (value). */
function boopPriceAdjustBlendedScore(blended, h, pm, pct) {
  const p = Math.max(-100, Math.min(100, Number(pm) || 0));
  if (Math.abs(p) < 1) return blended;
  const t = Math.abs(p) / 100;
  if (p > 0) {
    let penalty = t * boopPriceValuePenaltyMax(p) * valueSeekingLuxuryLean(h, pct);
    const stars = Number(h.starRating);
    if (Number.isFinite(stars) && stars >= 4) {
      penalty += t * BOOP_PRICE_LUXURY_STAR_EXTRA;
    }
    return Math.max(0, blended - penalty);
  }
  const exp = valueSeekingLuxuryLean(h, pct);
  return blended + t * BOOP_PRICE_SPLURGE_BONUS_MAX * exp;
}

/** Room-gap guard: higher room wins unless the leader is 4–5★ (then price penalty applies). */
const BOOP_PRICE_LUXURY_ROOM_GUARD_LEAN = 0.72;

function shouldRoomGuardYieldToPrice(h, pct) {
  const stars = Number(h.starRating);
  if (Number.isFinite(stars) && stars >= 4) return true;
  return valueSeekingLuxuryLean(h, pct) >= BOOP_PRICE_LUXURY_ROOM_GUARD_LEAN;
}

function effectiveNbhdWeightForPriceMatters(baseW, pm) {
  const w = Number(baseW) || 0;
  if (w <= 0) return 0;
  const p = Number(pm) || 0;
  if (p <= 0) return w;
  const t = Math.abs(p) / 100;
  return Math.min(0.72, w * (1 + BOOP_PRICE_NBHD_WEIGHT_BOOST * t));
}

/** Weak-nbhd hotel may beat strong-nbhd peer on price only with a large room lead. */
function shouldNbhdGuardYieldToPrice(weakNbhdHotel, strongNbhdHotel) {
  const roomWeak = v2BestRoomScore(weakNbhdHotel);
  const roomStrong = v2BestRoomScore(strongNbhdHotel);
  return roomWeak - roomStrong >= BOOP_PRICE_NBHD_ROOM_YIELD_GAP;
}

function compareV2HotelsPriceAware(a, b, nbhdWeight, pm, pricePercentiles) {
  const p = Number(pm) || 0;
  const wEff = effectiveNbhdWeightForPriceMatters(nbhdWeight, pm);
  if (p > 0) {
    const roomGapGuard = boopPriceRoomGapGuard(pm);
    const roomGap = v2BestRoomScore(b) - v2BestRoomScore(a);
    if (roomGap >= roomGapGuard) {
      if (!shouldRoomGuardYieldToPrice(b, pricePercentiles)) return 1;
    } else if (roomGap <= -roomGapGuard) {
      if (!shouldRoomGuardYieldToPrice(a, pricePercentiles)) return -1;
    }
    const nbhdA = a.nbhd_fit_pct;
    const nbhdB = b.nbhd_fit_pct;
    if (wEff > 0 && nbhdA != null && nbhdB != null) {
      const nbhdGap = nbhdB - nbhdA;
      if (nbhdGap >= BOOP_PRICE_NBHD_GAP_GUARD) {
        if (!shouldNbhdGuardYieldToPrice(a, b)) return 1;
      } else if (nbhdGap <= -BOOP_PRICE_NBHD_GAP_GUARD) {
        if (!shouldNbhdGuardYieldToPrice(b, a)) return -1;
      }
    }
  }
  const diff = v2PriceAdjustedBlendedScore(b, wEff, pm, pricePercentiles)
    - v2PriceAdjustedBlendedScore(a, wEff, pm, pricePercentiles);
  if (Math.abs(diff) > 1e-6) return diff > 0 ? 1 : -1;
  return (b.vectorScore || 0) - (a.vectorScore || 0);
}

function parseBoopProfileFromQuery(query) {
  try {
    const raw = query?.boop_profile;
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** Extra LiteAPI meta sync when star class is needed for price-matters or luxury tweaks. */
function needsBoopStarMetaForRanking(profile) {
  if (!profile?.answers) return false;
  const luxuryPref = Number(profile.prefs?.luxury ?? 0);
  if (Number.isFinite(luxuryPref) && luxuryPref < -5) return true;
  const pm = Number(profile.answers.priceMatters);
  return Number.isFinite(pm) && pm !== 0;
}

function v2BlendedSortScore(h, nbhdWeight, roomScore) {
  const raw = roomScore != null ? roomScore : v2BestRoomScore(h);
  if (nbhdWeight > 0 && h.nbhd_fit_pct != null) {
    return (1 - nbhdWeight) * raw + nbhdWeight * h.nbhd_fit_pct;
  }
  return raw;
}

/** Room+nbhd blend first, then price slider (same BOOP nbhd weight as search). */
function v2PriceAdjustedBlendedScore(h, nbhdWeight, pm, pct) {
  const blended = v2BlendedSortScore(h, nbhdWeight);
  return boopPriceAdjustBlendedScore(blended, h, pm, pct);
}

function sortV2HotelsDefault(hotels, nbhdWeight) {
  hotels.sort((a, b) => {
    const sa = v2BlendedSortScore(a, nbhdWeight);
    const sb = v2BlendedSortScore(b, nbhdWeight);
    if (Math.abs(sb - sa) > 1e-6) return sb - sa;
    return (b.vectorScore || 0) - (a.vectorScore || 0);
  });
}

function sortV2HotelsByPriceMatters(hotels, nbhdWeight, pm, pricePercentiles) {
  hotels.sort((a, b) =>
    compareV2HotelsPriceAware(a, b, nbhdWeight, pm, pricePercentiles)
  );
}

const CITY_COORDS = {
  "new york": [40.7128, -74.006], "new york city": [40.7128, -74.006],
  "nyc": [40.7128, -74.006], "manhattan": [40.758, -73.9855],
  "washington dc": [38.9072, -77.0369], "washington d.c.": [38.9072, -77.0369],
  "chiang mai": [18.7883, 98.9853], "kuala lumpur": [3.139, 101.6869],
  "sao paulo": [-23.5505, -46.6333], "rio de janeiro": [-22.9068, -43.1729],
  "buenos aires": [-34.6037, -58.3816], "cape town": [-33.9249, 18.4241],
  "tel aviv": [32.0853, 34.7818], "hong kong": [22.3193, 114.1694],
  "abu dhabi": [24.4539, 54.3773], "new orleans": [29.9511, -90.0715],
  "mexico city": [19.4326, -99.1332], "las vegas": [36.1699, -115.1398],
  "san francisco": [37.7749, -122.4194], "los angeles": [34.0522, -118.2437],
  "los angeles": [34.0522, -118.2437], "la": [34.0522, -118.2437],
  "chicago": [41.8781, -87.6298], "miami": [25.7617, -80.1918],
  "las vegas": [36.1699, -115.1398], "san francisco": [37.7749, -122.4194],
  "seattle": [47.6062, -122.3321], "boston": [42.3601, -71.0589],
  "washington dc": [38.9072, -77.0369], "dc": [38.9072, -77.0369],
  "new orleans": [29.9511, -90.0715], "austin": [30.2672, -97.7431],
  "toronto": [43.6532, -79.3832], "vancouver": [49.2827, -123.1207],
  "mexico city": [19.4326, -99.1332], "cancun": [21.1619, -86.8515],
  "rio de janeiro": [-22.9068, -43.1729], "rio": [-22.9068, -43.1729],
  "buenos aires": [-34.6037, -58.3816], "sao paulo": [-23.5505, -46.6333],
  "london": [51.5074, -0.1278], "paris": [48.8566, 2.3522],
  "barcelona": [41.3851, 2.1734], "madrid": [40.4168, -3.7038],
  "rome": [41.9028, 12.4964], "milan": [45.4654, 9.1859],
  "florence": [43.7696, 11.2558], "venice": [45.4408, 12.3155],
  "amsterdam": [52.3676, 4.9041], "berlin": [52.52, 13.405],
  "munich": [48.1351, 11.582], "prague": [50.0755, 14.4378],
  "vienna": [48.2082, 16.3738], "budapest": [47.4979, 19.0402],
  "lisbon": [38.7223, -9.1393], "athens": [37.9838, 23.7275],
  "istanbul": [41.0082, 28.9784], "zurich": [47.3769, 8.5417],
  "brussels": [50.8503, 4.3517], "copenhagen": [55.6761, 12.5683],
  "oslo": [59.9139, 10.7522], "stockholm": [59.3293, 18.0686],
  "dublin": [53.3498, -6.2603], "edinburgh": [55.9533, -3.1883],
  "dubai": [25.2048, 55.2708], "abu dhabi": [24.4539, 54.3773],
  "cairo": [30.0444, 31.2357], "cape town": [-33.9249, 18.4241],
  "nairobi": [-1.2921, 36.8219], "marrakech": [31.6295, -7.9811],
  "tel aviv": [32.0853, 34.7818], "doha": [25.2854, 51.531],
  "tokyo": [35.6762, 139.6503], "osaka": [34.6937, 135.5023],
  "kyoto": [35.0116, 135.7681], "bangkok": [13.7563, 100.5018],
  "singapore": [1.3521, 103.8198], "hong kong": [22.3193, 114.1694],
  "bali": [-8.3405, 115.092], "kuala lumpur": [3.139, 101.6869],
  "sydney": [-33.8688, 151.2093], "melbourne": [-37.8136, 144.9631],
  "mumbai": [19.076, 72.8777], "delhi": [28.6139, 77.209],
  "phuket": [7.8804, 98.3923], "koh samui": [9.5120, 100.0136],
  "beijing": [39.9042, 116.4074], "shanghai": [31.2304, 121.4737],
  "seoul": [37.5665, 126.978], "busan": [35.1796, 129.0756],
  "taipei": [25.0330, 121.5654], "ho chi minh city": [10.8231, 106.6297],
  "hanoi": [21.0285, 105.8542], "da nang": [16.0544, 108.2022],
  "hoi an": [15.8801, 108.3380], "siem reap": [13.3633, 103.8564],
  "phnom penh": [11.5564, 104.9282], "yangon": [16.8661, 96.1951],
  "colombo": [6.9271, 79.8612], "kathmandu": [27.7172, 85.3240],
  "dhaka": [23.8103, 90.4125], "karachi": [24.8607, 67.0011],
  "lahore": [31.5204, 74.3587], "islamabad": [33.6844, 73.0479],
  "goa": [15.2993, 74.1240], "jaipur": [26.9124, 75.7873],
  "agra": [27.1767, 78.0081], "varanasi": [25.3176, 82.9739],
  "udaipur": [24.5854, 73.7125], "kochi": [9.9312, 76.2673],
  "hyderabad": [17.3850, 78.4867], "chennai": [13.0827, 80.2707],
  "bangalore": [12.9716, 77.5946], "kolkata": [22.5726, 88.3639],
  "brisbane": [-27.4698, 153.0251], "perth": [-31.9505, 115.8605],
  "adelaide": [-34.9285, 138.6007], "gold coast": [-28.0167, 153.4000],
  "cairns": [-16.9186, 145.7781], "auckland": [-36.8485, 174.7633],
  "wellington": [-41.2866, 174.7756], "queenstown": [-45.0312, 168.6626],
  "christchurch": [-43.5321, 172.6362],
  "cape town": [-33.9249, 18.4241], "johannesburg": [-26.2041, 28.0473],
  "durban": [-29.8587, 31.0218], "cairo": [30.0444, 31.2357],
  "luxor": [25.6872, 32.6396], "marrakech": [31.6295, -7.9811],
  "casablanca": [33.5731, -7.5898], "nairobi": [-1.2921, 36.8219],
  "zanzibar": [-6.1659, 39.2026], "addis ababa": [9.0320, 38.7469],
  "kigali": [-1.9441, 30.0619], "accra": [5.6037, -0.1870],
  "lagos": [6.5244, 3.3792], "dakar": [14.7167, -17.4677],
  "havana": [23.1136, -82.3666], "nassau": [25.0480, -77.3554],
  "santo domingo": [18.4861, -69.9312], "punta cana": [18.5820, -68.4050],
  "san juan": [18.4655, -66.1057], "montego bay": [18.4762, -77.8939],
  "reykjavik": [64.1355, -21.8954], "tallinn": [59.4370, 24.7536],
  "riga": [56.9460, 24.1059], "vilnius": [54.6872, 25.2797],
  "sofia": [42.6977, 23.3219], "belgrade": [44.7866, 20.4489],
  "zagreb": [45.8150, 15.9819], "split": [43.5081, 16.4402],
  "dubrovnik": [42.6507, 18.0944], "sarajevo": [43.8563, 18.4131],
  "ljubljana": [46.0569, 14.5058], "bratislava": [48.1486, 17.1077],
  "wroclaw": [51.1079, 17.0385], "krakow": [50.0647, 19.9450],
  "gdansk": [54.3520, 18.6466], "salzburg": [47.8095, 13.0550],
  "innsbruck": [47.2692, 11.4041], "lucerne": [47.0502, 8.3093],
  "bern": [46.9480, 7.4474], "basel": [47.5596, 7.5886],
  "bruges": [51.2093, 3.2247], "ghent": [51.0500, 3.7303],
  "antwerp": [51.2213, 4.4051], "luxembourg": [49.6117, 6.1319],
  "nice": [43.7102, 7.2620], "bordeaux": [44.8378, -0.5792],
  "lyon": [45.7640, 4.8357], "marseille": [43.2965, 5.3698],
  "seville": [37.3891, -5.9845], "valencia": [39.4699, -0.3763],
  "malaga": [36.7213, -4.4214], "bilbao": [43.2630, -2.9350],
  "ibiza": [38.9067, 1.4206], "naples": [40.8518, 14.2681],
  "palermo": [38.1157, 13.3615], "bologna": [44.4949, 11.3426],
  "turin": [45.0703, 7.6869], "amalfi": [40.6340, 14.6027],
  "santorini": [36.3932, 25.4615], "mykonos": [37.4467, 25.3289],
  "thessaloniki": [40.6401, 22.9444], "edinburgh": [55.9533, -3.1883],
  "manchester": [53.4808, -2.2426], "liverpool": [53.4084, -2.9916],
  "bristol": [51.4545, -2.5879], "bath": [51.3781, -2.3597],
  "oxford": [51.7520, -1.2577], "birmingham": [52.4862, -1.8904],
  "galway": [53.2707, -9.0568], "florence": [43.7696, 11.2558],
  "porto": [41.1579, -8.6291], "lisbon": [38.7223, -9.1393],
  "algarve": [37.0179, -7.9307], "madeira": [32.7607, -16.9595],
  "oslo": [59.9139, 10.7522], "bergen": [60.3929, 5.3241],
  "gothenburg": [57.7089, 11.9746], "helsinki": [60.1699, 24.9384],
  "copenhagen": [55.6761, 12.5683], "stockholm": [59.3293, 18.0686],
  "brussels": [50.8503, 4.3517], "amsterdam": [52.3676, 4.9041],
  "rotterdam": [51.9244, 4.4777], "berlin": [52.52, 13.405],
  "hamburg": [53.5753, 10.0153], "munich": [48.1351, 11.582],
  "frankfurt": [50.1109, 8.6821], "cologne": [50.9333, 6.9500],
  "dresden": [51.0504, 13.7373], "stuttgart": [48.7758, 9.1829],
  "vienna": [48.2082, 16.3738], "prague": [50.0755, 14.4378],
  "budapest": [47.4979, 19.0402], "warsaw": [52.2297, 21.0122],
  "bucharest": [44.4268, 26.1025], "istanbul": [41.0082, 28.9784],
  "antalya": [36.8841, 30.7056], "bodrum": [37.0344, 27.4305],
  "cappadocia": [38.6431, 34.8289], "beirut": [33.8938, 35.5018],
  "amman": [31.9454, 35.9284], "jerusalem": [31.7683, 35.2137],
  "riyadh": [24.7136, 46.6753], "jeddah": [21.5433, 39.1728],
  "muscat": [23.5880, 58.3829], "doha": [25.2854, 51.531],
  "manama": [26.2154, 50.5832], "tashkent": [41.2995, 69.2401],
  "almaty": [43.2220, 76.8512], "tbilisi": [41.7151, 44.8271],
  "yerevan": [40.1872, 44.5152], "baku": [40.4093, 49.8671],
  "ho chi minh": [10.8231, 106.6297], "saigon": [10.8231, 106.6297],
  "penang": [5.4141, 100.3288], "langkawi": [6.3500, 99.8000],
  "lombok": [-8.5833, 116.1167], "yogyakarta": [-7.7956, 110.3695],
  "manila": [14.5995, 120.9842], "cebu": [10.3157, 123.8854],
  "boracay": [11.9674, 121.9248], "palawan": [9.8349, 118.7384],
  "luang prabang": [19.8845, 102.1348], "vientiane": [17.9757, 102.6331],
  "chengdu": [30.5728, 104.0668], "xian": [34.3416, 108.9398],
  "hangzhou": [30.2741, 120.1551], "guilin": [25.2736, 110.2899],
  "macau": [22.1987, 113.5439], "kaohsiung": [22.6273, 120.3014],
  "osaka": [34.6937, 135.5023], "kyoto": [35.0116, 135.7681],
  "hiroshima": [34.3853, 132.4553], "sapporo": [43.0618, 141.3545],
  "fukuoka": [33.5904, 130.4017], "nara": [34.6851, 135.8050],
  "guadalajara": [20.6597, -103.3496], "monterrey": [25.6866, -100.3161],
  "tulum": [20.2114, -87.4654], "cabo san lucas": [22.8905, -109.9167],
  "playa del carmen": [20.6296, -87.0739], "cancun": [21.1619, -86.8515],
  "medellin": [6.2442, -75.5812], "cartagena": [10.3910, -75.4794],
  "cusco": [13.5319, -71.9675], "montevideo": [-34.9011, -56.1645],
  "quito": [-0.1807, -78.4678], "la paz": [-16.5000, -68.1193],
  "salvador": [-12.9714, -38.5014], "brasilia": [-15.7801, -47.9292],
  "asuncion": [-25.2637, -57.5759], "lima": [-12.0464, -77.0428],
  "mendoza": [-32.8908, -68.8272], "santiago": [-33.4489, -70.6693],
  "bora bora": [-16.5004, -151.7415], "tahiti": [-17.6509, -149.4260],
  "fiji": [-18.1416, 178.4419], "maldives": [3.2028, 73.2207],
  "seychelles": [-4.6796, 55.4920], "mauritius": [-20.3484, 57.5522],
  "reunion": [-21.1151, 55.5364], "zanzibar": [-6.1659, 39.2026],
  "kampala": [0.3476, 32.5825], "mombasa": [-4.0435, 39.6682],
  "dar es salaam": [-6.7924, 39.2083], "sharm el sheikh": [27.9158, 34.3300],
  "hurghada": [27.2578, 33.8117], "luxor": [25.6872, 32.6396],
  "fez": [34.0181, -5.0078], "tangier": [35.7595, -5.8340],
  "tunis": [36.8065, 10.1815], "algiers": [36.7538, 3.0588],
  "accra": [5.6037, -0.1870], "abuja": [9.0765, 7.3986],
  "dakar": [14.7167, -17.4677], "addis ababa": [9.0320, 38.7469],
  "kigali": [-1.9441, 30.0619], "harare": [-17.8252, 31.0335],
  "nashville": [36.1627, -86.7816], "atlanta": [33.7490, -84.3880],
  "dallas": [32.7767, -96.7970], "houston": [29.7604, -95.3698],
  "phoenix": [33.4484, -112.0740], "san diego": [32.7157, -117.1611],
  "minneapolis": [44.9778, -93.2650], "detroit": [42.3314, -83.0458],
  "philadelphia": [39.9526, -75.1652], "orlando": [28.5383, -81.3792],
  "salt lake city": [40.7608, -111.8910], "kansas city": [39.0997, -94.5786],
  "pittsburgh": [40.4406, -79.9959], "portland": [45.5051, -122.6750],
  "denver": [39.7392, -104.9903], "austin": [30.2672, -97.7431],
  "calgary": [51.0447, -114.0719], "ottawa": [45.4215, -75.6919],
  "quebec city": [46.8139, -71.2082], "edmonton": [53.5461, -113.4938],
  "winnipeg": [49.8951, -97.1384],
};

// ── HyDE (Hypothetical Document Embeddings) ──────────────────────────────────
// For each user query, Gemini Flash Lite generates a short structured caption
// using the same vocabulary stored in room_embeddings. Embedding that caption
// rather than the raw query bridges vocabulary gaps ("multiple sinks" → "double
// sinks"), handles abstract terms ("spa bathroom", "romantic suite"), and
// naturally strips negations ("no carpet" → bedroom photo type only).
// Results are cached in-memory (4h TTL) — repeated queries pay zero overhead.
const HYDE_TTL  = 4 * 60 * 60 * 1000;   // 4 hours
const hydeCache = new Map();             // cacheKey → { hypothetical, embedding, ts }

function hydeKey(q) {
  return `v1:${q.toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

// Extract negated concepts for logging and future post-filter work.
// e.g. "double sinks without bathtub" → { negations: ["bathtub"], positiveQuery: "double sinks" }
function extractNegations(query) {
  const negated = [];
  const PATTERNS = [
    /\bno\s+([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bwithout\s+(?:a\s+|an\s+)?([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bnot\s+(?:a\s+|an\s+)?([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bavoid(?:ing)?\s+([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
  ];
  let cleaned = query;
  for (const p of PATTERNS) {
    const gp = new RegExp(p.source, 'gi');
    let m;
    while ((m = gp.exec(query)) !== null) {
      const concept = m[1].trim().toLowerCase();
      if (concept.length > 1) negated.push(concept);
    }
    cleaned = cleaned.replace(new RegExp(p.source, 'gi'), ' ');
  }
  return { negations: negated, positiveQuery: cleaned.replace(/\s+/g, ' ').trim() || null };
}

// Derive intentType from the hypothetical PHOTO TYPE field, with keyword fallback.
function extractIntentType(hydeText, query) {
  if (hydeText) {
    const m = hydeText.match(/^PHOTO TYPE:\s*(\w[\w ]*)/m);
    if (m) {
      const pt = m[1].toLowerCase().trim();
      if (pt === 'bathroom')    return 'bathroom';
      if (pt === 'bedroom')     return 'bedroom';
      if (pt === 'view')        return 'view';
      if (pt === 'living area') return 'living area';
    }
  }
  const q = query.toLowerCase();
  if (/\b(baths?|tubs?|showers?|sinks?|toilets?|bidet|bathroom|soaking|jacuzzi|spa)\b/.test(q)) return 'bathroom';
  if (/\b(beds?|bedroom|sleep|pillow|king|queen|twin|mattress)\b/.test(q)) return 'bedroom';
  if (/\b(views?|balcon(y|ies)|terrace|window|skyline|ocean|sea|city view)\b/.test(q)) return 'view';
  if (/\b(living|sofa|lounge|sitting|couch|armchair)\b/.test(q)) return 'living area';
  return null;
}

// Regex → DB feature flags (shared by /api/vsearch strict + soft modes)
const VSEARCH_FEATURE_FLAGS = [
  { label: 'double sinks',             flag: 'double_sinks',           queryMatch: /\bdouble sinks?\b|\btwo sinks?\b|\bdual sinks?\b|\btwin sinks?\b|\bmultiple sinks?\b|\bseveral sinks?\b/i },
  { label: 'soaking tub',              flag: 'soaking_tub',            queryMatch: /\b(soaking|freestanding|clawfoot)\s*tub\b/i },
  { label: 'bathtub',                  flag: 'bathtub',                queryMatch: /\bbathtub\b|\bbath tub\b/i },
  { label: 'walk-in shower',           flag: 'walk_in_shower',         queryMatch: /\bwalk[- ]in shower\b/i },
  { label: 'rainfall shower',          flag: 'rainfall_shower',        queryMatch: /\brainfall shower\b/i },
  { label: 'jacuzzi',                  flag: 'in_room_jacuzzi',        queryMatch: /\bjacuzzi\b|\bin[- ]room hot tub\b|\bwhirlpool\b/i },
  { label: 'bidet',                    flag: 'bidet',                  queryMatch: /\bbidet\b/i },
  { label: 'king bed',                 flag: 'king_bed',               queryMatch: /\bking(?:[- ]size(?:d)?)?\s*bed\b|\bking bed\b/i },
  { label: 'four-poster bed',          flag: 'four_poster_bed',        queryMatch: /\bfour[- ]poster\b/i },
  { label: 'walk-in closet',           flag: 'walk_in_closet',         queryMatch: /\bwalk[- ]in closet\b|\bdressing room\b/i },
  { label: 'separate living area',     flag: 'separate_living_area',   queryMatch: /\bseparate living\b|\bliving room\b/i },
  { label: 'high ceilings',            flag: 'high_ceilings',          queryMatch: /\bhigh ceilings?\b|\bvaulted ceiling\b/i },
  { label: 'floor-to-ceiling windows', flag: 'floor_to_ceiling_windows', queryMatch: /\bfloor[- ]to[- ]ceiling windows?\b|\bpanoramic windows?\b/i },
  { label: 'balcony',                  flag: 'balcony',                queryMatch: /\bbalcon(y|ies)\b/i },
  { label: 'work desk',                flag: 'work_desk',              queryMatch: /\b(work\s*)?desks?\b|\bwork(space|station)\b/i },
  { label: 'terrace',                  flag: 'terrace',                queryMatch: /\bterrace\b/i },
  { label: 'Eiffel Tower view',        flag: 'landmark_view',          queryMatch: /\bEiffel Tower\b|\bEiffel view\b/i },
  { label: 'city view',                flag: 'city_view',              queryMatch: /\bcity view\b/i },
  { label: 'garden view',              flag: 'garden_view',            queryMatch: /\bgarden view\b/i },
  { label: 'river view',               flag: 'river_view',             queryMatch: /\briver view\b|\bSeine view\b|\bThames view\b/i },
  { label: 'fireplace',                flag: 'fireplace',              queryMatch: /\bfireplace\b/i },
];

const SOFT_FLAG_COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const softFlagCoverageCache = new Map();

function getCachedSoftFlagCoverage(city, flagKeys) {
  const key = `${city}::${[...flagKeys].sort().join(',')}`;
  const hit = softFlagCoverageCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  return null;
}

function setCachedSoftFlagCoverage(city, flagKeys, data) {
  const key = `${city}::${[...flagKeys].sort().join(',')}`;
  softFlagCoverageCache.set(key, { data, expires: Date.now() + SOFT_FLAG_COVERAGE_CACHE_TTL_MS });
}

async function fetchFlagCoverageBatched(city, flagKeys, hotelIds, fetchClient) {
  const BATCH = 400;
  const hotelFlagHits = new Map();
  const n = flagKeys.length;
  if (n === 0) return new Map();

  for (let i = 0; i < hotelIds.length; i += BATCH) {
    const batch = hotelIds.slice(i, i + BATCH);
    const { data, error } = await fetchClient
      .from('room_types_index')
      .select('hotel_id, features')
      .eq('city', city)
      .in('hotel_id', batch);
    if (error) {
      console.error('[soft_flags] coverage batch error:', error.message);
      throw error;
    }
    for (const row of data || []) {
      if (!hotelFlagHits.has(row.hotel_id)) hotelFlagHits.set(row.hotel_id, new Set());
      const hits = hotelFlagHits.get(row.hotel_id);
      for (const fk of flagKeys) {
        if (row.features && row.features[fk] === true) hits.add(fk);
      }
    }
  }

  const coverageMap = new Map();
  for (const [hotelId, hits] of hotelFlagHits) {
    coverageMap.set(hotelId, hits.size / n);
  }
  return coverageMap;
}

function buildSoftFlagCoveragePromise(city, detectedFlagKeys, fetchClient) {
  if (!detectedFlagKeys.length) return Promise.resolve(null);
  const cached = getCachedSoftFlagCoverage(city, detectedFlagKeys);
  if (cached) return Promise.resolve(cached);

  const cap = parseInt(process.env.SOFT_FLAG_HOTEL_CAP || '1500', 10);
  return fetchClient
    .from(hotelsCacheFor(city))
    .select('hotel_id')
    .eq('city', city)
    .then(({ data, error }) => {
      if (error) throw error;
      const ids = (data || []).map(h => h.hotel_id).slice(0, cap);
      return fetchFlagCoverageBatched(city, detectedFlagKeys, ids, fetchClient);
    })
    .then((map) => {
      setCachedSoftFlagCoverage(city, detectedFlagKeys, map);
      return map;
    })
    .catch((e) => {
      console.error('[soft_flags] coverage fetch failed:', e.message);
      return null;
    });
}

/** How many detected query flags are true on this photo's feature_flags jsonb. */
function countPhotoFlagMatches(featureFlags, detectedFlagKeys) {
  if (!featureFlags || !detectedFlagKeys?.length) return 0;
  let n = 0;
  for (const fk of detectedFlagKeys) {
    if (featureFlags[fk] === true) n++;
  }
  return n;
}

/** In-place sort: confirmed flags first, then intent, then similarity. */
function sortHotelPhotosForDisplay(photos, intentType, detectedFlagKeys, flagMode) {
  const useFlagOrder = detectedFlagKeys.length > 0 && flagMode === "soft";
  photos.sort((a, b) => {
    if (useFlagOrder) {
      const fa = countPhotoFlagMatches(a.feature_flags, detectedFlagKeys);
      const fb = countPhotoFlagMatches(b.feature_flags, detectedFlagKeys);
      if (fb !== fa) return fb - fa;
    }
    const aIntent = (!intentType || a.photo_type === intentType) ? 1 : 0;
    const bIntent = (!intentType || b.photo_type === intentType) ? 1 : 0;
    if (bIntent !== aIntent) return bIntent - aIntent;
    return b.similarity - a.similarity;
  });
}

// System prompt for HyDE caption generation.
const HYDE_SYSTEM_PROMPT = `You are a hotel room photo caption assistant for a visual search engine.
Given a user search query about hotel rooms, generate a MINIMAL structured caption representing what a matching photo would look like.

RULES:
- Include ONLY fields directly implied by the query. Do NOT add anything the user did not request.
- Use ONLY the vocabulary listed for each field.
- Always output in English.
- Strip negations ("no carpet", "without bathtub") — only describe what the ideal room SHOULD have.
- If the query is NOT about visual room features (price, location, hotel brand, pet policy, parking, breakfast, Wi-Fi), output exactly: NOT_ROOM_QUERY

VALID FIELDS AND VALUES:
PHOTO TYPE: bedroom | bathroom | living area | view | other
SINKS: single sink | double sinks | triple sinks
COUNTER SPACE: small counter | large counter
BATHTUB: built-in tub | freestanding tub | soaking tub
SHOWER: rainfall shower | walk-in shower | shower over bath | steam shower
SEPARATE TOILET ROOM: yes
BED: single bed | twin beds | double bed | queen bed | king bed
WALK-IN CLOSET: yes
NATURAL LIGHT: bright natural light | low light
WINDOWS: large windows | floor-to-ceiling windows | small windows
VIEW: city view | Eiffel Tower view | garden view | pool view | sea view | courtyard view
BALCONY OR TERRACE: yes
SIZE IMPRESSION: spacious | compact
SEPARATE LIVING AREA: yes
SOFA: yes
FIREPLACE: yes
IN-ROOM HOT TUB OR JACUZZI: yes
DISTINCTIVE FEATURES: [brief description]

EXAMPLES:
Query: "double sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "two sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "multiple sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "soaking tub"
PHOTO TYPE: bathroom
BATHTUB: soaking tub

Query: "freestanding bathtub"
PHOTO TYPE: bathroom
BATHTUB: freestanding tub

Query: "big windows city view"
PHOTO TYPE: bedroom
WINDOWS: large windows
VIEW: city view

Query: "floor to ceiling windows"
PHOTO TYPE: bedroom
WINDOWS: floor-to-ceiling windows

Query: "king bed lots of natural light"
PHOTO TYPE: bedroom
BED: king bed
NATURAL LIGHT: bright natural light

Query: "spa bathroom"
PHOTO TYPE: bathroom
BATHTUB: soaking tub
SHOWER: rainfall shower

Query: "room with balcony"
PHOTO TYPE: bedroom
BALCONY OR TERRACE: yes

Query: "fireplace"
PHOTO TYPE: bedroom
FIREPLACE: yes

Query: "romantic suite"
PHOTO TYPE: bedroom
SIZE IMPRESSION: spacious
SEPARATE LIVING AREA: yes

Query: "modern bathroom with rainfall shower"
PHOTO TYPE: bathroom
SHOWER: rainfall shower
DISTINCTIVE FEATURES: modern style

Query: "views of the Eiffel Tower"
PHOTO TYPE: view
VIEW: Eiffel Tower view

Query: "double sinks no bathtub"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "hotel near Eiffel Tower"
NOT_ROOM_QUERY

Query: "cheap price"
NOT_ROOM_QUERY

Query: "pet friendly"
NOT_ROOM_QUERY

Now generate for this query (output ONLY the caption, no explanation):`;

// Generate a hypothetical caption via Gemini Flash Lite. Returns null on failure
// or when the query is not about room visuals — callers fall back to raw query.
async function hydeGenerate(query, geminiKey) {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: HYDE_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: `Query: "${query}"` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 150 },
        }),
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!resp.ok) { console.warn(`[hyde] HTTP ${resp.status}`); return null; }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || text === 'NOT_ROOM_QUERY') return null;
    return text;
  } catch (err) {
    console.warn(`[hyde] timeout/error (falling back to raw query): ${err.message}`);
    return null;
  }
}

function resolveCoords(city) {
  const key = city.trim().toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

function normalizeCityName(city) {
  return String(city || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function resolveCityName(rawCity, dbClient, tableHints = ["indexed_cities", "hotels_cache"]) {
  const normalized = normalizeCityName(rawCity);
  if (!normalized || !dbClient) return normalized;

  for (const table of tableHints) {
    try {
      const { data } = await dbClient
        .from(table)
        .select("city")
        .ilike("city", normalized)
        .limit(1);
      if (data?.[0]?.city) return data[0].city;
    } catch {
      // Fallback to normalized input on any table/query mismatch.
    }
  }
  return normalized;
}

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" }
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

// ── Security headers (helmet) ─────────────────────────────────────────────────
// Skip CSP for the beta — we still inline-set window._WL_BASE_URL etc. and
// pull in third-party scripts (PostHog, Sentry CDN, MapLibre); writing a
// correct CSP is its own ticket. The other helmet defaults (HSTS,
// frameguard, noSniff, etc.) are safe for our setup.
const helmet = require("helmet");
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ── CORS allowlist ────────────────────────────────────────────────────────────
// Was previously `origin: "*"` which allowed any site to hit our API. Restrict
// to known origins; add `RENDER_EXTERNAL_URL` (helps preview deploys) and
// localhost dev. The `null` origin (curl, server-side, Same-origin POST) is
// always allowed because cors() passes through requests with no Origin header.
const _allowedOrigins = new Set([
  "https://www.travelboop.com",
  "https://travelboop.com",
  "https://roommatch-1fg5.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
if (process.env.RENDER_EXTERNAL_URL) _allowedOrigins.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ""));
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (_allowedOrigins.has(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "256kb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Protects expensive endpoints from accidental floods (or a bad actor inside
// the beta). Health + public-config are explicitly skipped so monitors and the
// SPA's first-paint config fetch are never throttled.
const rateLimit = require("express-rate-limit");
const RL_SKIP = new Set(["/api/health", "/api/config", "/api/public-config"]);
function rlHandler(req, res /*, next, options */) {
  res.status(429).json({
    error: "rate_limited",
    detail: "Too many requests. Slow down and try again shortly.",
  });
}
const _rlOpts = { standardHeaders: true, legacyHeaders: false, handler: rlHandler, skip: (req) => RL_SKIP.has(req.path || "") };
const _rlSearch = rateLimit({ ..._rlOpts, windowMs: 60_000, max: 60 });   // /api/vsearch
const _rlRates  = rateLimit({ ..._rlOpts, windowMs: 60_000, max: 30 });   // /api/rates
const _rlMeta   = rateLimit({ ..._rlOpts, windowMs: 60_000, max: 90 });   // /api/hotels-meta
const _rlAdmin  = rateLimit({ ..._rlOpts, windowMs: 60_000, max: 10 });   // /api/index-* + backfill
const _rlGeneric = rateLimit({ ..._rlOpts, windowMs: 60_000, max: 240 }); // everything else /api/*
app.use("/api/vsearch",      _rlSearch);
app.use("/api/rates",        _rlRates);
app.use("/api/hotel-rates",  _rlRates);   // single-hotel rates, same budget as batch
app.use("/api/hotels-meta",  _rlMeta);
app.use("/api/hotel-rooms",  _rlMeta);
app.use("/api/index-city",   _rlAdmin);
app.use("/api/index-cancel", _rlAdmin);
app.use(/^\/api\/v2\//,      _rlGeneric);
app.use(/^\/api\/backfill-/, _rlAdmin);
app.use(/^\/api\//,          _rlGeneric);

// ── API beta gate ─────────────────────────────────────────────────────────────
// When SITE_PASSWORD is set (closed beta), every /api/* request must carry the
// rm_gate cookie set by /auth — otherwise return 401 JSON. INDEX_SECRET in the
// body or `x-index-secret` header bypasses (admin/scripts). A small allowlist
// keeps health checks, the public config endpoint, and unauth'd helpers usable
// by monitors and the first paint.
const API_GATE_ALLOWLIST = new Set([
  "/api/health",
  "/api/config",
  "/api/public-config",
]);
function _apiBetaGate(req, res, next) {
  if (!SITE_PASSWORD) return next();
  if (req.method === "OPTIONS") return next();
  const p = req.path || "";
  if (!p.startsWith("/api/")) return next();
  if (API_GATE_ALLOWLIST.has(p)) return next();
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.rm_gate === SITE_PASSWORD_HASH) return next();
  const sec = req.body?.secret || req.headers["x-index-secret"] || req.query.secret;
  if (sec && sec === process.env.INDEX_SECRET) return next();
  return res.status(401).json({ error: "beta_gate_required" });
}
app.use(_apiBetaGate);

/** Indexable marketing pages + crawler helpers — do not send global noindex. */
const MARKETING_HTML = {
  "/mexico-city-hotels": "mexico-city-hotels.html",
  "/cdmx-neighborhood-stays": "cdmx-neighborhood-stays.html",
  "/mexico-city-visual-search": "mexico-city-visual-search.html",
};
function isIndexablePublicPath(p) {
  if (!p) return false;
  if (p === "/sitemap.xml" || p === "/robots.txt") return true;
  if (p === "/privacy" || p === "/terms") return true;
  if (MARKETING_HTML[p]) return true;
  if (p.endsWith("/") && MARKETING_HTML[p.slice(0, -1)]) return true;
  return false;
}
app.use((req, res, next) => {
  if (isIndexablePublicPath(req.path || "")) return next();
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

// ── Password gate (only active when SITE_PASSWORD env var is set) ─────────────
if (SITE_PASSWORD) {
  // Handle login form submission
  app.post("/auth", express.urlencoded({ extended: false }), (req, res) => {
    const entered = crypto.createHash("sha256")
      .update((req.body.password || "").trim() + "rm-salt-2026")
      .digest("hex");
    if (entered === SITE_PASSWORD_HASH) {
      // Secure flag: include only when we're actually behind HTTPS so localhost
      // sessions aren't silently rejected by Set-Cookie. SameSite=Lax (not
      // Strict) so the redirect from /auth → / and any same-site nav from
      // marketing pages preserves the cookie. HttpOnly so the cookie is not
      // readable from JS (defence in depth — the value is a hash anyway).
      const isHttps = ((req.headers["x-forwarded-proto"] || req.protocol || "").split(",")[0] || "").trim() === "https";
      const cookie = `rm_gate=${SITE_PASSWORD_HASH}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`;
      res.setHeader("Set-Cookie", cookie);
      return res.redirect("/");
    }
    return res.send(loginHtml("That code did not work. Double-check your invite email and try again."));
  });

  // Gate the frontend — intercept GET / before static middleware serves index.html
  app.get("/", (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.rm_gate === SITE_PASSWORD_HASH) return next();
    return res.send(loginHtml());
  });

  // Gate the SPA hotel detail route the same way (it also serves index.html).
  app.get("/hotel/:hotelId", (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.rm_gate === SITE_PASSWORD_HASH) return next();
    return res.send(loginHtml());
  });
}

// ── Inject runtime client config into served index.html ──────────────────────
// We replace the literal `__WL_BASE_URL__` placeholder so window._WL_BASE_URL
// is set BEFORE app.js executes. This eliminates the previous race where the
// async /api/config fetch resolved AFTER buildBookUrl() captured an empty
// value at module init, silently sending users to the Google fallback.
function _wlBaseUrlFromEnv() {
  const d = process.env.LITEAPI_WL_DOMAIN;
  return d ? `https://${d.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
}
function _maptilerKeyFromEnv() {
  // Public-by-design (used in tile URLs that the browser fetches). MUST be
  // restricted by HTTP referrer in the Maptiler dashboard for production.
  return (process.env.MAPTILER_KEY || "").trim();
}
let _indexHtmlSrc = null;
function _readIndexHtml() {
  if (_indexHtmlSrc == null || process.env.NODE_ENV !== "production") {
    _indexHtmlSrc = fs.readFileSync(path.join(__dirname, "client", "index.html"), "utf8");
  }
  return _indexHtmlSrc;
}
function serveAppHtml(res) {
  // Re-inject per request so env changes take effect immediately on next deploy/restart.
  // Strip JS-string-breakers from injected values; placeholders sit inside
  // double-quoted JS string literals in index.html.
  const safe = (s) => String(s || "").replace(/[\\"']/g, "");
  const wl  = safe(_wlBaseUrlFromEnv());
  const mt  = safe(_maptilerKeyFromEnv());
  const sd  = safe(process.env.SENTRY_DSN_CLIENT || "");
  const phk = safe(process.env.POSTHOG_PROJECT_KEY || "");
  const phh = safe(process.env.POSTHOG_HOST || "https://us.i.posthog.com");
  const rel = safe(SENTRY_RELEASE);
  const env = safe(process.env.SENTRY_ENV || "production");
  const bb  = safe(process.env.BETA_BANNER || "");
  const html = _readIndexHtml()
    .replace(/__WL_BASE_URL__/g, wl)
    .replace(/__MAPTILER_KEY__/g, mt)
    .replace(/__SENTRY_DSN__/g, sd)
    .replace(/__POSTHOG_KEY__/g, phk)
    .replace(/__POSTHOG_HOST__/g, phh)
    .replace(/__RELEASE__/g, rel)
    .replace(/__ENV__/g, env)
    .replace(/__BETA_BANNER__/g, bb);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

function marketingOrigin(req) {
  let proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (proto !== "http" && proto !== "https") proto = "https";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "");
  if (host) return `${proto}://${host}`;
  const base = (process.env.RENDER_EXTERNAL_URL || "https://www.travelboop.com").replace(/\/$/, "");
  return /^https?:\/\//i.test(base) ? base : `https://${base}`;
}

function serveMarketingHtml(req, res, filename) {
  const fp = path.join(__dirname, "client", "marketing", filename);
  try {
    let html = fs.readFileSync(fp, "utf8");
    const origin = marketingOrigin(req);
    html = html.replace(/__ORIGIN__/g, origin);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=600");
    return res.send(html);
  } catch (e) {
    console.error("[marketing]", filename, e.message);
    return res.status(404).send("Not found");
  }
}

// Always serve `/` and `/hotel/:hotelId` via our injecting helper (even when
// SITE_PASSWORD is unset and the gate handlers above don't run).
app.get("/", (_req, res) => serveAppHtml(res));
app.get("/hotel/:hotelId", (_req, res) => serveAppHtml(res));

// SEO marketing landings (Mexico City launch) — before static so paths are not shadowed
Object.entries(MARKETING_HTML).forEach(([route, file]) => {
  app.get(route, (req, res) => serveMarketingHtml(req, res, file));
  app.get(`${route}/`, (req, res) => res.redirect(301, route));
});

// ── Standalone legal pages ───────────────────────────────────────────────────
// Self-contained HTML so they're publicly accessible (don't pass beta gate),
// indexable by crawlers, and shareable as direct URLs. Copy mirrors the
// in-app overlay versions in client/app.js getStaticPageContent().
function _legalHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title} — TravelByVibe</title>
<meta name="description" content="${title} for TravelByVibe — a friendly beta for discovering hotels by neighbourhood and real room photos."/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>
  *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background:#0c0c0e; color:#e8e4dc; font-family:'DM Sans',sans-serif; line-height:1.65; padding:48px 20px 80px; }
  .wrap { max-width:720px; margin:0 auto; }
  .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:32px; padding-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.07); }
  .brand { font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:300; letter-spacing:.05em; color:#c9a96e; text-decoration:none; }
  .home { color:rgba(232,228,220,0.55); font-size:13px; text-decoration:none; }
  .home:hover { color:#c9a96e; }
  h1 { font-family:'Cormorant Garamond',serif; font-size:42px; font-weight:300; letter-spacing:.03em; color:#c9a96e; margin-bottom:24px; }
  h2 { font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:400; color:#e8d5b0; margin-top:28px; margin-bottom:10px; }
  p, li { font-size:15px; color:rgba(232,228,220,0.85); margin-bottom:12px; }
  ul { padding-left:22px; margin-bottom:14px; }
  a { color:#c9a96e; }
  .muted { color:rgba(232,228,220,0.55); font-size:13px; margin-top:32px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.05); }
  .foot { margin-top:48px; font-size:12px; color:rgba(232,228,220,0.45); text-align:center; }
  .foot a { color:rgba(232,228,220,0.7); text-decoration:none; margin:0 8px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="/">TravelBy<span style="color:#c9a96e">Vibe</span></a>
    <a class="home" href="/">← Home</a>
  </div>
  <h1>${title}</h1>
  ${body}
  <p class="muted">TravelByVibe is in beta — details here are a simple overview, not legal advice, and we may update them as the product evolves. Operated by TravelBoop, LLC.</p>
  <div class="foot">
    <a href="/privacy">Privacy</a>·<a href="/terms">Terms</a>·<a href="mailto:beta@travelboop.com">Contact</a>
  </div>
</div>
</body>
</html>`;
}
app.get("/privacy", (_req, res) => {
  const body = `
    <p>We keep this short: here is what we collect, why, and who helps us run the site.</p>
    <h2>What we collect</h2>
    <ul>
      <li><strong>What you type in the app</strong> — city, searches, wizard choices, and feedback you send us. We use this to run your search and tune neighbourhood suggestions.</li>
      <li><strong>Basic connection info</strong> — like IP address and browser type, to keep the service secure and reliable.</li>
      <li><strong>A simple “you’re signed in” cookie</strong> — only when we use a beta code on the site. It just remembers that you entered the code; it is not used to track you around the web.</li>
      <li><strong>Anonymous product stats</strong> — for example that a search ran or a page opened. We never attach your exact search words to those stats.</li>
      <li><strong>Crash and error reports</strong> — so we can fix bugs. We strip sensitive bits from those reports where we can.</li>
      <li><strong>Feedback you choose to send</strong> — your message, optional email, the page you were on, and a summary of what you were searching (not a full transcript).</li>
    </ul>
    <h2>Partners</h2>
    <p>Hotel listings, photos, and prices come from our travel data and booking partners. Some features use Google’s AI services. We use trusted vendors for hosting, maps, email, and the anonymous stats and error tools above — each has their own privacy terms.</p>
    <h2>Your choices</h2>
    <p>During beta we may adjust how long we keep certain data. To ask a question or request deletion, email <a href="mailto:beta@travelboop.com">beta@travelboop.com</a> — we are a small team and will reply as soon as we can.</p>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
  res.send(_legalHtml("Privacy", body));
});
app.get("/terms", (_req, res) => {
  const body = `
    <p>By using TravelByVibe while we are in beta, you agree to these terms. If you do not agree, please stop using the site.</p>
    <h2>Not professional advice</h2>
    <p>TravelByVibe is a trip-planning helper, not a lawyer, accountant, or travel agent. Neighbourhood blurbs and match scores are for inspiration — always double-check anything important before you book.</p>
    <h2>No guarantees</h2>
    <p>The service is provided “as is.” We do not promise that prices, availability, or any hotel will be right for your trip.</p>
    <h2>Bookings</h2>
    <p>When you leave our site to book elsewhere, that site’s rules apply. We are not part of your reservation.</p>
    <h2>Please play fair</h2>
    <p>Do not abuse the service — for example by trying to break it, scrape it at huge volume, or ruin the experience for others. We may pause access if we need to protect the beta or other users.</p>
    <h2>Limitation of liability</h2>
    <p>To the fullest extent the law allows, TravelBoop, LLC and its operators are not responsible for indirect or consequential damages from using the beta.</p>
    <h2>Changes</h2>
    <p>We may update these terms as the product grows. If you keep using TravelByVibe after an update, that means you accept the new version.</p>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
  res.send(_legalHtml("Terms of service", body));
});

app.get("/sitemap.xml", (req, res) => {
  const o = marketingOrigin(req);
  const urls = [
    ...Object.keys(MARKETING_HTML).map(
      (p) => `  <url><loc>${o}${p}</loc><changefreq>weekly</changefreq><priority>0.85</priority></url>`
    ),
    `  <url><loc>${o}/privacy</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`,
    `  <url><loc>${o}/terms</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`,
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
  res.send(body);
});

// ── Public client config ──────────────────────────────────────────────────────
// Kept as a fallback (window._WL_BASE_URL / window._MAPTILER_KEY are normally
// already injected by serveAppHtml above; the client also fetches this so a
// missed injection is recoverable).
app.get("/api/config", (req, res) => {
  res.json({
    wl_base_url:   _wlBaseUrlFromEnv(),
    maptiler_key:  _maptilerKeyFromEnv(),
  });
});

// Static assets — set { index: false } so Express never auto-serves
// client/index.html (we own that via serveAppHtml so injection always happens).
app.use(express.static(path.join(__dirname, "client"), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if (process.env.NODE_ENV === "production") {
      return;
    } else if (/\.(?:js|css|mjs)$/i.test(filePath)) {
      // Local dev: avoid stale /app.js after edits (browser aggressive caching).
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  },
}));

// ── Photo fields debug — shows raw LiteAPI photo object structure ─────────────
app.get("/api/debug-photos", async (req, res) => {
  const hotelId = req.query.hotelId;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await liteGet(`/data/hotel?hotelId=${hotelId}`);
  if (!r.ok) return res.status(500).json({ error: "LiteAPI failed", status: r.status });
  const detail = r.data?.data || {};
  const rooms = detail.rooms || [];

  // Scan top-level hotel fields for any photo-like arrays (hotel gallery, exterior, lobby, etc.)
  const topLevelPhotoFields = {};
  for (const [k, v] of Object.entries(detail)) {
    if (k === "rooms") continue;
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (typeof first === "string" && (first.includes("http") || first.includes(".jpg") || first.includes(".png"))) {
        topLevelPhotoFields[k] = { count: v.length, sample: v.slice(0, 3) };
      } else if (typeof first === "object" && first !== null && (first.url || first.hd_url || first.imageUrl)) {
        topLevelPhotoFields[k] = { count: v.length, sampleFields: Object.keys(first), sample: v.slice(0, 2) };
      }
    }
  }

  // All top-level keys (excluding rooms) so we know what the response shape is
  const topLevelKeys = Object.keys(detail).filter(k => k !== "rooms");

  const sample = rooms.slice(0, 3).map(room => ({
    roomName: room.roomName || room.name,
    photoCount: (room.photos||[]).length,
    firstPhotoFields: room.photos?.[0] ? Object.keys(room.photos[0]) : [],
    samplePhotos: (room.photos||[]).slice(0, 3).map(p => ({
      url: (p.url||p.hd_url||"").slice(-40),
      ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'url' && k !== 'hd_url')),
    })),
  }));
  res.json({ hotelId, topLevelKeys, topLevelPhotoFields, roomCount: rooms.length, sample });
});

// ── Debug rates for a single hotel ───────────────────────────────────────────
// Shows parsed room types AND raw LiteAPI response for full structure inspection.
// Usage: GET /api/debug-rates?hotelId=lp6556dea4&checkin=2026-03-30&checkout=2026-04-02
app.get("/api/debug-rates", async (req, res) => {
  const { hotelId, checkin, checkout } = req.query;
  if (!hotelId || !checkin || !checkout) return res.status(400).json({ error: "hotelId, checkin, checkout required" });
  const nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  const dbgCur = sanitizeRatesCurrency(req.query.currency);

  // 1) /hotels/rates — what's bookable
  const ratesRes = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
    method: "POST",
    headers: { "X-API-Key": LITEAPI_KEY, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ hotelIds: [hotelId], checkin, checkout, currency: dbgCur, guestNationality: "US",
      occupancies: [{ adults: 2 }], maxRatesPerHotel: LITEAPI_MAX_RATES_PER_HOTEL, roomMapping: true, timeout: 22 }),
  });
  const ratesJson = await ratesRes.json();
  const ratesList = ratesJson?.data?.rates ?? ratesJson?.data ?? ratesJson?.rates ?? [];
  const hotel = ratesList[0];

  // 2) /data/hotel — the full catalog (rooms with AND without photos)
  let catalogRooms = [];
  let catalogRoomCount = 0;
  let catalogRoomsWithPhotos = 0;
  try {
    const detailRes = await fetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(hotelId)}`, {
      headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
    });
    const detailJson = await detailRes.json();
    const rooms = detailJson?.data?.rooms ?? [];
    catalogRoomCount = rooms.length;
    catalogRooms = rooms.map(r => {
      const photoCount = (r.photos || []).length;
      if (photoCount > 0) catalogRoomsWithPhotos++;
      return {
        room_type_id: r.id ?? r.roomId ?? r.roomTypeId ?? null,
        name:         r.roomName || r.name || null,
        photo_count:  photoCount,
        indexed:      photoCount > 0, // mirrors index-city-v2.js behaviour
      };
    });
  } catch (e) { /* tolerate catalog failure — still report rates */ }

  // 3) Our indexed inventory for this hotel (what we actually persisted)
  let indexedRooms = [];
  try {
    // db isn't declared at module scope — has to be wired up per handler.
    // Without this the supabase query throws ReferenceError, gets swallowed
    // by the try/catch, and indexedRooms stays [] — making every rate look
    // like IN_CATALOG_NOT_INDEXED even when it matches indexed inventory.
    const db = supabaseAdmin || supabase;
    const { data, error } = await db
      .from("v2_room_inventory")
      .select("room_name,room_type_id")
      .eq("hotel_id", hotelId);
    if (!error && data) {
      const seen = new Map();
      for (const row of data) {
        const k = `${row.room_type_id ?? "_null_"}|${row.room_name}`;
        if (!seen.has(k)) seen.set(k, { room_type_id: row.room_type_id, room_name: row.room_name, photo_rows: 0 });
        seen.get(k).photo_rows++;
      }
      indexedRooms = Array.from(seen.values());
    }
  } catch (e) { /* tolerate */ }
  const indexedIds = new Set(indexedRooms.map(r => r.room_type_id != null ? String(r.room_type_id) : null).filter(Boolean));

  // 4) Cross-reference each rate against indexed inventory
  const roomTypes = !hotel ? [] : (hotel.roomTypes || []).map(rt => {
    const firstRate = rt.rates?.[0] || {};
    const fromRetailTotal  = firstRate.retailRate?.total?.[0]?.amount;
    const fromRetailNet    = firstRate.retailRate?.net?.[0]?.amount;
    const fromTotal        = firstRate.total;
    const fromNet          = firstRate.net;
    const resolved = fromRetailTotal ?? fromRetailNet ?? fromTotal ?? fromNet ?? null;
    const mid = firstRate.mappedRoomId;
    const matchedIndex = mid != null && indexedIds.has(String(mid));
    return {
      roomTypeId:      rt.roomTypeId,
      rateCount:       rt.rates?.length,
      mappedRoomId:    mid,
      name:            firstRate.name,
      perNight:        resolved ? Math.round(resolved / nights) : null,
      // diagnostic: cause of mismatch
      mapping:         mid == null
        ? "NULL_MAPPED_ID"          // cause 1: LiteAPI didn't tag this rate
        : matchedIndex
          ? "MATCHED_INDEXED"        // good
          : (catalogRooms.find(c => String(c.room_type_id) === String(mid))
              ? "IN_CATALOG_NOT_INDEXED"   // cause 2: catalog room had 0 photos, we dropped it
              : "ID_NOT_IN_CATALOG"),       // cause 3: rate-only / supplier drift
    };
  });

  const summary = !hotel ? { foundHotel: false } : {
    foundHotel: true,
    rates_total:                roomTypes.length,
    rates_with_mappedRoomId:    roomTypes.filter(r => r.mappedRoomId != null).length,
    rates_matched_indexed:      roomTypes.filter(r => r.mapping === "MATCHED_INDEXED").length,
    rates_null_mapped_id:       roomTypes.filter(r => r.mapping === "NULL_MAPPED_ID").length,
    rates_catalog_not_indexed:  roomTypes.filter(r => r.mapping === "IN_CATALOG_NOT_INDEXED").length,
    rates_id_not_in_catalog:    roomTypes.filter(r => r.mapping === "ID_NOT_IN_CATALOG").length,
    catalog_rooms_total:        catalogRoomCount,
    catalog_rooms_with_photos:  catalogRoomsWithPhotos,
    indexed_room_types:         indexedRooms.length,
  };

  res.json({
    httpStatus: ratesRes.status,
    hotelId,
    nights,
    summary,
    rates: roomTypes,
    indexedRooms,
    catalogRooms,
  });
});

// ── Gemini model debug endpoint ───────────────────────────────────────────────
app.get("/api/debug-gemini", async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_KEY || "";
  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_KEY not set" });

  const models = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-lite-preview-06-17",
    "gemini-2.5-flash-lite-001",
    "gemini-2.5-flash",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
  ];

  // Tiny valid 2x2 red PNG in base64
  const testB64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";
  const testMime = "image/png";

  const results = [];

  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: testMime, data: testB64 } },
              { text: "What colour is this image? One word answer." }
            ]}],
            generationConfig: { maxOutputTokens: 10 }
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      const err  = data?.error?.message || null;
      results.push({ model, status: r.status, ok: r.ok, response: text, error: err });
      console.log(`[debug-gemini] ${model}: ${r.status} ${text || err || ""}`);
    } catch(e) {
      results.push({ model, status: "timeout", ok: false, error: e.message });
      console.log(`[debug-gemini] ${model}: ERROR ${e.message}`);
    }
  }

  const working = results.filter(r => r.ok && r.response);

  // Test embedding models
  const embedModels = [
    "text-embedding-004",
    "text-embedding-005",
    "gemini-embedding-001",
    "embedding-001",
    "text-multilingual-embedding-002",
  ];
  const embedResults = [];
  for (const model of embedModels) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text: "test hotel room" }] } }),
          signal: AbortSignal.timeout(8000),
        }
      );
      const data = await r.json();
      const dims = data?.embedding?.values?.length || null;
      const err  = data?.error?.message || null;
      embedResults.push({ model, status: r.status, ok: r.ok, dims, error: err });
      console.log(`[debug-gemini] embed ${model}: ${r.status} dims=${dims} ${err||""}`);
    } catch(e) {
      embedResults.push({ model, status: "timeout", ok: false, error: e.message });
    }
  }

  res.json({
    visionResults: results,
    workingVision: working.map(r => r.model),
    embedResults,
    workingEmbeds: embedResults.filter(r => r.ok && r.dims).map(r => `${r.model} (${r.dims} dims)`),
  });
});

// ── Deep debug endpoint — tests all LiteAPI params for a city ─────────────────
app.get("/api/debug-city", async (req, res) => {
  const city = (req.query.city || "Paris").trim();
  const report = { city, tests: [] };

  async function test(label, path) {
    try {
      const r = await liteGet(path);
      const data = r.data?.data || r.data || [];
      const count = Array.isArray(data) ? data.length : (r.data?.total ?? "?");
      const sample = Array.isArray(data) && data[0]
        ? { id: data[0].id || data[0].hotelId, name: data[0].name }
        : null;
      report.tests.push({ label, status: r.status, count, sample, ok: r.ok });
      console.log(`[debug] ${label}: status=${r.status} count=${count}`);
    } catch(e) {
      report.tests.push({ label, error: e.message });
      console.log(`[debug] ${label}: ERROR ${e.message}`);
    }
  }

  const coords = resolveCoords(city);
  const cc = { "paris":"FR","london":"GB","new york city":"US","nyc":"US",
                "tokyo":"JP","sydney":"AU","dubai":"AE","barcelona":"ES" }[city.toLowerCase()] || "";

  // ── Full hotel catalog tests ───────────────────────────────────────────────
  await test("hotels: countryCode+cityName limit=50",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=50`);

  await test("hotels: countryCode+cityName limit=200",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  if (coords) {
    await test("hotels: lat/lng radius=15000m limit=50",
      `/data/hotels?latitude=${coords[0]}&longitude=${coords[1]}&radius=15000&limit=50`);
    await test("hotels: lat/lng radius=30000m limit=200",
      `/data/hotels?latitude=${coords[0]}&longitude=${coords[1]}&radius=30000&limit=200`);
  }

  // ── Room-search index tests ────────────────────────────────────────────────
  const q = encodeURIComponent("hotel room");

  await test("room-search: countryCode+cityName limit=50",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=50`);

  await test("room-search: countryCode+cityName limit=100",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=100`);

  if (coords) {
    await test("room-search: lat/lng radius=30 limit=50",
      `/data/hotels/room-search?query=${q}&latitude=${coords[0]}&longitude=${coords[1]}&radius=30&limit=50`);
    await test("room-search: lat/lng radius=50 limit=100",
      `/data/hotels/room-search?query=${q}&latitude=${coords[0]}&longitude=${coords[1]}&radius=50&limit=100`);
  }

  await test("room-search: city param only limit=50",
    `/data/hotels/room-search?query=${q}&city=${encodeURIComponent(city)}&limit=50`);

  await test("room-search: no geo limit=100",
    `/data/hotels/room-search?query=${q}&limit=100`);

  await test("room-search: countryCode+cityName limit=200",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  // Broader queries as suggested by LiteAPI docs
  const qBroad = encodeURIComponent("room OR suite OR bedroom");
  await test("room-search: broad OR query countryCode+cityName limit=200",
    `/data/hotels/room-search?query=${qBroad}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  // Full catalog with high limit
  await test("hotels: countryCode+cityName limit=500",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=500`);

  await test("hotels: countryCode+cityName limit=1000",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=1000`);

  // Check total count via offset
  const r500 = await liteGet(`/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=1&offset=0`);
  report.totalHotelsInCatalog = r500.data?.total || r500.data?.count || "unknown";
  console.log(`[debug] total hotels in LiteAPI catalog for ${city}: ${report.totalHotelsInCatalog}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const roomSearchMax = Math.max(...report.tests
    .filter(t => t.label.includes("room-search"))
    .map(t => typeof t.count === "number" ? t.count : 0));
  const hotelCatalogMax = Math.max(...report.tests
    .filter(t => t.label.includes("hotels:"))
    .map(t => typeof t.count === "number" ? t.count : 0));

  report.summary = {
    hotelCatalogMax,
    roomSearchIndexMax: roomSearchMax,
    gap: `${roomSearchMax} room-search vs ${hotelCatalogMax} full catalog`,
    conclusion: roomSearchMax < hotelCatalogMax * 0.1
      ? "Room-search index is VERY sparse for this city (<10% of catalog)"
      : roomSearchMax < hotelCatalogMax * 0.5
      ? "Room-search index is PARTIAL for this city (<50% of catalog)"
      : "Room-search index covers most of the catalog"
  };

  res.json(report);
});

// ── City autocomplete via Geoapify (free tier: 3000 req/day, no card needed) ──
// Get a free key at: https://myprojects.geoapify.com
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "";

app.get("/api/places", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) return res.json({ places: [] });

  // No key — return empty, frontend will just have no suggestions
  if (!GEOAPIFY_KEY) {
    console.warn("[places] GEOAPIFY_KEY not set");
    return res.json({ places: [] });
  }

  try {
    const url = "https://api.geoapify.com/v1/geocode/autocomplete?" + new URLSearchParams({
      text:    q,
      type:    "city",
      limit:   8,
      format:  "json",
      apiKey:  GEOAPIFY_KEY,
    });
    const r    = await fetch(url);
    const data = await r.json();

    const places = (data.results || [])
      .filter(p => p.city || p.name)
      .map(p => ({
        name:         p.city || p.name || "",
        country:      p.country || "",
        state:        p.state   || "",
        country_code: (p.country_code || "").toUpperCase() || null,
        lat:          p.lat ?? null,
        lng:          p.lon ?? null,
      }))
      // Deduplicate by name+country
      .filter((p, i, arr) =>
        arr.findIndex(x => x.name === p.name && x.country === p.country) === i
      );

    res.json({ places });
  } catch (err) {
    console.error("[places]", err.message);
    res.json({ places: [] });
  }
});


// ── Main search endpoint ───────────────────────────────────────────────────────
app.get("/api/room-search", async (req, res) => {
  const { query, city } = req.query;
  if (!query || !city) return res.status(400).json({ error: "query and city are required" });
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });

  // ── Step 1: room-search with 3-attempt strategy to maximise results ─────────
  const coords = resolveCoords(city);

  async function trySearch(extraParams) {
    const p = new URLSearchParams({ query, limit: 50, ...extraParams });
    // Remove empty values
    for (const [k, v] of [...p.entries()]) { if (v === "" || v === undefined) p.delete(k); }
    console.log(`[search] trying: ${p.toString()}`);
    const r = await liteGet(`/data/hotels/room-search?${p}`);
    const count = r.data?.data?.length ?? 0;
    console.log(`[search] got ${count} hotels`);
    return r.ok ? (r.data?.data || []) : [];
  }

  // Look up country code for the city
  const COUNTRY_CODES = {
    // Europe
    "paris": "FR", "nice": "FR", "lyon": "FR", "marseille": "FR", "bordeaux": "FR",
    "london": "GB", "edinburgh": "GB", "manchester": "GB", "liverpool": "GB",
    "barcelona": "ES", "madrid": "ES", "seville": "ES", "valencia": "ES", "ibiza": "ES",
    "rome": "IT", "milan": "IT", "florence": "IT", "venice": "IT", "naples": "IT",
    "amsterdam": "NL", "berlin": "DE", "munich": "DE", "hamburg": "DE", "frankfurt": "DE",
    "vienna": "AT", "zurich": "CH", "geneva": "CH", "brussels": "BE",
    "prague": "CZ", "budapest": "HU", "warsaw": "PL", "krakow": "PL",
    "athens": "GR", "lisbon": "PT", "porto": "PT", "oslo": "NO",
    "stockholm": "SE", "copenhagen": "DK", "helsinki": "FI", "dublin": "IE",
    "istanbul": "TR", "reykjavik": "IS",
    // Americas
    "new york city": "US", "new york": "US", "nyc": "US", "los angeles": "US",
    "chicago": "US", "miami": "US", "san francisco": "US", "las vegas": "US",
    "seattle": "US", "boston": "US", "washington dc": "US", "austin": "US",
    "denver": "US", "nashville": "US", "atlanta": "US", "dallas": "US",
    "houston": "US", "portland": "US", "new orleans": "US", "tacoma": "US",
    "toronto": "CA", "vancouver": "CA", "montreal": "CA",
    "mexico city": "MX", "cancun": "MX",
    "rio de janeiro": "BR", "sao paulo": "BR", "buenos aires": "AR",
    "bogota": "CO", "lima": "PE", "santiago": "CL",
    // Asia
    "tokyo": "JP", "osaka": "JP", "kyoto": "JP",
    "seoul": "KR", "beijing": "CN", "shanghai": "CN",
    "hong kong": "HK", "singapore": "SG",
    "bangkok": "TH", "phuket": "TH", "chiang mai": "TH",
    "bali": "ID", "jakarta": "ID", "kuala lumpur": "MY",
    "mumbai": "IN", "delhi": "IN", "goa": "IN",
    "dubai": "AE", "abu dhabi": "AE", "doha": "QA",
    // Africa & Middle East
    "cairo": "EG", "marrakech": "MA", "cape town": "ZA",
    "nairobi": "KE", "tel aviv": "IL",
    // Oceania
    "sydney": "AU", "melbourne": "AU", "auckland": "NZ",
  };
  const countryCode = COUNTRY_CODES[city.trim().toLowerCase()] || "";

  // Attempt 1: countryCode + cityName (recommended by LiteAPI support)
  let searchData = countryCode
    ? await trySearch({ countryCode, cityName: city })
    : [];

  // Attempt 2: lat/lng with radius
  if (searchData.length < 15 && coords) {
    const r2 = await trySearch({ latitude: coords[0], longitude: coords[1], radius: 30 });
    if (r2.length > searchData.length) {
      searchData = r2;
      console.log(`[search] lat/lng attempt better, using it`);
    }
  }

  // Attempt 3: city name only
  if (searchData.length < 15) {
    const r3 = await trySearch({ city });
    if (r3.length > searchData.length) {
      searchData = r3;
      console.log(`[search] city-name attempt better, using it`);
    }
  }

  // Attempt 4: no geo filter
  if (searchData.length < 15) {
    const r4 = await trySearch({});
    if (r4.length > searchData.length) {
      searchData = r4;
      console.log(`[search] no-geo attempt better, using it`);
    }
  }

  console.log(`[search] final pool: ${searchData.length} hotels`);
  if (searchData.length === 0 && !countryCode && !coords) {
    return res.json({ hotels: [], query, city });
  }

  // Normalise similarity scores to 30–95% range
  const rawScores = searchData.map(h => h.rooms?.[0]?.similarity || 0);
  const maxS = Math.max(...rawScores) || 1;
  const minS = Math.min(...rawScores.filter(s => s > 0)) || 0;
  const norm = s => s > 0 ? Math.round(30 + ((s - minS) / (maxS - minS || 1)) * 65) : null;

  // Build a map of hotelId → best match info from room-search
  const bestMatchMap = {};
  const matchedIds = new Set();
  searchData.forEach(h => {
    const r = h.rooms?.[0];
    bestMatchMap[h.id] = {
      roomName: r?.room_name || "",
      imageUrl: r?.image_url || "",
      score:    norm(r?.similarity || 0),
    };
    matchedIds.add(h.id);
  });

  // ── Hybrid: pad with regular hotel list if room-search returned < 15 ─────────
  let paddingHotels = [];
  if (searchData.length < 15) {
    const needed = 20 - searchData.length;
    const padParams = new URLSearchParams({ limit: needed + 5 }); // fetch a few extra to filter dupes
    if (countryCode) { padParams.set("countryCode", countryCode); padParams.set("cityName", city); }
    else if (coords)  { padParams.set("latitude", coords[0]); padParams.set("longitude", coords[1]); padParams.set("radius", 15000); }
    else               { padParams.set("city", city); }

    const padRes = await liteGet(`/data/hotels?${padParams}`);
    if (padRes.ok) {
      paddingHotels = (padRes.data?.data || [])
        .filter(h => !matchedIds.has(h.id || h.hotelId))
        .slice(0, needed);
      console.log(`[search] hybrid: adding ${paddingHotels.length} unmatched hotels to pad results`);
    }
  }

  // ── Step 2: parallel-fetch hotel details ─────────────────────────────────────
  const top20 = searchData.slice(0, 20);
  const detailResults = await Promise.all([
    ...top20.map(h => liteGet(`/data/hotel?hotelId=${h.id}`).catch(() => null)),
    ...paddingHotels.map(h => liteGet(`/data/hotel?hotelId=${h.id || h.hotelId}`).catch(() => null)),
  ]);
  const top20Details     = detailResults.slice(0, top20.length);
  const paddingDetails   = detailResults.slice(top20.length);

  // ── Step 3: build structured hotel + room-type response ──────────────────────
  function buildHotel(h, detail, best, isMatched) {

    // Group detail rooms by roomName, collecting all photos per type
    const roomTypeMap = new Map();
    for (const room of (detail?.rooms || [])) {
      const name    = room.roomName || room.name || "Room";
      const photos  = (room.photos || []).map(p => p.url || p.hd_url || "").filter(Boolean);
      const size    = room.roomSizeSquare
        ? `${room.roomSizeSquare} ${room.roomSizeUnit || "sqm"}`
        : "";
      const amenities = (room.roomAmenities || []).map(a => a.name).filter(Boolean).slice(0, 5);
      const beds    = (room.bedTypes || []).map(b => `${b.quantity}× ${b.bedType}`).join(", ");
      const views   = (room.views || []).map(v => v.view).filter(Boolean).join(", ");

      if (!roomTypeMap.has(name)) {
        roomTypeMap.set(name, { name, photos: [], size, amenities, beds, views, score: null });
      }
      // Merge photos, deduplicate by URL
      const existing = roomTypeMap.get(name);
      for (const p of photos) {
        if (!existing.photos.includes(p)) existing.photos.push(p);
      }
    }

    // Assign the best-match score to the matching room type (fuzzy name match)
    if (best.roomName) {
      const bestNameLower = best.roomName.toLowerCase();
      let matched = false;
      for (const [name, rt] of roomTypeMap) {
        if (name.toLowerCase() === bestNameLower ||
            name.toLowerCase().includes(bestNameLower) ||
            bestNameLower.includes(name.toLowerCase())) {
          rt.score = best.score;
          // Ensure the best-match image is first in photos
          if (best.imageUrl && !rt.photos.includes(best.imageUrl)) {
            rt.photos.unshift(best.imageUrl);
          }
          matched = true;
          break;
        }
      }
      // If no name match, inject the best-match room as its own entry at the top
      if (!matched && best.imageUrl) {
        roomTypeMap.set("__best__" + best.roomName, {
          name: best.roomName, photos: [best.imageUrl],
          size: "", amenities: [], beds: "", views: "", score: best.score
        });
      }
    }

    // Sort: scored room first, then rest alphabetically
    const roomTypes = [...roomTypeMap.values()].sort((a, b) => {
      if (a.score !== null && b.score === null) return -1;
      if (b.score !== null && a.score === null) return 1;
      return (b.score || 0) - (a.score || 0);
    });

    return {
      id:         h.id || h.hotelId,
      name:       detail?.name      || h.name     || "Hotel",
      address:    detail?.address   || h.address  || "",
      city:       detail?.city      || h.city     || city,
      country:    detail?.country   || h.country  || "",
      starRating: detail?.starRating || h.starRating || h.stars || 0,
      rating:     detail?.rating    || h.rating   || h.guestRating || 0,
      roomTypes:  roomTypes.slice(0, 6),
      isMatched,  // flag so frontend can show section divider
    };
  }

  const matchedHotels  = top20.map((h, i) => buildHotel(h, top20Details[i]?.data?.data, bestMatchMap[h.id], true));
  const paddedHotels   = paddingHotels.map((h, i) => buildHotel(h, paddingDetails[i]?.data?.data, { roomName:"", imageUrl:"", score:null }, false));
  const hotels         = [...matchedHotels, ...paddedHotels];

  // Re-sort hotels by their best room score (highest first) after enrichment
  // Room-search order can drift once we merge detail data
  // Cap display at 20 best matches even if API returned more
  const sortedHotels = hotels
    .map(h => ({
      ...h,
      _bestScore: h.roomTypes.find(rt => rt.score !== null)?.score ?? 0,
    }))
    .sort((a, b) => b._bestScore - a._bestScore)
    .map(({ _bestScore, ...h }) => h);

  console.log(`[search] done — ${sortedHotels.length} hotels sorted by score: ${sortedHotels.map(h => h.roomTypes.find(rt=>rt.score)?.score ?? 0).join(",")}`);
  res.json({ hotels: sortedHotels, query, city });
});

// ── CLIP search via HuggingFace + LiteAPI full catalog ────────────────────────
// Streams results via SSE so hotels appear progressively as they score
const HF_KEY = process.env.HUGGINGFACE_KEY || "";
const VLM_MODEL = "meta-llama/Llama-3.2-11B-Vision-Instruct";

const COUNTRY_CODES_CLIP = {
  "paris":"FR","nice":"FR","lyon":"FR","marseille":"FR","bordeaux":"FR",
  "london":"GB","edinburgh":"GB","manchester":"GB","liverpool":"GB","bristol":"GB",
  "barcelona":"ES","madrid":"ES","seville":"ES","valencia":"ES","ibiza":"ES","malaga":"ES",
  "rome":"IT","milan":"IT","florence":"IT","venice":"IT","naples":"IT","bologna":"IT",
  "amsterdam":"NL","rotterdam":"NL",
  "berlin":"DE","munich":"DE","hamburg":"DE","frankfurt":"DE","cologne":"DE","dresden":"DE",
  "vienna":"AT","salzburg":"AT","zurich":"CH","geneva":"CH","bern":"CH","lucerne":"CH",
  "brussels":"BE","bruges":"BE","ghent":"BE",
  "prague":"CZ","budapest":"HU","warsaw":"PL","krakow":"PL","gdansk":"PL","wroclaw":"PL",
  "athens":"GR","santorini":"GR","mykonos":"GR","thessaloniki":"GR",
  "lisbon":"PT","porto":"PT",
  "oslo":"NO","bergen":"NO","stockholm":"SE","gothenburg":"SE","copenhagen":"DK",
  "helsinki":"FI","reykjavik":"IS","dublin":"IE","galway":"IE",
  "istanbul":"TR","antalya":"TR","bodrum":"TR",
  "new york city":"US","new york":"US","nyc":"US","manhattan":"US",
  "los angeles":"US","chicago":"US","miami":"US","san francisco":"US","las vegas":"US",
  "seattle":"US","boston":"US","washington dc":"US","austin":"US","denver":"US",
  "nashville":"US","atlanta":"US","dallas":"US","houston":"US","portland":"US",
  "new orleans":"US","tacoma":"US","phoenix":"US","san diego":"US","orlando":"US",
  "toronto":"CA","vancouver":"CA","montreal":"CA","calgary":"CA",
  "mexico city":"MX","cancun":"MX","tulum":"MX",
  "rio de janeiro":"BR","sao paulo":"BR","salvador":"BR",
  "buenos aires":"AR","bogota":"CO","cartagena":"CO","lima":"PE","santiago":"CL",
  "tokyo":"JP","osaka":"JP","kyoto":"JP","hiroshima":"JP","sapporo":"JP",
  "seoul":"KR","busan":"KR",
  "beijing":"CN","shanghai":"CN","chengdu":"CN","guilin":"CN",
  "hong kong":"HK","macau":"MO","taipei":"TW",
  "bangkok":"TH","chiang mai":"TH","phuket":"TH","koh samui":"TH","krabi":"TH",
  "singapore":"SG","kuala lumpur":"MY","penang":"MY","langkawi":"MY",
  "bali":"ID","jakarta":"ID","yogyakarta":"ID","lombok":"ID",
  "hanoi":"VN","ho chi minh city":"VN","da nang":"VN","hoi an":"VN",
  "siem reap":"KH","phnom penh":"KH","luang prabang":"LA",
  "mumbai":"IN","delhi":"IN","bangalore":"IN","goa":"IN","jaipur":"IN","agra":"IN",
  "dubai":"AE","abu dhabi":"AE","doha":"QA","riyadh":"SA","muscat":"OM",
  "tel aviv":"IL","jerusalem":"IL","amman":"JO","beirut":"LB",
  "cairo":"EG","luxor":"EG","hurghada":"EG","sharm el sheikh":"EG",
  "marrakech":"MA","casablanca":"MA","fez":"MA",
  "cape town":"ZA","johannesburg":"ZA","nairobi":"KE","zanzibar":"TZ",
  "sydney":"AU","melbourne":"AU","brisbane":"AU","perth":"AU","cairns":"AU",
  "auckland":"NZ","queenstown":"NZ",
  "maldives":"MV","bora bora":"PF","fiji":"FJ",
};

// ── HuggingFace CLIP scoring ──────────────────────────────────────────────────
// Rate limit: free tier = 200 req / 5 min → throttle to max 30 req/min to be safe
let _hfReqCount = 0;
let _hfWindowStart = Date.now();

async function hfThrottle() {
  const now = Date.now();
  if (now - _hfWindowStart > 60000) { _hfReqCount = 0; _hfWindowStart = now; }
  if (_hfReqCount >= 30) {
    const wait = 60000 - (now - _hfWindowStart) + 100;
    console.log(`[clip] rate limit pause ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
    _hfReqCount = 0; _hfWindowStart = Date.now();
  }
  _hfReqCount++;
}

async function clipScore(imageUrl, textQuery) {
  if (!HF_KEY) return 0;
  try {
    await hfThrottle();

    // Use Llama Vision via HuggingFace router — ask it to rate how well the image matches
    const prompt = `Rate how well this hotel room photo matches the description: "${textQuery}". Reply with ONLY a number from 0 to 100, where 100 is a perfect match and 0 is no match. Consider visual features like room style, bathroom features, furniture, lighting. Reply with just the number.`;

    const r = await fetch(
      `https://router.huggingface.co/hf-inference/models/${VLM_MODEL}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: prompt }
              ]
            }
          ],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!r.ok) {
      const err = await r.text();
      console.warn(`[clip] HF error ${r.status}: ${err.slice(0, 100)}`);
      return 0;
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "0";
    const score = Math.min(100, Math.max(0, parseInt(text.replace(/[^0-9]/g, "")) || 0));
    return score / 100; // normalise to 0-1
  } catch (e) {
    console.warn(`[clip] error:`, e.message);
    return 0;
  }
}

app.get("/api/clip-search", async (req, res) => {
  const { query, city } = req.query;
  if (!query || !city) return res.status(400).json({ error: "query and city are required" });
  if (String(process.env.CLIP_SEARCH_ENABLED || "").toLowerCase() !== "true") {
    return res.status(503).json({ error: "CLIP search is disabled for this deployment" });
  }
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });
  if (!HF_KEY)         return res.status(500).json({ error: "HUGGINGFACE_KEY not configured" });

  // SSE headers — allows streaming hotels to frontend as they score
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}

`);

  try {
    // Step 1: fetch full hotel catalog for city
    const cityKey     = city.trim().toLowerCase();
    const countryCode = COUNTRY_CODES_CLIP[cityKey] || "";
    const hotelParams = new URLSearchParams({ limit: 50 });
    if (countryCode) { hotelParams.set("countryCode", countryCode); hotelParams.set("cityName", city); }
    else             { hotelParams.set("latitude", resolveCoords(city)?.[0] || ""); hotelParams.set("longitude", resolveCoords(city)?.[1] || ""); hotelParams.set("radius", 15000); }

    send({ type: "status", message: `Fetching hotels in ${city}…` });
    const hotelsRes = await liteGet(`/data/hotels?${hotelParams}`);
    const allHotels = hotelsRes.data?.data || [];
    if (!allHotels.length) { send({ type: "done", total: 0 }); return res.end(); }

    const top10 = allHotels.slice(0, 10);
    send({ type: "status", message: `Scoring ${top10.length} hotels with CLIP…` });

    // Step 2: for each hotel fetch details + score all room photos
    for (let i = 0; i < top10.length; i++) {
      const h = top10[i];
      send({ type: "status", message: `Analyzing hotel ${i + 1} of ${top10.length}: ${h.name || h.id}` });

      // Fetch hotel detail
      const detailRes = await liteGet(`/data/hotel?hotelId=${h.id || h.hotelId}`);
      const detail    = detailRes.data?.data || null;

      // Collect all room photos grouped by room type
      const roomTypeMap = new Map();
      for (const room of (detail?.rooms || [])) {
        const name   = room.roomName || room.name || "Room";
        const photos = (room.photos || []).map(p => p.url || p.hd_url || "").filter(Boolean);
        const size   = room.roomSizeSquare ? `${room.roomSizeSquare} ${room.roomSizeUnit || "sqm"}` : "";
        const beds   = (room.bedTypes || []).map(b => `${b.quantity}× ${b.bedType}`).join(", ");
        const amenities = (room.roomAmenities || []).map(a => a.name).filter(Boolean).slice(0, 5);
        if (!roomTypeMap.has(name)) {
          roomTypeMap.set(name, { name, photos: [], size, beds, amenities, scores: [] });
        }
        const rt = roomTypeMap.get(name);
        for (const p of photos) {
          if (!rt.photos.includes(p)) rt.photos.push(p);
        }
      }

      // Score all photos for each room type with CLIP
      console.log(`[clip] hotel "${h.name}" has ${roomTypeMap.size} room types`);
      for (const rt of roomTypeMap.values()) {
        console.log(`[clip]   "${rt.name}" — ${rt.photos.length} photos`);
        const photoScores = await Promise.all(
          rt.photos.slice(0, 1).map(url => clipScore(url, query))
        );
        rt.scores = photoScores;
        console.log(`[clip]   scores: ${photoScores.map(s => s.toFixed(3)).join(", ")}`);
      }

      // Build room types sorted by best photo score
      const roomTypes = [...roomTypeMap.values()]
        .map(rt => {
          const bestIdx   = rt.scores.indexOf(Math.max(...rt.scores, 0));
          const bestScore = rt.scores[bestIdx] || 0;
          // Re-order photos: best scoring first
          const orderedPhotos = rt.photos.length
            ? [rt.photos[bestIdx], ...rt.photos.filter((_, i) => i !== bestIdx)]
            : rt.photos;
          return {
            name:      rt.name,
            photos:    orderedPhotos,
            size:      rt.size,
            beds:      rt.beds,
            amenities: rt.amenities,
            score:     bestScore > 0 ? Math.round(bestScore * 100) : null,
            rawScore:  bestScore,
          };
        })
        .sort((a, b) => (b.rawScore || 0) - (a.rawScore || 0));

      const hotelBestScore = roomTypes[0]?.rawScore || 0;

      send({
        type: "hotel",
        hotel: {
          id:         h.id || h.hotelId || "",
          name:       detail?.name      || h.name || "Hotel",
          address:    detail?.address   || h.address || "",
          city:       detail?.city      || h.city   || city,
          country:    detail?.country   || h.country || "",
          starRating: detail?.starRating || h.starRating || h.stars || 0,
          rating:     detail?.rating    || h.rating || h.guestRating || 0,
          roomTypes:  roomTypes.slice(0, 6),
          clipScore:  Math.round(hotelBestScore * 100),
          isMatched:  true,
        }
      });
    }

    send({ type: "done", total: top10.length });
  } catch (err) {
    console.error("[clip-search]", err);
    send({ type: "error", message: err.message });
  }

  res.end();
});

// ── Vector search endpoint ────────────────────────────────────────────────────
app.get("/api/vsearch", async (req, res) => {
  const requestedVersionRaw = String(req.query.search_version || process.env.SEARCH_VERSION_DEFAULT || "v2").toLowerCase();
  const requestedVersion = requestedVersionRaw === "v2" ? "v2" : "v1";
  if (requestedVersion === "v2") {
    const v2 = await runV2Search({
      req,
      supabase,
      supabaseAdmin,
      resolveCityName,
    });
    if (v2.status === 200 && v2.body?.hotels?.length) {
      // Sync-fetch LiteAPI metadata for the top META_SYNC_LIMIT hotels (regardless of
      // whether their indexed room photos were loaded by Phase B) — those are the
      // cards the user sees on first paint. Lazy-fetch the rest in the background so
      // every hotel — including "stubs" beyond GALLERY_LIMIT that have no indexed
      // room rows — still gets a real LiteAPI name, hero photo, star rating, and
      // address. Without this, stubs would render as "Hotel in {city}" forever.
      const META_SYNC_LIMIT = parseInt(process.env.META_SYNC_LIMIT || "30", 10);
      const allIds       = v2.body.hotels.map((h) => String(h.id).trim()).filter(Boolean);
      const boopProfileForMeta = parseBoopProfileFromQuery(req.query);
      const needsStarPenaltyMeta = needsBoopStarMetaForRanking(boopProfileForMeta);
      const STAR_PENALTY_META_TOPN = parseInt(process.env.STAR_PENALTY_META_TOPN || "150", 10);
      const metaFetchTopN = needsStarPenaltyMeta
        ? Math.min(allIds.length, Math.max(META_SYNC_LIMIT, STAR_PENALTY_META_TOPN))
        : META_SYNC_LIMIT;
      const syncIds      = allIds.slice(0, metaFetchTopN);
      const deferredIds  = allIds.slice(metaFetchTopN);
      const photoHotels  = v2.body.hotels.filter(h => h.roomTypes?.length > 0).length;
      const t0meta = Date.now();
      const liveMeta = await fetchHotelMetaBatch(syncIds);
      const filled = Object.values(liveMeta).filter(Boolean).length;
      console.log(
        `[v2-meta] sync fetched ${filled}/${syncIds.length} hotels in ${Date.now()-t0meta}ms` +
        ` (deferred ${deferredIds.length}, total ${allIds.length}, with_photos ${photoHotels}` +
        `${needsStarPenaltyMeta ? ", star_penalty_meta=1" : ""})`
      );
      for (const h of v2.body.hotels) {
        const sid = String(h.id).trim();
        const m = liveMeta[sid];
        if (m) {
          h.name        = resolveHotelNameFromMeta(m, sid, h.name);
          h.mainPhoto   = m.mainPhoto   || null;
          h.starRating  = m.starRating  || 0;
          h.rating      = m.guestRating || 0;
          h.address     = m.address     || "";
        } else if (isPlaceholderHotelTitle(h.name, sid)) {
          h.name = "";
        }
      }
      // Tell the client which IDs still need a meta fetch so it can lazy-batch them.
      v2.body.deferred_meta_ids = deferredIds;
      // Warm cache in the background — finishes ~1–3s after response is sent.
      prefetchHotelMetaBackground(deferredIds);

      // ── Boop star-class ranking tweaks (no live rates) ─────────────────────
      try {
        const boopProfile = boopProfileForMeta || parseBoopProfileFromQuery(req.query);
        if (boopProfile) {
          const luxuryPref  = Number(boopProfile?.prefs?.luxury ?? 0);
          const priceMatters = Number(boopProfile?.answers?.priceMatters);
          const hasBoopTailoredQuery = !!(
            String(req.query.hotel_query || "").trim() ||
            String(req.query.must_haves || "").trim() ||
            String(req.query.query || "").trim()
          );
          const nbhdWeight = v2.body.stats?.nbhd_rank_weight ?? 0;
          if (luxuryPref < -5) {
            const luxPenFactor = Math.min(0.30, Math.abs(luxuryPref) / 50);
            for (const h of v2.body.hotels) {
              const stars = h.starRating || 3;
              if (stars > 3) {
                const penalty = luxPenFactor * Math.min(1, (stars - 3) / 2);
                h.vectorScore = Math.max(0, Math.round(h.vectorScore * (1 - penalty)));
              }
            }
            sortV2HotelsDefault(v2.body.hotels, nbhdWeight);
            v2.body.stats.luxury_star_penalty_applied = true;
            v2.body.stats.luxury_pref = luxuryPref;
          }
          // Continuous price blend: every slider step shifts ranking (stars w/o dates).
          v2.body.stats.price_matters_ranking_active = false;
          if (hasBoopTailoredQuery && Number.isFinite(priceMatters) && priceMatters !== 0) {
            const pmStrength = boopPriceMattersStrength(priceMatters);
            v2.body.stats.price_matters = priceMatters;
            v2.body.stats.price_matters_strength = pmStrength;
            v2.body.stats.price_matters_ranking_active = true;
            sortV2HotelsByPriceMatters(v2.body.hotels, nbhdWeight, priceMatters, null);
            v2.body.stats.price_matters_mode = priceMatters > 0 ? "room_penalty_value" : "room_bonus_splurge";
            console.log(
              `[v2] price_matters: pm=${priceMatters} strength=${pmStrength.toFixed(2)} `
              + `mode=${v2.body.stats.price_matters_mode}`
            );
          }
        }
      } catch (e) {
        console.warn("[v2] star-penalty failed (non-fatal):", e.message);
      }

      return res.status(200).json(v2.body);
    }
    // V2 returned no results (city not yet indexed in V2 or no matches) — fall through to V1.
    if (v2.status !== 200) {
      return res.status(v2.status).json(v2.body);
    }
    console.log(`[vsearch] V2 returned 0 results for ${req.query.city}, falling back to V1`);
  }

  const { query } = req.query;
  const cityInput = (req.query.city || "").trim();
  // BOOP v4 optional inputs:
  //   hotel_query — separate HyDE seed for hotel-level vibe (lobby/bar/etc.). When
  //     provided, we run score_hotels in parallel and attach hotelScore per result.
  //   must_haves  — comma-separated feature-flag names (e.g. "balcony,work_desk")
  //     to union with query-text detection. Lets the client send picks explicitly
  //     without needing the query text to contain all the keywords.
  const hotelQuery = (req.query.hotel_query || "").trim() || null;
  const mustHavesRaw = (req.query.must_haves || "").trim();
  const clientMustHaves = mustHavesRaw
    ? mustHavesRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  if (!query || !cityInput) return res.status(400).json({ error: "query and city required" });
  if (!supabase)       return res.status(500).json({ error: "Supabase not configured" });
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["indexed_cities", "hotels_cache"]);

  const CC_MAP = {
    "paris":"FR","london":"GB","new york city":"US","new york":"US","nyc":"US",
    "tokyo":"JP","sydney":"AU","dubai":"AE","barcelona":"ES","rome":"IT",
    "amsterdam":"NL","berlin":"DE","madrid":"ES","vienna":"AT","prague":"CZ",
    "bangkok":"TH","singapore":"SG","hong kong":"HK","seoul":"KR","milan":"IT",
  };

  const t0 = Date.now();
  try {
    // 1. Check if city is indexed — use admin key to avoid anon-role permission gaps
    const { data: cityRow } = await (supabaseAdmin || supabase)
      .from("indexed_cities")
      .select("status, hotel_count, photo_count")
      .eq("city", city)
      .single();

    const status = cityRow?.status || "none";
    const hotelCount = cityRow?.hotel_count || 0;

    // Already indexing but has partial data — allow search to proceed on whatever's indexed
    // Only block entirely if there is truly nothing indexed yet
    if (status === "indexing" && hotelCount === 0) {
      console.log(`[vsearch] ${city} indexing with no data yet — returning status`);
      return res.json({
        hotels: [], query, city,
        indexing: true,
        indexStatus: "indexing",
        message: `Visual index for ${city} is being built. Check back in a few minutes.`
      });
    }

    // Not indexed at all — trigger background indexing and fall back
    if (status === "none" || !cityRow) {
      console.log(`[vsearch] ${city} not indexed — triggering background index`);
      if (supabaseAdmin) {
        // Atomic insert — only succeeds if city doesn't already exist
        // Prevents duplicate runs if two requests come in simultaneously
        const { error: insertErr } = await supabaseAdmin
          .from("indexed_cities")
          .insert({ city, country_code: CC_MAP[city.toLowerCase()] || "", status: "indexing",
                    started_at: new Date().toISOString(), updated_at: new Date().toISOString() });

        if (!insertErr) {
          // We won the race — start indexing
          loadIndexCity()(city, 200).catch(e => console.error("[indexer]", e.message));
        } else {
          console.log(`[vsearch] ${city} indexing already started by another request`);
        }
      }
      return res.json({
        hotels: [], query, city,
        indexing: true,
        indexStatus: "started",
        message: `Building visual index for ${city}. Check back in a few minutes.`
      });
    }

    // Proceed with vector search (complete or partially-indexed city)
    const indexing = status === "indexing"; // let client know if still in progress

    const fetchClient = supabaseAdmin || supabase;
    const GALLERY_LIMIT = 250;
    /** Set when BOOP profile + nbhd blend runs — used for final sort + optional response field */
    let nbhdRankWeight = 0;
    let nbhdFitByHotelId = null;

    // Feature flags from raw query — before HyDE so soft-flag coverage can run in parallel with HyDE + Phase A.
    // Union with any explicit client-supplied must_haves (BOOP v4 screen 6 picks).
    const textFlagSet = new Set(VSEARCH_FEATURE_FLAGS.filter(f => f.queryMatch.test(query)).map(f => f.flag));
    for (const mh of clientMustHaves) textFlagSet.add(mh);
    const detectedFlags = VSEARCH_FEATURE_FLAGS.filter(f => textFlagSet.has(f.flag));
    const flagMode =
      (process.env.VSEARCH_FLAG_MODE || "soft").toLowerCase() === "strict" ||
      String(req.query.flag_mode || "").toLowerCase() === "strict"
        ? "strict"
        : "soft";
    const required_features =
      flagMode === "strict" && detectedFlags.length > 0
        ? Object.fromEntries(detectedFlags.map(f => [f.flag, true]))
        : null;
    const detectedFlagKeys = detectedFlags.map(f => f.flag);

    if (detectedFlags.length) {
      console.log(
        `[vsearch] feature flags: ${detectedFlags.map(f => f.label).join(", ")}` +
          (flagMode === "strict" ? " → DB pre-filter" : " → soft boost (no hard filter)")
      );
    }

    let coveragePromise = Promise.resolve(null);
    if (flagMode === "soft" && detectedFlagKeys.length > 0) {
      coveragePromise = buildSoftFlagCoveragePromise(city, detectedFlagKeys, fetchClient);
    }

    // Only select spatial columns — display metadata (name, photo, ratings) is fetched
    // live from LiteAPI at response-build time and cached in-memory (fetchHotelMetaBatch).
    const hotelsPromise = fetchClient.from(hotelsCacheFor(city)).select("hotel_id, city, country_code, lat, lng").eq("city", city);

    // 2. HyDE: generate a hypothetical caption matching the room_embeddings vocabulary,
    // then embed it. This handles vocabulary gaps ("multiple sinks" → "double sinks"),
    // abstract queries ("spa bathroom", "romantic suite"), and negations ("no carpet"
    // → positive features only). Cache miss adds ~500ms; hits are free (4h TTL).
    const { negations } = extractNegations(query);
    if (negations.length) {
      console.log(`[vsearch] negations detected: [${negations.join(', ')}]`);
    }

    const tStartEmbed = Date.now();
    let queryEmbedding;
    let hydeText = null;
    const hydeKey_str = hydeKey(query);
    const cachedHyde  = hydeCache.get(hydeKey_str);

    if (cachedHyde && Date.now() - cachedHyde.ts < HYDE_TTL) {
      queryEmbedding = cachedHyde.embedding;
      hydeText       = cachedHyde.hypothetical;
      console.log(`[vsearch] HyDE cache hit: "${query}"`);
    } else {
      hydeText = await hydeGenerate(query, process.env.GEMINI_KEY);
      const textToEmbed = hydeText ?? query;
      if (hydeText) {
        console.log(`[vsearch] HyDE: "${query}" → "${hydeText.replace(/\n/g, ' ').slice(0, 120)}"`);
      }

      const embedRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text: textToEmbed }] } }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!embedRes.ok) throw new Error("Gemini embedding failed");
      const embedData = await embedRes.json();
      const rawEmbedding = embedData?.embedding?.values;
      if (!rawEmbedding) throw new Error("No embedding returned");
      queryEmbedding = rawEmbedding.slice(0, 768);
      hydeCache.set(hydeKey_str, { hypothetical: hydeText, embedding: queryEmbedding, ts: Date.now() });
    }

    // 3. intentType from HyDE (photo-type focus for scoring).
    const intentType = extractIntentType(hydeText, query);

    // BOOP v4: embed hotel_query in parallel with everything downstream. We
    // DON'T run HyDE expansion on it — the client already builds a rich
    // hotel-vibe seed like "polished luxury hotel in quiet central Paris with
    // a modern lobby, intimate bar, spa and rooftop pool" which is embedded
    // directly against hotel_profile_index.blended.
    let hotelQueryEmbedding = null;
    const hotelEmbedPromise = hotelQuery
      ? fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text: hotelQuery }] } }),
            signal: AbortSignal.timeout(8000),
          }
        )
          .then(r => r.ok ? r.json() : null)
          .then(d => { hotelQueryEmbedding = d?.embedding?.values?.slice(0, 768) || null; })
          .catch(e => { console.warn("[vsearch] hotel_query embed failed:", e.message); })
      : Promise.resolve();

    // ── Geo pre-filter: polygon (preferred) or bbox → hotel_ids for score_room_types ──
    let bboxHotelIds = null;
    const polygonParam = req.query.polygon;
    if (polygonParam) {
      try {
        const ring = normalizePolygonRing(JSON.parse(polygonParam));
        if (ring?.length >= 4) {
          const pb = bboxFromRing(ring);
          if (pb?.lat_min != null) {
            const { data: polyHotels } = await supabase
              .from(hotelsCacheFor(city))
              .select("hotel_id, lat, lng")
              .eq("city", city)
              .gte("lat", pb.lat_min).lte("lat", pb.lat_max)
              .gte("lng", pb.lon_min).lte("lng", pb.lon_max);
            bboxHotelIds = (polyHotels || [])
              .filter((h) => h.lat != null && h.lng != null && pointInPolygon(h.lat, h.lng, ring))
              .map((h) => h.hotel_id);
            console.log(`[vsearch] polygon filter: ${bboxHotelIds.length} hotels in polygon`);
            if (bboxHotelIds.length === 0) bboxHotelIds = null;
          }
        }
      } catch (e) {
        console.warn("[vsearch] polygon parse failed:", e.message);
      }
    }
    const bboxParam = req.query.bbox;
    if (!bboxHotelIds && bboxParam) {
      const parts = bboxParam.split(",").map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        const [lat_min, lat_max, lon_min, lon_max] = parts;
        const { data: bboxHotels } = await supabase
          .from(hotelsCacheFor(city))
          .select("hotel_id")
          .eq("city", city)
          .gte("lat", lat_min).lte("lat", lat_max)
          .gte("lng", lon_min).lte("lng", lon_max);
        bboxHotelIds = bboxHotels?.map(h => h.hotel_id) ?? [];
        console.log(`[vsearch] bbox filter: ${bboxHotelIds.length} hotels in bbox`);
        if (bboxHotelIds.length === 0) bboxHotelIds = null;
      }
    }

    // ── Phase A: room-type scoring (full city) + hotel metadata cache — in PARALLEL ──
    // score_room_types scans room_types_index (~7k rows for Paris) for all hotels in the
    // city. No pre-filter needed: hotel score = MAX room-type similarity across all rooms.
    // Running alongside hotels_cache eliminates a full sequential round trip vs the old
    // 3-phase flow (score_hotels → score_room_types → score_hotel_photos).
    const tAfterEmbed = Date.now();
    const [roomTypesResult, cachedResult, coverageMap] = await Promise.all([
      fetchClient.rpc("score_room_types", {
        query_embedding: queryEmbedding,
        search_city: city,
        ...(required_features ? { required_features } : {}),
        ...(bboxHotelIds ? { hotel_ids: bboxHotelIds } : {}),
      }),
      hotelsPromise,
      coveragePromise,
    ]);
    const tPhaseA = Date.now();
    console.log(`[vsearch] HyDE+embed: ${tAfterEmbed - tStartEmbed}ms  phaseA(room_types): ${tPhaseA - tAfterEmbed}ms`);

    if (roomTypesResult.error) throw new Error("score_room_types: " + roomTypesResult.error.message);
    if (cachedResult.error) console.error("[vsearch] hotels_cache error:", cachedResult.error.message);

    const cached = cachedResult.data;

    // Hotel score = MAX room-type similarity (best room wins, not average)
    const hotelSimMap    = new Map();  // hotel_id → max similarity
    const roomTypeSimMap = new Map();  // "hotel_id::room_name" → similarity
    for (const rt of (roomTypesResult.data || [])) {
      const prev = hotelSimMap.get(rt.hotel_id) ?? 0;
      if (rt.similarity > prev) hotelSimMap.set(rt.hotel_id, rt.similarity);
      roomTypeSimMap.set(`${rt.hotel_id}::${rt.room_name}`, rt.similarity);
    }

    // If bbox search returned 0 results, retry city-wide as a fallback
    if (!hotelSimMap.size && bboxHotelIds) {
      console.log(`[vsearch] 0 results in geo fence (polygon/bbox) — retrying city-wide`);
      const fallback = await fetchClient.rpc("score_room_types", {
        query_embedding: queryEmbedding,
        search_city: city,
        ...(required_features ? { required_features } : {}),
      });
      if (fallback.error) throw new Error("score_room_types fallback: " + fallback.error.message);
      for (const rt of (fallback.data || [])) {
        const prev = hotelSimMap.get(rt.hotel_id) ?? 0;
        if (rt.similarity > prev) hotelSimMap.set(rt.hotel_id, rt.similarity);
        roomTypeSimMap.set(`${rt.hotel_id}::${rt.room_name}`, rt.similarity);
      }
    }

    if (!hotelSimMap.size) {
      return res.json({ hotels: [], query, city, indexing, indexStatus: status });
    }

    // Max raw cosine across all hotels (for display % — independent of soft-flag re-order).
    const maxRawSim = Math.max(...hotelSimMap.values());

    let rankedHotels = [...hotelSimMap.entries()]
      .map(([hotel_id, similarity]) => ({ hotel_id, similarity }))
      .sort((a, b) => b.similarity - a.similarity);

    // Soft flag-heavy: multiplicative boost by coverage + mild penalty when coverage < 1
    // (replaces legacy additive SOFT_FLAG_BONUS_MAX — see SOFT_FLAG_COVERAGE_MULT).
    const covMult = parseFloat(process.env.SOFT_FLAG_COVERAGE_MULT || "0.28");
    const missPen = parseFloat(process.env.SOFT_FLAG_MISS_PENALTY || "0.08");
    if (flagMode === "soft" && coverageMap && detectedFlagKeys.length > 0) {
      let withCov = 0;
      for (const h of rankedHotels) {
        const c = coverageMap.get(h.hotel_id) ?? 0;
        if (c > 0) withCov++;
        let boosted = h.similarity * (1 + covMult * c);
        boosted *= 1 - missPen * (1 - c);
        h.s_boosted = Math.min(0.999, boosted);
      }
      rankedHotels.sort((a, b) => (b.s_boosted ?? b.similarity) - (a.s_boosted ?? a.similarity));
      if (rankedHotels.length >= 2) {
        const top = rankedHotels[0];
        const second = rankedHotels[1];
        if (
          top.similarity < 0.55 &&
          second.similarity > 0.65 &&
          (top.s_boosted ?? top.similarity) > (second.s_boosted ?? second.similarity)
        ) {
          console.warn(
            `[soft_flags] rank inversion: top ${top.hotel_id} raw=${top.similarity.toFixed(3)} vs #2 ${second.hotel_id} raw=${second.similarity.toFixed(3)}`
          );
        }
      }
      console.log(
        `[vsearch] soft_flags: cov_mult=${covMult} miss_penalty=${missPen} hotels_with_coverage=${withCov}/${rankedHotels.length}`
      );
    } else {
      rankedHotels.forEach(h => { h.s_boosted = h.similarity; });
    }

    const rawNbhdW = parseFloat(process.env.VSEARCH_NBHD_RANK_WEIGHT || "0.22");
    nbhdRankWeight = Number.isFinite(rawNbhdW) && rawNbhdW > 0 ? rawNbhdW : 0;
    let boopProfileForNbhd = null;
    const boopParam = req.query.boop_profile;
    if (typeof boopParam === "string" && boopParam.trim()) {
      try {
        boopProfileForNbhd = JSON.parse(boopParam);
      } catch (_) {
        boopProfileForNbhd = null;
      }
    }
    // When the user explicitly picked a neighbourhood scene, give neighbourhood fit more pull.
    if (nbhdRankWeight > 0 && boopProfileForNbhd?.answers?.nbhdScene) {
      nbhdRankWeight = Math.min(0.72, nbhdRankWeight * 1.25);
    }
    if (nbhdRankWeight > 0 && boopProfileForNbhd && typeof boopProfileForNbhd === "object" && rankedHotels.length) {
      const { applyNbhdBoopRank } = require("./lib/nbhd-vibe-rank");
      const nbhdRankResult = await applyNbhdBoopRank(fetchClient, city, rankedHotels, boopProfileForNbhd, {
        weight: nbhdRankWeight,
        neutralPct: parseFloat(process.env.VSEARCH_NBHD_NEUTRAL_PCT || "62"),
        maxHotels: parseInt(process.env.VSEARCH_NBHD_RANK_MAX_HOTELS || "5000", 10),
      });
      nbhdFitByHotelId = nbhdRankResult.nbhdFitByHotelId;
      if (nbhdFitByHotelId?.size) {
        console.log(
          `[vsearch] nbhd_boop_rank: weight=${nbhdRankWeight} hotels=${rankedHotels.length} nbhd_scores=${nbhdFitByHotelId.size}`
        );
      }
    }

    console.log(`[vsearch] ranked: ${rankedHotels.length} hotels from room-type scoring`);

    // ── Phase B: photo fetch + hotel-vibe scoring + primary-nbhd lookup (parallel) ──
    // fetch_hotel_photos returns photo metadata; similarity per photo comes from
    // room_types_index scores already computed in Phase A.
    // score_hotels scores the SAME top-N hotels against hotel_profile_index using
    // the hotel_query embedding (BOOP v4). get_primary_nbhds_for_hotels tags each
    // with the smallest-bbox neighbourhood its lat/lng falls inside.
    const topHotelIds = rankedHotels.slice(0, GALLERY_LIMIT).map(h => h.hotel_id);

    // Ensure hotel_query embedding is ready before score_hotels runs.
    await hotelEmbedPromise;

    const [photosResult, hotelScoreResult, primaryNbhdResult] = await Promise.all([
      fetchClient.rpc("fetch_hotel_photos", { hotel_ids: topHotelIds }),
      hotelQueryEmbedding
        ? fetchClient.rpc("score_hotels", {
            query_embedding: hotelQueryEmbedding,
            search_city: city,
            hotel_ids: topHotelIds,
          })
        : Promise.resolve({ data: [], error: null }),
      fetchClient.rpc("get_primary_nbhds_for_hotels", { p_hotel_ids: topHotelIds }),
    ]);
    const tPhaseB = Date.now();
    console.log(`[vsearch] phaseB: ${tPhaseB - tPhaseA}ms (photos + hotel_score + primary_nbhd)`);

    // Build hotelVibeSimMap (hotel_id → cosine similarity) and adaptive 0-100 remap.
    const hotelVibeSimMap = new Map();
    let hotelSimMaxRaw = 0;
    if (hotelScoreResult.error) {
      console.warn(`[vsearch] score_hotels error (non-fatal): ${hotelScoreResult.error.message}`);
    } else {
      for (const r of (hotelScoreResult.data || [])) {
        hotelVibeSimMap.set(r.hotel_id, r.similarity);
        if (r.similarity > hotelSimMaxRaw) hotelSimMaxRaw = r.similarity;
      }
    }
    const HOTEL_SIM_MAX = hotelSimMaxRaw > 0 ? hotelSimMaxRaw : 0.9;
    const HOTEL_SIM_MIN = Math.max(HOTEL_SIM_MAX - 0.30, 0);
    const hotelSimSpan  = Math.max(HOTEL_SIM_MAX - HOTEL_SIM_MIN, 1e-9);

    // Build primaryNbhdMap (hotel_id → { id, name, vibe_short, attributes })
    const primaryNbhdMap = new Map();
    if (primaryNbhdResult.error) {
      console.warn(`[vsearch] get_primary_nbhds_for_hotels error (non-fatal): ${primaryNbhdResult.error.message}`);
    } else {
      for (const r of (primaryNbhdResult.data || [])) {
        primaryNbhdMap.set(r.hotel_id, {
          id: r.neighborhood_id,
          name: r.name,
          vibe_short: r.vibe_short,
          attributes: r.attributes || null,
        });
      }
    }

    if (photosResult.error) throw new Error("fetch_hotel_photos: " + photosResult.error.message);
    const photos = photosResult.data || [];
    console.log(`[vsearch] photos for top ${topHotelIds.length} hotels: ${photos.length}`);

    // 4. Build hotelPhotosMap and hotelScoreMap.
    // Photo similarity = room_type similarity from Phase A (same room → same score).
    // Photos whose room_name isn't in roomTypeSimMap fall back to hotel-level similarity.
    const cacheMap       = new Map((cached || []).map(h => [h.hotel_id, h]));
    const hotelPhotosMap = new Map();  // hotel_id → [{...photo, similarity, caption?}]
    const hotelScoreMap  = new Map();  // hotel_id → {scores[], intentScores[], captions[]}

    for (const p of photos) {
      // For feature-filtered queries, rooms not returned by score_room_types (i.e., rooms
      // that don't have the required feature) get similarity 0 so they sort to the bottom.
      // Without this, they'd inherit the hotel-level max and incorrectly appear first.
      const roomTypeSim = roomTypeSimMap.get(`${p.hotel_id}::${p.room_name}`);
      const similarity  = roomTypeSim ?? (required_features ? 0 : (hotelSimMap.get(p.hotel_id) ?? 0));

      if (!hotelPhotosMap.has(p.hotel_id)) hotelPhotosMap.set(p.hotel_id, []);
      hotelPhotosMap.get(p.hotel_id).push({ ...p, similarity });

      if (!hotelScoreMap.has(p.hotel_id)) hotelScoreMap.set(p.hotel_id, { scores: [], intentScores: [] });
      const hs = hotelScoreMap.get(p.hotel_id);
      hs.scores.push(similarity);
      if (!intentType || p.photo_type === intentType) hs.intentScores.push(similarity);
    }

    for (const arr of hotelPhotosMap.values()) {
      sortHotelPhotosForDisplay(arr, intentType, detectedFlagKeys, flagMode);
    }

    // Log similarity distribution (from room_types scores, not per-photo)
    if (rankedHotels.length > 0) {
      const sims = rankedHotels.slice(0, Math.min(rankedHotels.length, 200)).map(h => h.similarity);
      const top5 = sims.slice(0, 5).map(s => s.toFixed(4)).join(', ');
      const p95  = sims[Math.floor(sims.length * 0.05)]?.toFixed(4);
      console.log(`[vsearch] room_type similarity — top5: [${top5}]  p95: ${p95}`);
    }

    // 5. Compute topScore per hotel.
    //    Top GALLERY_LIMIT hotels use per-photo similarity (accurate) with structural penalty.
    //    Hotels beyond GALLERY_LIMIT use room-type-level similarity with no penalty
    //    (no captions available to verify, ranked far down anyway).
    // Adaptive normalization: SIM_MAX = max raw similarity in the result set (not boosted order).
    // Spread fixed at 0.30.
    const SIM_MAX = maxRawSim > 0 ? maxRawSim : 0.9;
    const SIM_MIN = Math.max(SIM_MAX - 0.30, 0);
    const simSpan = Math.max(SIM_MAX - SIM_MIN, 1e-9);
    const photoHotelIds = new Set(hotelPhotosMap.keys());

    // Score = mean of top-3 similarities (intent-type photos first, fallback to all).
    // Feature flag pre-filter in score_room_types ensures every hotel here has confirmed
    // the required features — no post-hoc penalty or boost needed.
    const boostedByHotelId = new Map(rankedHotels.map(h => [h.hotel_id, h.s_boosted ?? h.similarity]));

    const photoHotelScores = [...photoHotelIds].map(hotelId => {
      const hs       = hotelScoreMap.get(hotelId);
      const arr      = hs.intentScores.length > 0 ? hs.intentScores : hs.scores;
      arr.sort((a, b) => b - a);
      const rawScore = arr.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, arr.length);
      const boosted = boostedByHotelId.get(hotelId);
      const rankScore = flagMode === "soft" && detectedFlagKeys.length > 0 && Number.isFinite(boosted)
        ? boosted
        : rawScore;
      let score = Math.max(0, Math.min(100, (rankScore - SIM_MIN) / simSpan * 100));
      // Photo-count penalty: penalises hotels with too few photos overall (poor visual coverage).
      const hpAll = hotelPhotosMap.get(hotelId) || [];
      if (hpAll.length < 3) {
        const photoFactor = hpAll.length / 3;
        score *= photoFactor;
        console.log(`[vsearch] photo-count penalty: ${hotelId} only ${hpAll.length} total photos → score now ${score.toFixed(1)}`);
      }
      return { hotelId, topScore: score, hasPhotos: true };
    });

    // Scores for hotels beyond GALLERY_LIMIT (room-type similarity, no penalty)
    const remainingHotelScores = rankedHotels
      .filter(h => !photoHotelIds.has(h.hotel_id))
      .map(h => {
        const rankScore =
          flagMode === "soft" && detectedFlagKeys.length > 0
            ? (h.s_boosted ?? h.similarity)
            : h.similarity;
        const score = Math.max(0, Math.min(100, (rankScore - SIM_MIN) / simSpan * 100));
        return { hotelId: h.hotel_id, topScore: score, hasPhotos: false };
      });

    const allHotels = [...photoHotelScores, ...remainingHotelScores]
      .sort((a, b) => b.topScore - a.topScore);

    if (nbhdFitByHotelId && nbhdFitByHotelId.size > 0 && nbhdRankWeight > 0) {
      const w = nbhdRankWeight;
      allHotels.sort((a, b) => {
        const nbA = nbhdFitByHotelId.get(a.hotelId) ?? 62;
        const nbB = nbhdFitByHotelId.get(b.hotelId) ?? 62;
        const ca = (1 - w) * (a.topScore / 100) + w * (nbA / 100);
        const cb = (1 - w) * (b.topScore / 100) + w * (nbB / 100);
        if (Math.abs(cb - ca) > 1e-6) return cb - ca;
        return b.topScore - a.topScore;
      });
    }

    // 6. Fetch hotel display metadata (name, photo, ratings) live from LiteAPI for
    //    hotels that will actually be rendered (those with photo data).
    const photoHotelIdList = allHotels.filter(h => h.hasPhotos).map(h => h.hotelId);
    const liveMeta = await fetchHotelMetaBatch(photoHotelIdList);

    // 7. Build response for all hotels
    const hotels = allHotels.map(({ hotelId, topScore, hasPhotos }) => {
      // Live metadata for hotels with photos; for stubs use inventory fallback only.
      const meta           = liveMeta[hotelId] || {};
      const score          = Math.round(topScore);
      const hotelPhotos    = hotelPhotosMap.get(hotelId) || [];
      const fallbackName   = hotelPhotos[0]?.hotel_name || null;

      // BOOP v4: hotelScore + primary_nbhd (same shape for photo + non-photo branches).
      const rawHotelSim = hotelVibeSimMap.get(hotelId);
      const hotelScore = rawHotelSim != null
        ? Math.round(Math.max(0, Math.min(100, (rawHotelSim - HOTEL_SIM_MIN) / hotelSimSpan * 100)))
        : null;
      const primaryNbhd = primaryNbhdMap.get(hotelId) || null;
      const nbhdFitPct = nbhdFitByHotelId?.get(hotelId);

      // Hotels without photo data (beyond GALLERY_LIMIT): return stub with no room types.
      // They appear in the sorted list with their match score from room_types_index.
      if (!hasPhotos) {
        return {
          id:          hotelId,
          name:        resolveHotelNameFromMeta({}, hotelId, fallbackName),
          address:     "",
          city,
          country:     "",
          starRating:  0,
          rating:      0,
          mainPhoto:   null,
          hotelPhotos: [],
          roomTypes:   [],
          isMatched:   score > 0,
          vectorScore: score,
          hotelScore,
          primary_nbhd: primaryNbhd,
          ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
        };
      }

      // Group photos by room_name; hotelPhotos is already sorted similarity DESC.
      // room_type_id comes from LiteAPI (stored at index time) — may be null for older rows.
      const roomMap = new Map();
      for (const p of hotelPhotos) {
        const rName = p.room_name || "Room";
        if (!roomMap.has(rName)) roomMap.set(rName, { photos: [], roomTypeId: p.room_type_id || null });
        const entry = roomMap.get(rName);
        if (entry.photos.length < 12) {
          entry.photos.push({
            url: p.photo_url,
            type: p.photo_type,
            similarity: p.similarity,
            feature_flags: p.feature_flags,
          });
        }
      }

      const roomEntries = [...roomMap.entries()].map(([name, entry]) => {
        const fm = entry.photos.reduce(
          (m, ph) => Math.max(m, countPhotoFlagMatches(ph.feature_flags, detectedFlagKeys)),
          0
        );
        return { name, entry, flagMatch: fm };
      });
      roomEntries.sort((a, b) => {
        if (detectedFlagKeys.length > 0 && flagMode === "soft") {
          if (b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
        }
        return (b.entry.photos[0]?.similarity ?? 0) - (a.entry.photos[0]?.similarity ?? 0);
      });

      const roomTypes = roomEntries.map(({ name, entry, flagMatch }) => {
        const photoEntries = entry.photos;
        // Per-room score: use intent-filtered photos (same filter as hotel-level score)
        // so bedroom photos don't dilute a bathroom query score and vice versa.
        // Fall back to all photos if the room has no photos of the intent type.
        const intentPhotos = intentType
          ? photoEntries.filter(p => p.type === intentType)
          : [];
        const scoringPhotos = intentPhotos.length > 0 ? intentPhotos : photoEntries;
        const sims = scoringPhotos.map(p => p.similarity).sort((a, b) => b - a);
        const rawRoom = sims.length > 0
          ? sims.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, sims.length)
          : 0;
        let roomScore = Math.max(0, Math.min(100, (rawRoom - SIM_MIN) / simSpan * 100));
        // Photo-count penalty at room level: rooms with < 3 photos rank lower.
        if (photoEntries.length < 3) roomScore *= photoEntries.length / 3;
        return {
          name,
          roomTypeId: entry.roomTypeId,
          photos:     photoEntries.map(p => p.url),
          score:      Math.round(roomScore),
          size:       "",
          beds:       "",
          amenities:  [],
          flagMatch,
        };
      });

      // Flag-heavy soft: rooms with confirmed query flags first, then by score.
      roomTypes.sort((a, b) => {
        if (detectedFlagKeys.length > 0 && flagMode === "soft") {
          if (b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
        }
        return (b.score || 0) - (a.score || 0);
      });
      for (const rt of roomTypes) delete rt.flagMatch;

      return {
        id:          hotelId,
        name:        resolveHotelNameFromMeta(meta, hotelId, fallbackName),
        address:     meta.address || "",
        city,
        country:     "",
        starRating:  meta.starRating || 0,
        rating:      meta.guestRating || 0,
        mainPhoto:   meta.mainPhoto || null,
        hotelPhotos: [],
        roomTypes:   roomTypes.slice(0, 8),
        isMatched:   score > 0,
        vectorScore: score,
        hotelScore,
        primary_nbhd: primaryNbhd,
        ...(nbhdFitPct != null ? { nbhd_fit_pct: nbhdFitPct } : {}),
      };
    });

    const tTotal = Date.now() - t0;
    const kpiFlag = tTotal > 3000 ? " ⚠️ KPI BREACH" : "";
    console.log(`[vsearch] TOTAL: ${tTotal}ms${kpiFlag} | ${city}: ${hotels.length} hotels, top score ${allHotels[0]?.topScore?.toFixed(3)}`);

    const stats = {
      indexed: cityRow?.photo_count || 0,
      search_version_used: "v1",
      search_version_requested: requestedVersionRaw,
    };
    // Neighbourhood blend diagnostics (weight ≠ neighbourhood % on cards; weight is room vs nbhd for *sort*).
    if (Number.isFinite(rawNbhdW)) stats.nbhd_rank_weight_config = rawNbhdW;
    stats.nbhd_rank_weight_active = nbhdRankWeight;
    stats.nbhd_blend_applied = !!(nbhdFitByHotelId && nbhdFitByHotelId.size > 0);
    if (boopProfileForNbhd) stats.boop_profile_received = true;
    if (nbhdRankWeight > 0 && nbhdFitByHotelId && nbhdFitByHotelId.size > 0) {
      stats.nbhd_rank_weight = nbhdRankWeight;
    }
    if (String(req.query.debug || "") === "1") {
      const sample = rankedHotels.slice(0, 10).map(h => ({
        hotel_id: h.hotel_id,
        raw: h.similarity,
        boosted: h.s_boosted ?? h.similarity,
        coverage: coverageMap?.get?.(h.hotel_id) ?? 0,
      }));
      stats.softFlags = {
        mode: flagMode,
        detected: detectedFlagKeys,
        coverageMult: covMult,
        missPenalty: missPen,
        sample,
      };
    }

    if (String(req.query.compare || "") === "1") {
      try {
        const v2 = await runV2Search({
          req: { query: { ...req.query, search_version: "v2" } },
          supabase,
          supabaseAdmin,
          resolveCityName,
        });
        if (v2?.status === 200 && Array.isArray(v2.body?.hotels)) {
          const v1Top = hotels.slice(0, 20).map((h) => String(h.id));
          const v2Top = v2.body.hotels.slice(0, 20).map((h) => String(h.id));
          const set = new Set(v1Top);
          const overlap = v2Top.filter((id) => set.has(id)).length;
          stats.compare = {
            enabled: true,
            v1_top_ids: v1Top,
            v2_top_ids: v2Top,
            overlap_top20: overlap,
          };
        }
      } catch (e) {
        stats.compare = { enabled: true, error: e.message };
      }
    }

    res.json({ hotels, query, city, indexing, indexStatus: status, stats });

  } catch(err) {
    console.error("[vsearch]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Index status endpoint ──────────────────────────────────────────────────────
app.get("/api/index-status", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  if (!cityInput || !supabase) return res.json({ status: "unknown" });
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["indexed_cities"]);
  const { data } = await supabase
    .from("indexed_cities")
    .select("status, hotel_count, photo_count, started_at, completed_at")
    .eq("city", city)
    .single();
  res.json(data || { status: "none" });
});

// ── Cancel indexing endpoint ──────────────────────────────────────────────────
app.post("/api/index-cancel", async (req, res) => {
  const { city: cityRaw, secret } = req.body || {};
  const city = normalizeCityName(cityRaw);
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Supabase not configured" });

  const { error } = await supabaseAdmin
    .from("indexed_cities")
    .update({ stop_requested: true, updated_at: new Date().toISOString() })
    .eq("city", city);

  if (error) return res.status(500).json({ error: error.message });

  console.log(`[indexer] Cancel requested for ${city}`);
  res.json({ message: `Cancel requested for ${city} — will stop after current batch` });
});

// LiteAPI rate.cancellationPolicies — true when refundable with a zero-penalty tier
// (typical "free cancellation until …") or explicitly RFN with no policy rows.
function liteRateHasFreeCancellation(rate) {
  const pol = rate?.cancellationPolicies;
  if (!pol || typeof pol !== "object") return false;
  if (pol.refundableTag === "NRFN") return false;
  const infos = pol.cancelPolicyInfos;
  if (Array.isArray(infos) && infos.length) {
    if (infos.some((i) => Number(i?.amount) === 0)) return true;
  }
  return pol.refundableTag === "RFN";
}

// ── Live pricing endpoint ──────────────────────────────────────────────────────
// Fetches cheapest available rate per hotel for a given city + date range.
// Fires a single batched POST to LiteAPI /hotels/rates with all hotel IDs.
// Returns { prices: { hotel_id: $/night }, currency, nights, pricedCount }
// ─── LiteAPI /hotels/rates helpers (used by /api/rates handler) ──────────────
//
// Why these exist: LiteAPI silently caps per-hotel rates to ~1 (cheapest) when
// the request batch >= 50 hotels, regardless of `maxRatesPerHotel`. Bisected
// empirically: 48-hotel batch returns full 3-5 rates; 50-hotel batch returns
// 1. So the /api/rates handler does a single large call for hotel-level
// cheapest prices (drives "Available rooms only" filter + price sort), then
// fans out smaller chunks (<=48) for the top-N ranked-and-priced hotels to
// recover the missing per-room rates for cards users actually see.
async function liteRatesCall(hotelIds, checkin, checkout, currency = "USD") {
  const cur = sanitizeRatesCurrency(currency);
  const liteRes = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
    method: "POST",
    headers: { "X-API-Key": LITEAPI_KEY, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      hotelIds,
      checkin,
      checkout,
      currency: cur,
      guestNationality: "US",
      occupancies: [{ adults: 2 }],
      maxRatesPerHotel: LITEAPI_MAX_RATES_PER_HOTEL,
      roomMapping: true,
      timeout: 22,
    }),
  });
  if (liteRes.status === 429) {
    const err = new Error("rate_limited");
    err.status = 429;
    throw err;
  }
  if (!liteRes.ok) {
    const err = new Error("liteapi_error_" + liteRes.status);
    err.status = liteRes.status;
    throw err;
  }
  const json = await liteRes.json();
  // LiteAPI v3 wraps in { data: { rates: [...] } } or { data: [...] } — handle both.
  return json?.data?.rates ?? json?.data ?? json?.rates ?? [];
}

// Merge a LiteAPI rates list into the accumulator maps in place. Used by both
// the main batched call and the top-N detail pass. Existing entries are kept
// when the new per-night is not strictly cheaper, so the detail pass can only
// add new mappedRoomIds or improve prices — never overwrite better data.
function mergeLiteRatesIntoMaps(ratesList, nights, acc) {
  let totalRoomTypes = 0, withMappedId = 0, newMappedIds = 0;
  for (const hotel of ratesList) {
    const hotelId = hotel.hotelId;
    for (const rt of (hotel.roomTypes || [])) {
      totalRoomTypes++;
      const total = rt.rates?.[0]?.retailRate?.total?.[0]?.amount;
      if (!total || total <= 0) continue;
      const perNight = Math.round(total / nights);

      const firstRate = rt.rates?.[0];
      const fcThis    = liteRateHasFreeCancellation(firstRate);
      if (fcThis) acc.hotelFreeCancel[hotelId] = true;

      if (!acc.prices[hotelId] || perNight < acc.prices[hotelId]) {
        acc.prices[hotelId] = perNight;
      }

      const mappedRoomId = firstRate?.mappedRoomId;
      if (mappedRoomId) {
        withMappedId++;
        const key = String(mappedRoomId);
        if (!acc.roomPrices[hotelId]) acc.roomPrices[hotelId] = {};
        const existing = acc.roomPrices[hotelId][key];
        if (existing == null) newMappedIds++;
        if (existing == null || perNight < existing) {
          acc.roomPrices[hotelId][key] = perNight;
          if (firstRate?.name) {
            if (!acc.roomNames[hotelId]) acc.roomNames[hotelId] = {};
            acc.roomNames[hotelId][key] = String(firstRate.name).slice(0, 120);
          }
          const offerId = firstRate?.offerId || firstRate?.offer_id;
          if (offerId) {
            if (!acc.offerIds[hotelId]) acc.offerIds[hotelId] = {};
            acc.offerIds[hotelId][key] = offerId;
          }
          if (!acc.roomFreeCancel[hotelId]) acc.roomFreeCancel[hotelId] = {};
          acc.roomFreeCancel[hotelId][key] = fcThis;
        }
      }
    }
  }
  return { totalRoomTypes, withMappedId, newMappedIds };
}

// Top-N detail-pass knobs.
//
// CHUNK=15 is the empirically-validated sweet spot. LiteAPI's per-hotel rate
// allocation isn't a simple "cap at batch >= 50" function — it's allocated
// from a non-monotonic global budget that depends on the cohort. Tested
// chunk sizes 10/15/20/25/30/40 against a 50-hotel cohort: chunk=15 returns
// max total rates (191) AND covers lp3e1a2 with all 3 rates consistently.
// chunk=20 anomalously drops back to 168/2-rates. chunk>=25 leaks rates
// for some hotels. Smaller chunks = more parallel calls but more reliable
// per-hotel coverage. With CHUNK=15 + TOPN=50 we issue 4 chunks in parallel.
const RATES_DETAIL_TOPN     = Math.max(0, Math.min(200,
  Number(process.env.RATES_DETAIL_TOPN ?? 50)));
const RATES_DETAIL_CHUNK    = Math.max(5, Math.min(48,
  Number(process.env.RATES_DETAIL_CHUNK ?? 15)));

app.get("/api/rates", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  const { checkin } = req.query;
  let { checkout } = req.query;
  const currency = sanitizeRatesCurrency(req.query.currency);
  if (!cityInput || !checkin || !checkout) {
    return res.status(400).json({ error: "city, checkin and checkout required" });
  }
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["hotels_cache", "indexed_cities"]);
  let nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  if (nights < 1) {
    return res.status(400).json({ error: "checkout must be after checkin" });
  }
  // Cap at 30 nights — LiteAPI doesn't support longer stays. Clamp instead of erroring.
  if (nights > 30) {
    const cappedCheckout = new Date(checkin);
    cappedCheckout.setDate(cappedCheckout.getDate() + 30);
    checkout = cappedCheckout.toISOString().slice(0, 10);
    nights   = 30;
  }

  // Accumulator maps mutated by mergeLiteRatesIntoMaps across both passes.
  const acc = {
    prices: {},          // hotel_id → cheapest $/night (hotel-level display)
    roomPrices: {},      // hotel_id → { room_type_id → $/night }
    roomNames: {},       // hotel_id → { room_type_id → rate name (for "extra rates" rows when the room isn't in our indexed inventory) }
    offerIds: {},        // hotel_id → { room_type_id → offerId } for white-label checkout deep links
    roomFreeCancel: {},  // hotel_id → { room_type_id → bool } — cheapest shown rate per room
    hotelFreeCancel: {}, // hotel_id → true if any returned rate with a price is free-cancel
  };

  const emptyResponse = (extra = {}) => ({
    prices: acc.prices,
    roomPrices: acc.roomPrices,
    roomNames: acc.roomNames,
    offerIds: acc.offerIds,
    roomFreeCancel: acc.roomFreeCancel,
    hotelFreeCancel: acc.hotelFreeCancel,
    currency,
    nights,
    pricedCount: Object.keys(acc.prices).length,
    ...extra,
  });

  try {
    // If the frontend passes ranked hotel IDs directly, use them.
    // Otherwise fall back to fetching all hotel IDs for the city from the DB.
    let hotelIds;
    const rawIds = req.query.hotelIds;
    if (rawIds && typeof rawIds === 'string' && rawIds.length > 0) {
      hotelIds = rawIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
      console.log(`[rates] ${city}: using ${hotelIds.length} ranked hotel IDs from client, ${checkin}→${checkout}, currency=${currency}`);
    } else {
      const fc = supabaseAdmin || supabase;
      const { data: hotelRows, error: dbErr } = await fc
        .from(hotelsCacheFor(city)).select("hotel_id").eq("city", city);
      if (dbErr) throw new Error("DB: " + dbErr.message);
      if (!hotelRows?.length) return res.json(emptyResponse());
      hotelIds = hotelRows.map(h => h.hotel_id);
      console.log(`[rates] ${city}: fetching rates for ${hotelIds.length} hotels from DB, ${checkin}→${checkout}, currency=${currency}`);
    }

    // ── Main batched call. Drives hotel-level prices for sorting/filtering.
    //    Per-hotel rates are silently capped to ~1 by LiteAPI when the batch
    //    is large; the detail pass below recovers the rest for top-N hotels.
    let ratesList;
    try {
      ratesList = await liteRatesCall(hotelIds, checkin, checkout, currency);
    } catch (e) {
      if (e.status === 429) {
        console.warn("[rates] LiteAPI rate limited");
        return res.json(emptyResponse({ rateLimited: true }));
      }
      console.error("[rates] LiteAPI error", e.status || e.message);
      return res.json(emptyResponse());
    }

    // Diagnostic: log raw structure for the first hotel with rooms.
    const sampleHotel = ratesList.find(h => (h.roomTypes||[]).length > 0);
    if (sampleHotel) {
      const srt = sampleHotel.roomTypes[0];
      const srate = srt?.rates?.[0];
      console.log(`[rates] sample hotel ${sampleHotel.hotelId}: roomTypes=${sampleHotel.roomTypes.length}`);
      console.log(`[rates] sample rate name: "${srate?.name}", mappedRoomId: ${srate?.mappedRoomId}, roomTypeId: ${srt?.roomTypeId}`);
      sampleHotel.roomTypes.slice(0, 5).forEach((r, i) => {
        const rate = r.rates?.[0];
        console.log(`[rates]   room[${i}] mappedRoomId=${rate?.mappedRoomId} name="${rate?.name}" total=${rate?.retailRate?.total?.[0]?.amount}`);
      });
    }

    const mainStats = mergeLiteRatesIntoMaps(ratesList, nights, acc);
    console.log(`[rates] main pass: ${mainStats.totalRoomTypes} room types, ${mainStats.withMappedId} with mappedRoomId, +${mainStats.newMappedIds} room rates`);

    // ── Top-N detail pass.
    //    LiteAPI has a per-request global rate budget that gets split across
    //    the cohort. Big batches → 1 rate per hotel. Small batches with all
    //    priced hotels → 2 rates per hotel. Small batches with some unpriced
    //    hotels → 3+ rates per priced hotel (the unpriced hotels contribute 0
    //    and "give" their budget share to the rest). We deliberately do NOT
    //    pre-filter to priced hotels here — keeping the natural input order
    //    means unpriced hotels dilute the cohort and improve per-hotel rate
    //    coverage for the priced ones users actually see. Validated against
    //    lp3e1a2 in Mexico City: with priced-only cohort the target gets 2
    //    rates; with mixed cohort the target gets all 3.
    if (RATES_DETAIL_TOPN > 0 && hotelIds.length >= 50) {
      const detailIds = hotelIds.slice(0, RATES_DETAIL_TOPN);
      if (detailIds.length > 0) {
        // ── Round-robin chunk assignment.
        //    Adjacent hotels in search-ranked order tend to share a star tier
        //    (top hits are luxury, mid-pack is mid-tier, etc.). Sequential
        //    chunking groups same-tier hotels together; LiteAPI's per-request
        //    budget then gets split thin among them, so luxury hotels with 20+
        //    room types steal allocation from their neighbours. Round-robin
        //    interleaves tiers across chunks so each chunk has a mix, which
        //    empirically lets the smaller hotels keep their full rate counts.
        //    Validated against lp3e1a2 in Mexico City: sequential chunks
        //    co-located it with lp4bab4 (St. Regis, 20 rooms) and capped it at
        //    2 rates; isolated in a separate chunk it returns all 3.
        const numChunks = Math.ceil(detailIds.length / RATES_DETAIL_CHUNK);
        const chunks = Array.from({ length: numChunks }, () => []);
        for (let i = 0; i < detailIds.length; i++) {
          chunks[i % numChunks].push(detailIds[i]);
        }
        const t0 = Date.now();
        const results = await Promise.allSettled(
          chunks.map(ids => liteRatesCall(ids, checkin, checkout, currency))
        );
        let newRoomRates = 0, callsOk = 0, callsFail = 0;
        for (const r of results) {
          if (r.status === "fulfilled") {
            callsOk++;
            const s = mergeLiteRatesIntoMaps(r.value, nights, acc);
            newRoomRates += s.newMappedIds;
          } else {
            callsFail++;
            console.warn(`[rates] detail chunk failed: ${r.reason?.message}`);
          }
        }
        const pricedInDetail = detailIds.filter(id => acc.prices[id] != null).length;
        console.log(`[rates] detail pass: top ${detailIds.length} hotels (${pricedInDetail} priced from main), ${callsOk}/${chunks.length} chunks ok (size<=${RATES_DETAIL_CHUNK}), +${newRoomRates} extra room rates in ${Date.now() - t0}ms`);
      }
    }

    const { prices, roomPrices, roomNames, offerIds, roomFreeCancel, hotelFreeCancel } = acc;
    const pricedCount = Object.keys(prices).length;
    const roomPricedCount = Object.values(roomPrices).reduce((s, rm) => s + Object.keys(rm).length, 0);
    // Distinct-rooms-per-hotel histogram. Validates the LITEAPI_MAX_RATES_PER_HOTEL
    // knob AND the detail pass: if most priced hotels are in the 0–1 bucket we're
    // still missing rooms (consider bumping); if most are 6+ we may be over-fetching.
    const bucketsHist = { '0': 0, '1': 0, '2-3': 0, '4-5': 0, '6+': 0 };
    for (const hid of Object.keys(prices)) {
      const n = roomPrices[hid] ? Object.keys(roomPrices[hid]).length : 0;
      if (n === 0) bucketsHist['0']++;
      else if (n === 1) bucketsHist['1']++;
      else if (n <= 3) bucketsHist['2-3']++;
      else if (n <= 5) bucketsHist['4-5']++;
      else bucketsHist['6+']++;
    }
    console.log(`[rates] ${city}: ${pricedCount}/${hotelIds.length} hotels priced, ${roomPricedCount} room type rates, currency=${currency}, maxRates=${LITEAPI_MAX_RATES_PER_HOTEL}, detailTopN=${RATES_DETAIL_TOPN}`);
    console.log(`[rates] distinct-rooms histogram: 0:${bucketsHist['0']} 1:${bucketsHist['1']} 2-3:${bucketsHist['2-3']} 4-5:${bucketsHist['4-5']} 6+:${bucketsHist['6+']}`);
    res.json({ prices, roomPrices, roomNames, offerIds, roomFreeCancel, hotelFreeCancel, currency, nights, pricedCount });

  } catch (err) {
    console.error("[rates]", err.message);
    res.json(emptyResponse());
  }
});

// ── Single-hotel rates endpoint ───────────────────────────────────────────────
// GET /api/hotel-rates?hotelId=X&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
//
// Fetches rates for exactly ONE hotel. Because the batch is size=1, LiteAPI's
// hidden per-batch cap doesn't apply — we get all available room rates (up to
// maxRatesPerHotel). This is what powers the client-side per-hotel enrichment
// pass that runs after /api/rates returns for the city.
//
// The batch /api/rates call only returns 3–5 rates per hotel for large cities
// (LiteAPI caps at 1 rate/hotel when batch >= 50, detail pass recovers some
// but large hotels like the Ritz (23 room types) still only get 3–5 back).
// A single-hotel call returns all room types.
app.get("/api/hotel-rates", async (req, res) => {
  const hotelId = (req.query.hotelId || "").trim();
  const { checkin } = req.query;
  let { checkout } = req.query;
  const currency = sanitizeRatesCurrency(req.query.currency);
  if (!hotelId || !checkin || !checkout) {
    return res.status(400).json({ error: "hotelId, checkin, checkout required" });
  }
  // Normalise checkout: if same as checkin, add 1 night
  if (checkout === checkin) {
    const d = new Date(checkout);
    d.setDate(d.getDate() + 1);
    checkout = d.toISOString().slice(0, 10);
  }
  const nights = Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / 86400000));
  try {
    const ratesList = await liteRatesCall([hotelId], checkin, checkout, currency);
    const acc = { prices: {}, roomPrices: {}, roomNames: {}, offerIds: {}, roomFreeCancel: {}, hotelFreeCancel: {} };
    const stats = mergeLiteRatesIntoMaps(ratesList, nights, acc);
    const roomCount = acc.roomPrices[hotelId] ? Object.keys(acc.roomPrices[hotelId]).length : 0;
    console.log(`[hotel-rates] ${hotelId}: ${roomCount} room rates, ${stats.totalRoomTypes} room types from LiteAPI`);
    res.json({
      hotelId,
      price:         acc.prices[hotelId] ?? null,
      roomPrices:    acc.roomPrices[hotelId] ?? {},
      roomNames:     acc.roomNames[hotelId] ?? {},
      offerIds:      acc.offerIds[hotelId] ?? {},
      roomFreeCancel: acc.roomFreeCancel[hotelId] ?? {},
      hotelFreeCancel: acc.hotelFreeCancel[hotelId] ?? false,
      currency,
      nights,
    });
  } catch (e) {
    if (e.status === 429) return res.status(429).json({ error: "rate_limited" });
    console.error("[hotel-rates]", e.message);
    res.status(500).json({ error: "rates_error" });
  }
});

// ── feature_summary extractor (mirrors index-city.js version) ────────────────
// Keeps only POSITIVE/PRESENT values; drops FLOORING & DECOR section entirely.
// Must stay in sync with extractFeatureSummary() in scripts/index-city.js.
//
// photoType-aware: each photo type only embeds its own relevant sections so
// the resulting vector isn't diluted by unrelated fields.  For example, a
// bathroom embedding should encode sink/bathtub/shower features — not "queen
// bed" or "armchair" — so it scores closely against a HyDE query like
// "PHOTO TYPE: bathroom\nSINKS: double sinks".
function extractFeatureSummary(caption, photoType = null) {
  if (!caption) return null;

  // Sections that carry no useful signal for the given photo type.
  // FLOORING & DECOR is always skipped (hallucination-prone, rarely queried).
  const PHOTO_TYPE_SKIP = {
    'bathroom':    ['BEDROOM', 'FURNITURE'],
    'bedroom':     ['BATHROOM'],
    'living area': ['BATHROOM', 'BEDROOM'],
    'view':        ['BATHROOM', 'BEDROOM', 'FURNITURE', 'NOTABLE FEATURES'],
  };
  const skipExtra = photoType ? (PHOTO_TYPE_SKIP[photoType] || []) : [];
  const SKIP_SECTIONS = new Set(['FLOORING & DECOR', ...skipExtra]);
  const SKIP_VALUES   = new Set(['no', 'none', 'unknown', 'standard', 'standard ceiling', 'moderate light']);
  const lines = caption.split('\n');
  const kept  = [];
  let skipSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const secMatch = line.match(/^([A-Z][A-Z &]+):$/);
    if (secMatch) { skipSection = SKIP_SECTIONS.has(secMatch[1]); continue; }
    if (skipSection) continue;
    if (line.startsWith('PHOTO TYPE:') && line.includes('|')) { kept.push(line); continue; }
    if (line.startsWith('Room type:')) { kept.push(line); continue; }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const value = line.slice(colonIdx + 1).trim().toLowerCase();
      if (!value || SKIP_VALUES.has(value)) continue;
      if (value.startsWith('no ') || value.includes('not visible')) continue;
      // Normalise vocabulary to match common user query terms
      const normalised = line
        .replace(/:\s*two sinks\b/i,       ': double sinks')
        .replace(/:\s*one sink\b/i,        ': single sink')
        .replace(/:\s*three sinks\b/i,     ': triple sinks')
        .replace(/:\s*shower over bath\b/i,': shower over bath, rainfall shower');
      kept.push(normalised);
    }
  }
  return kept.length > 1 ? kept.join('\n') : null;
}

// Parses a feature_summary string into an explicit boolean flags object.
// Only present keys are true (absent = not confirmed). Must stay in sync with
// the SQL UPDATE in supabase/feature-flags.sql and the copy in scripts/index-city.js.
function extractFeatureFlags(featureSummary) {
  if (!featureSummary) return {};
  const f = featureSummary;
  const flags = {};

  // Bathroom
  if (/^SINKS:\s*double sinks/im.test(f))                                              flags.double_sinks = true;
  if (/^BATHTUB:/im.test(f))                                                           flags.bathtub = true;
  if (/^BATHTUB:\s*soaking tub/im.test(f))                                            flags.soaking_tub = true;
  if (/^BATHTUB:\s*clawfoot/im.test(f))                                               flags.clawfoot_tub = true;
  if (/^SHOWER:\s*walk-in shower/im.test(f))                                          flags.walk_in_shower = true;
  if (/^SHOWER:.*rainfall shower/im.test(f) ||
      /^DISTINCTIVE FEATURES:.*rainfall shower/im.test(f))                            flags.rainfall_shower = true;
  if (/^IN-ROOM HOT TUB OR JACUZZI:\s*yes/im.test(f) ||
      /^BATHTUB:\s*(?:jacuzzi|hot tub)/im.test(f))                                    flags.in_room_jacuzzi = true;
  if (/^BIDET:\s*yes/im.test(f))                                                      flags.bidet = true;
  if (/^SEPARATE TOILET ROOM:\s*yes/im.test(f))                                       flags.separate_toilet_room = true;
  if (/^DESK:\s*(?:small|large) desk/im.test(f))                                      flags.work_desk = true;

  // Bedroom / Closet
  if (/^BED:.*\bking\b/im.test(f))                                                    flags.king_bed = true;
  if (/^BED:.*four[- ]poster/im.test(f))                                              flags.four_poster_bed = true;
  if (/^BED:.*\btwins?\b/im.test(f))                                                  flags.twin_beds = true;
  if (/^WALK-IN CLOSET:\s*yes/im.test(f))                                             flags.walk_in_closet = true;

  // Space
  if (/^SEPARATE LIVING AREA:\s*yes/im.test(f))                                       flags.separate_living_area = true;
  if (/^CEILING HEIGHT:\s*(?:high ceilings|vaulted ceiling)/im.test(f))              flags.high_ceilings = true;
  if (/^WINDOWS:\s*floor-to-ceiling windows/im.test(f))                              flags.floor_to_ceiling_windows = true;

  // Outdoor
  if (/^BALCONY OR TERRACE:\s*yes/im.test(f))                                        flags.balcony = true;
  if (/^DISTINCTIVE FEATURES:.*\bterrace\b/im.test(f))                               flags.terrace = true;

  // Views
  if (/^VIEW:\s*city view/im.test(f))                                                 flags.city_view = true;
  if (/^VIEW:\s*(?:Eiffel Tower|landmark|Big Ben|Tower Bridge|Empire State|monument)/im.test(f)) flags.landmark_view = true;
  if (/^VIEW:\s*garden view/im.test(f))                                               flags.garden_view = true;
  if (/^VIEW:\s*(?:river view|seine|thames|hudson|canal view)/im.test(f))             flags.river_view = true;
  if (/^VIEW:\s*courtyard view/im.test(f))                                            flags.courtyard_view = true;
  if (/^VIEW:\s*pool view/im.test(f))                                                 flags.pool_view = true;
  if (/^VIEW:\s*(?:sea view|ocean view)/im.test(f))                                   flags.sea_view = true;
  if (/^VIEW:\s*mountain view/im.test(f))                                             flags.mountain_view = true;

  // Features
  if (/^FIREPLACE:\s*yes/im.test(f))                                                  flags.fireplace = true;
  if (/^DISTINCTIVE FEATURES:.*\bprivate pool\b/im.test(f))                          flags.private_pool = true;
  if (/^SOFA:\s*yes/im.test(f))                                                       flags.sofa = true;
  if (/^CHAISE LOUNGE:\s*yes/im.test(f))                                              flags.chaise_lounge = true;
  if (/^DINING TABLE:\s*yes/im.test(f))                                               flags.dining_table = true;

  return flags;
}

// ── Backfill feature_embedding for existing rows (protected) ─────────────────
// Reads each row's raw caption, applies the improved extractFeatureSummary()
// to get a clean signal-dense text (positive features only, no flooring noise),
// embeds it with gemini-embedding-001, and stores both the cleaned text and
// the vector. After ALL rows are done, rebuilds room_types_index in one SQL
// call instead of per-hotel RPCs.
// Usage: POST /api/backfill-feature-embeddings {"city":"Paris","secret":"..."}
app.post("/api/backfill-feature-embeddings", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  const GEMINI_KEY = process.env.GEMINI_KEY || "";
  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_KEY not set" });

  const { force } = req.body || {};
  const fc = supabaseAdmin || supabase;
  let countQuery = fc.from("room_embeddings")
    .select("*", { count: "exact", head: true })
    .eq("city", city);
  if (!force) countQuery = countQuery.is("feature_embedding", null);
  const { count } = await countQuery;

  res.json({ message: `Backfill started for ${city} (force=${!!force})`, todo: count });

  (async () => {
    console.log(`[feat-embed] starting backfill for ${city}: ${count} rows (force=${!!force})`);
    const BATCH = 200, CHUNK = 20, RATE = 900;
    let done = 0, failed = 0, lastId = 0;
    const startMs = Date.now();

    // Rate limiter (per 60s window)
    let windowStart = Date.now(), windowCount = 0;
    async function rateLimitedEmbed(text) {
      const now = Date.now();
      if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
      if (windowCount >= RATE) {
        const wait = 61000 - (now - windowStart);
        console.log(`[feat-embed] rate limit, pausing ${Math.round(wait / 1000)}s`);
        await new Promise(r => setTimeout(r, wait));
        windowStart = Date.now(); windowCount = 0;
      }
      windowCount++;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] } }),
          signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const vals = d?.embedding?.values;
      return vals ? vals.slice(0, 768) : null;
    }

    // Cursor-based pagination (avoids offset drift if rows are written mid-run)
    while (true) {
      let rowQuery = fc.from("room_embeddings")
        .select("id, caption, photo_type")
        .eq("city", city)
        .gt("id", lastId)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (!force) rowQuery = rowQuery.is("feature_embedding", null);
      const { data: rows, error } = await rowQuery;

      if (error) { console.error("[feat-embed] fetch error:", error.message); break; }
      if (!rows?.length) break;
      lastId = rows[rows.length - 1].id;

      for (let i = 0; i < rows.length; i += CHUNK) {
        await Promise.all(rows.slice(i, i + CHUNK).map(async row => {
          // Re-derive feature_summary using photo-type-specific section filtering
          const summary = extractFeatureSummary(row.caption, row.photo_type);
          if (!summary) { failed++; return; }
          const vec = await rateLimitedEmbed(summary);
          if (!vec) { failed++; return; }
          const { error: upErr } = await fc.from("room_embeddings")
            .update({ feature_embedding: vec, feature_summary: summary, feature_flags: extractFeatureFlags(summary) })
            .eq("id", row.id);
          if (upErr) { failed++; console.warn("[feat-embed] update err:", upErr.message); }
          else done++;
        }));
      }

      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(`[feat-embed] progress: ${done} done, ${failed} failed — ${(done / (elapsed || 1)).toFixed(1)}/s`);
    }

    console.log(`[feat-embed] embeddings done: ${done} updated, ${failed} failed`);

    // Verify completeness before rebuilding the index
    const { count: remaining } = await fc.from("room_embeddings")
      .select("*", { count: "exact", head: true })
      .eq("city", city).is("feature_embedding", null);
    if (remaining > 0) {
      console.warn(`[feat-embed] ${remaining} rows still missing feature_embedding — index rebuild may be partial`);
    }

    // Single bulk SQL call instead of ~1000 per-hotel RPCs
    console.log(`[feat-embed] rebuilding room_types_index for ${city}...`);
    const { data: rebuildCount, error: rebuildErr } = await fc
      .rpc("rebuild_room_types_index_city", { p_city: city });
    if (rebuildErr) {
      console.error("[feat-embed] rebuild error:", rebuildErr.message);
    } else {
      console.log(`[feat-embed] room_types_index rebuilt: ${rebuildCount} rows — backfill complete`);
    }
  })().catch(err => console.error("[feat-embed] fatal:", err.message));
});

// ── Backfill hotel_photos gallery for existing hotels_cache rows (protected) ──
// Fetches LiteAPI /data/hotel for each hotel where hotel_photos = '[]',
// extracts hotelImages[], and updates hotels_cache.hotel_photos.
// Usage: POST /api/backfill-hotel-gallery {"city":"Paris","secret":"roommatch-2026"}
app.post("/api/backfill-hotel-gallery", async (req, res) => {
  const { city, secret, dryRun } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  res.json({ message: `Hotel gallery backfill started for ${city}`, dryRun: !!dryRun });

  (async () => {
    const t0 = Date.now();
    console.log(`[gallery-backfill] Starting for ${city} dryRun=${!!dryRun}`);

    // Fetch all hotels_cache rows for city (including those already done, for resume safety)
    const { data: allHotels, error: fetchErr } = await supabaseAdmin
      .from("hotels_cache")
      .select("hotel_id, main_photo, hotel_photos")
      .eq("city", city);

    if (fetchErr || !allHotels) {
      console.error("[gallery-backfill] hotels_cache fetch failed:", fetchErr?.message);
      return;
    }

    // Only process hotels where gallery is empty
    const todo = allHotels.filter(h => !h.hotel_photos || h.hotel_photos.length === 0);
    console.log(`[gallery-backfill] ${allHotels.length} hotels total, ${todo.length} need gallery`);

    const CONCURRENCY = 20;
    let done = 0, filled = 0, empty = 0;

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (row) => {
        try {
          const r = await liteGet(`/data/hotel?hotelId=${row.hotel_id}`);
          if (!r.ok) { done++; empty++; return; }
          const detail = r.data?.data || {};
          const mainPhotoUrl = row.main_photo || "";

          const rawPhotos = [
            ...(detail.hotelImages || []),
            ...(detail.photos      || []),
            ...(detail.images      || []),
            ...(detail.gallery     || []),
          ];
          const photos = rawPhotos
            .map(p => (typeof p === "string" ? p : p?.urlHd || p?.url || p?.hd_url || ""))
            .filter(Boolean)
            .filter(u => u !== mainPhotoUrl)
            .slice(0, 8);

          if (!dryRun && photos.length > 0) {
            await supabaseAdmin
              .from("hotels_cache")
              .update({ hotel_photos: photos })
              .eq("hotel_id", row.hotel_id);
          }

          done++;
          if (photos.length > 0) filled++; else empty++;
          if (done % 50 === 0) {
            console.log(`[gallery-backfill] ${done}/${todo.length} done, ${filled} filled, ${empty} empty`);
          }
        } catch (e) {
          done++; empty++;
          console.warn(`[gallery-backfill] ${row.hotel_id} error:`, e.message);
        }
      }));
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[gallery-backfill] Done in ${elapsed}s — ${filled}/${todo.length} hotels got photos, ${empty} empty`);
  })().catch(err => console.error("[gallery-backfill] fatal:", err.message));
});

// ── Backfill room_type_id for existing rows (protected) ───────────────────────
app.post("/api/backfill-room-ids", async (req, res) => {
  const { city, secret, dryRun } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  // Run async, stream progress to logs
  res.json({ message: `Backfill started for ${city}`, dryRun: !!dryRun });

  (async () => {
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
    const matchScore = (a, b) => {
      const na = norm(a), nb = norm(b);
      if (na === nb) return 3;
      if (na.includes(nb) || nb.includes(na)) return 2;
      const wa = new Set(na.split(" ")), wb = new Set(nb.split(" "));
      return [...wa].filter(w => wb.has(w) && w.length > 2).length >= 2 ? 1 : 0;
    };

    const fc = supabaseAdmin || supabase;
    const { data: rows, error } = await fc
      .from("room_embeddings").select("hotel_id, room_name")
      .eq("city", city).is("room_type_id", null);
    if (error) { console.error("[backfill]", error.message); return; }
    if (!rows?.length) { console.log("[backfill] Nothing to backfill"); return; }

    const byHotel = new Map();
    for (const r of rows) {
      if (!byHotel.has(r.hotel_id)) byHotel.set(r.hotel_id, new Set());
      byHotel.get(r.hotel_id).add(r.room_name);
    }
    console.log(`[backfill] ${rows.length} rows across ${byHotel.size} hotels`);

    let updated = 0, failed = 0;
    for (const [hotelId, roomNames] of byHotel) {
      try {
        const r = await fetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${hotelId}`, {
          headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { console.warn(`[backfill] ${hotelId}: LiteAPI ${r.status}`); failed += roomNames.size; continue; }
        const detail = (await r.json())?.data || {};
        const liteRooms = (detail.rooms || []).map(rm => ({
          id: rm.id || rm.roomId || rm.roomTypeId || null,
          name: rm.roomName || rm.name || "",
        })).filter(rm => rm.id);

        for (const dbName of roomNames) {
          let best = null, bestScore = 0;
          for (const lr of liteRooms) {
            const s = matchScore(dbName, lr.name);
            if (s > bestScore) { bestScore = s; best = lr; }
          }
          if (!best || bestScore === 0) { console.warn(`[backfill] ${hotelId}: no match for "${dbName}"`); failed++; continue; }
          console.log(`[backfill] ${hotelId}: "${dbName}" → ${best.id} (score ${bestScore})`);
          if (!dryRun) {
            const { error: upErr } = await fc.from("room_embeddings")
              .update({ room_type_id: best.id })
              .eq("hotel_id", hotelId).eq("room_name", dbName).is("room_type_id", null);
            if (upErr) { console.error(`[backfill] update error:`, upErr.message); failed++; }
            else updated++;
          } else { updated++; }
        }
        await new Promise(r => setTimeout(r, 150)); // gentle LiteAPI pacing
      } catch(e) { console.warn(`[backfill] ${hotelId}: ${e.message}`); failed += roomNames.size; }
    }
    console.log(`[backfill] Done — ${updated} updated, ${failed} unmatched`);
  })();
});

// ── Neighborhoods endpoint ─────────────────────────────────────────────────────
// GET /api/neighborhoods?city=Paris
// Returns 5-8 Gemini-generated neighborhood cards with vibes + Unsplash photos.
// Gated to indexed cities only. Caches in DB — first call takes ~4-8s.
const neighborhoodGenerating = new Set(); // track in-flight generation per city

// Rebuild v2_room_types_index for a city without re-running the full indexer.
// POST /api/v2/rebuild-city-index {"city":"Mexico City","secret":"roommatch-2026"}
app.post("/api/v2/rebuild-city-index", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-2026")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  const fc = supabaseAdmin || supabase;
  if (!fc) return res.status(500).json({ error: "Supabase not configured" });
  res.json({ message: `Rebuilding v2_room_types_index for "${city}"...` });
  try {
    const { data, error } = await fc.rpc("rebuild_v2_room_types_index_city", { p_city: city });
    if (error) console.error(`[v2-rebuild] ${city} error:`, error.message);
    else {
      console.log(`[v2-rebuild] ${city}: ${data} room types rebuilt`);
      invalidatePhaseACache(city);
      console.log(`[v2-rebuild] ${city}: phase-A cache invalidated`);
    }
  } catch (ex) {
    console.error(`[v2-rebuild] ${city} exception:`, ex.message);
  }
});

app.get("/api/neighborhoods", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  if (!cityInput) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["neighborhoods", "indexed_cities", "hotels_cache"]);

  try {
    // Return cached rows immediately if they exist
    const { data: cached } = await supabase
      .from("neighborhoods")
      .select("*")
      .eq("city", city)
      .order("id");
    if (cached?.length > 0) {
      return res.json({ neighborhoods: cached, city });
    }

    // If generation already in-flight for this city, return 202
    if (neighborhoodGenerating.has(city)) {
      return res.status(202).json({ status: "generating", city });
    }

    // Kick off generation
    neighborhoodGenerating.add(city);
    try {
      const rows = await loadNeighborhoodGenerator().generateNeighborhoods(
        city, supabaseAdmin || supabase,
        process.env.GEMINI_KEY, process.env.UNSPLASH_KEY, process.env.GOOGLE_PLACES_KEY, process.env.PEXELS_KEY, process.env.FLICKR_KEY
      );
      neighborhoodGenerating.delete(city);
      return res.json({ neighborhoods: rows, city });
    } catch (e) {
      neighborhoodGenerating.delete(city);
      console.error(`[neighborhoods] generation failed for ${city}:`, e.message);
      return res.status(500).json({ error: "Neighborhood generation failed", detail: e.message });
    }
  } catch (err) {
    console.error("[neighborhoods]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Vibe presets endpoint ──────────────────────────────────────────────────────
// GET /api/vibe-presets?city=Paris
// Returns 8 canonical room-style photos + captions for photo-tap search.
const VIBE_STYLES = [
  { label: "Bright & Minimal",    query: "bright white room large windows minimal modern" },
  { label: "Warm Art Deco",       query: "art deco warm tones dark wood ornate details" },
  { label: "Romantic & Soft",     query: "soft lighting romantic canopy bed pastel tones" },
  { label: "Bold & Contemporary", query: "bold contemporary design statement furniture dramatic" },
  { label: "Classic Luxury",      query: "classic luxury marble chandelier high ceilings gold" },
  { label: "Cozy & Intimate",     query: "cozy intimate warm textures fireplace reading nook" },
  { label: "Urban & Industrial",  query: "urban industrial exposed brick concrete loft dark" },
  { label: "Serene & Spa-Like",   query: "serene spa bathroom soaking tub natural light zen" },
];

app.get("/api/vibe-presets", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  if (!cityInput) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["vibe_presets", "neighborhoods", "indexed_cities"]);

  try {
    // Return cached presets if available
    const { data: cached } = await supabase
      .from("vibe_presets")
      .select("style_label, query_used, photo_url, caption")
      .eq("city", city)
      .order("id");
    if (cached?.length >= VIBE_STYLES.length) {
      return res.json({ presets: cached, city });
    }

    // Generate: run vsearch for each style, take top photo
    const presets = [];
    for (const style of VIBE_STYLES) {
      try {
        // Inline vsearch to get top photo without an HTTP round-trip
        const embedRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text: style.query }] } }),
          }
        );
        if (!embedRes.ok) continue;
        const embedData = await embedRes.json();
        const embedding = embedData?.embedding?.values?.slice(0, 768);
        if (!embedding) continue;

        const fc = supabaseAdmin || supabase;
        const { data: roomTypes } = await fc.rpc("score_room_types", {
          query_embedding: embedding,
          search_city: city,
        });
        if (!roomTypes?.length) continue;

        const topHotelId = roomTypes[0].hotel_id;
        const { data: photos } = await fc.rpc("fetch_hotel_photos", {
          hotel_ids: [topHotelId],
          max_per_hotel: 5,
        });
        const photo = photos?.find(p => p.photo_url);
        if (!photo) continue;

        presets.push({
          city,
          style_label: style.label,
          query_used:  style.query,
          photo_url:   photo.photo_url,
          caption:     photo.caption || style.query,
          hotel_id:    topHotelId,
        });
      } catch (e) {
        console.warn(`[vibe-presets] style "${style.label}" failed:`, e.message);
      }
    }

    if (presets.length > 0) {
      await (supabaseAdmin || supabase)
        .from("vibe_presets")
        .upsert(presets, { onConflict: "city,style_label" });
    }

    res.json({ presets: presets.map(p => ({
      style_label: p.style_label, query_used: p.query_used,
      photo_url: p.photo_url, caption: p.caption,
    })), city });
  } catch (err) {
    console.error("[vibe-presets]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Backfill neighborhood vibe elements/photos (protected) ────────────────────
// POST /api/backfill-neighborhood-vibes {"secret":"roommatch-2026","city":"Paris"}
app.post("/api/backfill-neighborhood-vibes", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `backfill-neighborhood-vibes started for ${city}` });

  (async () => {
    try {
      const updated = await loadNeighborhoodGenerator().recomputeNeighborhoodVibes(city, db, process.env.UNSPLASH_KEY, process.env.GOOGLE_PLACES_KEY, process.env.GEMINI_KEY, process.env.PEXELS_KEY, process.env.FLICKR_KEY);
      console.log(`[backfill-neighborhood-vibes] ${city}: ${updated} neighborhoods refreshed`);
    } catch (e) {
      console.error(`[backfill-neighborhood-vibes] ${city} failed:`, e.message);
    }
  })();
});

// POST /api/regenerate-neighborhoods {"secret":"roommatch-2026","city":"Mexico City"}
// Wipes all neighborhood rows for the city (except manual_override=true) and runs a
// fresh Gemini generation from scratch.  Use after prompt or scoring changes.
app.post("/api/regenerate-neighborhoods", async (req, res) => {
  const { city, secret, keep_manual = true } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const geminiKey   = process.env.GEMINI_KEY;
  const unsplashKey = process.env.UNSPLASH_KEY;
  if (!geminiKey) return res.status(500).json({ error: "GEMINI_KEY not set" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `regenerate-neighborhoods started for ${city} (keep_manual=${keep_manual})` });

  (async () => {
    try {
      // Delete existing rows (skip manual_override=true when keep_manual is set)
      let deleteQ = db.from("neighborhoods").delete().eq("city", city);
      if (keep_manual) deleteQ = deleteQ.eq("manual_override", false);
      const { error: delErr } = await deleteQ;
      if (delErr) throw new Error(`delete failed: ${delErr.message}`);
      console.log(`[regenerate-neighborhoods] deleted existing rows for ${city} (keep_manual=${keep_manual})`);

      const rows = await loadNeighborhoodGenerator().generateNeighborhoods(
        city, db, geminiKey, unsplashKey,
        process.env.GOOGLE_PLACES_KEY || null,
        process.env.PEXELS_KEY || null,
        process.env.FLICKR_KEY || null
      );
      console.log(`[regenerate-neighborhoods] ${city}: ${rows.length} neighborhoods generated`);
    } catch (e) {
      console.error(`[regenerate-neighborhoods] ${city} failed:`, e.message);
    }
  })();
});

// POST /api/backfill-neighborhood-polygons {"secret":"roommatch-2026","city":"Mexico City","force":false}
// Fetches authoritative OSM/Nominatim polygons for all neighborhoods of a city.
// Skips rows already having ≥20-vertex OSM polygon unless force=true.
app.post("/api/backfill-neighborhood-polygons", async (req, res) => {
  const { city, secret, force = false } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `backfill-neighborhood-polygons started for ${city} (force=${force})` });

  (async () => {
    try {
      const result = await loadNeighborhoodGenerator().backfillNeighborhoodPolygons(city, db, force);
      console.log(`[backfill-neighborhood-polygons] ${city}: ${result.updated} updated, ${result.skipped} skipped`);
    } catch (e) {
      console.error(`[backfill-neighborhood-polygons] ${city} failed:`, e.message);
    }
  })();
});

// POST /api/refresh-hotel-counts {"secret":"roommatch-2026","city":"Mexico City"}
// Recomputes hotel_count for all neighborhoods of a city from hotels_cache lat/lng.
// Fast (~1s). Responds with updated counts.
app.post("/api/refresh-hotel-counts", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  try {
    await loadNeighborhoodGenerator().refreshHotelCounts(city, db);
    const { data } = await db.from("neighborhoods").select("name, hotel_count").eq("city", city).order("hotel_count", { ascending: false });
    return res.json({ updated: data?.length || 0, counts: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/backfill-neighborhood-photos {"secret":"roommatch-2026","city":"Paris"}
// Re-fetches only hero photos (photo_url/photo_credit) using improved Unsplash queries.
// Does NOT regenerate Gemini data. Responds immediately; runs in background.
app.post("/api/backfill-neighborhood-photos", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `backfill-neighborhood-photos started for ${city}` });

  (async () => {
    try {
      const updated = await loadNeighborhoodGenerator().backfillNeighborhoodPhotos(city, db, process.env.UNSPLASH_KEY, process.env.GOOGLE_PLACES_KEY, process.env.PEXELS_KEY, process.env.FLICKR_KEY);
      console.log(`[backfill-neighborhood-photos] ${city}: ${updated} photos updated`);
    } catch (e) {
      console.error(`[backfill-neighborhood-photos] ${city} failed:`, e.message);
    }
  })();
});

// POST /api/backfill-neighborhood-photo-queries {"secret":"roommatch-2026","city":"Paris"}
// For existing neighborhoods with empty photo_queries: calls Gemini to generate specific
// named-place queries per element, then re-fetches only element photos. ~2min per city.
app.post("/api/backfill-neighborhood-photo-queries", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `backfill-neighborhood-photo-queries started for ${city}` });

  (async () => {
    try {
      const updated = await loadNeighborhoodGenerator().backfillPhotoQueries(
        city, db, process.env.GEMINI_KEY, process.env.UNSPLASH_KEY, process.env.GOOGLE_PLACES_KEY, process.env.PEXELS_KEY, process.env.FLICKR_KEY
      );
      console.log(`[backfill-neighborhood-photo-queries] ${city}: ${updated} neighborhoods updated`);
    } catch (e) {
      console.error(`[backfill-neighborhood-photo-queries] ${city} failed:`, e.message);
    }
  })();
});

// ── Backfill lat/lng endpoint (protected) ─────────────────────────────────────
// POST /api/backfill-latlng {"secret":"roommatch-2026","city":"Paris"}
app.post("/api/backfill-latlng", async (req, res) => {
  const { city, secret, dry_run } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const db = supabaseAdmin || supabase;
  const cities = city ? [city] : ["Paris", "Kuala Lumpur"];
  res.json({ message: `backfill-latlng started for: ${cities.join(", ")}` });
  (async () => {
    for (const c of cities) {
      try {
        const updated = await loadBackfillLatlng().backfillCity(c, db, !!dry_run);
        console.log(`[backfill-latlng] ${c}: ${updated} updated`);
        // Refresh hotel_count for neighborhoods after backfill
        await loadNeighborhoodGenerator().refreshHotelCounts(c, db).catch(() => {});
      } catch (e) {
        console.error(`[backfill-latlng] ${c} error:`, e.message);
      }
    }
    console.log("[backfill-latlng] done");
  })();
});

// ── Manual trigger endpoint (protected) ───────────────────────────────────────
app.post("/api/index-city", async (req, res) => {
  const { city: cityRaw, limit, secret, min_room_photos } = req.body || {};
  const city = normalizeCityName(cityRaw);
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  const opts = {};
  if (min_room_photos != null) opts.minRoomPhotos = Number(min_room_photos);
  // Fire and forget
  loadIndexCity()(city, limit || 200, opts)
    .catch(e => {
      console.error(`[indexer] FAILED for ${city}:`, e.message);
    });
  res.json({ message: `Indexing ${city} started`, city, limit: limit || 200, ...(opts.minRoomPhotos ? { min_room_photos: opts.minRoomPhotos } : {}) });
});

// ── V2 isolated city index (facts-only datastore) ────────────────────────────
app.post("/api/v2/reindex-city", async (req, res) => {
  const { city, limit = 200, secret, force = true } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  res.json({ message: `V2 reindex started for ${city}`, city, limit, force });
  loadIndexCityV2()(city, Number(limit) || 200, !!force)
    .then((r) => console.log(`[v2-index] complete ${city}:`, r))
    .catch(async (e) => {
      console.error(`[v2-index] failed ${city}:`, e.message);
      const fc = supabaseAdmin || supabase;
      if (fc) {
        await fc.from("v2_indexed_cities").upsert({
          city,
          status: "failed",
          last_error: e.message,
          updated_at: new Date().toISOString(),
        }, { onConflict: "city" });
      }
    });
});

// ── V2 full city rollout (reindex → verify → neighbourhoods → V1 cleanup) ─────
const _v2RolloutActive = new Set();
function loadV2RolloutCore() {
  return require("./scripts/v2-city-rollout-core");
}

// POST /api/v2/city-rollout {"secret":"...","city":"Paris","force":true,"limit":5200}
// Fire-and-forget on Render. Poll GET /api/v2/city-rollout/status?city=Paris
app.post("/api/v2/city-rollout", async (req, res) => {
  const {
    city,
    secret,
    limit,
    force = true,
    resume = false,
    skip_neighborhoods = false,
    keep_v1 = false,
    regenerate_neighborhoods = false,
  } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Supabase service role required" });
  if (_v2RolloutActive.has(city)) {
    return res.status(409).json({ error: "rollout_already_running", city });
  }

  const forceRebuild = resume ? false : !!force;
  _v2RolloutActive.add(city);
  res.json({
    message: `V2 city rollout started for ${city}`,
    city,
    force: forceRebuild,
    resume: !!resume,
    skip_neighborhoods: !!skip_neighborhoods,
    keep_v1: !!keep_v1,
    regenerate_neighborhoods: !!regenerate_neighborhoods,
    limit: rolloutLimit ?? (limit != null ? Number(limit) : null),
    status_url: `/api/v2/city-rollout/status?city=${encodeURIComponent(city)}`,
    note: "Tail Render logs: [v2-rollout] and [v2-index]. Restart Render after complete so /api/rates uses v2_hotels_cache.",
  });

  const core = loadV2RolloutCore();
  let rolloutLimit = limit != null ? Number(limit) : undefined;
  if (rolloutLimit == null) {
    try {
      const cc = core.countryCode(city);
      const total = await core.liteCatalogTotal(
        city, cc, process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY,
      );
      rolloutLimit = total + 50;
      console.log(`[v2-rollout] ${city}: auto limit=${rolloutLimit} (catalog=${total})`);
    } catch (e) {
      console.warn(`[v2-rollout] ${city}: could not auto-detect catalog limit:`, e.message);
    }
  }
  core.runFullCityRollout({
    db: supabaseAdmin,
    city,
    reindexFn: loadIndexCityV2(),
    limit: rolloutLimit,
    force: forceRebuild,
    skipNeighborhoods: !!skip_neighborhoods,
    keepV1: !!keep_v1,
    regenerateNeighborhoods: !!regenerate_neighborhoods,
    log: (...args) => console.log("[v2-rollout]", ...args),
  })
    .then((snap) => console.log(`[v2-rollout] complete ${city}:`, snap?.counts))
    .catch(async (e) => {
      console.error(`[v2-rollout] failed ${city}:`, e.message);
      if (e.code !== "VERIFY_FAILED") {
        await supabaseAdmin.from("v2_indexed_cities").upsert({
          city,
          status: "failed",
          last_error: e.message,
          updated_at: new Date().toISOString(),
        }, { onConflict: "city" });
      }
    })
    .finally(() => _v2RolloutActive.delete(city));
});

app.get("/api/v2/city-rollout/status", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  if (!cityInput || !supabase) return res.status(400).json({ error: "city required" });
  const db = supabaseAdmin || supabase;
  const city = await resolveCityName(cityInput, db, ["v2_indexed_cities", "v2_hotels_cache", "hotels_cache"]);
  try {
    const core = loadV2RolloutCore();
    const snapshot = await core.getRolloutSnapshot(db, city);
    let catalog_total = null;
    try {
      catalog_total = await core.liteCatalogTotal(
        city,
        core.countryCode(city),
        process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY,
      );
    } catch (_) { /* optional */ }
    res.json({
      ...snapshot,
      rollout_running: _v2RolloutActive.has(city),
      catalog_total,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── V2 room-type classification backfill (Gemini text, no vision) ────────────
app.post("/api/v2/backfill-room-types", async (req, res) => {
  const { city, secret, force = false } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  res.json({ message: `Room-type classification backfill started for ${city}`, city, force });
  try {
    const { backfillRoomTypes } = require("./scripts/backfill-room-types");
    const result = await backfillRoomTypes(city, { force: !!force });
    console.log(`[backfill-rt] complete:`, result);
  } catch (e) {
    console.error(`[backfill-rt] failed for ${city}:`, e.message);
  }
});

// ── V2 visual_style classification (Gemini vision, single-label) ─────────────
// Incremental per-photo backfill so boop's stayVibe answer drives ranking.
// Idempotent — skips photos that already have a visual_style_* fact row.
// See scripts/classify-visual-style.js for design + cost notes.
app.post("/api/v2/classify-visual-style", async (req, res) => {
  const { city, secret, limit, country_code, concurrency, rate_per_min } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  res.json({
    message: `visual_style classification started for ${city}`,
    city,
    limit: Number.isFinite(limit) ? limit : null,
    concurrency: Number(concurrency) || null,
    rate_per_min: Number(rate_per_min) || null,
    note: "Tail Render logs ([vs-classify] prefix) for progress.",
  });
  try {
    const { classifyVisualStyleForCity } = require("./scripts/classify-visual-style");
    const result = await classifyVisualStyleForCity(city, {
      limit: Number.isFinite(limit) ? Number(limit) : undefined,
      country_code: country_code || undefined,
      concurrency: Number(concurrency) || undefined,
      rate_per_min: Number(rate_per_min) || undefined,
    });
    console.log("[vs-classify] complete:", result);
  } catch (e) {
    console.error(`[vs-classify] failed for ${city}:`, e.message);
  }
});

// ── V2 hotel-public photo classification (Phase 1b: hotel-vibe scoring) ──────
// Same pattern as classify-visual-style but for `v2_hotels_cache.hotel_photos`
// (lobby, pool, bar, exterior, ...). Emits area_* presence facts + visual_style_*
// per photo into `v2_room_feature_facts` under room_name='__hotel_public__'.
// `score_hotels_facts_v2` then blends room and public coverage to produce
// `hotelScore` for every hotel.
//
// Mexico City: ~3500 hotels × ~8 public photos avg ≈ 28k photos, ~35 min,
// ~$1.06 at concurrency=24 / rate_per_min=1500.
// See scripts/classify-hotel-public.js for design notes.
app.post("/api/v2/classify-hotel-public", async (req, res) => {
  const { city, secret, limit, concurrency, rate_per_min } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  res.json({
    message: `hotel-public classification started for ${city}`,
    city,
    limit: Number.isFinite(limit) ? limit : null,
    concurrency: Number(concurrency) || null,
    rate_per_min: Number(rate_per_min) || null,
    note: "Tail Render logs ([hp-classify] prefix) for progress.",
  });
  try {
    const { classifyHotelPublicForCity } = require("./scripts/classify-hotel-public");
    const result = await classifyHotelPublicForCity(city, {
      limit: Number.isFinite(limit) ? Number(limit) : undefined,
      concurrency: Number(concurrency) || undefined,
      rate_per_min: Number(rate_per_min) || undefined,
    });
    console.log("[hp-classify] complete:", result);
  } catch (e) {
    console.error(`[hp-classify] failed for ${city}:`, e.message);
  }
});

app.get("/api/v2/index-status", async (req, res) => {
  const cityInput = (req.query.city || "").trim();
  if (!cityInput || !supabase) return res.json({ status: "unknown" });
  const city = await resolveCityName(cityInput, supabaseAdmin || supabase, ["v2_indexed_cities", "v2_hotels_cache", "hotels_cache"]);
  const { data } = await (supabaseAdmin || supabase)
    .from("v2_indexed_cities")
    .select("status, hotel_count, photo_count, started_at, completed_at, last_error")
    .eq("city", city)
    .single();
  res.json(data || { status: "none" });
});

// BOOP v4: incremental pass that only pulls hotel-level amenity photos +
// description embeddings for existing indexed cities. Leaves room data alone.
// Trigger after deploying v4 to backfill Paris/KL without re-indexing rooms.
app.post("/api/index-city-amenities", async (req, res) => {
  const { city: cityRaw, limit, secret } = req.body || {};
  const city = normalizeCityName(cityRaw);
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  loadIndexCityAmenities()(city, { limit: limit || null })
    .catch(e => console.error(`[amenity_only] FAILED for ${city}:`, e.message));
  res.json({
    message: `Amenity-only indexing for ${city} started`,
    city, limit: limit || null,
    note: "Processes hotel-level photos + descriptions. Room photos untouched. Check Render logs for progress."
  });
});

// BOOP v4: manually trigger rebuild of hotel_profile_index for a city.
// Useful if amenity indexing completed but the aggregation step failed.
app.post("/api/rebuild-hotel-profile-index", async (req, res) => {
  const { city: cityRaw, secret } = req.body || {};
  const city = normalizeCityName(cityRaw);
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  try {
    const db = supabaseAdmin || supabase;
    const { data, error } = await db.rpc("rebuild_hotel_profile_index_city", { p_city: city });
    if (error) throw error;
    res.json({ city, rows_updated: data, message: "hotel_profile_index rebuilt" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Street View Static API — 4-frame neighborhood walk ───────────────────────
// GET /api/street-view?hotelId=lp1beec
// Server: GOOGLE_STREETVIEW_SERVER_KEY (no browser Referer — used for metadata only).
// Client <img>: signed URLs with GOOGLE_STREETVIEW_BROWSER_KEY + GOOGLE_STREETVIEW_SIGNING_SECRET.
// Legacy: GOOGLE_STREETVIEW_KEY alone fills both keys if the split keys are unset.
// https://developers.google.com/maps/documentation/streetview/digital-signature
const SV_SERVER_KEY = process.env.GOOGLE_STREETVIEW_SERVER_KEY || process.env.GOOGLE_STREETVIEW_KEY || "";
const SV_BROWSER_KEY = process.env.GOOGLE_STREETVIEW_BROWSER_KEY || process.env.GOOGLE_STREETVIEW_KEY || "";
const SV_SIGNING_SECRET = process.env.GOOGLE_STREETVIEW_SIGNING_SECRET || "";
const _svCache = new Map();     // cacheKey → { ts, urls }
const _svCoordCache = new Map(); // hotelId → { lat, lng }  (permanent, no expiry needed)
const SV_CACHE_MS = 24 * 60 * 60 * 1000; // 24h
const SV_CACHE_VERSION = 4; // bump when URL params / signing change (invalidates stale cache)
let _svUnsignedWarned = false;

function googleStreetViewSigningKeyBytes(secretRaw) {
  if (!secretRaw || typeof secretRaw !== "string") return null;
  const s = secretRaw.trim();
  try {
    return Buffer.from(s, "base64url");
  } catch {
    try {
      const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      return Buffer.from(b64 + pad, "base64");
    } catch {
      return null;
    }
  }
}

/** pathWithQuery must start with `/maps/api/streetview` or `/maps/api/streetview/metadata` and include `?...` (no signature). */
function signGoogleStreetViewPath(pathWithQuery) {
  const keyBytes = googleStreetViewSigningKeyBytes(SV_SIGNING_SECRET);
  if (!keyBytes) return null;
  const sig = crypto.createHmac("sha1", keyBytes).update(pathWithQuery).digest("base64");
  const sigSafe = sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://maps.googleapis.com${pathWithQuery}&signature=${sigSafe}`;
}

function fullStreetViewUrl(pathWithQuery) {
  if (SV_SIGNING_SECRET) {
    const signed = signGoogleStreetViewPath(pathWithQuery);
    if (signed) return signed;
  }
  if (!_svUnsignedWarned) {
    console.warn("[street-view] GOOGLE_STREETVIEW_SIGNING_SECRET unset — returning unsigned URLs (set secret for production)");
    _svUnsignedWarned = true;
  }
  return `https://maps.googleapis.com${pathWithQuery}`;
}

app.get("/api/street-view", async (req, res) => {
  const hotelId = (req.query.hotelId || "").trim();
  const cityHint = (req.query.city || "").trim(); // optional — used to pick the right cache table
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  if (!SV_SERVER_KEY || !SV_BROWSER_KEY) {
    return res.status(503).json({
      error: "Street View not configured",
      hint: "Set GOOGLE_STREETVIEW_SERVER_KEY + GOOGLE_STREETVIEW_BROWSER_KEY (or legacy GOOGLE_STREETVIEW_KEY for both)",
    });
  }
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const cacheKey = `${SV_CACHE_VERSION}:${hotelId}`;
  const cached = _svCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SV_CACHE_MS) {
    return res.json({ urls: cached.urls, cached: true });
  }

  // Look up lat/lng — coord cache first, then DB (single table when city known, parallel otherwise)
  const db = supabaseAdmin || supabase;
  let lat, lng;
  const cached_coord = _svCoordCache.get(hotelId);
  if (cached_coord) { lat = cached_coord.lat; lng = cached_coord.lng; }
  if (!lat || !lng) {
    const t0db = Date.now();
    const primaryTable = cityHint ? hotelsCacheFor(cityHint) : null;
    let row = null;
    if (primaryTable) {
      // City is known — query exactly one table
      const { data } = await db.from(primaryTable).select("lat, lng").eq("hotel_id", hotelId).maybeSingle();
      row = (data?.lat && data?.lng) ? data : null;
    } else {
      // City unknown — query both in parallel
      const [r1, r2] = await Promise.all([
        db.from("hotels_cache").select("lat, lng").eq("hotel_id", hotelId).maybeSingle(),
        db.from("v2_hotels_cache").select("lat, lng").eq("hotel_id", hotelId).maybeSingle(),
      ]);
      row = (r1.data?.lat && r1.data?.lng) ? r1.data : (r2.data?.lat && r2.data?.lng) ? r2.data : null;
    }
    if (row) { lat = row.lat; lng = row.lng; _svCoordCache.set(hotelId, { lat, lng }); }
    console.log(`[street-view] db lookup ${hotelId} (${primaryTable || "both"}): ${Date.now() - t0db}ms`);
  }
  if (!lat || !lng) {
    return res.status(404).json({ error: "Hotel coordinates not found" });
  }

  const size = "1280x800";
  const fov = 102;
  const pitch = 0;
  const radius = 120; // broaden search to find curb/outdoor pano near hotel footprint
  const sampleDistanceM = 55;
  const browserKeyQ = encodeURIComponent(SV_BROWSER_KEY);
  const serverKeyQ = encodeURIComponent(SV_SERVER_KEY);

  const svPathFromPano = (panoId, heading) =>
    `/maps/api/streetview?size=${size}&pano=${encodeURIComponent(panoId)}&heading=${heading}&pitch=${pitch}&fov=${fov}&source=outdoor&key=${browserKeyQ}`;

  const svPathFromLocation = (la, ln, heading) =>
    `/maps/api/streetview?size=${size}&location=${la},${ln}&heading=${heading}&pitch=${pitch}&fov=${fov}&radius=${radius}&source=outdoor&key=${browserKeyQ}`;

  // Sample around the hotel point to avoid interior-captured pano at the exact pin.
  const latStep = sampleDistanceM / 111320;
  const lngStep = sampleDistanceM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const candidates = [
    { la: lat + latStep, ln: lng, heading: 180, label: "north" },
    { la: lat, ln: lng + lngStep, heading: 270, label: "east" },
    { la: lat - latStep, ln: lng, heading: 0, label: "south" },
    { la: lat, ln: lng - lngStep, heading: 90, label: "west" },
  ];

  // Fetch all 4 cardinal-direction metadata calls in parallel — was sequential before (~1.5-2.8s).
  let urls = [];
  const t0meta = Date.now();
  try {
    const metaResults = await Promise.all(candidates.map(async (c) => {
      const metaPath =
        `/maps/api/streetview/metadata?location=${c.la},${c.ln}&radius=${radius}&source=outdoor&key=${serverKeyQ}`;
      let metaUrl = SV_SIGNING_SECRET ? signGoogleStreetViewPath(metaPath) : null;
      if (!metaUrl) metaUrl = `https://maps.googleapis.com${metaPath}`;
      try {
        const metaResp = await fetch(metaUrl);
        const meta = await metaResp.json();
        if (meta.status !== "OK") return null;
        const panoId = meta.pano_id || meta.panoId;
        if (panoId) return fullStreetViewUrl(svPathFromPano(panoId, c.heading));
        if (meta.location) return fullStreetViewUrl(svPathFromLocation(meta.location.lat, meta.location.lng, c.heading));
        return fullStreetViewUrl(svPathFromLocation(c.la, c.ln, c.heading));
      } catch (_) { return null; }
    }));
    urls = metaResults.filter(Boolean).slice(0, 4);
  } catch (e) {
    console.warn("[street-view] metadata sampling failed:", e.message);
  }
  console.log(`[street-view] ${hotelId}: metadata ${Date.now() - t0meta}ms → ${urls.length} urls`);

  if (!urls.length) {
    console.log(`[street-view] No outdoor curb coverage for ${hotelId} near ${lat},${lng}`);
    return res.json({ urls: [], coverage: false });
  }
  _svCache.set(cacheKey, { ts: Date.now(), urls });
  res.json({ urls, coverage: true });
});

// ── GET /api/hotels-meta — batch lazy metadata fetch ────────────────────────
// Used by the client to fill in name / mainPhoto / starRating / rating / address
// for hotel cards beyond the synchronous fetch limit (META_SYNC_LIMIT, default 30)
// returned by /api/vsearch. Reads from _hotelMetaCache; missing IDs are fetched
// from LiteAPI on demand. Returns { hotels: { [id]: { name, mainPhoto, ... } } }.
app.get("/api/hotels-meta", async (req, res) => {
  const idsRaw = String(req.query.ids || "").trim();
  if (!idsRaw) return res.status(400).json({ error: "ids required (comma-separated)" });
  const ids = idsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return res.status(400).json({ error: "no valid ids" });
  try {
    const t0 = Date.now();
    const meta = await fetchHotelMetaBatch(ids);
    const out = {};
    for (const id of ids) {
      const sid = String(id);
      const m = meta[sid];
      if (m) {
        out[sid] = {
          name:        m.name        || null,
          mainPhoto:   m.mainPhoto   || null,
          starRating:  m.starRating  || 0,
          guestRating: m.guestRating || 0,
          address:     m.address     || "",
        };
      }
    }
    const filled = Object.keys(out).length;
    console.log(`[hotels-meta] returned ${filled}/${ids.length} in ${Date.now()-t0}ms`);
    res.json({ hotels: out });
  } catch (e) {
    console.error("[hotels-meta]", e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/hotel-rooms — lazy room data for stub hotels ───────────────────
// /api/vsearch returns ALL hotels in a city (e.g. 3500 for Mexico City) but
// only fetches photos+room data for the top GALLERY_LIMIT=250 by vibe sim.
// The remaining 3250 are returned as stubs (roomTypes: []). When /api/rates
// gives those stubs a price, the card has nothing visual to show — the user
// sees "Queen Room" as a rate-only row even when we DO have 12 indexed
// photos for that room in v2_room_inventory. This endpoint serves that
// missing data: pass the stub-hotel IDs, get back roomTypes (name + photos
// + photo_type) per hotel. No vibe scoring — stubs are by definition
// outside the top-vibe-ranked set, so score is 0. Bookable via rate-only
// matching on roomTypeId.
//
// Request:  GET /api/hotel-rooms?ids=lp1,lp2,...&city=Mexico%20City
// Response: { hotels: { [hotel_id]: { roomTypes: [{name, roomTypeId, photos[]}] } } }
app.get("/api/hotel-rooms", async (req, res) => {
  const idsRaw = String(req.query.ids || "").trim();
  const city   = String(req.query.city || "").trim();
  if (!idsRaw) return res.status(400).json({ error: "ids required (comma-separated)" });
  if (!city)   return res.status(400).json({ error: "city required" });
  const ids = idsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 150);
  if (!ids.length) return res.status(400).json({ error: "no valid ids" });
  try {
    const t0 = Date.now();
    const db = supabaseAdmin || supabase;
    // Pull every photo row for the requested hotels. v2_room_inventory has
    // both photo_url and photo_type (unlike v2_room_feature_facts which
    // doesn't). For 150 hotels × ~5 rooms × ~5 photos = ~3750 rows max.
    const { data, error } = await db
      .from("v2_room_inventory")
      .select("hotel_id, room_name, room_type_id, photo_url, photo_type")
      .in("hotel_id", ids)
      .eq("city", city)
      .neq("room_name", "__hotel_public__")   // exclude hotel-public pseudo-room
      .limit(10000);
    if (error) {
      console.error("[hotel-rooms] db error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    // Group: hotel_id → (room_name → { roomTypeId, photos[], photo_type counts })
    // Cap each room at 10 photos so cards aren't bloated.
    const PHOTOS_PER_ROOM = 10;
    const byHotel = new Map();
    for (const row of (data || [])) {
      if (!byHotel.has(row.hotel_id)) byHotel.set(row.hotel_id, new Map());
      const rooms = byHotel.get(row.hotel_id);
      const rn = row.room_name || "Room";
      if (!rooms.has(rn)) {
        rooms.set(rn, {
          roomTypeId: row.room_type_id != null ? String(row.room_type_id) : null,
          photos:     [],
          seen:       new Set(),
        });
      }
      const entry = rooms.get(rn);
      if (entry.photos.length >= PHOTOS_PER_ROOM) continue;
      if (!row.photo_url || entry.seen.has(row.photo_url)) continue;
      entry.seen.add(row.photo_url);
      entry.photos.push(row.photo_url);
    }
    // Shape output to match what client/app.js renders for the indexed compact
    // row path (roomTypeHTML 'compact' variant). score=0 since stubs aren't
    // vibe-scored; the rate-only matching kicks in via roomTypeId.
    const out = {};
    for (const [hotelId, rooms] of byHotel.entries()) {
      out[hotelId] = {
        roomTypes: [...rooms.entries()].map(([name, e]) => ({
          name,
          roomTypeId: e.roomTypeId,
          photos:     e.photos,
          score:      0,
          amenities:  [],
          beds:       "",
          size:       "",
        })),
      };
    }
    const filledHotels = Object.keys(out).length;
    const totalRooms = Object.values(out).reduce((s, h) => s + h.roomTypes.length, 0);
    console.log(`[hotel-rooms] returned ${filledHotels}/${ids.length} hotels, ${totalRooms} rooms in ${Date.now()-t0}ms`);
    res.json({ hotels: out });
  } catch (e) {
    console.error("[hotel-rooms]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/hotel/:hotelId — hotel details panel data ──────────────────────
// Returns hotel metadata, room type photos, facts, and primary neighbourhood.
// In-flight deduplication prevents thundering herd on cold cache.
const _hotelDetailInflight = new Map();
app.get("/api/hotel/:hotelId", async (req, res) => {
  const hotelId = req.params.hotelId;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });

  if (_hotelDetailInflight.has(hotelId)) {
    try {
      const cached = await _hotelDetailInflight.get(hotelId);
      return res.json(cached);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const fetchPromise = (async () => {
    const db = supabaseAdmin || supabase;

    // 1. DB: v2_hotels_cache
    const [cacheRes, roomTypesRes, photosRes] = await Promise.all([
      db.from("v2_hotels_cache").select("hotel_photos, lat, lng, property_type, city, country_code").eq("hotel_id", hotelId).maybeSingle(),
      db.from("v2_room_types_index").select("room_name, facts, photo_count").eq("hotel_id", hotelId).limit(30),
      db.from("v2_room_inventory").select("photo_url, photo_type, room_name").eq("hotel_id", hotelId).limit(300),
    ]);

    const cacheRow = cacheRes.data || {};
    const city     = cacheRow.city || null;

    // 2. Live LiteAPI metadata (reuses shared _hotelMetaCache)
    await fetchHotelMetaBatch([hotelId]);
    const meta = _hotelMetaCache.get(hotelId) || {};

    // 3. Group room photos
    const photosByRoom = new Map();
    for (const p of (photosRes.data || [])) {
      const rn = p.room_name || "Room";
      if (!photosByRoom.has(rn)) photosByRoom.set(rn, []);
      if (photosByRoom.get(rn).length < 12) photosByRoom.get(rn).push(p.photo_url);
    }

    // 4. Build room_types array (merge index facts with photo URLs)
    const roomTypesIndex = roomTypesRes.data || [];
    const roomTypes = roomTypesIndex.map(rt => ({
      room_name:   rt.room_name,
      photos:      photosByRoom.get(rt.room_name) || [],
      photo_count: rt.photo_count || 0,
      facts:       rt.facts || {},
    }));
    // Include any rooms from inventory that have photos but no index entry
    for (const [rn, photos] of photosByRoom.entries()) {
      if (!roomTypes.find(rt => rt.room_name === rn)) {
        roomTypes.push({ room_name: rn, photos, photo_count: photos.length, facts: {} });
      }
    }

    // 5. Primary neighbourhood (bbox check)
    let primaryNbhd = null;
    if (city && cacheRow.lat && cacheRow.lng) {
      const { data: nbhds } = await db.from("neighborhoods")
        .select("name, vibe_short, bbox")
        .eq("city", city)
        .limit(20);
      if (nbhds?.length) {
        const lat = cacheRow.lat, lng = cacheRow.lng;
        for (const n of nbhds) {
          const b = n.bbox;
          if (b && lat >= b.lat_min && lat <= b.lat_max && lng >= b.lon_min && lng <= b.lon_max) {
            primaryNbhd = { name: n.name, vibe_short: n.vibe_short };
            break;
          }
        }
      }
    }

    return {
      hotel_id:      hotelId,
      name:          resolveHotelNameFromMeta(meta, hotelId, ""),
      star_rating:   meta.starRating || 0,
      guest_rating:  meta.guestRating || 0,
      address:       meta.address || "",
      city:          city || "",
      lat:           cacheRow.lat || null,
      lng:           cacheRow.lng || null,
      description:   meta.description || "",
      amenities:     meta.amenities || [],
      check_in:      meta.checkIn  || null,
      check_out:     meta.checkOut || null,
      property_type: cacheRow.property_type || "hotel",
      hotel_photos:  cacheRow.hotel_photos || [],
      room_types:    roomTypes,
      primary_nbhd:  primaryNbhd,
    };
  })();

  _hotelDetailInflight.set(hotelId, fetchPromise);
  fetchPromise.finally(() => _hotelDetailInflight.delete(hotelId));

  try {
    const data = await fetchPromise;
    res.json(data);
  } catch (e) {
    console.error("[hotel-detail]", hotelId, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/hotel/:hotelId/reviews — guest reviews proxy ───────────────────
// LIVE-ONLY proxy to LiteAPI /data/reviews. Reviews must NOT be persisted to
// the database, and must NOT be fed into embeddings, HyDE, or any prompt input
// (LiteAPI ToS forbids derivative datasets / model training).
// Short in-memory hint cache (per-process) only smooths back-button + double-fetch
// during the same session; it is bounded and self-evicting.
const REVIEWS_CACHE_TTL_MS  = 3 * 60 * 1000; // 3 min
const REVIEWS_CACHE_MAX     = 200;
const _reviewsCache         = new Map(); // key -> { data, expiresAt }
const _reviewsInflight      = new Map(); // key -> Promise<data>

function _reviewsCacheKey(hotelId, limit, offset, language) {
  return `${hotelId}|${limit}|${offset}|${language || ""}`;
}
function _reviewsCachePut(key, data) {
  _reviewsCache.set(key, { data, expiresAt: Date.now() + REVIEWS_CACHE_TTL_MS });
  if (_reviewsCache.size > REVIEWS_CACHE_MAX) {
    const oldest = _reviewsCache.keys().next().value;
    if (oldest) _reviewsCache.delete(oldest);
  }
}
function _reviewsCacheGet(key) {
  const hit = _reviewsCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    _reviewsCache.delete(key);
    return null;
  }
  return hit.data;
}

app.get("/api/hotel/:hotelId/reviews", async (req, res) => {
  const t0 = Date.now();
  const hotelId  = req.params.hotelId;
  const rawLimit = parseInt(req.query.limit, 10);
  const rawOff   = parseInt(req.query.offset, 10);
  const limit    = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;
  const offset   = Number.isFinite(rawOff)   ? Math.max(rawOff, 0)                 : 0;
  const language = (req.query.language || "").toString().slice(0, 5).toLowerCase() || "";

  if (!hotelId)        return res.status(400).json({ error: "hotelId required" });
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });

  // Don't let downstream caches retain reviews
  res.setHeader("Cache-Control", "private, no-store");

  const key = _reviewsCacheKey(hotelId, limit, offset, language);
  const cached = _reviewsCacheGet(key);
  if (cached) {
    console.log(`[reviews] hit  ${hotelId} l=${limit} o=${offset} ${Date.now() - t0}ms (cache)`);
    return res.json(cached);
  }

  if (_reviewsInflight.has(key)) {
    try {
      const data = await _reviewsInflight.get(key);
      console.log(`[reviews] join ${hotelId} l=${limit} o=${offset} ${Date.now() - t0}ms (inflight)`);
      return res.json(data);
    } catch (e) {
      return res.status(502).json({ error: "review fetch failed", message: e.message });
    }
  }

  const params = new URLSearchParams({ hotelId, limit: String(limit), offset: String(offset) });
  if (language) params.set("language", language);
  const url = `https://api.liteapi.travel/v3.0/data/reviews?${params.toString()}`;

  const fetchPromise = (async () => {
    const r = await fetch(url, {
      headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
    });
    if (!r.ok) {
      const status = r.status;
      let detail   = "";
      try { detail = await r.text(); } catch (_) {}
      throw new Error(`LiteAPI ${status}${detail ? ": " + detail.slice(0, 160) : ""}`);
    }
    const json = await r.json();
    const arr  = Array.isArray(json?.data) ? json.data : [];

    // Slim DTO — only fields we render; never log review text.
    const reviews = arr
      .map(r => {
        const score   = Number(r.averageScore);
        const dateRaw = (r.date || "").toString();
        const tsMs    = (() => {
          const t = Date.parse(dateRaw.replace(" ", "T") + "Z");
          return Number.isFinite(t) ? t : 0;
        })();
        return {
          score:    Number.isFinite(score) ? score : null,
          date:     dateRaw || null,
          ts:       tsMs,
          headline: typeof r.headline === "string" ? r.headline : "",
          pros:     typeof r.pros     === "string" ? r.pros     : "",
          cons:     typeof r.cons     === "string" ? r.cons     : "",
          language: typeof r.language === "string" ? r.language : "",
          country:  typeof r.country  === "string" ? r.country  : "",
          name:     typeof r.name     === "string" ? r.name.slice(0, 24) : "",
          source:   typeof r.source   === "string" ? r.source : "",
          type:     typeof r.type     === "string" ? r.type   : "",
        };
      })
      // Recency only (per UX scope) — sort descending; ties keep API order.
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const total = Number.isFinite(Number(json?.total)) ? Number(json.total) : null;
    const data  = {
      hotel_id: hotelId,
      limit,
      offset,
      language: language || null,
      total,
      has_more: total != null
        ? offset + reviews.length < total
        : reviews.length === limit, // best-effort when total is missing
      reviews,
    };
    _reviewsCachePut(key, data);
    return data;
  })();

  _reviewsInflight.set(key, fetchPromise);
  fetchPromise.finally(() => _reviewsInflight.delete(key));

  try {
    const data = await fetchPromise;
    console.log(`[reviews] miss ${hotelId} l=${limit} o=${offset} ${Date.now() - t0}ms count=${data.reviews.length}`);
    res.json(data);
  } catch (e) {
    console.warn(`[reviews] err  ${hotelId} l=${limit} o=${offset} ${Date.now() - t0}ms ${e.message}`);
    res.status(502).json({ error: "review fetch failed", message: e.message });
  }
});

// ── POST /api/backfill-property-types — re-classify property_type for a city ──
app.post("/api/backfill-property-types", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== process.env.INDEX_SECRET) return res.status(403).json({ error: "forbidden" });
  if (!city) return res.status(400).json({ error: "city required" });
  const db = supabaseAdmin || supabase;
  try {
    const HOSTEL_RE     = /\b(hostel|dormitory|dorm|bunk bed)\b/i;
    const VILLA_RE      = /\bvilla\b/i;
    const VACHOME_RE    = /\b(vacation home|vacation rental|house)\b/i;
    const ANY_RENTAL_RE = /\b(apartment|vacation home|vacation rental|house|villa|hostel|dormitory|dorm|bunk bed)\b/i;
    // Fetch all room inventory rows for city (hotel_id + room_name only).
    // PAGINATION REQUIRED: PostgREST defaults to a 10k-row cap (via
    // pgrst.db_max_rows). Mexico City has ~74k inventory rows, so a single
    // .select() silently returned only ~10k → only 678 of 3497 hotels got
    // classified, and lp114339 (Ire Ile My Hostel) stayed mis-classified as
    // "hotel" after a backfill that *reported* success. We page through in
    // 1000-row windows until we hit a short page.
    const PAGE = 1000;
    const byHotel = new Map();
    let from = 0, fetched = 0;
    while (true) {
      const { data: page, error: fetchErr } = await db
        .from("v2_room_inventory")
        .select("hotel_id, room_name")
        .eq("city", city)
        .range(from, from + PAGE - 1);
      if (fetchErr) throw new Error(fetchErr.message);
      if (!page || page.length === 0) break;
      for (const r of page) {
        if (!byHotel.has(r.hotel_id)) byHotel.set(r.hotel_id, []);
        byHotel.get(r.hotel_id).push(r.room_name || "");
      }
      fetched += page.length;
      if (page.length < PAGE) break;
      from += PAGE;
    }
    console.log(`[backfill-property-types] ${city}: paged ${fetched} inventory rows for ${byHotel.size} hotels`);
    let updated = 0;
    for (const [hotelId, roomNames] of byHotel.entries()) {
      const hostelCount  = roomNames.filter(n => HOSTEL_RE.test(n)).length;
      const villaCount   = roomNames.filter(n => VILLA_RE.test(n)).length;
      const vachomeCount = roomNames.filter(n => VACHOME_RE.test(n)).length;
      let property_type = "hotel";
      // Hostel rule: ANY dorm-style room flips the property to "hostel".
      // Hostels mix dorm beds with private rooms (e.g. lp114339 has 2 dorm
      // + 2 "Basic Triple Room"). Old "ALL rooms must match" rule bucketed
      // these back into "hotel" silently.
      if (hostelCount > 0) {
        property_type = "hostel";
      } else {
        const rentalCount = roomNames.filter(n => ANY_RENTAL_RE.test(n)).length;
        // Apartments/villas/vacation_homes still require ALL rooms to match.
        if (rentalCount === roomNames.length) {
          if (villaCount > 0)        property_type = "villa";
          else if (vachomeCount > 0) property_type = "vacation_home";
          else                       property_type = "apartment";
        }
      }
      const { error: upErr } = await db.from("v2_hotels_cache")
        .update({ property_type })
        .eq("hotel_id", hotelId)
        .eq("city", city);
      if (upErr) console.warn("[backfill-property-types] update failed for", hotelId, upErr.message);
      else updated++;
    }
    console.log(`[backfill-property-types] ${city}: updated ${updated}/${byHotel.size} hotels`);
    res.json({ ok: true, city, updated, total: byHotel.size });
  } catch (e) {
    console.error("[backfill-property-types]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Beta endpoints ────────────────────────────────────────────────────────────
// Resend client (lazy — only constructed if RESEND_API_KEY set)
let _resend = null;
function _getResend() {
  if (_resend) return _resend;
  if (!process.env.RESEND_API_KEY) return null;
  try {
    const { Resend } = require("resend");
    _resend = new Resend(process.env.RESEND_API_KEY);
    return _resend;
  } catch (_) {
    return null;
  }
}

function _clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.ip || req.connection?.remoteAddress || "";
}

// In-app feedback form submissions. Required: { message }. Optional: { distinctId, email, sentiment, currentUrl, currentSearch }.
// Writes to beta_feedback (Supabase). If SLACK_FEEDBACK_WEBHOOK is set we also
// fan out a brief preview to Slack so the team sees feedback in real time.
app.post("/api/feedback", async (req, res) => {
  try {
    const b = req.body || {};
    const message = String(b.message || "").trim().slice(0, 4000);
    if (!message) return res.status(400).json({ error: "message_required" });
    const row = {
      distinct_id:    String(b.distinctId || b.distinct_id || "").slice(0, 64) || null,
      user_email:     b.email ? String(b.email).trim().toLowerCase().slice(0, 200) : null,
      sentiment:      Number.isInteger(b.sentiment) && b.sentiment >= 1 && b.sentiment <= 5 ? b.sentiment : null,
      message,
      current_url:    String(b.currentUrl || b.current_url || "").slice(0, 500) || null,
      current_search: String(b.currentSearch || b.current_search || "").slice(0, 500) || null,
      user_agent:     String(req.headers["user-agent"] || "").slice(0, 300) || null,
      ip_addr:        _clientIp(req).slice(0, 45) || null,
    };
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.from("beta_feedback").insert(row);
      if (error) {
        console.error("[feedback] insert failed:", error.message);
        return res.status(500).json({ error: "db_insert_failed" });
      }
    } else {
      console.warn("[feedback] no supabaseAdmin; logging only:", row);
    }
    // Fire-and-forget Slack mirror (optional — set SLACK_FEEDBACK_WEBHOOK to enable)
    if (process.env.SLACK_FEEDBACK_WEBHOOK) {
      const slackPayload = {
        text: `*New beta feedback* ${row.sentiment ? `(${row.sentiment}/5)` : ""}\n` +
              `> ${message.replace(/\n/g, "\n> ").slice(0, 500)}` +
              (row.user_email ? `\n_email:_ ${row.user_email}` : "") +
              (row.current_url ? `\n_url:_ ${row.current_url}` : "") +
              (row.current_search ? `\n_search:_ ${row.current_search}` : ""),
      };
      fetch(process.env.SLACK_FEEDBACK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload),
      }).catch((e) => console.warn("[feedback] slack post failed:", e.message));
    }
    // Fire-and-forget email mirror (optional — set BETA_FEEDBACK_EMAIL + RESEND_API_KEY to enable)
    if (process.env.BETA_FEEDBACK_EMAIL && process.env.RESEND_API_KEY && process.env.BETA_FROM) {
      const resend = _getResend();
      if (resend) {
        const sentLabel = row.sentiment ? ` ${row.sentiment}/5` : "";
        const subject   = `[TravelByVibe beta]${sentLabel} ${message.slice(0, 60).replace(/\s+/g, " ")}${message.length > 60 ? "…" : ""}`;
        const escape    = (s) => String(s || "").replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1e;max-width:560px">
            <h2 style="font-family:Georgia,serif;color:#a8893d;margin:0 0 4px">New beta feedback${sentLabel ? " · " + sentLabel.trim() : ""}</h2>
            <p style="color:#666;font-size:12px;margin:0 0 16px">${escape(new Date().toUTCString())}</p>
            <blockquote style="border-left:3px solid #c9a96e;padding:8px 14px;margin:0 0 18px;background:#faf6ee;white-space:pre-wrap;font-size:14px;line-height:1.55">${escape(message)}</blockquote>
            <table style="font-size:12px;color:#444;border-collapse:collapse">
              ${row.user_email     ? `<tr><td style="padding:2px 8px 2px 0;color:#888">email</td><td>${escape(row.user_email)}</td></tr>`     : ""}
              ${row.distinct_id    ? `<tr><td style="padding:2px 8px 2px 0;color:#888">distinct_id</td><td><code>${escape(row.distinct_id)}</code></td></tr>` : ""}
              ${row.current_url    ? `<tr><td style="padding:2px 8px 2px 0;color:#888">on page</td><td>${escape(row.current_url)}</td></tr>`    : ""}
              ${row.current_search ? `<tr><td style="padding:2px 8px 2px 0;color:#888">searching</td><td>${escape(row.current_search)}</td></tr>` : ""}
              ${row.user_agent     ? `<tr><td style="padding:2px 8px 2px 0;color:#888">user-agent</td><td style="color:#999;font-size:11px">${escape(row.user_agent)}</td></tr>` : ""}
            </table>
            <p style="color:#999;font-size:11px;margin:20px 0 0">All submissions are also stored in <code>beta_feedback</code> in Supabase.</p>
          </div>`;
        const plain = `New beta feedback${sentLabel}\n\n` + message + "\n\n" +
          (row.user_email     ? `email: ${row.user_email}\n` : "") +
          (row.distinct_id    ? `distinct_id: ${row.distinct_id}\n` : "") +
          (row.current_url    ? `on page: ${row.current_url}\n` : "") +
          (row.current_search ? `searching: ${row.current_search}\n` : "");
        // Reply-To set to the user's email when present so you can reply directly.
        const replyTo = row.user_email || process.env.BETA_REPLY_TO || undefined;
        resend.emails.send({
          from: process.env.BETA_FROM,
          to:   process.env.BETA_FEEDBACK_EMAIL,
          subject,
          html,
          text: plain,
          ...(replyTo ? { replyTo } : {}),
        }).then((r) => {
          if (r?.error) console.warn("[feedback] resend error:", r.error.message || r.error);
        }).catch((e) => console.warn("[feedback] resend send failed:", e.message));
      }
    }
    trackServer(row.distinct_id, "feedback_submitted_server", {
      sentiment: row.sentiment,
      has_email: !!row.user_email,
      message_length: message.length,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[feedback] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// One-time beta consent acceptance ledger. Body: { distinctId, email?, policyVersion? }.
app.post("/api/beta-consent", async (req, res) => {
  try {
    const b = req.body || {};
    const distinctId = String(b.distinctId || b.distinct_id || "").slice(0, 64);
    if (!distinctId) return res.status(400).json({ error: "distinct_id_required" });
    const row = {
      distinct_id:    distinctId,
      user_email:     b.email ? String(b.email).trim().toLowerCase().slice(0, 200) : null,
      ip_addr:        _clientIp(req).slice(0, 45) || null,
      user_agent:     String(req.headers["user-agent"] || "").slice(0, 300) || null,
      policy_version: String(b.policyVersion || "v1-2026-05-07").slice(0, 40),
    };
    if (supabaseAdmin) {
      // Idempotent — primary key is distinct_id
      const { error } = await supabaseAdmin.from("beta_consents").upsert(row, { onConflict: "distinct_id" });
      if (error) {
        console.error("[beta-consent] upsert failed:", error.message);
        return res.status(500).json({ error: "db_upsert_failed" });
      }
    }
    trackServer(distinctId, "beta_consent_accepted_server", { policy_version: row.policy_version });
    res.json({ ok: true });
  } catch (e) {
    console.error("[beta-consent] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Generic server-side event mirror — used by the client whenever it wants the
// event to survive ad-blockers / private browsing. Body: { distinctId, event, properties }.
app.post("/api/track", (req, res) => {
  try {
    const b = req.body || {};
    const ev = String(b.event || "").slice(0, 64);
    if (!ev) return res.status(400).json({ error: "event_required" });
    trackServer(String(b.distinctId || "").slice(0, 64), ev, b.properties || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("[track] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Smoke-test Sentry wiring. Hit it with curl/browser; should appear in Sentry
// within ~30 sec. Gated behind INDEX_SECRET so it can't be abused as a noise tap.
app.get("/api/debug-sentry", (req, res) => {
  const secret = req.query.secret || req.headers["x-index-secret"];
  if (process.env.INDEX_SECRET && secret !== process.env.INDEX_SECRET) {
    return res.status(401).json({ error: "secret_required" });
  }
  setTimeout(() => {
    throw new Error("debug-sentry: intentional test exception");
  }, 0);
  res.json({ ok: true, note: "thrown async; check Sentry within ~30s" });
});

// Sentry must be installed AFTER all routes but BEFORE the catch-all + your
// own error handlers. setupExpressErrorHandler patches the Express app to
// auto-capture unhandled errors thrown in route handlers.
if (process.env.SENTRY_DSN_SERVER) {
  Sentry.setupExpressErrorHandler(app);
}

app.get("*", (_req, res) => serveAppHtml(res));

// ── Graceful shutdown: fix any cities stuck at "indexing" when Render deploys ──
async function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received — cleaning up stuck indexing jobs`);
  // Flush telemetry first so we don't lose final breadcrumbs / events.
  try {
    if (posthog) await posthog.shutdown();
  } catch (e) {
    console.warn("[shutdown] posthog flush failed:", e.message);
  }
  try {
    if (process.env.SENTRY_DSN_SERVER) await Sentry.close(2000);
  } catch (e) {
    console.warn("[shutdown] sentry close failed:", e.message);
  }
  if (!supabaseAdmin) { process.exit(0); return; }
  try {
    // Find any cities still marked as indexing
    const { data: stuck } = await supabaseAdmin
      .from("indexed_cities")
      .select("city")
      .eq("status", "indexing");

    for (const row of (stuck || [])) {
      // Update to "complete" with actual counts from room_embeddings
      const { data: counts } = await supabaseAdmin
        .from("room_embeddings")
        .select("hotel_id", { count: "exact" })
        .eq("city", row.city);

      const { count: photoCount } = await supabaseAdmin
        .from("room_embeddings")
        .select("*", { count: "exact", head: true })
        .eq("city", row.city);

      const hotelIds = new Set((counts || []).map(r => r.hotel_id));

      await supabaseAdmin.from("indexed_cities").update({
        status:      photoCount > 0 ? "complete" : "failed",
        hotel_count: hotelIds.size,
        photo_count: photoCount || 0,
        completed_at: new Date().toISOString(),
      }).eq("city", row.city);

      console.log(`[shutdown] ${row.city}: marked ${photoCount > 0 ? "complete" : "failed"} (${hotelIds.size} hotels, ${photoCount} photos)`);
    }
  } catch (e) {
    console.warn("[shutdown] cleanup error:", e.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
