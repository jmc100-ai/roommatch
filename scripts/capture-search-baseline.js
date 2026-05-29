#!/usr/bin/env node
/**
 * Capture search ranking + perf baseline for perf-flag regressions.
 *
 *   node scripts/capture-search-baseline.js
 *   node scripts/capture-search-baseline.js --base-url=http://localhost:3000
 *   node scripts/capture-search-baseline.js --out=reports/search-baseline-golden.json
 *
 * Compare after changes:
 *   node scripts/compare-search-baseline.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { sortHotelsBestMatch, bestMatchRoomScore } = require("../lib/client-match-sort");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=reports/search-baseline-golden.json")
  .split("=")[1];
const DELAY_MS = Number((process.argv.find((a) => a.startsWith("--delay=")) || "").split("=")[1]) || 400;

/** Fixed cases — include Ritz-style regression + stratified Boop grid. */
const FIXED_CASES = [
  {
    id: "ritz_mxc_dated",
    city: "Mexico City",
    checkin: "2026-06-18",
    checkout: "2026-06-25",
    answers: {
      trip: "first",
      stayVibe: "sleek_polished",
      nbhdScene: "calm_central",
      group_size: "couple",
      priceMatters: 0,
    },
    dealbreakers: [],
    freetext: "",
    queryOverride: "sleek polished upscale refined room natural light",
  },
  {
    id: "value_mxc_dated",
    city: "Mexico City",
    checkin: "2026-06-18",
    checkout: "2026-06-25",
    answers: {
      trip: "repeat",
      stayVibe: "simple_value",
      nbhdScene: "buzz_central",
      group_size: "couple",
      priceMatters: 80,
    },
    dealbreakers: [],
    freetext: "",
  },
  {
    id: "splurge_mxc_dated",
    city: "Mexico City",
    checkin: "2026-07-01",
    checkout: "2026-07-05",
    answers: {
      trip: "expert",
      stayVibe: "sleek_polished",
      nbhdScene: "scenic_open",
      group_size: "couple",
      priceMatters: -80,
    },
    dealbreakers: [],
    freetext: "",
  },
  {
    id: "cozy_leafy_no_dates",
    city: "Mexico City",
    checkin: null,
    checkout: null,
    answers: {
      trip: "first",
      stayVibe: "cozy_warm",
      nbhdScene: "leafy_local",
      group_size: "couple",
      priceMatters: 0,
    },
    dealbreakers: [],
    freetext: "",
  },
  {
    id: "distinct_hip_paris",
    city: "Paris",
    checkin: "2026-06-20",
    checkout: "2026-06-24",
    answers: {
      trip: "repeat",
      stayVibe: "distinct_unique",
      nbhdScene: "hip_local",
      group_size: "couple",
      priceMatters: 0,
    },
    dealbreakers: ["balcony"],
    freetext: "",
  },
];

const GRID_CASES = [
  { id: "grid_sleek_buzz", city: "Mexico City", dates: true, answers: { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central", group_size: "couple", priceMatters: 0 } },
  { id: "grid_cozy_calm", city: "Mexico City", dates: true, answers: { trip: "repeat", stayVibe: "cozy_warm", nbhdScene: "calm_central", group_size: "couple", priceMatters: 50 } },
  { id: "grid_distinct_hip", city: "Mexico City", dates: false, answers: { trip: "expert", stayVibe: "distinct_unique", nbhdScene: "hip_local", group_size: "solo", priceMatters: 0 } },
  { id: "grid_value_leafy", city: "Mexico City", dates: true, answers: { trip: "first", stayVibe: "simple_value", nbhdScene: "leafy_local", group_size: "family", priceMatters: 100 } },
  { id: "grid_sleek_scenic", city: "Mexico City", dates: true, answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "scenic_open", group_size: "couple", priceMatters: -50 } },
  { id: "grid_paris_calm", city: "Paris", dates: true, answers: { trip: "first", stayVibe: "cozy_warm", nbhdScene: "calm_central", group_size: "couple", priceMatters: 0 } },
  { id: "grid_paris_buzz", city: "Paris", dates: false, answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "buzz_central", group_size: "couple", priceMatters: 30 } },
];

function addDates(c) {
  if (!c.dates && c.checkin == null) return { ...c, checkin: null, checkout: null };
  if (c.checkin) return c;
  return { ...c, checkin: "2026-06-18", checkout: "2026-06-25" };
}

function allCases() {
  const grid = GRID_CASES.map((c) => addDates({
    ...c,
    dealbreakers: c.dealbreakers || [],
    freetext: c.freetext || "",
  }));
  return [...FIXED_CASES, ...grid];
}

function apiHeaders() {
  const h = { Accept: "application/json" };
  if (process.env.INDEX_SECRET) h["x-index-secret"] = process.env.INDEX_SECRET;
  return h;
}

async function fetchTimed(url, timeoutMs = 120000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: apiHeaders(), signal: ctrl.signal });
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("utf8");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    return { data, wallMs: Date.now() - t0, bytes: buf.byteLength, ok: true };
  } finally {
    clearTimeout(timer);
  }
}

function cloneHotels(hotels) {
  return (hotels || []).map((h) => ({
    ...h,
    roomTypes: (h.roomTypes || []).map((rt) => ({ ...rt, photos: rt.photos ? [...rt.photos] : [] })),
    roomPrices: h.roomPrices ? { ...h.roomPrices } : undefined,
  }));
}

