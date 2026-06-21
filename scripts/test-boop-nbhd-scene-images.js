#!/usr/bin/env node
/**
 * Validate city-specific Boop nbhdScene wizard images.
 *
 *   node scripts/test-boop-nbhd-scene-images.js
 *   node scripts/test-boop-nbhd-scene-images.js --city="Paris"
 *   node scripts/test-boop-nbhd-scene-images.js --base-url=http://localhost:3000
 */

require("dotenv").config();

const {
  fetchNbhdSceneWizardImages,
  SLOT_CONFIGS,
  SLOT_IDS,
} = require("./boop-nbhd-scene-images");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const cityArg = process.argv.find((a) => a.startsWith("--city="));
const CITY = cityArg ? cityArg.split("=")[1] : "Mexico City";

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }

function isHttpUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function printSlot(slotId, url, meta) {
  const label = SLOT_CONFIGS[slotId]?.title || slotId;
  const ok = !!url && (isHttpUrl(url) || url.startsWith("images/"));
  console.log(
    `  ${slotId.padEnd(14)} ${ok ? green("OK") : red("MISS")} ` +
    `[${label}] source=${meta?.source || "?"} ` +
    (meta?.geminiScore != null ? `score=${meta.geminiScore} ` : "") +
    (meta?.placeName ? `place="${meta.placeName}"` : "")
  );
  if (url) console.log(`           ${url.slice(0, 90)}${url.length > 90 ? "…" : ""}`);
  if (meta?.geminiReason) console.log(`           reason: ${meta.geminiReason}`);
}

async function testModule(city) {
  console.log(`\n── Module fetch: ${city} ──`);
  const r = await fetchNbhdSceneWizardImages(city, {
    placesKey: process.env.GOOGLE_PLACES_KEY || null,
    unsplashKey: process.env.UNSPLASH_KEY || null,
    geminiKey: process.env.GEMINI_KEY || null,
  });
  for (const slotId of SLOT_IDS) {
    printSlot(slotId, r.images[slotId], r.meta[slotId]);
  }
  return r;
}

async function testApi(city) {
  console.log(`\n── API: ${BASE_URL} ──`);
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const res = await fetch(
    `${BASE_URL}/api/boop-nbhd-scene-images?city=${encodeURIComponent(city)}`,
    { headers }
  );
  const text = await res.text();
  if (!res.ok) {
    console.log(red(`HTTP ${res.status}: ${text.slice(0, 200)}`));
    return null;
  }
  if (text.trimStart().startsWith("<")) {
    console.log(red("API returned HTML (endpoint not deployed yet?)"));
    return null;
  }
  const data = JSON.parse(text);
  for (const slotId of SLOT_IDS) {
    printSlot(slotId, data.images?.[slotId], data.meta?.[slotId]);
  }
  console.log(`  cached=${!!data.cached} db=${!!data.db_cached}`);
  return data;
}

async function main() {
  const hasKeys = !!(process.env.GOOGLE_PLACES_KEY || process.env.UNSPLASH_KEY);
  if (!hasKeys) {
    console.log(yellow("Warning: no GOOGLE_PLACES_KEY or UNSPLASH_KEY — expect static fallbacks only"));
  }

  const mod = await testModule(CITY);
  const dynamicCount = SLOT_IDS.filter((id) => mod.meta[id]?.source !== "static").length;
  if (dynamicCount === SLOT_IDS.length) {
    console.log(green(`\n${CITY}: both slots city-specific`));
  } else if (dynamicCount > 0) {
    console.log(yellow(`\n${CITY}: ${dynamicCount}/${SLOT_IDS.length} slots city-specific`));
  } else {
    console.log(yellow(`\n${CITY}: static fallbacks only — check API keys`));
  }

  await testApi(CITY);

  if (CITY.toLowerCase() !== "paris") {
    console.log("\n── Module fetch: Paris (sanity) ──");
    await testModule("Paris");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
