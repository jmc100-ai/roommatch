#!/usr/bin/env node
/**
 * /api/vsearch latency audit — undated or dated Boop (Paris + Mexico City).
 *
 *   node scripts/audit-vsearch-perf.js
 *   node scripts/audit-vsearch-perf.js --dates
 *   node scripts/audit-vsearch-perf.js --dates --prefetch
 *   node scripts/audit-vsearch-perf.js --dates --runs=5
 *   node scripts/audit-vsearch-perf.js --base-url=http://localhost:3000 --dates --city="Paris"
 *
 * With --dates: adds checkin/checkout, expects rates embed + bookable_first stats.
 * Run 1 ≈ cold (rates/phase-A miss); runs 2+ ≈ warm on same instance.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const BASE = (argv.find((a) => a.startsWith("--base-url=")) || "--base-url=http://localhost:3000")
  .split("=")[1]
  .replace(/\/$/, "");
const RUNS = Math.max(1, parseInt(argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || "5", 10));
const DATED = argv.includes("--dates");
const PREFETCH = argv.includes("--prefetch");
const CITY_FILTER = argv.find((a) => a.startsWith("--city="))?.split("=").slice(1).join("=") || null;
const OUT = argv.find((a) => a.startsWith("--out="))?.split("=").slice(1).join("=") || null;

const QUERY = "sleek modern minimalist room, clean lines, natural light";
const BOOP_PROFILE = {
  answers: {
    group_size: "couple",
    priceMatters: 100,
    stayVibe: "sleek_polished",
    nbhdScene: "buzz_central",
  },
  prefs: { central: 11, iconic: 36, walkability: 10, nightlife: 12 },
  dealbreakers: [],
};

const CITIES = ["Paris", "Mexico City"];

/** Prior Render baseline (pre bookable-first, from docs/search-performance-future.md). */
const PRIOR_BASELINE = {
  "Paris": {
    hotels: 4975,
    payload_mb: 2.64,
    warm_wall_p50_ms: 3600,
    cold_wall_ms: "12000-14000",
    handler_warm_p50_ms: 3100,
  },
  "Mexico City": {
    hotels: 3497,
    payload_mb: 2.19,
    warm_wall_p50_ms: 3400,
    cold_wall_ms: "9000-12000",
    handler_warm_p50_ms: 3300,
  },
};

function p50(sorted) {
  if (!sorted.length) return null;
  const s = [...sorted].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function auditDates() {
  const checkin = new Date();
  checkin.setDate(checkin.getDate() + 45);
  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + 3);
  return {
    checkin: checkin.toISOString().slice(0, 10),
    checkout: checkout.toISOString().slice(0, 10),
  };
}

