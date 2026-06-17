#!/usr/bin/env node
/** Patch hand-maintained marketing pages with shared SEO (FAQ, footer, JSON-LD, keyword titles). */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { applySeoMeta } = require("./marketing-keywords");

const DIR = path.join(__dirname, "..", "client", "marketing");

function attrEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const STANDALONE = [
  { file: "mexico-city-hotels.html", canonical: "mexico-city-hotels" },
  { file: "mexico-city-visual-search.html", canonical: "mexico-city-visual-search" },
];

for (const p of STANDALONE) {
  const fp = path.join(DIR, p.file);
  let html = fs.readFileSync(fp, "utf8");
  const m = applySeoMeta({
    canonical: p.canonical,
    city: "Mexico City",
    pageCategory: "hub",
    faqs: seo.HUB_FAQS[p.canonical],
    title: "",
    desc: "",
  });

  html = html.replace(/<title>[^<]+<\/title>/, `<title>${m.title}</title>`);
  html = html.replace(/name="description" content="[^"]*"/, `name="description" content="${attrEsc(m.desc)}"`);
  html = html.replace(/property="og:title" content="[^"]*"/, `property="og:title" content="${attrEsc(m.title)}"`);
  html = html.replace(/property="og:description" content="[^"]*"/, `property="og:description" content="${attrEsc(m.desc)}"`);
  if (!html.includes('property="og:site_name"')) {
    html = html.replace(
      /<meta property="og:type" content="website" \/>/,
      `<meta property="og:type" content="website" />\n  <meta property="og:site_name" content="TravelByVibe" />`
    );
  }
  if (!html.includes('name="twitter:title"')) {
    html = html.replace(
      /<meta name="twitter:card" content="summary_large_image" \/>/,
      `<meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="${attrEsc(m.title)}" />\n  <meta name="twitter:description" content="${attrEsc(m.desc)}" />`
    );
  } else {
    html = html.replace(/name="twitter:title" content="[^"]*"/, `name="twitter:title" content="${attrEsc(m.title)}"`);
    html = html.replace(/name="twitter:description" content="[^"]*"/, `name="twitter:description" content="${attrEsc(m.desc)}"`);
  }

  html = html.replace(
    /(?:\s*<link rel="icon"[^>]*\/>\s*)+/,
    `\n${seo.FAVICON_HEAD}\n`
  );

  html = html.replace(
    /(<link rel="stylesheet" href="\/marketing\/marketing\.css" \/>)\s*(?:<script type="application\/ld\+json">[\s\S]*?<\/script>\s*)+/,
    `$1\n${seo.headJsonLd(m).trim()}\n`
  );

  if (m.faqs && !html.includes("faq-sec")) {
    html = html.replace(/(\s*)<\/main>/, `\n${seo.faqSection(m.faqs)}\n  </main>`);
  }

  html = html.replace(/<footer class="mfoot">[\s\S]*<\/html>/, seo.footer("Mexico City"));

  if (!html.includes('data-marketing-city="Mexico City"')) {
    html = html.replace("<body>", '<body data-marketing-city="Mexico City" data-marketing-campaign="cdmx_seo_2026">');
  }

  fs.writeFileSync(fp, html, "utf8");
  console.log("patched", p.file);
}
