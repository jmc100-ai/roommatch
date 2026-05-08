require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const baseline = require("./search-test-baseline.json");

const DEFAULT_BASE_URL = "https://roommatch-1fg5.onrender.com";
const PAGE_SIZE = 5000;

const SEARCH_TESTS = [
  {
    id: 1,
    query: "double sinks",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "double_sinks" },
    description: "Feature flag: double_sinks",
  },
  {
    id: 2,
    query: "rainfall shower",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "rainfall_shower" },
    description: "Feature flag: rainfall_shower",
  },
  {
    id: 3,
    query: "soaking tub",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "soaking_tub" },
    description: "Feature flag: soaking_tub",
  },
  {
    id: 4,
    query: "walk in shower",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "walk_in_shower" },
    description: "Feature flag: walk_in_shower",
  },
  {
    id: 5,
    query: "bright room with large windows",
    city: "Kuala Lumpur",
    expectation: { type: "semantic" },
    description: "Semantic query over all indexed KL hotels",
  },
  {
    id: 6,
    query: "double sinks",
    city: "Paris",
    expectation: { type: "feature", flag: "double_sinks" },
    description: "Feature flag: double_sinks (Paris)",
  },
  {
    id: 7,
    query: "Art Deco style room",
    city: "Paris",
    expectation: { type: "semantic" },
    description: "Semantic query over all indexed Paris hotels",
  },
  {
    id: 8,
    query: "balcony",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "balcony" },
    description: "Feature flag: balcony (Kuala Lumpur)",
  },
  {
    id: 9,
    query: "city view",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "city_view" },
    description: "Feature flag: city_view (Kuala Lumpur)",
  },
  {
    id: 10,
    query: "king bed",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "king_bed" },
    description: "Feature flag: king_bed (Kuala Lumpur)",
  },
  {
    id: 11,
    query: "separate living area",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "separate_living_area" },
    description: "Feature flag: separate_living_area (Kuala Lumpur)",
  },
  {
    id: 12,
    query: "floor-to-ceiling windows",
    city: "Kuala Lumpur",
    expectation: { type: "feature", flag: "floor_to_ceiling_windows" },
    description: "Feature flag: floor_to_ceiling_windows (Kuala Lumpur)",
  },
  {
    id: 13,
    query: "balcony",
    city: "Paris",
    expectation: { type: "feature", flag: "balcony" },
    description: "Feature flag: balcony (Paris)",
  },
  {
    id: 14,
    query: "city view",
    city: "Paris",
    expectation: { type: "feature", flag: "city_view" },
    description: "Feature flag: city_view (Paris)",
  },
  {
    id: 15,
    query: "bathtub",
    city: "Paris",
    expectation: { type: "feature", flag: "bathtub" },
    description: "Feature flag: bathtub (Paris)",
  },
  {
    id: 16,
    query: "terrace",
    city: "Paris",
    expectation: { type: "feature", flag: "terrace" },
    description: "Feature flag: terrace (Paris)",
  },
  {
    id: 17,
    query: "Eiffel Tower view",
    city: "Paris",
    expectation: { type: "feature", flag: "landmark_view" },
    description: "Feature flag: landmark_view / Eiffel Tower view (Paris)",
  },
  // ── Mexico City (V2 pipeline) ───────────────────────────────────────────────
  // V2 stores facts in `v2_room_types_index.facts` (jsonb). For semantic queries
  // we use `minHotels` as a floor (>=) instead of an exact count, because V2
  // semantic ranking is naturally fuzzy and counts shift with re-indexes.
  { id: 100, query: "rooftop terrace", city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 50, description: "Semantic: rooftop terrace (CDMX, V2)" },
  { id: 101, query: "double sinks",            city: "Mexico City", expectation: { type: "feature", flag: "double_sinks" },           source: "v2", description: "V2 feature: double_sinks (CDMX)" },
  { id: 102, query: "walk in shower",          city: "Mexico City", expectation: { type: "feature", flag: "walk_in_shower" },         source: "v2", description: "V2 feature: walk_in_shower (CDMX)" },
  { id: 103, query: "soaking tub",             city: "Mexico City", expectation: { type: "feature", flag: "soaking_tub" },            source: "v2", description: "V2 feature: soaking_tub (CDMX)" },
  { id: 104, query: "balcony",                 city: "Mexico City", expectation: { type: "feature", flag: "balcony" },                source: "v2", description: "V2 feature: balcony (CDMX)" },
  { id: 105, query: "city view",               city: "Mexico City", expectation: { type: "feature", flag: "city_view" },              source: "v2", description: "V2 feature: city_view (CDMX)" },
  { id: 106, query: "king bed",                city: "Mexico City", expectation: { type: "feature", flag: "king_bed" },               source: "v2", description: "V2 feature: king_bed (CDMX)" },
  { id: 107, query: "bright airy room with large windows", city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 100, description: "V2 semantic: bright airy (CDMX)" },
  { id: 108, query: "dark moody romantic suite",          city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 30, description: "V2 semantic: dark moody (CDMX)" },
  { id: 109, query: "minimalist modern design",           city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 30, description: "V2 semantic: minimalist modern (CDMX)" },
  { id: 110, query: "art deco style",                     city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 10, description: "V2 semantic: art deco (CDMX)" },
  { id: 111, query: "loft industrial exposed brick",      city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 5,  description: "V2 semantic: loft industrial (CDMX)" },
  { id: 112, query: "panoramic view city lights",         city: "Mexico City", expectation: { type: "semantic" }, source: "v2", minHotels: 30, description: "V2 semantic: panoramic view (CDMX)" },
];

