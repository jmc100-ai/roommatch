#!/usr/bin/env node
/**
 * Audit marketing HTML: broken external images + internal link targets.
 * Usage: node scripts/audit-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARKETING_DIR = path.join(ROOT, "client", "marketing");

const { marketingHtmlMap, allMarketingRoutes } = require("./marketing-paths");

const MARKETING_ROUTES = new Set([
  "/",
  ...Object.keys(marketingHtmlMap()),
  "/sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap-marketing.xml",
  "/sitemap-stays-mexico-city.xml",
  "/sitemap-stays-paris.xml",
  "/privacy",
  "/terms",
]);

const STATIC_ASSETS = new Set([
  "/marketing/marketing.css",
  "/marketing/marketing-hotels.js",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-48.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/site.webmanifest",
]);

const SKIP_LINK_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "commons.wikimedia.org",
  "unsplash.com",
  "unsplash.com/license",
  "liteapi.travel",
  "schema.org",
]);

/** Hotel / partner CDNs — hotlinked at build time; skip slow per-URL HEAD in bulk audits. */
const SKIP_IMAGE_HOSTS = new Set([
  "api.liteapi.travel",
  "static.cupid.travel",
  "cupid.travel",
  "nuitee.link",
  "photos.hotelbeds.com",
  "images.unsplash.com",
  "live.staticflickr.com",
]);

function decodeLoose(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function normFile(s) {
  return decodeLoose(s).replace(/ /g, "_").toLowerCase();
}

function extractImageUrls(html) {
  const urls = new Set();
  const patterns = [
    /(?:src|content)=["'](https?:\/\/[^"']+)["']/gi,
    /background-image:\s*url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi,
    /url\(['"]?(https?:\/\/upload\.wikimedia\.org[^'")]+)['"]?\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) urls.add(m[1].replace(/&amp;/g, "&"));
  }
  return [...urls];
}

function extractHrefs(html) {
  const hrefs = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) hrefs.add(m[1]);
  return [...hrefs];
}

function wikimediaMismatch(url) {
  const m = url.match(
    /\/commons\/thumb\/([^/]+\/[^/]+)\/([^/]+)\/(\d+px-)([^/?#]+)/
  );
  if (!m) return null;
  const [, , fileInPath, , fileInWidth] = m;
  if (normFile(fileInPath) !== normFile(fileInWidth)) {
    return { fileInPath, fileInWidth };
  }
  return null;
}

function resolveInternalHref(href) {
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return { ok: true };
  if (href.startsWith("/marketing/") || href === "/favicon.svg" || STATIC_ASSETS.has(href)) {
    return { ok: STATIC_ASSETS.has(href) || href.startsWith("/marketing/"), reason: "static asset" };
  }
  let pathOnly = href.replace(/^__ORIGIN__/, "").split("?")[0].split("#")[0];
  if (!pathOnly.startsWith("/")) pathOnly = `/${pathOnly}`;
  if (pathOnly !== "/" && pathOnly.endsWith("/")) pathOnly = pathOnly.slice(0, -1);
  if (pathOnly.startsWith("/hotel/")) return { ok: true };
  if (pathOnly.startsWith("/stays/")) return { ok: MARKETING_ROUTES.has(pathOnly) };
  if (MARKETING_ROUTES.has(pathOnly)) return { ok: true };
  return { ok: false, pathOnly };
}

async function headOk(url, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15000);
      const r = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ac.signal,
        headers: {
          "User-Agent": "TravelByVibe-MarketingAudit/1.0",
          Range: "bytes=0-0",
        },
      });
      clearTimeout(timer);
      if (r.status === 200 || r.status === 206) return 200;
      if (r.status === 405 || r.status === 403) {
        const ac2 = new AbortController();
        const t2 = setTimeout(() => ac2.abort(), 15000);
        const g = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: ac2.signal,
          headers: { "User-Agent": "TravelByVibe-MarketingAudit/1.0" },
        });
        clearTimeout(t2);
        if (g.status === 200) return 200;
      }
      if (r.status === 429 && i < retries) {
        await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
        continue;
      }
      return r.status;
    } catch (e) {
      if (i === retries) return `ERR:${e.message}`;
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  return 0;
}

