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

async function fetchDistinctHotelIds(city, featureFlag = null) {
  const db = getSupabase();
  if (!db) throw new Error("Supabase credentials not configured");
  const hotelIds = new Set();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = db
      .from("room_types_index")
      .select("hotel_id")
      .eq("city", city)
      .range(offset, offset + PAGE_SIZE - 1);

    if (featureFlag) {
      query = query.contains("features", { [featureFlag]: true });
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase query failed for ${city}${featureFlag ? ` (${featureFlag})` : ""}: ${error.message}`);

    for (const row of data || []) {
      if (row.hotel_id) hotelIds.add(row.hotel_id);
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  return hotelIds;
}

async function getExpectedHotelCount(test) {
  const key = `${test.city}::${test.expectation.type}::${test.expectation.flag || "all"}`;
  if (expectedCountCache.has(key)) return expectedCountCache.get(key);

  let count;
  const db = getSupabase();

  if (db) {
    const ids = await fetchDistinctHotelIds(
      test.city,
      test.expectation.type === "feature" ? test.expectation.flag : null
    );
    count = ids.size;
  } else {
    count = baseline.counts[key];
    if (typeof count !== "number") {
      throw new Error(`No baseline count found for ${key}`);
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
