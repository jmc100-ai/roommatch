#!/usr/bin/env node
/**
 * Ping IndexNow after deploy so Bing (and partners) discover new URLs quickly.
 * Requires INDEXNOW_KEY env (default: travelbyvibe-indexnow) and key file served at /{key}.txt
 *
 * Usage:
 *   node scripts/indexnow-ping.js
 *   node scripts/indexnow-ping.js --hub-only   # only hub URLs (faster post-deploy)
 */
const fs = require("fs");
const path = require("path");
const { sitemapPaths } = require("./marketing-paths");

const ORIGIN = (
  process.env.SITE_PUBLIC_ORIGIN ||
  process.env.BETA_BASE_URL ||
  "https://www.travelbyvibe.com"
).replace(/\/$/, "");

const KEY = (process.env.INDEXNOW_KEY || "travelbyvibe-indexnow").trim();
const hubOnly = process.argv.includes("--hub-only");

const HUB_PATHS = [
  "/destinations",
  "/sitemap",
  "/where-to-stay-in-paris",
  "/paris-hotels",
  "/paris-hotel-finder",
  "/paris-visual-search",
  "/where-to-stay-in-mexico-city",
  "/mexico-city-hotels",
  "/best-area-to-stay-in-mexico-city-first-time",
  "/travel-mexico-city-hotels",
  "/mexico-city-hotel-finder",
  "/mexico-city-visual-search",
];

const paths = hubOnly ? HUB_PATHS : sitemapPaths();
const urlList = paths.map((p) => `${ORIGIN}${p}`);

const host = new URL(ORIGIN).host;

async function main() {
  const body = JSON.stringify({
    host,
    key: KEY,
    keyLocation: `${ORIGIN}/${KEY}.txt`,
    urlList,
  });

  const endpoints = [
    "https://api.indexnow.org/indexnow",
    "https://www.bing.com/indexnow",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
      });
      console.log(`${endpoint} → ${res.status} (${urlList.length} URLs)`);
    } catch (e) {
      console.error(`${endpoint} failed:`, e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