async function oneRun(city, runIndex, dates) {
  const params = new URLSearchParams({
    query: QUERY,
    city,
    search_version: "v2",
    boop_profile: JSON.stringify(BOOP_PROFILE),
    currency: "USD",
  });
  if (DATED && dates) {
    params.set("checkin", dates.checkin);
    params.set("checkout", dates.checkout);
  }
  const url = `${BASE}/api/vsearch?${params}`;
  const headers = { "Accept-Encoding": "gzip, deflate" };
  if (process.env.INDEX_SECRET) headers["x-index-secret"] = process.env.INDEX_SECRET;

  const t0 = Date.now();
  const r = await fetch(url, { headers });
  const buf = Buffer.from(await r.arrayBuffer());
  const wall = Date.now() - t0;
  const bodyLen = buf.length;
  let data;
  try {
    data = JSON.parse(buf.toString("utf8"));
  } catch {
    return { ok: false, wall_ms: wall, runIndex, city, error: `HTTP ${r.status} not JSON` };
  }
  const unbookableBytes = data.unbookable_compact
    ? Buffer.byteLength(JSON.stringify(data.unbookable_compact), "utf8")
    : 0;

  const st = data.stats || {};
  const perf = st.perf_ms || {};
  const rates = data.rates || {};
  const hero = data.hotels?.[0];

  const row = {
    run: runIndex + 1,
    city,
    ok: r.ok,
    wall_ms: wall,
    body_bytes: bodyLen,
    gzip: r.headers.get("content-encoding") === "gzip",
    hotels: (data.hotels || []).length,
    ranked_total: st.ranked_total ?? null,
    bookable_count: st.bookable_count ?? null,
    unbookable_vibe_count: st.unbookable_vibe_count ?? null,
    hero_hotel_id: st.hero_hotel_id ?? hero?.id ?? null,
    hero_vector_score: hero?.vectorScore ?? null,
    hero_price: hero?.price ?? null,
    bookable_first: !!st.bookable_first,
    bookable_payload: st.bookable_payload ?? null,
    unbookable_stashed: data.unbookable_compact?.length ?? null,
    sort_source: st.sort_source ?? null,
    handler_wall_ms: st.handler_wall_ms ?? null,
    meta_sync_ms: st.meta_sync_ms ?? null,
    rates_embed_ms: st.rates_embed_ms ?? perf.rates_embed_ms ?? null,
    rates_embed_wait_ms: perf.rates_embed_wait_ms ?? null,
    rates_cache_hit: rates.cache_hit ?? null,
    rates_full_city: rates.full_city ?? null,
    rates_tail_pending: rates.tail_pending ?? null,
    rates_priced_count: rates.pricedCount ?? null,
    rates_hotels_only: rates.hotels_only ?? null,
    unbookable_stashed: data.unbookable_compact?.length ?? null,
    unbookable_bytes: unbookableBytes || null,
    phase_a_ms: perf.phase_a_ms ?? null,
    phase_b_ms: perf.phase_b_ms ?? null,
    nlp_intent_ms: perf.nlp_intent_ms ?? null,
    v2_wall_ms: perf.wall_ms ?? null,
  };

  console.log(
    `  Run ${row.run}: wall=${row.wall_ms}ms body=${fmtBytes(row.body_bytes)}` +
    `${row.gzip ? " gzip" : ""} hotels=${row.hotels}` +
    (DATED ? ` bookable=${row.bookable_count ?? "?"} hero=${row.hero_hotel_id}` : "") +
    ` | handler=${row.handler_wall_ms ?? "—"}ms rates=${row.rates_embed_ms ?? "—"}ms` +
    (row.rates_cache_hit ? " rates_cache" : "") +
    (row.phase_a_ms === 0 ? " phase_a=hit" : row.phase_a_ms != null ? ` phase_a=${row.phase_a_ms}ms` : "")
  );
  return row;
}

