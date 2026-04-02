/**
 * backfill-latlng.js — one-time script to populate lat/lng for existing hotels_cache rows
 *
 * Strategy per hotel:
 *   1. Fetch /data/hotel?hotelId=... from LiteAPI — check location fields
 *   2. If still null, geocode hotel.address via Geoapify /v1/geocode/search
 *   3. UPDATE hotels_cache SET lat, lng
 *
 * Run: node scripts/backfill-latlng.js [--city=Paris] [--dry-run]
 * Or via API: POST /api/backfill-latlng {"secret":"roommatch-2026","city":"Paris"}
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const LITEAPI_KEY   = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY;
const GEOAPIFY_KEY  = process.env.GEOAPIFY_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const CONCURRENCY   = 5;
const SLEEP_MS      = 200; // gentle rate limiting

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function liteGet(path) {
  const url = `https://api.liteapi.travel/v3.0${path}`;
  const res = await fetch(url, { headers: { "X-API-Key": LITEAPI_KEY, accept: "application/json" } });
  const data = res.ok ? await res.json() : null;
  return { ok: res.ok, status: res.status, data };
}

async function geocodeAddress(address, city, geoapifyKey) {
  if (!geoapifyKey || !address) return null;
  const text = encodeURIComponent(`${address}, ${city}`);
  const url  = `https://api.geoapify.com/v1/geocode/search?text=${text}&limit=1&apiKey=${geoapifyKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data.features?.[0]?.geometry?.coordinates;
    if (!feat) return null;
    return { lat: feat[1], lng: feat[0] };
  } catch { return null; }
}

async function backfillCity(city, db, dryRun) {
  // Fetch all hotels_cache rows for city where lat IS NULL
  const { data: hotels, error } = await db
    .from("hotels_cache")
    .select("hotel_id, name, address")
    .eq("city", city)
    .is("lat", null);

  if (error) throw new Error(`hotels_cache query failed: ${error.message}`);
  if (!hotels?.length) {
    console.log(`[backfill-latlng] ${city}: all hotels already have lat/lng`);
    return 0;
  }

  console.log(`[backfill-latlng] ${city}: ${hotels.length} hotels missing lat/lng`);
  let updated = 0;

  // Process in batches with concurrency control
  for (let i = 0; i < hotels.length; i += CONCURRENCY) {
    const batch = hotels.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (hotel) => {
      let lat = null, lng = null, source = null;

      // 1. Try LiteAPI /data/hotel
      try {
        const r = await liteGet(`/data/hotel?hotelId=${hotel.hotel_id}`);
        if (r.ok && r.data?.data) {
          const d = r.data.data;
          lat = d.location?.latitude ?? d.location?.lat ?? d.latitude ?? d.lat ?? null;
          lng = d.location?.longitude ?? d.location?.lng ?? d.longitude ?? d.lng ?? null;
          if (lat != null) source = "liteapi";
        }
      } catch { /* non-fatal */ }

      // 2. Fallback: Geoapify geocoding
      if (lat == null && hotel.address) {
        const geo = await geocodeAddress(hotel.address, city, GEOAPIFY_KEY);
        if (geo) { lat = geo.lat; lng = geo.lng; source = "geoapify"; }
      }

      if (lat == null) {
        console.log(`  [skip] ${hotel.name}: no coordinates found`);
        return;
      }

      if (!dryRun) {
        const { error: upErr } = await db
          .from("hotels_cache")
          .update({ lat, lng })
          .eq("hotel_id", hotel.hotel_id);
        if (upErr) {
          console.log(`  [error] ${hotel.name}: ${upErr.message}`);
          return;
        }
      }

      updated++;
      console.log(`  [${source}${dryRun ? "/dry" : ""}] ${hotel.name}: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    }));
    await sleep(SLEEP_MS);
  }

  console.log(`[backfill-latlng] ${city}: updated ${updated}/${hotels.length}`);
  return updated;
}

module.exports = { backfillCity };

// CLI entry point
if (require.main === module) {
  const args    = process.argv.slice(2);
  const getArg  = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i+1] : null; };
  const dryRun  = args.includes("--dry-run");
  const city    = getArg("city");

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  (async () => {
    const cities = city
      ? [city]
      : ["Paris", "Kuala Lumpur"];

    for (const c of cities) {
      await backfillCity(c, db, dryRun);
    }
    console.log("[backfill-latlng] done");
  })().catch(e => { console.error(e.message); process.exit(1); });
}
