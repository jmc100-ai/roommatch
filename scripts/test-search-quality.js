#!/usr/bin/env node
/**
 * Search quality test suite — V1 tests use flag_mode=strict; V2 tests use soft
 * ranking and verify flagged hotels appear in the top 10 (V2 returns full catalog).
 *
 * Usage:
 *   node scripts/test-search-quality.js
 *   node scripts/test-search-quality.js --base-url=http://localhost:3000
 */

const {
  SEARCH_TESTS,
  getBaseUrl,
  getExpectedHotelCount,
  fetchDistinctHotelIds,
} = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(str, len) {
  return String(str).padEnd(len);
}

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s)   { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s){ return `\x1b[33m${s}\x1b[0m`; }
function bold(s)  { return `\x1b[1m${s}\x1b[0m`; }

async function callVsearch(query, city, test = {}) {
  const source = test.source || "v1";
  const params = new URLSearchParams({ query, city, search_version: source === "v2" ? "v2" : "v1" });
  // V1-only: strict DB pre-filter. V2 uses soft ranking + top-N fact coverage checks.
  if (source !== "v2") params.set("flag_mode", "strict");
  const url = `${BASE_URL}/api/vsearch?${params}`;
  // Bypass the beta gate (closed-beta SITE_PASSWORD cookie wall) when INDEX_SECRET
  // is set in the environment. Required for CI runs against production.
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const start = Date.now();
  const res = await fetch(url, { headers });
  const elapsed = Date.now() - start;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { data, elapsed };
}

/** V2 feature queries return the full catalog — verify flagged hotels appear in top N. */
async function checkV2FeatureCoverage(test, hotels, topN = 10) {
  const flaggedIds = await fetchDistinctHotelIds(test.city, test.expectation.flag, "v2");
  if (flaggedIds.size === 0) return { pass: true, hits: 0, flaggedInDb: 0, skipped: true };
  const minHits = typeof test.minTopFactHits === "number" ? test.minTopFactHits : 1;
  const hits = hotels.slice(0, topN).filter((h) => flaggedIds.has(String(h.hotel_id || h.id))).length;
  return { pass: hits >= minHits, hits, flaggedInDb: flaggedIds.size, skipped: false };
}

