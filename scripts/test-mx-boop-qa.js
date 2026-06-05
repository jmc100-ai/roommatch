#!/usr/bin/env node
/**
 * Mexico City Boop QA — data completeness + server sort monotonicity.
 *
 *   node scripts/test-mx-boop-qa.js
 *   node scripts/test-mx-boop-qa.js --base-url=http://localhost:3000
 */

require("dotenv").config();

const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { auditVsearchHotels, formatAuditFailures } = require("../lib/v2-server-rank");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const CITY = "Mexico City";

const SCENARIOS = [
  { id: "hip_sleek", answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 } },
  { id: "leafy_cozy", answers: { trip: "first", stayVibe: "cozy_warm", nbhdScene: "leafy_local", group_size: "couple", priceMatters: 0 } },
  { id: "buzz_value", answers: { trip: "repeat", stayVibe: "simple_value", nbhdScene: "buzz_central", group_size: "couple", priceMatters: 80 } },
  { id: "calm_splurge", answers: { trip: "expert", stayVibe: "sleek_polished", nbhdScene: "calm_central", group_size: "couple", priceMatters: -80 } },
  { id: "distinct_balcony", answers: { trip: "repeat", stayVibe: "distinct_unique", nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 }, dealbreakers: ["balcony"] },
];

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }

async function callVsearch(profile, dealbreakers = []) {
  const { roomSeed, hotelSeed, mustHaves } = buildBoopSeeds(profile);
  const params = new URLSearchParams({
    query: roomSeed,
    city: CITY,
    search_version: "v2",
    hotel_query: hotelSeed,
    boop_profile: JSON.stringify(profile),
  });
  if (mustHaves.length) params.set("must_haves", mustHaves.join(","));
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const res = await fetch(`${BASE_URL}/api/vsearch?${params}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  console.log(`\nMexico City Boop QA — ${BASE_URL}\n`);
  let failed = 0;

  for (const sc of SCENARIOS) {
    process.stdout.write(`  ${sc.id}… `);
    try {
      const profile = buildBoopProfile(sc.answers, sc.dealbreakers || []);
      const data = await callVsearch(profile, sc.dealbreakers || []);
      const audit = auditVsearchHotels(data, 50, profile);
      const errs = formatAuditFailures(audit, data.stats || {});

      if (errs.length) {
        failed++;
        console.log(red("FAIL"));
        errs.forEach((e) => console.log(`      ${e}`));
      } else {
        console.log(
          green("PASS")
          + ` (stubs top50=${audit.stubsTop50}, inv=${audit.sortInversions}, metaSync=${audit.metaSyncN})`
        );
      }
    } catch (e) {
      failed++;
      console.log(red("ERROR"));
      console.log(`      ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n${failed ? red(`${failed} scenario(s) failed`) : green("All scenarios passed")}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
