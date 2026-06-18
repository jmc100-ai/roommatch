#!/usr/bin/env node
/**
 * Write sitemap index + marketing/stays XML sitemaps and HTML sitemap.
 * Run after adding marketing routes: node scripts/build-sitemap.js
 */
const fs = require("fs");
const path = require("path");
const { sitemapPaths, staysSitemapPaths, allMarketingRoutes } = require("./marketing-paths");

const ORIGIN = (
  process.env.SITE_PUBLIC_ORIGIN ||
  process.env.BETA_BASE_URL ||
  "https://www.travelbyvibe.com"
).replace(/\/$/, "");

const CLIENT = path.join(__dirname, "..", "client");
const lastmod = new Date().toISOString().slice(0, 10);

function urlEntry(loc, changefreq, priority) {
  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

function writeUrlset(fileName, entries) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
  const out = path.join(CLIENT, fileName);
  fs.writeFileSync(out, xml, "utf8");
  return out;
}

const allPaths = sitemapPaths();
const stayMx = staysSitemapPaths("Mexico City");
const stayParis = staysSitemapPaths("Paris");
const marketingOnly = allPaths.filter((p) => !p.startsWith("/stays/"));

const coreEntries = [
  urlEntry(`${ORIGIN}/`, "weekly", "1.0"),
  ...marketingOnly.map((p) => urlEntry(`${ORIGIN}${p}`, "weekly", p === "/sitemap" ? "0.5" : "0.85")),
  urlEntry(`${ORIGIN}/privacy`, "monthly", "0.4"),
  urlEntry(`${ORIGIN}/terms`, "monthly", "0.4"),
];

const stayMxEntries = stayMx.map((p) => urlEntry(`${ORIGIN}${p}`, "monthly", "0.7"));
const stayParisEntries = stayParis.map((p) => urlEntry(`${ORIGIN}${p}`, "monthly", "0.7"));

writeUrlset("sitemap-marketing.xml", coreEntries);
if (stayMxEntries.length) writeUrlset("sitemap-stays-mexico-city.xml", stayMxEntries);
if (stayParisEntries.length) writeUrlset("sitemap-stays-paris.xml", stayParisEntries);

const sitemapFiles = ["sitemap-marketing.xml"];
if (stayMxEntries.length) sitemapFiles.push("sitemap-stays-mexico-city.xml");
if (stayParisEntries.length) sitemapFiles.push("sitemap-stays-paris.xml");

const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapFiles
  .map((f) => `  <sitemap><loc>${ORIGIN}/${f}</loc><lastmod>${lastmod}</lastmod></sitemap>`)
  .join("\n")}
</sitemapindex>
`;

fs.writeFileSync(path.join(CLIENT, "sitemap-index.xml"), indexXml, "utf8");

// Legacy single file — marketing + first 500 stays for older GSC entries
const legacyStayCap = 500;
const legacyStays = [...stayMx, ...stayParis].slice(0, legacyStayCap);
const legacyEntries = [
  ...coreEntries,
  ...legacyStays.map((p) => urlEntry(`${ORIGIN}${p}`, "monthly", "0.7")),
];
writeUrlset("sitemap.xml", legacyEntries);

console.log(
  `Sitemaps: marketing=${marketingOnly.length + 3}, stays MX=${stayMx.length}, stays Paris=${stayParis.length}, index=${sitemapFiles.length} files`
);

// HTML sitemap for humans + crawl discovery
function routesByCity() {
  const groups = { hub: [], Paris: [], "Mexico City": [], stays: [] };
  const seen = new Set();
  for (const r of allMarketingRoutes()) {
    if (r.alias || seen.has(r.path) || r.path === "/sitemap") continue;
    seen.add(r.path);
    if (r.path.startsWith("/stays/")) groups.stays.push(r);
    else if (r.path === "/destinations") groups.hub.push(r);
    else if (r.city === "Paris") groups.Paris.push(r);
    else if (r.city === "Mexico City") groups["Mexico City"].push(r);
    else groups.hub.push(r);
  }
  return groups;
}

function linkList(routes, max = 200) {
  return routes
    .slice(0, max)
    .map((r) => `        <li><a href="__ORIGIN__${r.path}">${r.title}</a></li>`)
    .join("\n");
}

const g = routesByCity();
const htmlSitemap = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index,follow" />
  <title>Site Map — All TravelByVibe Destination Guides</title>
  <meta name="description" content="Complete list of TravelByVibe SEO destination guides: Paris and Mexico City hotel search, neighborhood guides, hotel stay pages, and visual room search." />
  <link rel="canonical" href="__ORIGIN__/sitemap" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="stylesheet" href="/marketing/marketing.css" />
</head>
<body>
  <header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="__ORIGIN__/">Open app →</a>
      </nav>
    </div>
  </header>
  <main class="wrap" style="max-width:var(--max-wide);padding-top:48px">
    <h1>Site map</h1>
    <p class="msec-lead">All indexable destination guides — neighborhood hubs, hotel picks, individual stay pages, comparisons, and visual search landing pages.</p>
    <section class="sitemap-sec">
      <h2>Hub pages</h2>
      <ul class="sitemap-list">
${linkList(g.hub)}
      </ul>
    </section>
    <section class="sitemap-sec">
      <h2>Paris guides</h2>
      <ul class="sitemap-list">
${linkList(g.Paris)}
      </ul>
    </section>
    <section class="sitemap-sec">
      <h2>Mexico City guides</h2>
      <ul class="sitemap-list">
${linkList(g["Mexico City"])}
      </ul>
    </section>
    <section class="sitemap-sec">
      <h2>Hotel stay pages (sample)</h2>
      <ul class="sitemap-list">
${linkList(g.stays, 40)}
      </ul>
      <p style="font-size:14px;margin-top:8px"><a href="__ORIGIN__/sitemap-stays-mexico-city.xml">All Mexico City stays (XML)</a> · <a href="__ORIGIN__/sitemap-stays-paris.xml">All Paris stays (XML)</a></p>
    </section>
    <p style="margin-top:32px"><a href="__ORIGIN__/sitemap-index.xml">Sitemap index (XML)</a></p>
  </main>
</body>
</html>
`;

const htmlOut = path.join(CLIENT, "marketing", "sitemap.html");
fs.writeFileSync(htmlOut, htmlSitemap, "utf8");
console.log(`Wrote ${htmlOut}`);
