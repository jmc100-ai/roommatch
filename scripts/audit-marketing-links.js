#!/usr/bin/env node
/** Fast internal route validation for all marketing HTML (no external HEAD). */
const fs = require("fs");
const path = require("path");
const { marketingHtmlMap } = require("./marketing-paths");

const ROOT = path.join(__dirname, "..", "client", "marketing");
const ROUTES = new Set([
  "/",
  "/privacy",
  "/terms",
  "/sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap-marketing.xml",
  "/sitemap-stays-mexico-city.xml",
  "/sitemap-stays-paris.xml",
  ...Object.keys(marketingHtmlMap()),
]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isDirectory()) walk(fp, out);
    else if (name.endsWith(".html")) out.push(fp);
  }
  return out;
}

function checkFile(fp) {
  const html = fs.readFileSync(fp, "utf8");
  const issues = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) continue;
    let p = href.replace(/^__ORIGIN__/, "").split("?")[0].split("#")[0];
    if (!p.startsWith("/")) p = `/${p}`;
    if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
    if (p.startsWith("/hotel/")) continue;
    if (p.startsWith("/marketing/") || p.startsWith("/favicon") || p === "/site.webmanifest" || p === "/apple-touch-icon.png") continue;
    if (!ROUTES.has(p)) issues.push({ href, path: p });
  }
  return issues;
}

const files = walk(ROOT);
let bad = 0;
for (const fp of files) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, "/");
  const issues = checkFile(fp);
  if (issues.length) {
    bad++;
    console.log(rel, issues.slice(0, 3));
  }
}
console.log(`\n${files.length} files, ${bad} with broken internal links`);
process.exit(bad ? 1 : 0);
