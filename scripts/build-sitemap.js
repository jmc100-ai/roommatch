#!/usr/bin/env node
/**
 * Write client/sitemap.xml for crawlers (static, cache-friendly).
 * Run after adding marketing routes: node scripts/build-sitemap.js
 */
const fs = require("fs");
const path = require("path");

const ORIGIN = (
  process.env.SITE_PUBLIC_ORIGIN ||
  process.env.BETA_BASE_URL ||
  "https://www.travelbyvibe.com"
).replace(/\/$/, "");

const MARKETING_PATHS = [
  "/destinations",
  "/mexico-city-hotels",
  "/where-to-stay-in-mexico-city",
  "/mexico-city-neighborhood-guide",
  "/mexico-city-hotel-finder",
  "/cdmx-neighborhood-stays",
  "/hotels-in-condesa",
  "/hotels-in-roma-norte",
  "/hotels-in-polanco",
  "/hotels-in-juarez",
  "/hotels-in-centro-historico",
  "/condesa-vs-polanco",
  "/roma-norte-vs-condesa",
  "/juarez-vs-condesa",
  "/mexico-city-boutique-hotels",
  "/mexico-city-cafe-vibe-hotels",
  "/mexico-city-local-neighborhood-hotels",
  "/mexico-city-design-hotels",
  "/mexico-city-visual-search",
  "/paris-hotels",
  "/where-to-stay-in-paris",
  "/paris-neighborhood-stays",
  "/paris-neighborhood-guide",
  "/paris-hotel-finder",
  "/hotels-in-le-marais",
  "/hotels-in-saint-germain",
  "/hotels-in-montmartre",
  "/hotels-in-latin-quarter",
  "/hotels-in-opera",
  "/marais-vs-saint-germain",
  "/montmartre-vs-marais",
  "/latin-quarter-vs-saint-germain",
  "/paris-boutique-hotels",
  "/paris-luxury-hotels",
  "/paris-romantic-hotels",
  "/paris-classic-hotels",
  "/paris-visual-search",
];

const lastmod = new Date().toISOString().slice(0, 10);

function urlEntry(loc, changefreq, priority) {
  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

const urls = [
  ...MARKETING_PATHS.map((p) => urlEntry(`${ORIGIN}${p}`, "weekly", "0.85")),
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
console.log(`Wrote ${out} (${MARKETING_PATHS.length + 2} URLs, origin=${ORIGIN})`);
