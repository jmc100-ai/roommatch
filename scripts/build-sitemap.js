#!/usr/bin/env node
/**
 * Write client/sitemap.xml and client/marketing/sitemap.html for crawlers.
 * Run after adding marketing routes: node scripts/build-sitemap.js
 */
const fs = require("fs");
const path = require("path");
const { sitemapPaths, MARKETING_ROUTES } = require("./marketing-paths");

const ORIGIN = (
  process.env.SITE_PUBLIC_ORIGIN ||
  process.env.BETA_BASE_URL ||
  "https://www.travelbyvibe.com"
).replace(/\/$/, "");

const MARKETING_PATHS = sitemapPaths();

const lastmod = new Date().toISOString().slice(0, 10);

function urlEntry(loc, changefreq, priority) {
  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

const urls = [
  urlEntry(`${ORIGIN}/`, "weekly", "1.0"),
  ...MARKETING_PATHS.map((p) => urlEntry(`${ORIGIN}${p}`, "weekly", p === "/sitemap" ? "0.5" : "0.85")),
  urlEntry(`${ORIGIN}/privacy`, "monthly", "0.4"),
  urlEntry(`${ORIGIN}/terms`, "monthly", "0.4"),
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

const out = path.join(__dirname, "..", "client", "sitemap.xml");
fs.writeFileSync(out, xml, "utf8");
console.log(`Wrote ${out} (${MARKETING_PATHS.length + 3} URLs, origin=${ORIGIN})`);

// HTML sitemap for humans + crawl discovery
function routesByCity() {
  const groups = { hub: [], Paris: [], "Mexico City": [] };
  const seen = new Set();
  for (const r of MARKETING_ROUTES) {
    if (r.alias || seen.has(r.path) || r.path === "/sitemap") continue;
    seen.add(r.path);
    if (r.path === "/destinations") groups.hub.push(r);
    else if (r.city === "Paris") groups.Paris.push(r);
    else if (r.city === "Mexico City") groups["Mexico City"].push(r);
    else groups.hub.push(r);
  }
  return groups;
}

function linkList(routes) {
  return routes
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
  <meta name="description" content="Complete list of TravelByVibe SEO destination guides: Paris and Mexico City hotel search, neighbourhood guides, comparisons, and visual room search." />
  <link rel="canonical" href="__ORIGIN__/sitemap" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/png" href="/favicon-48.png" sizes="48x48" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&amp;family=DM+Sans:wght@400;500&amp;display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/marketing/marketing.css" />
</head>
<body>
  <header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
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
    <p class="msec-lead">All indexable destination guides — neighbourhood hubs, hotel picks, comparisons, and visual search landing pages.</p>
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
      <h2>Legal</h2>
      <ul class="sitemap-list">
        <li><a href="__ORIGIN__/privacy">Privacy policy</a></li>
        <li><a href="__ORIGIN__/terms">Terms of use</a></li>
      </ul>
    </section>
    <p style="margin-top:32px"><a href="__ORIGIN__/sitemap.xml">XML sitemap</a> for search engines</p>
  </main>
  <footer class="mfoot">
    <p>TravelByVibe · <a href="__ORIGIN__/">travelbyvibe.com</a> · <a href="__ORIGIN__/destinations">Destinations</a></p>
  </footer>
</body>
</html>
`;

const htmlOut = path.join(__dirname, "..", "client", "marketing", "sitemap.html");
fs.writeFileSync(htmlOut, htmlSitemap, "utf8");
console.log(`Wrote ${htmlOut}`);
