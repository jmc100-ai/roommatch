#!/usr/bin/env node
/**
 * Refresh Paris preset hotel IDs in marketing-hotels.json from Supabase bboxes.
 * De-duplicates IDs across neighborhoods; keeps tier structure (luxury/boutique/value).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const PRESETS_PATH = path.join(__dirname, "..", "client", "marketing", "marketing-hotels.json");

const NBHD_TO_PRESET = {
  "Le Marais": "paris-le-marais",
  "Saint-Germain-des-Prés": "paris-saint-germain",
  Montmartre: "paris-montmartre",
  "Latin Quarter": "paris-latin-quarter",
  "Opéra / Grands Boulevards": "paris-opera",
};

const TIER_TAGS = {
  luxury: ["Palace stay", "Five-star Paris"],
  boutique: ["Design boutique", "Neighborhood gem"],
  value: ["Central value", "Walkable base"],
};

function tierRows(ids, tier) {
  const tags = TIER_TAGS[tier];
  const slice = tier === "luxury" ? ids.slice(0, 2) : tier === "boutique" ? ids.slice(2, 4) : ids.slice(4, 6);
  return slice.map((id, i) => ({
    id,
    fallbackName: `Paris ${tier} hotel`,
    tag: tags[i] || tags[0],
  }));
}

async function inventoryCounts(db, city) {
  const counts = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await db.from("v2_room_inventory").select("hotel_id").eq("city", city).range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const row of data) counts.set(row.hotel_id, (counts.get(row.hotel_id) || 0) + 1);
    if (data.length < 1000) break;
    from += 1000;
  }
  return counts;
}

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, "utf8"));
  const invCounts = await inventoryCounts(db, "Paris");
  const used = new Set();

  const { data: nbhds } = await db
    .from("neighborhoods")
    .select("name,bbox")
    .eq("city", "Paris")
    .in("name", Object.keys(NBHD_TO_PRESET));

  const { data: hotels } = await db
    .from("v2_hotels_cache")
    .select("hotel_id,lat,lng")
    .eq("city", "Paris")
    .not("lat", "is", null);

  const pool = [];
  for (const nbhd of nbhds || []) {
    const b = nbhd.bbox;
    if (!b) continue;
    const ids = (hotels || [])
      .filter(
        (h) =>
          h.lat >= b.lat_min &&
          h.lat <= b.lat_max &&
          h.lng >= b.lon_min &&
          h.lng <= b.lon_max &&
          (invCounts.get(h.hotel_id) || 0) >= 6
      )
      .map((h) => h.hotel_id)
      .filter((id) => !used.has(id));
    const pick = ids.slice(0, 6);
    if (pick.length < 6) {
      for (const id of ids.slice(6)) {
        if (pick.length >= 6) break;
        if (!used.has(id)) pick.push(id);
      }
    }
    pick.forEach((id) => used.add(id));
    pool.push(...pick);
    const key = NBHD_TO_PRESET[nbhd.name];
    presets[key] = {
      luxury: tierRows(pick.length >= 2 ? pick : pool.slice(0, 6), "luxury"),
      boutique: tierRows(pick.length >= 4 ? pick : pool.slice(0, 6), "boutique"),
      value: tierRows(pick.length >= 6 ? pick : pool.slice(0, 6), "value"),
    };
  }

  const flat = [...new Set(pool)].slice(0, 12);
  while (flat.length < 8) {
    const extra = (hotels || []).find((h) => (invCounts.get(h.hotel_id) || 0) >= 6 && !used.has(h.hotel_id));
    if (!extra) break;
    used.add(extra.hotel_id);
    flat.push(extra.hotel_id);
  }

  const toFlat = (ids, prefix) =>
    ids.slice(0, 4).map((id, i) => ({ id, fallbackName: `${prefix} Paris hotel`, tag: TIER_TAGS.luxury[i] || "Paris stay" }));

  presets["paris-luxury"] = toFlat(flat, "Luxury");
  presets["paris-romantic"] = toFlat(flat.slice(2).concat(flat.slice(0, 2)), "Romantic");
  presets["paris-classic"] = toFlat(flat.slice(4).concat(flat.slice(0, 2)), "Classic");

  presets["paris-boutique"] = {
    marais: presets["paris-le-marais"].boutique,
    "saint-germain": presets["paris-saint-germain"].boutique,
    montmartre: presets["paris-montmartre"].boutique,
    romantic: presets["paris-romantic"].slice(0, 2),
  };

  presets["paris-cafe-vibe"] = [
    ...presets["paris-saint-germain"].boutique,
    ...presets["paris-le-marais"].boutique.slice(0, 2),
  ];

  presets["paris-walkable"] = {
    marais: presets["paris-le-marais"].value,
    "latin-quarter": presets["paris-latin-quarter"].value,
    "saint-germain": presets["paris-saint-germain"].value,
  };

  fs.writeFileSync(PRESETS_PATH, JSON.stringify(presets, null, 2) + "\n", "utf8");
  console.log("Updated Paris presets in", PRESETS_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