function mergeRates(hotels, ratesData) {
  const prices = ratesData.prices || {};
  const roomPrices = ratesData.roomPrices || {};
  for (const h of hotels) {
    const id = String(h.id);
    h.price = prices[id] != null ? Number(prices[id]) : null;
    h.roomPrices = roomPrices[id] ? { ...roomPrices[id] } : null;
  }
  return Number(ratesData.pricedCount) || 0;
}

function summarizeHotel(h, ctx = {}) {
  return {
    id: String(h.id),
    vectorScore: h.vectorScore ?? null,
    hotelScore: h.hotelScore ?? null,
    nbhd_fit_pct: h.nbhd_fit_pct ?? null,
    roomMatch: bestMatchRoomScore(h, ctx),
    price: h.price != null ? Math.round(h.price) : null,
    name: (h.name || "").slice(0, 40) || null,
    hasRooms: (h.roomTypes || []).length > 0,
    stubHasNbhdAttrs: !!(h.primary_nbhd?.attributes),
    primary_nbhd_name: h.primary_nbhd?.name ?? null,
  };
}

function payloadStats(hotels) {
  const stubs = hotels.filter((h) => !(h.roomTypes || []).length);
  const full = hotels.filter((h) => (h.roomTypes || []).length > 0);
  const stubBytes = stubs.reduce((s, h) => s + JSON.stringify(h).length, 0);
  const fullBytes = full.reduce((s, h) => s + JSON.stringify(h).length, 0);
  return {
    total: hotels.length,
    stubs: stubs.length,
    full: full.length,
    stubBytes,
    fullBytes,
    totalBytes: stubBytes + fullBytes,
  };
}

async function runCase(caseDef) {
  const profile = buildBoopProfile(caseDef.answers, caseDef.dealbreakers, caseDef.freetext);
  const { roomSeed, hotelSeed, mustHaves } = buildBoopSeeds(profile);
  const query = caseDef.queryOverride || roomSeed;
  const params = new URLSearchParams({
    query,
    city: caseDef.city,
    search_version: "v2",
    hotel_query: hotelSeed,
    boop_profile: JSON.stringify(profile),
  });
  if (mustHaves.length) params.set("must_haves", mustHaves.join(","));
  const vsearchUrl = `${BASE_URL}/api/vsearch?${params}`;

  let ratesWallMs = null;
  let ratesBytes = null;
  let pricedCount = null;

  const hasDates = caseDef.checkin && caseDef.checkout;
  const vsearchP = fetchTimed(vsearchUrl);
  const ratesP = hasDates
    ? fetchTimed(
      `${BASE_URL}/api/rates?${new URLSearchParams({
        city: caseDef.city,
        checkin: caseDef.checkin,
        checkout: caseDef.checkout,
        currency: "USD",
      })}`,
      90000
    )
    : Promise.resolve(null);

  const [vsearchR, ratesR] = await Promise.all([vsearchP, ratesP]);
  const data = vsearchR.data;
  const hotels = cloneHotels(data.hotels || []);

  const ctx = {
    pricesLoaded: false,
    hasDateSearch: false,
    showAvailOnly: false,
  };

  if (ratesR?.ok) {
    ratesWallMs = ratesR.wallMs;
    ratesBytes = ratesR.bytes;
    pricedCount = mergeRates(hotels, ratesR.data);
    ctx.pricesLoaded = pricedCount > 0;
    ctx.hasDateSearch = true;
    ctx.showAvailOnly = ctx.pricesLoaded;
  }

  const serverTop10 = hotels.slice(0, 10).map((h) => String(h.id));

  const { hotels: sorted } = sortHotelsBestMatch(hotels, data.stats || {}, profile, ctx);
  const top10 = sorted.slice(0, 10).map((h) => summarizeHotel(h, ctx));
  const ps = payloadStats(data.hotels || []);

  return {
    id: caseDef.id,
    city: caseDef.city,
    dates: hasDates ? `${caseDef.checkin}→${caseDef.checkout}` : "none",
    perf: {
      vsearchWallMs: vsearchR.wallMs,
      vsearchBytes: vsearchR.bytes,
      ratesWallMs,
      ratesBytes,
      handlerWallMs: data.stats?.handler_wall_ms ?? null,
      perfMs: data.stats?.perf_ms ?? null,
      metaSyncMs: data.stats?.meta_sync_ms ?? null,
    },
    payload: ps,
    stats: {
      nbhd_rank_weight: data.stats?.nbhd_rank_weight ?? null,
      slim_stubs: data.stats?.slim_stubs ?? null,
      nbhd_cache_hit: data.stats?.nbhd_cache_hit ?? null,
    },
    top10,
    top10Ids: top10.map((h) => h.id).join(","),
    serverTop10Ids: serverTop10.join(","),
    pricedCount,
  };
}

(async () => {
  const cases = allCases();
  console.log(`Capturing baseline: ${cases.length} cases @ ${BASE_URL}\n`);

  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`  [${i + 1}/${cases.length}] ${c.id}… `);
    try {
      const row = await runCase(c);
      results.push(row);
      console.log(
        `vsearch=${row.perf.vsearchWallMs}ms ${Math.round(row.perf.vsearchBytes / 1024)}KB` +
        (row.perf.ratesWallMs != null ? ` rates=${row.perf.ratesWallMs}ms` : "") +
        ` #1=${row.top10[0]?.id || "—"}`
      );
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ id: c.id, error: e.message });
    }
    if (i < cases.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const doc = {
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    caseCount: results.length,
    cases: results,
  };

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  console.log(`\nWrote ${outPath}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
