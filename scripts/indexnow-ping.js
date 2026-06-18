#!/usr/bin/env node
/**
 * Ping IndexNow after deploy so Bing (and partners) discover new URLs quickly.
 * Requires INDEXNOW_KEY env (default: travelbyvibe-indexnow) and key file served at /{key}.txt
 *
 * Usage:
 *   node scripts/indexnow-ping.js
 *   node scripts/indexnow-ping.js --hub-only   # only hub URLs (faster post-deploy)
 *   node scripts/indexnow-ping.js --batch=5000 # chunk size (default 8000, max 10000)
 */
const { sitemapPaths } = require("./marketing-paths");

const ORIGIN = (
  process.env.SITE_PUBLIC_ORIGIN ||
  process.env.BETA_BASE_URL ||
  "https://www.travelbyvibe.com"
).replace(/\/$/, "");

const KEY = (process.env.INDEXNOW_KEY || "travelbyvibe-indexnow").trim();
const hubOnly = process.argv.includes("--hub-only");
const batchArg = process.argv.find((a) => a.startsWith("--batch="));
const BATCH = batchArg ? Math.min(10000, Number(batchArg.split("=")[1]) || 8000) : 8000;

const HUB_PATHS = [
  "/destinations",
  "/sitemap",
  "/where-to-stay-in-paris",
  "/paris-hotels",
  "/paris-hotels-by-vibe",
  "/paris-hotel-finder",
  "/paris-visual-search",
  "/where-to-stay-in-mexico-city",
  "/mexico-city-hotels",
  "/mexico-city-hotels-by-vibe",
  "/best-area-to-stay-in-mexico-city-first-time",
  "/travel-mexico-city-hotels",
  "/mexico-city-hotel-finder",
  "/mexico-city-visual-search",
];

const paths = hubOnly ? HUB_PATHS : sitemapPaths();
const urlList = paths.map((p) => `${ORIGIN}${p}`);

const host = new URL(ORIGIN).host;

async function pingBatch(batch, idx, total) {
  const body = JSON.stringify({
    host,
    key: KEY,
    keyLocation: `${ORIGIN}/${KEY}.txt`,
    urlList: batch,
  });

  const endpoints = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow"];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
      });
      console.log(`batch ${idx}/${total} ${endpoint} → ${res.status} (${batch.length} URLs)`);
    } catch (e) {
      console.error(`batch ${idx}/${total} ${endpoint} failed:`, e.message);
    }
  }
}

async function main() {
  const batches = [];
  for (let i = 0; i < urlList.length; i += BATCH) {
    batches.push(urlList.slice(i, i + BATCH));
  }
  console.log(`IndexNow: ${urlList.length} URLs in ${batches.length} batch(es)`);
  for (let i = 0; i < batches.length; i++) {
    await pingBatch(batches[i], i + 1, batches.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
