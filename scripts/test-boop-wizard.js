#!/usr/bin/env node
/**
 * Boop wizard integration tests — Mexico City V2.
 *
 * Usage:
 *   node scripts/test-boop-wizard.js
 *   node scripts/test-boop-wizard.js --base-url=http://localhost:3000
 *   node scripts/test-boop-wizard.js --quick   # unit + smoke only
 */

require("dotenv").config();

const {
  buildBoopProfile,
  buildBoopSeeds,
  STAY_VIBE_DERIVED,
  MUSTHAVE_OPTIONS,
} = require("../lib/boop-wizard");
const { STAY_VIBE_TO_VISUAL_STYLE } = require("./fact-catalog");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const QUICK = process.argv.includes("--quick");
const CITY = "Mexico City";
const DELAY_MS = QUICK ? 400 : 700;

const TRIPS = ["first", "repeat", "expert"];
const STAY_VIBES = Object.keys(STAY_VIBE_DERIVED);
const NBHD_SCENES = ["buzz_central", "calm_central", "hip_local", "leafy_local", "scenic_open"];
const MUSTHAVE_COMBOS = [
  [],
  ["balcony"],
  ["work_desk"],
  ["spa_bathroom"],
  ["spacious"],
  ["balcony", "work_desk"],
  ["spa_bathroom", "spacious"],
];
const PRICE_LEVELS = [-80, 0, 80];