function scoreLabel(pct) {
  if (pct >= 70) return green(`${pct}%`);
  if (pct >= 40) return yellow(`${pct}%`);
  return `${pct}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold(`\n🔍 RoomMatch Search Quality Tests`));
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Running ${SEARCH_TESTS.length} tests…\n`);

  const results = [];

  // Soft latency cap (ms). Queries above this still pass on count/score
  // but log a yellow latency warning. Production V2 cold path is ~3s; warm
  // is ~1s. 6s is comfortably above the warm + cold envelope.
  const LATENCY_SOFT_CAP_MS = 6000;

  for (const test of SEARCH_TESTS) {
    process.stdout.write(`  Test ${test.id}: "${test.query}" (${test.city})… `);

    let result;
    try {
      const expectedHotels = await getExpectedHotelCount(test);
      const { data, elapsed } = await callVsearch(test.query, test.city, test);
      const hotels = data.hotels || [];
      const count  = hotels.length;

      const isV2 = (test.source || "v1") === "v2";
      const isV2Feature = isV2 && test.expectation.type === "feature";
      const isFloor = test.expectation.type === "semantic" || (isV2 && typeof test.minHotels === "number");

      let countPass;
      let factPass = true;
      let factMeta = null;

      if (isV2Feature) {
        // V2 returns the full indexed catalog — check top-N fact coverage instead of total count.
        countPass = count >= 1;
        factMeta = await checkV2FeatureCoverage(test, hotels);
        factPass = factMeta.pass;
      } else if (isFloor) {
        countPass = count >= expectedHotels;
      } else {
        countPass = count === expectedHotels;
      }

      // Top 5 hotels
      const top5 = hotels.slice(0, 5).map(h => ({
        name: h.name || h.hotel_id,
        score: Math.round((h.vectorScore ?? h.score ?? 0) * 10) / 10,
        starRating: h.starRating,
      }));

      // Check top result has a meaningful score
      const topScore = top5[0]?.score ?? 0;
      const scorePass = topScore >= 40;

      const latencyPass = elapsed <= LATENCY_SOFT_CAP_MS;

      const pass = countPass && scorePass && factPass; // latency is soft — doesn't fail the test
      process.stdout.write(pass ? green("PASS") : red("FAIL"));
      const latencyStr = latencyPass ? `${elapsed}ms` : yellow(`${elapsed}ms (slow)`);
      console.log(` (${latencyStr})`);

      result = { test, expectedHotels, count, countPass, scorePass, factPass, factMeta, pass, top5, elapsed, latencyPass, isFloor, isV2Feature, error: null };
    } catch (err) {
      process.stdout.write(red("ERROR"));
      console.log();
      result = { test, expectedHotels: null, count: null, countPass: false, scorePass: false, factPass: false, factMeta: null, pass: false, top5: [], elapsed: null, latencyPass: false, isFloor: false, isV2Feature: false, error: err.message };
    }

    results.push(result);

    // Small delay between requests to avoid hammering the server
    await new Promise(r => setTimeout(r, 800));
  }

  // ── Summary table ──────────────────────────────────────────────────────────
  console.log(bold(`\n${"─".repeat(90)}`));
  console.log(bold(
    `  ${pad("ID", 4)}${pad("Query", 35)}${pad("City", 15)}` +
    `${pad("Expected", 10)}${pad("Got", 8)}${pad("Count", 8)}${pad("Score", 8)}${"Status"}`
  ));
  console.log(`${"─".repeat(90)}`);

  let passed = 0;
  for (const r of results) {
    const status = r.pass ? green("✅ PASS") : (r.error ? red("💥 ERROR") : red("❌ FAIL"));
    const countStr = r.count === null ? "—" : (r.countPass ? green(r.count) : red(r.count));
    const scoreStr = r.scorePass ? green("ok") : red("low");
    console.log(
      `  ${pad(r.test.id, 4)}${pad(r.test.query, 35)}${pad(r.test.city, 15)}` +
      `${pad(r.expectedHotels ?? "—", 10)}${pad(r.count ?? "—", 8)}${pad(r.countPass ? "✓" : "✗", 8)}` +
      `${pad(r.scorePass ? "✓" : "✗", 8)}${status}`
    );
    if (r.pass) passed++;
  }

  console.log(`${"─".repeat(90)}`);
  console.log(bold(`  ${passed}/${results.length} tests passed\n`));

  // ── Detailed results ───────────────────────────────────────────────────────
  console.log(bold(`\n📋 Top-5 Hotels Per Query\n`));
  for (const r of results) {
    const label = r.pass ? green("✅") : (r.error ? red("💥") : red("❌"));
    console.log(`${label} Test ${r.test.id}: "${r.test.query}" in ${r.test.city}`);
    if (r.error) {
      console.log(`     Error: ${red(r.error)}`);
    } else if (r.top5.length === 0) {
      console.log(`     ${red("No results returned")}`);
    } else {
      r.top5.forEach((h, i) => {
        const stars = h.starRating ? `${"★".repeat(h.starRating)}` : "";
        console.log(`     ${i + 1}. ${h.name} ${stars}  ${scoreLabel(h.score)}%`);
      });
    }
    if (!r.countPass && r.count !== null && !r.isV2Feature) {
      const diff = r.count - r.expectedHotels;
      const cmp = r.isFloor ? `min ${r.expectedHotels}` : `expected ${r.expectedHotels}`;
      console.log(`     ${yellow(`Count mismatch: ${cmp}, got ${r.count} (${diff > 0 ? "+" : ""}${diff})`)}`);
    }
    if (r.isV2Feature && r.factMeta && !r.factMeta.skipped && !r.factPass) {
      console.log(`     ${yellow(`Top-10 fact coverage: ${r.factMeta.hits} hits (need ≥1 of ${r.factMeta.flaggedInDb} flagged hotels in DB)`)}`);
    }
    if (r.elapsed !== null && !r.latencyPass) {
      console.log(`     ${yellow(`Latency: ${r.elapsed}ms (>${6000}ms soft cap; not a failure)`)}`);
    }
    console.log();
  }

  process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(err => {
  console.error(red(`\nFatal: ${err.message}`));
  process.exit(1);
});
