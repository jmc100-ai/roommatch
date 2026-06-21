#!/usr/bin/env node
/**
 * Apply boop_nbhd_scene_images migration check + warm cache for cities.
 * Requires table from supabase/add-boop-nbhd-scene-images.sql (run in SQL editor first).
 *
 *   node scripts/warm-boop-nbhd-scene-images.js
 *   node scripts/warm-boop-nbhd-scene-images.js --city="Paris"
 *   node scripts/warm-boop-nbhd-scene-images.js --city="Mexico City" --force
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { ensureBoopNbhdSceneImages } = require("./boop-nbhd-scene-images");

const force = process.argv.includes("--force");
const cities = (() => {
  const arg = process.argv.find((a) => a.startsWith("--city="));
  if (arg) return [arg.split("=")[1]];
  return ["Mexico City", "Paris", "London"];
})();

async function tableExists(db) {
  const { error } = await db.from("boop_nbhd_scene_images").select("city").limit(1);
  if (!error) return true;
  if (error.code === "PGRST205") return false;
  console.warn(`  table check: ${error.message}`);
  return false;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env");
    process.exit(1);
  }
  const db = createClient(url, key);

  const ok = await tableExists(db);
  if (!ok) {
    console.error("\nTable boop_nbhd_scene_images does NOT exist yet.");
    console.error("Run supabase/add-boop-nbhd-scene-images.sql in the Supabase SQL editor:");
    console.error("https://supabase.com/dashboard/project/dmgxrcmdihgsffvqllms/sql/new\n");
    process.exit(1);
  }

  console.log(`Table boop_nbhd_scene_images: OK${force ? " (force recompute)" : ""}\n`);
  for (const city of cities) {
    try {
      const r = await ensureBoopNbhdSceneImages(city, db, { force });
      const buzz = r.meta?.buzz_central;
      const scenic = r.meta?.scenic_open;
      console.log(
        `${city}: buzz=${buzz?.source} scenic=${scenic?.source}` +
        (r.db_cached ? " (db cache)" : " (computed + saved)")
      );
      if (buzz?.placeName) console.log(`  buzz_central: ${buzz.placeName} score=${buzz.geminiScore ?? "?"}`);
      if (buzz?.url) console.log(`    ${buzz.url.slice(0, 100)}…`);
      if (scenic?.placeName) console.log(`  scenic_open: ${scenic.placeName} score=${scenic.geminiScore ?? "?"}`);
      if (scenic?.url) console.log(`    ${scenic.url.slice(0, 100)}…`);

      if (force) {
        const base = process.argv.includes("--production")
          ? (process.env.BETA_BASE_URL || "https://www.travelbyvibe.com")
          : (process.env.WARM_BASE_URL || "http://localhost:3000");
        const secret = process.env.INDEX_SECRET;
        const q = new URLSearchParams({ city, refresh: "1" });
        if (secret) q.set("secret", secret);
        try {
          const resp = await fetch(`${base.replace(/\/$/, "")}/api/boop-nbhd-scene-images?${q}`, {
            headers: secret ? { "x-index-secret": secret } : {},
          });
          if (resp.ok) {
            console.log(`  server cache refreshed via ${base}`);
          } else {
            console.warn(`  server cache refresh HTTP ${resp.status} (${base}) — restart node server if on old code`);
          }
        } catch (e) {
          console.warn(`  server cache refresh skipped: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`${city}: FAILED — ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
