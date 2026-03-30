#!/usr/bin/env node
/**
 * Search quality test suite — calls the live /api/vsearch endpoint
 * and cross-references results against expected DB counts.
 *
 * Usage:
 *   node scripts/test-search-quality.js
 *   node scripts/test-search-quality.js --base-url http://localhost:3000
 */

const BASE_URL = (() => {
  const arg = process.argv.find(a => a.startsWith("--base-url="));
  return arg ? arg.split("=")[1] : "https://roommatch-1fg5.onrender.com";
})();

// ── Test definitions ─────────────────────────────────────────────────────────
// expectedHotels: exact count from DB (room_types_index feature flag counts).
// isFeatureQuery: true → feature-flag filter applies, result count should match DB exactly.
// isFeatureQuery: false → semantic-only, all hotels returned ranked; just check top results make sense.
// topResultCheck: optional keywords that should appear in top 5 results' captions.

const TESTS = [
  {
    id: 1,
    query: "double sinks",
    city: "Kuala Lumpur",
    expectedHotels: 33,
    isFeatureQuery: true,
    description: "Feature flag: double_sinks",
  },
  {
    id: 2,
    query: "rainfall shower",
    city: "Kuala Lumpur",
    expectedHotels: 40,
    isFeatureQuery: true,
    description: "Feature flag: rainfall_shower",
  },
  {
    id: 3,
    query: "soaking tub",
    city: "Kuala Lumpur",
    expectedHotels: 19,
    isFeatureQuery: true,
    description: "Feature flag: soaking_tub",
  },
  {
    id: 4,
    query: "walk in shower",
    city: "Kuala Lumpur",
    expectedHotels: 157,
    isFeatureQuery: true,
    description: "Feature flag: walk_in_shower",
  },
  {
    id: 5,
    query: "bright room with large windows",
    city: "Kuala Lumpur",
    expectedHotels: 200, // semantic — all hotels returned, sorted by relevance
    isFeatureQuery: false,
    description: "Semantic only — no feature filter, all 200 KL hotels ranked",
  },
  {
    id: 6,
    query: "double sinks",
    city: "Paris",
    expectedHotels: 159,
    isFeatureQuery: true,
    description: "Feature flag: double_sinks (Paris)",
  },
  {
    id: 7,
    query: "Art Deco style room",
    city: "Paris",
    expectedHotels: 999, // semantic — all Paris hotels ranked
    isFeatureQuery: false,
    description: "Semantic only — Art Deco style (Paris)",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(str, len) {
  return String(str).padEnd(len);
}

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s)   { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s){ return `\x1b[33m${s}\x1b[0m`; }
function bold(s)  { return `\x1b[1m${s}\x1b[0m`; }

async function callVsearch(query, city) {
  const url = `${BASE_URL}/api/vsearch?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`;
  const start = Date.now();
  const res = await fetch(url);
  const elapsed = Date.now() - start;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { data, elapsed };
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
  console.log(`   Running ${TESTS.length} tests…\n`);

  const results = [];

  for (const test of TESTS) {
    process.stdout.write(`  Test ${test.id}: "${test.query}" (${test.city})… `);

    let result;
    try {
      const { data, elapsed } = await callVsearch(test.query, test.city);
      const hotels = data.hotels || [];
      const count  = hotels.length;

      // Check count
      let countPass;
      if (test.isFeatureQuery) {
        // Exact match required for feature-filtered queries
        countPass = count === test.expectedHotels;
      } else {
        // Semantic: expect within ±10% of expected (all hotels)
        countPass = count >= test.expectedHotels * 0.9;
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

      const pass = countPass && scorePass;
      process.stdout.write(pass ? green("PASS") : red("FAIL"));
      console.log(` (${elapsed}ms)`);

      result = { test, count, countPass, scorePass, pass, top5, elapsed, error: null };
    } catch (err) {
      process.stdout.write(red("ERROR"));
      console.log();
      result = { test, count: null, countPass: false, scorePass: false, pass: false, top5: [], elapsed: null, error: err.message };
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
      `${pad(r.test.expectedHotels, 10)}${pad(r.count ?? "—", 8)}${pad(r.countPass ? "✓" : "✗", 8)}` +
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
    if (!r.countPass && r.count !== null) {
      const diff = r.count - r.test.expectedHotels;
      console.log(`     ${yellow(`⚠ Count mismatch: expected ${r.test.expectedHotels}, got ${r.count} (${diff > 0 ? "+" : ""}${diff})`)}`);
    }
    console.log();
  }

  process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(err => {
  console.error(red(`\nFatal: ${err.message}`));
  process.exit(1);
});
