#!/usr/bin/env node
/**
 * Validate city-specific Boop trip wizard images.
 *
 *   node scripts/test-boop-trip-images.js
 *   node scripts/test-boop-trip-images.js --city="Paris"
 *   node scripts/test-boop-trip-images.js --base-url=https://roommatch-1fg5.onrender.com
 */

require("dotenv").config();

const {
  fetchTripWizardImages,
  LITMUS_MEXICO_CITY,
  STATIC_FALLBACKS,
} = require("./boop-trip-images");
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

async function testModule(city) {
  console.log(`\n── Module fetch: ${city} ──`);
  const r = await fetchTripWizardImages(city, {
    placesKey: process.env.GOOGLE_PLACES_KEY || null,
    unsplashKey: process.env.UNSPLASH_KEY || null,
    geminiKey: process.env.GEMINI_KEY || null,
  });
  for (const slot of ["first", "repeat", "expert"]) {
    const url = r.images[slot];
    const meta = r.meta[slot];
    const ok = !!url && (isHttpUrl(url) || url.startsWith("images/"));
    console.log(
      `  ${slot.padEnd(7)} ${ok ? green("OK") : red("MISS")} ` +
      `source=${meta?.source || "?"} ` +
      (meta?.geminiScore != null ? `score=${meta.geminiScore} ` : "") +
      (meta?.placeName ? `place="${meta.placeName}"` : "")
    );
    if (url) console.log(`           ${url.slice(0, 90)}${url.length > 90 ? "…" : ""}`);
  }
  return r;
}

async function testApi(city) {
  console.log(`\n── API: ${BASE_URL} ──`);
  const headers = process.env.INDEX_SECRET ? { "x-index-secret": process.env.INDEX_SECRET } : {};
  const res = await fetch(
    `${BASE_URL}/api/boop-trip-images?city=${encodeURIComponent(city)}`,
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
  for (const slot of ["first", "repeat", "expert"]) {
    const url = data.images?.[slot];
    const meta = data.meta?.[slot];
    const ok = !!url;
    console.log(
      `  ${slot.padEnd(7)} ${ok ? green("OK") : red("MISS")} ` +
      `source=${meta?.source || "?"} cached=${!!data.cached} db=${!!data.db_cached}`
    );
  }
  return data;
}

function litmusMexicoCity(r) {
  console.log(`\n── Mexico City litmus (dynamic ≠ static fallback only) ──`);
  let pass = true;
  for (const slot of ["first", "repeat", "expert"]) {
    const url = r.images[slot];
    const staticFb = LITMUS_MEXICO_CITY[slot];
    const fromApi = r.meta[slot]?.source !== "static";
    const differs = url !== staticFb;
    if (!url) {
      console.log(`  ${slot}: ${red("no url")}`);
      pass = false;
      continue;
    }
    if (fromApi) {
      console.log(`  ${slot}: ${green("city-specific")} (${r.meta[slot].source})`);
    } else if (differs) {
      console.log(`  ${slot}: ${yellow("differs from litmus static but source=static")}`);
    } else {
      console.log(`  ${slot}: ${yellow("using static fallback — check GOOGLE_PLACES_KEY / UNSPLASH_KEY")}`);
    }
  }
  return pass;
}

async function main() {
  const hasKeys = !!(process.env.GOOGLE_PLACES_KEY || process.env.UNSPLASH_KEY);
  if (!hasKeys) {
    console.log(yellow("Warning: no GOOGLE_PLACES_KEY or UNSPLASH_KEY — expect static fallbacks only"));
  }

  const mod = await testModule(CITY);
  if (CITY.toLowerCase().includes("mexico")) litmusMexicoCity(mod);

  if (process.argv.includes("--api-only")) {
    await testApi(CITY);
    return;
  }
  await testApi(CITY);

  const paris = CITY.toLowerCase() === "paris";
  if (!paris) {
    console.log("\n── Module fetch: Paris (sanity) ──");
    await testModule("Paris");
  }

  console.log(`\nStatic fallbacks (all cities): first=${STATIC_FALLBACKS.first.slice(0, 40)}…`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
