#!/usr/bin/env node
/** Patch hand-maintained marketing pages with shared SEO (FAQ, footer, JSON-LD). */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");

const DIR = path.join(__dirname, "..", "client", "marketing");

const STANDALONE = [
  { file: "mexico-city-hotels.html", canonical: "mexico-city-hotels" },
  { file: "mexico-city-visual-search.html", canonical: "mexico-city-visual-search" },
];

for (const p of STANDALONE) {
  const fp = path.join(DIR, p.file);
  let html = fs.readFileSync(fp, "utf8");
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
  const desc = (html.match(/name="description" content="([^"]+)"/) || [])[1] || "";
  const meta = {
    title,
    desc,
    canonical: p.canonical,
    city: "Mexico City",
    pageCategory: "hub",
    faqs: seo.HUB_FAQS[p.canonical],
  };

  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    seo.headJsonLd(meta).trim()
  );

  if (meta.faqs && !html.includes("faq-sec")) {
    html = html.replace(/(\s*)<\/main>/, `\n${seo.faqSection(meta.faqs)}\n  </main>`);
  }

  html = html.replace(/<footer class="mfoot">[\s\S]*<\/html>/, seo.footer("Mexico City"));

  if (!html.includes('data-marketing-city="Mexico City"')) {
    html = html.replace("<body>", '<body data-marketing-city="Mexico City" data-marketing-campaign="cdmx_seo_2026">');
  }

  fs.writeFileSync(fp, html, "utf8");
  console.log("patched", p.file);
}
