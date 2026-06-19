#!/usr/bin/env node
/**
 * Build all SEO marketing pages (Phases 1–2) + sitemaps.
 * Order: stats → Paris/CDMX hand pages → spokes → stays → vibe → neighborhoods → sitemap
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
function run(cmd) {
  console.log(`\n>> ${cmd}\n`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", env: process.env });
}

run("node scripts/marketing-city-stats.js");
run("node scripts/refresh-paris-marketing-hotels.js");
run("node scripts/build-paris-marketing-pages.js");
run("node scripts/build-mexico-marketing-pages.js");
run("node scripts/build-spoke-seo-pages.js");
run("node scripts/build-hotel-seo-pages.js");
run("node scripts/build-vibe-marketing-pages.js");
run("node scripts/build-neighborhood-marketing-pages.js");
run("node scripts/build-sitemap.js");
run("node scripts/audit-marketing-links.js");
run("node scripts/audit-stays-sample.js");

console.log("\nAll marketing SEO pages built.");