let supabase;
const expectedCountCache = new Map();

function getBaseUrl(argv = process.argv) {
  const arg = argv.find((value) => value.startsWith("--base-url="));
  return arg ? arg.split("=")[1] : DEFAULT_BASE_URL;
}

function getSupabase() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  supabase = createClient(url, key);
  return supabase;
}

async function fetchDistinctHotelIds(city, featureFlag = null, source = "v1") {
  const db = getSupabase();
  if (!db) throw new Error("Supabase credentials not configured");
  // V2 cities (Mexico City) use a different index table + facts column.
  const table   = source === "v2" ? "v2_room_types_index" : "room_types_index";
  const factCol = source === "v2" ? "facts"               : "features";
  const hotelIds = new Set();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = db
      .from(table)
      .select("hotel_id")
      .eq("city", city)
      .range(offset, offset + PAGE_SIZE - 1);

    if (featureFlag) {
      query = query.contains(factCol, { [featureFlag]: true });
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase query failed for ${city}${featureFlag ? ` (${featureFlag})` : ""} on ${table}: ${error.message}`);

    for (const row of data || []) {
      if (row.hotel_id) hotelIds.add(row.hotel_id);
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  return hotelIds;
}

async function getExpectedHotelCount(test) {
  const source = test.source || "v1";
  const key = `${source}::${test.city}::${test.expectation.type}::${test.expectation.flag || "all"}`;
  if (expectedCountCache.has(key)) return expectedCountCache.get(key);

  let count;
  const db = getSupabase();

  if (db) {
    if (test.expectation.type === "semantic") {
      // Semantic queries don't have a deterministic "expected" count — use the
      // minHotels floor (handled in the runner) and fall back to a soft target
      // here that the runner only uses for reporting.
      count = typeof test.minHotels === "number" ? test.minHotels : 1;
    } else {
      const ids = await fetchDistinctHotelIds(test.city, test.expectation.flag, source);
      count = ids.size;
    }
  } else {
    count = baseline.counts[key];
    if (typeof count !== "number") {
      // Fallback for V2 baselines that don't exist yet — accept minHotels.
      if (typeof test.minHotels === "number") count = test.minHotels;
      else throw new Error(`No baseline count found for ${key}`);
    }
  }

  expectedCountCache.set(key, count);
  return count;
}

function parseResultCount(text) {
  if (!text) return null;

  const showingMatch = text.match(/Showing\s+\d+\s+of\s+(\d+)\s+hotels?/i);
  if (showingMatch) return Number(showingMatch[1]);

  const directMatch = text.match(/(\d+)\s+hotels?/i);
  if (directMatch) return Number(directMatch[1]);

  return null;
}

module.exports = {
  DEFAULT_BASE_URL,
  SEARCH_TESTS,
  getBaseUrl,
  getExpectedHotelCount,
  parseResultCount,
};
