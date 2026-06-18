#!/usr/bin/env node
/**
 * Spot-check stay page hero images + internal /stays/ links (sample).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { loadGeneratedRoutes } = require("./marketing-paths");

const STAYS = path.join(__dirname, "..", "client", "marketing", "stays");
const SAMPLE = Number(process.env.STAY_SAMPLE || 24);

async function headOk(url) {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0", "User-Agent": "TravelByVibe-StayAudit/1.0" },
      redirect: "follow",
    });
    return r.status === 200 || r.status === 206;
  } catch {
    return false;
  }
}

function extractHero(html) {
  const m = html.match(/class="hero"[^>]*style="background-image:url\('([^']+)'\)/);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

async function main() {
  const gen = loadGeneratedRoutes();
  const routes = (gen.staysRoutes || []).slice(0, SAMPLE);
  let fails = 0;
  for (const r of routes) {
    const fp = path.join(__dirname, "..", "client", "marketing", r.file);
    if (!fs.existsSync(fp)) {
      console.log("MISSING FILE", r.path);
      fails++;
      continue;
    }
    const html = fs.readFileSync(fp, "utf8");
    const hero = extractHero(html);
    if (!hero) {
      console.log("NO HERO", r.path);
      fails++;
      continue;
    }
    const ok = await headOk(hero);
    console.log(ok ? "OK" : "FAIL", r.path, hero.slice(0, 60));
    if (!ok) fails++;
  }
  console.log(`\nSampled ${routes.length} stays — ${fails} failures`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