/** Simulate Boop city-step prefetch: warm /api/rates before first vsearch run. */
async function prefetchRates(city, dates) {
  const params = new URLSearchParams({
    city,
    checkin: dates.checkin,
    checkout: dates.checkout,
    currency: "USD",
    skip_detail: "1",
  });
  const headers = {};
  if (process.env.INDEX_SECRET) headers["x-index-secret"] = process.env.INDEX_SECRET;
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/rates?${params}`, { headers });
  await r.arrayBuffer();
  const wall = Date.now() - t0;
  console.log(`  Prefetch /api/rates: ${wall}ms HTTP ${r.status}`);
  return { ok: r.ok, wall_ms: wall, status: r.status };
}

async function auditCity(city) {
  const dates = DATED ? auditDates() : null;
  console.log(`\n${"═".repeat(72)}`);
  console.log(`City: ${city}${DATED ? `  dates=${dates.checkin}→${dates.checkout}` : "  (no dates)"}`);
  if (PREFETCH && DATED) console.log("  Mode: Boop prefetch simulated before run 1");
  console.log(`${"═".repeat(72)}`);

  let prefetch = null;
  if (PREFETCH && DATED) {
    prefetch = await prefetchRates(city, dates);
  }

  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    const row = await oneRun(city, i, dates);
    rows.push(row);
    if (i < RUNS - 1) await new Promise((res) => setTimeout(res, 500));
  }

  const ok = rows.filter((r) => r.ok);
  const walls = ok.map((r) => r.wall_ms);
  const handlers = ok.map((r) => r.handler_wall_ms).filter((n) => n != null);
  const cold = ok[0];
  const warm = ok.slice(1);
  const warmWalls = warm.map((r) => r.wall_ms);
  const warmHandlers = warm.map((r) => r.handler_wall_ms).filter((n) => n != null);

  const summary = {
    city,
    dated: DATED,
    prefetch_simulated: PREFETCH && DATED ? prefetch : null,
    dates,
    runs: RUNS,
    base_url: BASE,
    timestamp: new Date().toISOString(),
    cold_run: cold || null,
    warm_p50_wall_ms: p50(warmWalls),
    warm_p50_handler_ms: p50(warmHandlers),
    all_p50_wall_ms: p50(walls),
    all_p50_handler_ms: p50(handlers),
    wall_min: walls.length ? Math.min(...walls) : null,
    wall_max: walls.length ? Math.max(...walls) : null,
    hero_stable: ok.every((r) => r.hero_hotel_id === ok[0]?.hero_hotel_id),
    rows: ok,
  };

  const prior = PRIOR_BASELINE[city];
  console.log("\n  Summary:");
  console.log(`    Client wall  cold(run1)=${cold?.wall_ms ?? "—"}ms  warm p50=${summary.warm_p50_wall_ms ?? "—"}ms  all p50=${summary.all_p50_wall_ms ?? "—"}ms`);
  console.log(`    Handler      cold=${cold?.handler_wall_ms ?? "—"}ms  warm p50=${summary.warm_p50_handler_ms ?? "—"}ms`);
  if (cold) {
    console.log(`    Payload      ${fmtBytes(cold.body_bytes)}${cold.gzip ? " (gzip)" : ""}  hotels=${cold.hotels}  bookable=${cold.bookable_count ?? "—"}`);
    console.log(`    Rates        embed=${cold.rates_embed_ms ?? "—"}ms full_city=${cold.rates_full_city} cache_hit=${cold.rates_cache_hit} priced=${cold.rates_priced_count}`);
    console.log(`    Bookable     first=${cold.bookable_first} sort=${cold.sort_source} hero=${cold.hero_hotel_id} stable=${summary.hero_stable}`);
  }
  if (prior) {
    const warmDelta = summary.warm_p50_wall_ms != null ? summary.warm_p50_wall_ms - prior.warm_wall_p50_ms : null;
    const deltaStr = warmDelta != null ? `${warmDelta >= 0 ? "+" : ""}${warmDelta}ms vs prior warm p50` : "";
    console.log(`    vs prior     warm p50 was ~${prior.warm_wall_p50_ms}ms ${deltaStr}`);
    console.log(`                 hotels was ~${prior.hotels} (now ${cold?.hotels ?? "—"}) payload was ~${prior.payload_mb} MB`);
  }

  return summary;
}

(async () => {
  console.log(`Vsearch perf audit`);
  console.log(`  Base: ${BASE}`);
  console.log(`  Mode: ${DATED ? "dated Boop + rates embed" : "undated"}${PREFETCH && DATED ? " + prefetch before run1" : ""}`);
  console.log(`  Runs/city: ${RUNS}`);

  const cities = CITY_FILTER ? [CITY_FILTER] : CITIES;
  const report = { summaries: [] };
  for (const city of cities) {
    report.summaries.push(await auditCity(city));
  }

  const outPath = OUT || path.join(
    __dirname,
    "..",
    "logs",
    `perf-audit-${DATED ? "dated" : "undated"}-${new Date().toISOString().slice(0, 10)}.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