const _imageStatusCache = new Map();

async function imageStatus(url) {
  if (_imageStatusCache.has(url)) return _imageStatusCache.get(url);
  const status = await headOk(url);
  _imageStatusCache.set(url, status);
  if (url.includes("wikimedia.org")) {
    await new Promise((res) => setTimeout(res, 120));
  }
  return status;
}

async function auditFile(rel, imageResults) {
  const fp = path.join(MARKETING_DIR, rel);
  const html = fs.readFileSync(fp, "utf8");
  const issues = [];

  for (const url of extractImageUrls(html)) {
    const mismatch = wikimediaMismatch(url);
    if (mismatch) {
      issues.push({
        type: "image-mismatch",
        url,
        detail: `${mismatch.fileInPath} vs ${mismatch.fileInWidth}`,
      });
    }
    let skipHttp = false;
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (SKIP_IMAGE_HOSTS.has(host) || [...SKIP_IMAGE_HOSTS].some((h) => host.endsWith(h))) skipHttp = true;
    } catch {
      skipHttp = true;
    }
    if (skipHttp) continue;
    const status = imageResults.get(url);
    if (status !== 200 && status !== 429) {
      issues.push({ type: "image-http", url, status });
    }
  }

  const localImgRe = /(?:src|background-image:\s*url\(['"]?)(\/images\/[^'")\s]+)/gi;
  let lm;
  while ((lm = localImgRe.exec(html)) !== null) {
    const rel = lm[1];
    const disk = path.join(ROOT, "client", rel.replace(/^\//, "").replace(/\//g, path.sep));
    if (!fs.existsSync(disk)) {
      issues.push({ type: "image-local-missing", path: rel });
    }
  }

  for (const href of extractHrefs(html)) {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      try {
        const u = new URL(href);
        if (SKIP_LINK_HOSTS.has(u.hostname) || u.pathname === "/license") continue;
        const status = await headOk(href);
        if (status !== 200 && status !== 301 && status !== 302) {
          issues.push({ type: "link-http", href, status });
        }
      } catch {
        issues.push({ type: "link-parse", href });
      }
      continue;
    }
    const r = resolveInternalHref(href);
    if (!r.ok) issues.push({ type: "link-internal", href, pathOnly: r.pathOnly });
  }

  return issues;
}

async function main() {
  console.log("Marketing audit starting…");
  const files = [];
  function walk(dir, prefix = "") {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      if (fs.statSync(fp).isDirectory()) walk(fp, prefix ? `${prefix}/${name}` : name);
      else if (name.endsWith(".html")) files.push(prefix ? `${prefix}/${name}` : name);
    }
  }
  walk(MARKETING_DIR);
  const urlFiles = new Map();
  for (const f of files) {
    const html = fs.readFileSync(path.join(MARKETING_DIR, f), "utf8");
    for (const url of extractImageUrls(html)) {
      if (!urlFiles.has(url)) urlFiles.set(url, []);
      urlFiles.get(url).push(f);
    }
  }
  const imageResults = new Map();
  for (const url of [...urlFiles.keys()].sort()) {
    let skip = false;
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (SKIP_IMAGE_HOSTS.has(host) || [...SKIP_IMAGE_HOSTS].some((h) => host.endsWith(h))) skip = true;
    } catch {
      skip = true;
    }
    if (skip) {
      imageResults.set(url, 200);
      continue;
    }
    imageResults.set(url, await imageStatus(url));
  }
  console.log(`Preflight: ${urlFiles.size} unique image URLs checked`);

  const all = [];
  for (const f of files.sort()) {
    const issues = await auditFile(f, imageResults);
    if (issues.length) {
      console.log(`\n## ${f} (${issues.length} issues)`);
      for (const i of issues) console.log(JSON.stringify(i));
      all.push({ file: f, issues });
    } else {
      console.log(`OK ${f}`);
    }
  }
  console.log(`\n---\n${files.length} pages, ${all.length} with issues, ${all.reduce((n, x) => n + x.issues.length, 0)} total issues`);
  process.exit(all.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
