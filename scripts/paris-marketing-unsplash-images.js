#!/usr/bin/env node
/**
 * Replace broken/guesswork Wikimedia thumb URLs on Paris marketing pages with
 * verified Unsplash hotlinks (same pattern as mexico-city-hotels.html).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [
  "client/marketing/paris-hotels.html",
  "client/marketing/paris-neighborhood-stays.html",
  "client/marketing/paris-visual-search.html",
  "client/marketing/destinations.html",
];

const IDS = {
  eiffel: "1511739001486-6bfe10ce785f",
  street: "1619872978981-e9885a014ba3",
  travel: "1521216774850-01bc1c5fe0da",
  skyline: "1477959858617-67f85cf4f1df",
};

function unsplash(id, w) {
  return `https://images.unsplash.com/photo-${id}?auto=format&amp;fit=crop&amp;w=${w}&amp;q=82`;
}

function pickId(wikiUrl) {
  const u = decodeURIComponent(wikiUrl);
  if (/Eiffel|Seine_and_Eiffel|Tour_Eiffel/i.test(u)) return IDS.eiffel;
  if (/Louvre|Tuileries|Notre-Dame/i.test(u)) return IDS.travel;
  if (/Marais|Mouffetard|metro_sign/i.test(u)) return IDS.street;
  if (/Montmartre|Sacr/i.test(u)) return IDS.eiffel;
  if (/Champs|Palais_Garnier|Pont_des_Arts/i.test(u)) return IDS.skyline;
  return IDS.eiffel;
}

function widthFromWiki(wikiUrl) {
  const m = wikiUrl.match(/\/(\d+)px-/);
  return m ? Math.min(Number(m[1]), 2000) : 960;
}

function replaceWiki(html) {
  return html.replace(
    /https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^"')&]+/g,
    (wiki) => unsplash(pickId(wiki), widthFromWiki(wiki))
  );
}

function fixCredits(html) {
  return html
    .replace(
      /Paris photos from <a href="https:\/\/commons\.wikimedia\.org"[^<]+<\/a>[^<]*\./,
      'Paris photos via <a href="https://unsplash.com" rel="noopener">Unsplash</a> (see unsplash.com/license).'
    )
    .replace(
      /Photography from <a href="https:\/\/commons\.wikimedia\.org\/"[^]+?partner properties\./,
      "Photography via <a href=\"https://unsplash.com\" rel=\"noopener\">Unsplash</a> and Wikimedia Commons where noted; marketing images are illustrative."
    );
}

for (const rel of files) {
  const fp = path.join(root, rel);
  let html = fs.readFileSync(fp, "utf8");
  const before = (html.match(/upload\.wikimedia/g) || []).length;
  html = replaceWiki(html);
  if (rel.startsWith("client/marketing/paris")) html = fixCredits(html);
  const after = (html.match(/upload\.wikimedia/g) || []).length;
  fs.writeFileSync(fp, html);
  console.log(rel, "wikimedia:", before, "→", after);
}
