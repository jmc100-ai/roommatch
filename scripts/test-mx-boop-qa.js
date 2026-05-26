#!/usr/bin/env node
/**
 * Mexico City Boop QA — data completeness + server sort monotonicity.
 *
 *   node scripts/test-mx-boop-qa.js
 *   node scripts/test-mx-boop-qa.js --base-url=http://localhost:3000
 */

require("dotenv").config();

const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const CITY = "Mexico City";
const HVB = 0.2;

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

function primaryApprox(h) {
  const v = Number(h.vectorScore) || 0;
  const hv = Number(h.hotelScore);
  let ps = v;
  if (Number.isFinite(hv) && hv > 0) ps = (1 - HVB) * v + HVB * hv;
  return ps;
}

function serverBlend(h, w) {
  const ps = primaryApprox(h);
  if (w > 0 && h.nbhd_fit_pct != null) return (1 - w) * ps + w * h.nbhd_fit_pct;
  return ps;
}

function hotelHasHero(h) {
  if (h.mainPhoto) return true;
  if (Array.isArray(h.hotelPhotos) && h.hotelPhotos.length) return true;
  return (h.roomTypes || []).some((rt) => (rt.photos || []).length > 0);
}

function auditHotels(data, topN = 50) {
  const hotels = (data.hotels || []).slice(0, topN);
  const w = typeof data.stats?.nbhd_rank_weight === "number" ? data.stats.nbhd_rank_weight : 0;
  const metaSyncN = 50;
  const issues = [];

  for (let i = 0; i < hotels.length; i++) {
    const h = hotels[i];
    const id = String(h.id || "");
    const rank = i + 1;
    if (!id) issues.push({ rank, id, msg: "missing id" });
    // First screen: every card needs a visual.
    if (rank <= 10 && !hotelHasHero(h)) issues.push({ rank, id, msg: "no hero / room photos" });
    if (h.vectorScore == null) issues.push({ rank, id, msg: "missing vectorScore" });
    // Names are sync-fetched for the first META_SYNC_LIMIT hotels only.
    if (rank <= metaSyncN && (!h.name || h.name === "Hotel" || h.name === id)) {
      issues.push({ rank, id, msg: `weak name: ${h.name || "(empty)"}` });
    }
    if (data.stats?.nbhd_blend_applied && h.nbhd_fit_pct == null) {
      issues.push({ rank, id, msg: "missing nbhd_fit_pct" });
    }
    const featured = (h.roomTypes || [])[0];
    if (featured && (featured.photos || []).length === 0) {
      issues.push({ rank, id, msg: "featured room has no photos" });
    }
  }

  let sortInversions = 0;
  for (let i = 1; i < Math.min(30, hotels.length); i++) {
    if (serverBlend(hotels[i], w) > serverBlend(hotels[i - 1], w) + 0.05) sortInversions++;
  }

  const stubsTop10 = hotels.slice(0, 10).filter((h) => !(h.roomTypes || []).length).length;
  const stubsTop50 = hotels.filter((h) => !(h.roomTypes || []).length).length;

  return { issues, sortInversions, stubsTop10, stubsTop50, w, count: hotels.length };
}

async function main() {
  console.log(`\nMexico City Boop QA — ${BASE_URL}\n`);
  let failed = 0;

  for (const sc of SCENARIOS) {
    process.stdout.write(`  ${sc.id}… `);
    try {
      const profile = buildBoopProfile(sc.answers, sc.dealbreakers || []);
      const data = await callVsearch(profile, sc.dealbreakers || []);
      const audit = auditHotels(data, 50);
      const errs = [];
      if (audit.count < 30) errs.push(`only ${audit.count} hotels in top slice`);
      if (audit.stubsTop10 > 1) errs.push(`${audit.stubsTop10}/10 top cards lack indexed room photos`);
      if (audit.issues.length > 5) errs.push(`${audit.issues.length} data issues in top 50 (max 5 allowed)`);
      else if (audit.issues.length) errs.push(audit.issues.slice(0, 3).map((x) => `#${x.rank} ${x.id}: ${x.msg}`).join("; "));
      if (audit.sortInversions > 4) errs.push(`${audit.sortInversions} sort inversions in top 30 (tiebreakers expected ≤4)`);

      if (errs.length) {
        failed++;
        console.log(red("FAIL"));
        errs.forEach((e) => console.log(`      ${e}`));
      } else {
        console.log(green("PASS") + ` (stubs top50=${audit.stubsTop50}, inv=${audit.sortInversions})`);
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
