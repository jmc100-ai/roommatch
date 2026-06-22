#!/usr/bin/env node
/**
 * Live searchable-hotel counts for marketing copy (from v2_room_inventory).
 * Writes client/marketing/city-stats.json — run before page generators.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const OUT = path.join(__dirname, "..", "client", "marketing", "city-stats.json");

function formatPlus(n) {
  const num = Number(n) || 0;
  if (num >= 1000) {
    const rounded = Math.floor(num / 100) * 100;
    return `${rounded.toLocaleString("en-US")}+`;
  }
  if (num >= 100) {
    const rounded = Math.floor(num / 50) * 50;
    return `${rounded}+`;
  }
  return `${Math.max(1, num)}+`;
}

async function countSearchableHotels(db, city) {
  const counts = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("v2_room_inventory")
      .select("hotel_id")
      .eq("city", city)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const row of data) {
      counts.set(row.hotel_id, (counts.get(row.hotel_id) || 0) + 1);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  const searchable = [...counts.values()].filter((n) => n >= 6).length;
  return { distinct: counts.size, searchable };
}

async function refreshCityStats() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env");

  const db = createClient(url, key);
  const stats = { generatedAt: new Date().toISOString(), cities: {} };

  for (const city of ["Paris", "Mexico City", "London"]) {
    const [{ data: ic }, inv] = await Promise.all([
      db.from("v2_indexed_cities").select("status,hotel_count,photo_count").eq("city", city).maybeSingle(),
      countSearchableHotels(db, city),
    ]);
    stats.cities[city] = {
      status: ic?.status || "unknown",
      catalogHotels: ic?.hotel_count || inv.distinct,
      photoCount: ic?.photo_count || 0,
      searchableHotels: inv.searchable,
      searchableLabel: formatPlus(inv.searchable),
      catalogLabel: formatPlus(ic?.hotel_count || inv.distinct),
    };
  }

  fs.writeFileSync(OUT, JSON.stringify(stats, null, 2) + "\n", "utf8");
  return stats;
}

function loadCityStats() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return {
      cities: {
        Paris: { searchableLabel: "4,900+", searchableHotels: 4900, status: "complete" },
        "Mexico City": { searchableLabel: "3,400+", searchableHotels: 3400, status: "complete" },
        London: { searchableLabel: "3,900+", searchableHotels: 3900, status: "complete" },
      },
    };
  }
}

function cityStat(city, field) {
  const row = loadCityStats().cities[city] || {};
  return row[field];
}

function searchableLabel(city) {
  const fallbacks = { Paris: "700+", "Mexico City": "3,500+", London: "3,900+" };
  return cityStat(city, "searchableLabel") || fallbacks[city] || "1,000+";
}

function socialProofSpan(city) {
  const labels = { Paris: "Paris", "Mexico City": "Mexico City", London: "London" };
  return `${searchableLabel(city)} ${labels[city] || city} hotels with room photos`;
}

if (require.main === module) {
  refreshCityStats()
    .then((s) => {
      console.log("wrote", OUT, JSON.stringify(s.cities, null, 2));
    })
    .catch((e) => {
      console.error(e.message || e);
      process.exit(1);
    });
}

module.exports = {
  OUT,
  refreshCityStats,
  loadCityStats,
  cityStat,
  searchableLabel,
  socialProofSpan,
  formatPlus,
};
