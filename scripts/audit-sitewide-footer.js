#!/usr/bin/env node
/**
 * Pre/post check for sitewide destination footers — HTML structure, route targets, no duplicates.
 * Usage: node scripts/audit-sitewide-footer.js [--strict]
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { marketingHtmlMap } = require("./marketing-paths");

const ROOT = path.join(__dirname, "..");
const MARKETING_DIR = path.join(ROOT, "client", "marketing");
const INDEX = path.join(ROOT, "client", "index.html");
const STRICT = process.argv.includes("--strict");

const DEST_LINKS = [
  { href: "/mexico-city-hotels", label: "Mexico City hotels" },
  { href: "/paris-hotels", label: "Paris hotels" },
  { href: "/destinations", label: "All guides" },
];

const MARKETING_ROUTES = new Set(["/", ...Object.keys(marketingHtmlMap())]);

let failures = 0;

function fail(msg) {
  failures += 1;
  console.error("FAIL:", msg);
}

function ok(msg) {
  console.log("OK:", msg);
}

function checkRoutes() {
  for (const { href } of DEST_LINKS) {
    if (!MARKETING_ROUTES.has(href)) fail(`route missing from marketing-paths: ${href}`);
    else ok(`route registered: ${href}`);
  }
}

function checkMarketingSeoFooter() {
  const paris = seo.footer("Paris");
  const cdmx = seo.footer("Mexico City");
  const hub = seo.footer(null);
  for (const [name, html] of [
    ["Paris", paris],
    ["Mexico City", cdmx],
    ["hub", hub],
  ]) {
    const opens = (html.match(/<footer class="mfoot">/g) || []).length;
    const closes = (html.match(/<\/footer>/g) || []).length;
    if (opens !== 1 || closes !== 1) fail(`${name} footer(): expected 1 footer tag, got ${opens}/${closes}`);
    else ok(`${name} footer(): single footer element`);

    for (const { href, label } of DEST_LINKS) {
      const needle = `href="__ORIGIN__${href}"`;
      if (!html.includes(needle)) fail(`${name} footer() missing ${needle}`);
      if (!html.includes(label)) fail(`${name} footer() missing anchor text "${label}"`);
    }
    if (!html.includes("/marketing/marketing.js")) ok(`${name} footer(): marketing.js script present`);
    else if (!html.includes('src="/marketing/marketing.js"')) fail(`${name} footer(): broken script tag`);
  }
}

function checkMarketingHtmlFiles() {
  const files = fs.readdirSync(MARKETING_DIR).filter((f) => f.endsWith(".html"));
  for (const f of files) {
    const html = fs.readFileSync(path.join(MARKETING_DIR, f), "utf8");
    const mfootCount = (html.match(/<footer class="mfoot">/g) || []).length;
    if (mfootCount !== 1) {
      fail(`${f}: expected 1 mfoot, found ${mfootCount}`);
      continue;
    }
    if (!html.includes("</footer>")) {
      fail(`${f}: missing </footer>`);
      continue;
    }
    if (html.includes("<footer") && html.indexOf("</html>") < html.lastIndexOf("</footer>")) {
      fail(`${f}: footer appears after </html>`);
    }
    const hasDest = DEST_LINKS.every(({ href }) => html.includes(`__ORIGIN__${href}`) || html.includes(`href="${href}"`));
    if (!hasDest && f !== "destinations.html" && f !== "sitemap.html") {
      // generated pages should get destinations row after regen
      if (STRICT) fail(`${f}: missing destination footer links (run generators)`);
    }
  }
  ok(`scanned ${files.length} marketing HTML files for footer structure`);
}

function checkIndexHtml() {
  const html = fs.readFileSync(INDEX, "utf8");
  const siteFooter = html.includes('id="site-footer"');
  const resultsFooter = (html.match(/<footer>/g) || []).length;
  if (!html.includes('href="/privacy"')) fail("index.html: missing /privacy link");
  if (!html.includes('href="/terms"')) fail("index.html: missing /terms link");
  for (const { href, label } of DEST_LINKS) {
    if (!html.includes(`href="${href}"`)) fail(`index.html: missing ${href}`);
    if (!html.includes(label)) fail(`index.html: missing "${label}"`);
  }
  if (!siteFooter) fail('index.html: missing #site-footer');
  if (resultsFooter < 1) fail("index.html: missing results <footer>");
  ok("index.html: footer links and structure");
}

function main() {
  console.log("Sitewide footer audit" + (STRICT ? " (strict)" : "") + "\n");
  checkRoutes();
  checkMarketingSeoFooter();
  checkMarketingHtmlFiles();
  checkIndexHtml();
  console.log(`\n---\n${failures ? failures + " failure(s)" : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
}

main();
