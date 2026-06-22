#!/usr/bin/env node
/** Audit "where to stay" phrase coverage across marketing HTML. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "client", "marketing");
const PHRASE = /where\s+to\s+stay/i;
const BODY_PHRASE = /where\s+to\s+stay/gi;
const SLUG = /where-to-stay/gi;
const BEST_AREA = /best\s+area\s+to\s+stay/gi;

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const fp = path.join(dir, n);
    if (fs.statSync(fp).isDirectory()) walk(fp, out);
    else if (n.endsWith(".html")) out.push(fp);
  }
  return out;
}

function extract(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const desc = (html.match(/name="description" content="([^"]*)"/i) || [])[1] || "";
  const h1 = (html.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1] || "";
  const h2s = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/gi)].map((m) => m[1]);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  return { title, desc, h1, h2s, body };
}

function count(text, re) {
  return (text.match(re) || []).length;
}

function cityFromRel(rel) {
  if (/london|westminster|covent|shoreditch|marylebone|kensington|notting|soho|paddington|heathrow|canary|king-s-cross|south-bank/i.test(rel))
    return "London";
  if (/paris|marais|montmartre|saint-germain|latin-quarter|opera|eiffel|canal-saint-martin/i.test(rel))
    return "Paris";
  if (/mexico|cdmx|condesa|polanco|roma-norte|juarez|coyoacan|reforma|chapultepec|aeropuerto|santa-fe|san-rafael/i.test(rel))
    return "Mexico City";
  if (rel === "destinations.html" || rel === "sitemap.html") return "Global";
  return "Other";
}

const hubFiles = new Set([
  "where-to-stay-in-london.html",
  "where-to-stay-in-paris.html",
  "where-to-stay-in-mexico-city.html",
]);

const cityHubFiles = new Set(["london-hotels.html", "paris-hotels.html", "mexico-city-hotels.html"]);

const files = walk(ROOT);
const byCity = {};
const missing = [];
const hubDetail = {};
const cityHubDetail = {};
const ranked = [];

for (const fp of files) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
  const base = path.basename(rel);
  const html = fs.readFileSync(fp, "utf8");
  const { title, desc, h1, h2s, body } = extract(html);
  const city = cityFromRel(rel);

  if (!byCity[city])
    byCity[city] = { files: 0, withPhrase: 0, title: 0, desc: 0, h1: 0, h2: 0, bodyTotal: 0, slug: 0, bestArea: 0 };

  const c = byCity[city];
  c.files++;
  const inTitle = PHRASE.test(title);
  const inDesc = PHRASE.test(desc);
  const inH1 = PHRASE.test(h1);
  const h2Hits = h2s.filter((h) => PHRASE.test(h)).length;
  const bodyCount = count(body, BODY_PHRASE);
  const slugCount = count(html, SLUG);
  const bestAreaCount = count(body + title + desc + h1, BEST_AREA);
  const any = inTitle || inDesc || inH1 || h2Hits > 0 || bodyCount > 0 || slugCount > 0;

  if (any) c.withPhrase++;
  if (inTitle) c.title++;
  if (inDesc) c.desc++;
  if (inH1) c.h1++;
  c.h2 += h2Hits;
  c.bodyTotal += bodyCount;
  c.slug += slugCount;
  c.bestArea += bestAreaCount;

  ranked.push({ rel, bodyCount, title: title.slice(0, 60) });

  if (hubFiles.has(base)) {
    hubDetail[base] = { title, desc, h1, bodyCount, slugCount, inTitle, inDesc, inH1, h2Hits };
  }
  if (cityHubFiles.has(base)) {
    cityHubDetail[base] = { title, desc, h1, bodyCount, slugCount, inTitle, inDesc, inH1, bestAreaCount };
  }

  if (!any && !rel.startsWith("stays/")) missing.push(rel);
}

console.log("=== CANONICAL HUB: /where-to-stay-in-{city} ===");
for (const f of ["where-to-stay-in-london.html", "where-to-stay-in-paris.html", "where-to-stay-in-mexico-city.html"]) {
  const d = hubDetail[f];
  if (!d) continue;
  console.log(f);
  console.log(`  title: ${d.inTitle ? "YES" : "NO"} | meta: ${d.inDesc ? "YES" : "NO"} | h1: ${d.inH1 ? "YES" : "NO"}`);
  console.log(`  body "where to stay": ${d.bodyCount} | slug/link refs: ${d.slugCount} | h2 with phrase: ${d.h2Hits}`);
}

console.log("\n=== MAIN CITY HUB: /{city}-hotels (high-traffic entry) ===");
for (const f of ["london-hotels.html", "paris-hotels.html", "mexico-city-hotels.html"]) {
  const d = cityHubDetail[f];
  if (!d) continue;
  console.log(f);
  console.log(`  title: ${d.inTitle ? "YES" : "NO"} — "${d.title.slice(0, 65)}"`);
  console.log(`  meta: ${d.inDesc ? "YES" : "NO"} — starts: "${d.desc.slice(0, 55)}..."`);
  console.log(`  h1: ${d.inH1 ? "YES" : "NO"} — "${d.h1}"`);
  console.log(`  body "where to stay": ${d.bodyCount} | "best area to stay": ${d.bestAreaCount} | slug refs: ${d.slugCount}`);
}

console.log("\n=== COVERAGE BY CITY (all marketing HTML) ===");
for (const [city, s] of Object.entries(byCity).sort()) {
  const pct = ((s.withPhrase / s.files) * 100).toFixed(0);
  console.log(`${city}: ${s.withPhrase}/${s.files} pages (${pct}%) mention phrase or slug`);
  console.log(`  title:${s.title} meta:${s.desc} h1:${s.h1} h2:${s.h2} bodyHits:${s.bodyTotal} slug:${s.slug} bestArea:${s.bestArea}`);
}

console.log("\n=== TOP 12 BY BODY PHRASE COUNT ===");
ranked
  .sort((a, b) => b.bodyCount - a.bodyCount)
  .slice(0, 12)
  .forEach((r) => console.log(`  ${r.bodyCount}x  ${r.rel}`));

console.log("\n=== PAGES WITH ZERO PHRASE (excl /stays/) ===");
console.log(`count: ${missing.length}`);
missing.forEach((m) => console.log(`  ${m}`));