/** Top-3 neighbourhood names we expect in top-15 hotel primary_nbhd for each scene (picker sim). */
const NBHD_SCENE_EXPECTED_TOP = {
  buzz_central: ["Centro Histórico", "Paseo de la Reforma", "Juárez"],
  calm_central: ["Polanco", "Paseo de la Reforma", "Condesa"],
  hip_local: ["Roma Norte", "Condesa", "Juárez"],
  leafy_local: ["Coyoacán", "San Rafael", "Condesa"],
  scenic_open: ["Paseo de la Reforma", "Centro Histórico", "Polanco"],
};

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callVsearch({ query, hotelQuery, mustHaves, boopProfile }) {
  const params = new URLSearchParams({
    query,
    city: CITY,
    search_version: "v2",
  });
  if (hotelQuery) params.set("hotel_query", hotelQuery);
  if (mustHaves?.length) params.set("must_haves", mustHaves.join(","));
  if (boopProfile) params.set("boop_profile", JSON.stringify(boopProfile));
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const url = `${BASE_URL}/api/vsearch?${params}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function avgStar(hotels, n = 20) {
  const slice = hotels.slice(0, n);
  const stars = slice.map((h) => Number(h.starRating)).filter((s) => Number.isFinite(s) && s > 0);
  if (!stars.length) return null;
  return stars.reduce((a, b) => a + b, 0) / stars.length;
}

function topNbhdNames(hotels, n = 15) {
  const names = [];
  for (const h of hotels.slice(0, n)) {
    const nm = h.primary_nbhd?.name;
    if (nm && !names.includes(nm)) names.push(nm);
  }
  return names;
}

function intentHasFact(data, factKey) {
  const intent = data?.stats?.query_router;
  if (!intent) return false;
  const keys = [
    ...(intent.hard_filters || []).map((x) => x.fact_key),
    ...(intent.soft_preferences || []).map((x) => x.fact_key),
  ];
  return keys.includes(factKey);
}

// ── Unit tests (no network) ───────────────────────────────────────────────────

function runUnitTests() {
  const failures = [];

  function assert(cond, msg) {
    if (!cond) failures.push(msg);
  }

  for (const sv of STAY_VIBES) {
    const p = buildBoopProfile({ trip: "repeat", stayVibe: sv, nbhdScene: "hip_local", group_size: "couple" });
    const derived = STAY_VIBE_DERIVED[sv];
    assert(p.answers.roomStyle === derived.roomStyle, `${sv}: roomStyle`);
    assert(p.answers.hotelPersonality === derived.hotelPersonality, `${sv}: hotelPersonality`);
    const styleKey = STAY_VIBE_TO_VISUAL_STYLE[sv];
    assert(!!styleKey, `${sv}: missing STAY_VIBE_TO_VISUAL_STYLE`);
  }

  const balconyProfile = buildBoopProfile(
    { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central", group_size: "couple" },
    ["balcony"]
  );
  const { mustHaves: mhBalcony } = buildBoopSeeds(balconyProfile);
  assert(mhBalcony.includes("private_balcony"), `balcony must-have → private_balcony (got ${mhBalcony})`);

  const deskProfile = buildBoopProfile(
    { trip: "repeat", stayVibe: "cozy_warm", nbhdScene: "leafy_local", group_size: "couple" },
    ["work_desk"]
  );
  assert(buildBoopSeeds(deskProfile).mustHaves.includes("ergonomic_workspace"), "work_desk → ergonomic_workspace");

  const valueSeed = buildBoopSeeds(
    buildBoopProfile({ trip: "repeat", stayVibe: "simple_value", nbhdScene: "scenic_open", group_size: "couple" })
  );
  assert(/good value|practical|economical/i.test(valueSeed.roomSeed), "simple_value room seed nudge");
  assert(/affordable|value/i.test(valueSeed.hotelSeed), "simple_value hotel seed");

  const buzzPrefs = buildBoopProfile({ trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central" }).prefs;
  const leafyPrefs = buildBoopProfile({ trip: "expert", stayVibe: "cozy_warm", nbhdScene: "leafy_local" }).prefs;
  assert((buzzPrefs.nightlife || 0) > (leafyPrefs.nightlife || 0), "buzz_central nightlife > leafy_local");
  assert((leafyPrefs.calm || 0) > (buzzPrefs.calm || 0), "leafy_local calm > buzz_central");

  const { FACT_CATALOG } = require("./fact-catalog");
  const factSet = new Set(FACT_CATALOG);
  for (const opt of MUSTHAVE_OPTIONS) {
    if (opt.flag) assert(factSet.has(opt.flag), `must-have flag ${opt.flag} not in FACT_CATALOG`);
    if (opt.id === "balcony") assert(opt.flag === "private_balcony", "balcony → private_balcony");
  }

  return failures;
}

// ── API test cases ────────────────────────────────────────────────────────────

function buildApiCases() {
  const cases = [];

  for (const stayVibe of STAY_VIBES) {
    cases.push({
      id: `stay_${stayVibe}`,
      answers: { trip: "repeat", stayVibe, nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 },
      dealbreakers: [],
      validate(data) {
        const styleKey = STAY_VIBE_TO_VISUAL_STYLE[stayVibe];
        if (!styleKey) return `no visual style map for ${stayVibe}`;
        if (!intentHasFact(data, styleKey)) return `intent missing ${styleKey}`;
        if ((data.hotels || []).length < 30) return `too few hotels: ${(data.hotels || []).length}`;
        return null;
      },
    });
  }

  for (const nbhdScene of NBHD_SCENES) {
    cases.push({
      id: `nbhd_${nbhdScene}`,
      answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene, group_size: "couple", priceMatters: 0 },
      dealbreakers: [],
      validate(data) {
        if (!data.stats?.nbhd_blend_applied) return "nbhd_blend_applied false";
        const top = topNbhdNames(data.hotels || [], 15);
        const expected = NBHD_SCENE_EXPECTED_TOP[nbhdScene] || [];
        const hit = expected.filter((n) => top.includes(n)).length;
        if (hit < 1) return `top nbhds ${JSON.stringify(top)} expected one of ${JSON.stringify(expected)}`;
        return null;
      },
    });
  }

  for (const dealbreakers of MUSTHAVE_COMBOS) {
    if (!dealbreakers.length) continue;
    cases.push({
      id: `mh_${dealbreakers.join("_")}`,
      answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 },
      dealbreakers,
      validate(data) {
        const hotels = data.hotels || [];
        if (hotels.length < 1) return "zero hotels (must-have too strict?)";
        for (const flag of dealbreakers) {
          const opt = MUSTHAVE_OPTIONS.find((o) => o.id === flag);
          if (!opt?.flag) continue;
          if (!intentHasFact(data, opt.flag)) return `intent missing hard filter ${opt.flag}`;
        }
        return null;
      },
    });
  }

  cases.push({
    id: "price_value_vs_splurge",
    async validatePair() {
      const base = { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "calm_central", group_size: "couple" };
      const valueP = buildBoopProfile({ ...base, priceMatters: 80 });
      const splurgeP = buildBoopProfile({ ...base, priceMatters: -80 });
      const vSeeds = buildBoopSeeds(valueP);
      const sSeeds = buildBoopSeeds(splurgeP);
      const [valueData, splurgeData] = await Promise.all([
        callVsearch({ query: vSeeds.roomSeed, hotelQuery: vSeeds.hotelSeed, mustHaves: vSeeds.mustHaves, boopProfile: valueP }),
        callVsearch({ query: sSeeds.roomSeed, hotelQuery: sSeeds.hotelSeed, mustHaves: sSeeds.mustHaves, boopProfile: splurgeP }),
      ]);
      const vStars = avgStar(valueData.hotels);
      const sStars = avgStar(splurgeData.hotels);
      if (vStars == null || sStars == null) return "missing star ratings on top hotels";
      if (valueData.stats?.price_matters !== 80) return `value search price_matters=${valueData.stats?.price_matters}`;
      if (splurgeData.stats?.price_matters !== -80) return `splurge search price_matters=${splurgeData.stats?.price_matters}`;
      if (vStars >= sStars - 0.15) {
        return `value top-20 avg stars ${vStars.toFixed(2)} should be < splurge ${sStars.toFixed(2)}`;
      }
      return null;
    },
  });

  if (!QUICK) {
    for (const trip of TRIPS) {
      for (const stayVibe of STAY_VIBES) {
        for (const nbhdScene of NBHD_SCENES) {
          cases.push({
            id: `grid_${trip}_${stayVibe}_${nbhdScene}`,
            answers: { trip, stayVibe, nbhdScene, group_size: "couple", priceMatters: 0 },
            dealbreakers: [],
            validate(data) {
              if ((data.hotels || []).length < 20) return `only ${(data.hotels || []).length} hotels`;
              const styleKey = STAY_VIBE_TO_VISUAL_STYLE[stayVibe];
              if (styleKey && !intentHasFact(data, styleKey)) return `missing ${styleKey}`;
              return null;
            },
          });
        }
      }
    }
  }

  return cases;
}

async function main() {
  console.log(`\nBoop wizard tests — ${CITY}`);
  console.log(`Base URL: ${BASE_URL}${QUICK ? " (quick)" : ""}\n`);

  const unitFails = runUnitTests();
  if (unitFails.length) {
    console.log(red(`Unit: ${unitFails.length} FAIL`));
    unitFails.forEach((f) => console.log(`  - ${f}`));
  } else {
    console.log(green("Unit: PASS"));
  }

  const cases = buildApiCases();
  let passed = 0;
  let failed = 0;
  const failMsgs = [];

  for (const tc of cases) {
    process.stdout.write(`  ${tc.id}… `);
    try {
      let err = null;
      if (tc.validatePair) {
        err = await tc.validatePair();
      } else {
        const profile = buildBoopProfile(tc.answers, tc.dealbreakers);
        const { roomSeed, hotelSeed, mustHaves } = buildBoopSeeds(profile);
        const data = await callVsearch({ query: roomSeed, hotelQuery: hotelSeed, mustHaves, boopProfile: profile });
        err = tc.validate(data);
      }
      if (err) {
        failed++;
        failMsgs.push({ id: tc.id, err });
        console.log(red("FAIL"));
        console.log(`      ${err}`);
      } else {
        passed++;
        console.log(green("PASS"));
      }
    } catch (e) {
      failed++;
      failMsgs.push({ id: tc.id, err: e.message });
      console.log(red("ERROR"));
      console.log(`      ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`API: ${green(String(passed))} pass, ${failed ? red(String(failed)) : "0"} fail (${cases.length} cases)`);
  if (unitFails.length) console.log(`Unit failures: ${unitFails.length}`);

  const totalFail = unitFails.length + failed;
  if (totalFail) {
    console.log(red(`\n${totalFail} total failure(s)`));
    process.exit(1);
  }
  console.log(green("\nAll boop wizard tests passed."));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
