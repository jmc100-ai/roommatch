/**
 * Shared helpers for SEO marketing page generators (DB, LiteAPI meta, route manifest).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { hotelStaySlug, citySlug } = require("./marketing-slug");

const ROOT = path.join(__dirname, "..");
const MARKETING_DIR = path.join(ROOT, "client", "marketing");
const STAYS_DIR = path.join(MARKETING_DIR, "stays");
const ROUTES_JSON = path.join(__dirname, "marketing-routes-generated.json");
const MANIFEST_JSON = path.join(MARKETING_DIR, "stays-manifest.json");

const ORIGIN =
  (process.env.SITE_PUBLIC_ORIGIN || process.env.BETA_BASE_URL || "https://www.travelbyvibe.com").replace(/\/$/, "");

const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";

function getDb() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env");
  return createClient(url, key);
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadGeneratedRoutes() {
  try {
    return JSON.parse(fs.readFileSync(ROUTES_JSON, "utf8"));
  } catch {
    return { routes: [], staysRoutes: [], slugByHotelId: {} };
  }
}

function saveGeneratedRoutes(data) {
  fs.writeFileSync(ROUTES_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_JSON, "utf8"));
  } catch {
    return { slugByHotelId: {}, hotels: [] };
  }
}

function saveManifest(data) {
  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function mergeRoutes(existing, newRoutes, key = "routes") {
  const byPath = new Map();
  for (const r of existing[key] || []) byPath.set(r.path, r);
  for (const r of newRoutes) byPath.set(r.path, r);
  existing[key] = [...byPath.values()];
  return existing;
}

async function fetchLiteMetaBatch(hotelIds) {
  if (!LITEAPI_KEY || !hotelIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < hotelIds.length; i += 50) chunks.push(hotelIds.slice(i, i + 50));
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (id) => {
        try {
          const r = await fetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(id)}`, {
            headers: { "X-API-Key": LITEAPI_KEY, Accept: "application/json" },
          });
          if (!r.ok) return;
          const j = await r.json();
          const h = j.data || j;
          out[id] = {
            name: h.name || h.hotelName || null,
            mainPhoto: h.main_photo || h.mainPhoto || h.hotelImages?.[0]?.url || null,
            starRating: h.starRating || h.stars || 0,
            guestRating: h.rating || h.guestRating || 0,
            address: h.address || "",
          };
        } catch {
          /* skip */
        }
      })
    );
  }
  return out;
}

async function hotelsWithFact(db, city, factKey, limit = 12) {
  const { data, error } = await db
    .from("v2_room_types_index")
    .select("hotel_id, facts")
    .eq("city", city)
    .limit(8000);
  if (error) throw error;
  const ids = [];
  for (const row of data || []) {
    if (row.facts && row.facts[factKey] === true) ids.push(row.hotel_id);
    if (ids.length >= limit * 3) break;
  }
  return [...new Set(ids)].slice(0, limit);
}

async function hotelsWithVisualStyle(db, city, styleKey, limit = 12) {
  const factKey = `visual_style_${styleKey}`;
  return hotelsWithFact(db, city, factKey, limit);
}

async function topHotelsForCity(db, city, limit) {
  const { data: inv, error: e1 } = await db
    .from("v2_room_inventory")
    .select("hotel_id, photo_url")
    .eq("city", city)
    .not("photo_url", "is", null);
  if (e1) throw e1;
  const counts = new Map();
  for (const row of inv || []) {
    counts.set(row.hotel_id, (counts.get(row.hotel_id) || 0) + 1);
  }
  const ids = [...counts.entries()]
    .filter(([, n]) => n >= 6)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .slice(0, limit * 4);

  const meta = await fetchLiteMetaBatch(ids);
  const ranked = ids
    .map((id) => ({
      id,
      photos: counts.get(id) || 0,
      guestRating: Number(meta[id]?.guestRating) || 0,
      starRating: Number(meta[id]?.starRating) || 0,
      name: meta[id]?.name || id,
    }))
    .sort((a, b) => b.guestRating * 2 + b.starRating + b.photos * 0.01 - (a.guestRating * 2 + a.starRating + a.photos * 0.01))
    .slice(0, limit);
  return ranked;
}

async function samplePhotos(db, hotelId, max = 6) {
  const { data } = await db
    .from("v2_room_inventory")
    .select("photo_url, photo_type, room_name")
    .eq("hotel_id", hotelId)
    .not("photo_url", "is", null)
    .limit(40);
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    if (!row.photo_url || seen.has(row.photo_url)) continue;
    seen.add(row.photo_url);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

async function hotelTopFacts(db, hotelId) {
  const { data } = await db
    .from("v2_room_types_index")
    .select("facts")
    .eq("hotel_id", hotelId)
    .limit(20);
  const tallies = new Map();
  for (const row of data || []) {
    const f = row.facts || {};
    for (const [k, v] of Object.entries(f)) {
      if (v === true && !k.startsWith("visual_style_")) tallies.set(k, (tallies.get(k) || 0) + 1);
      if (v === true && k.startsWith("visual_style_")) tallies.set(k, 100);
    }
  }
  return [...tallies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);
}

const FACT_LABELS = {
  rainfall_shower: "rainfall shower",
  walk_in_shower: "walk-in shower",
  double_sinks: "double vanity",
  soaking_tub: "soaking tub",
  bathtub: "bathtub",
  balcony: "balcony",
  floor_to_ceiling_windows: "floor-to-ceiling windows",
  area_pool: "pool",
  area_rooftop: "rooftop",
  area_bar: "bar",
  visual_style_sleek_polished: "sleek polished design",
  visual_style_cozy_warm: "cozy warm design",
  visual_style_classic_traditional: "classic traditional design",
  visual_style_moody_dark: "moody atmosphere",
  visual_style_vibrant_eclectic: "eclectic design",
};

function factLabel(key) {
  return FACT_LABELS[key] || key.replace(/_/g, " ");
}

function utmCity(city) {
  return city === "Paris" ? "Paris" : "Mexico%20City";
}

function utmLink(city, campaign, content, extra) {
  const q = new URLSearchParams({
    city: city === "Paris" ? "Paris" : "Mexico City",
    utm_source: "travelbyvibe",
    utm_medium: "landing",
    utm_campaign: campaign,
    utm_content: content,
  });
  if (extra) Object.entries(extra).forEach(([k, v]) => q.set(k, v));
  return `__ORIGIN__/?${q.toString().replace(/ /g, "%20")}`;
}

function writePage(relativeFile, html) {
  const fp = path.join(MARKETING_DIR, relativeFile);
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, html, "utf8");
  return relativeFile;
}

module.exports = {
  ROOT,
  MARKETING_DIR,
  STAYS_DIR,
  ROUTES_JSON,
  MANIFEST_JSON,
  ORIGIN,
  getDb,
  escHtml,
  loadGeneratedRoutes,
  saveGeneratedRoutes,
  loadManifest,
  saveManifest,
  ensureDir,
  mergeRoutes,
  fetchLiteMetaBatch,
  hotelsWithFact,
  hotelsWithVisualStyle,
  topHotelsForCity,
  samplePhotos,
  hotelTopFacts,
  factLabel,
  utmCity,
  utmLink,
  writePage,
  hotelStaySlug,
  citySlug,
};
