#!/usr/bin/env node
/**
 * Audit marketing HTML: broken external images + internal link targets.
 * Usage: node scripts/audit-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARKETING_DIR = path.join(ROOT, "client", "marketing");

const { marketingHtmlMap } = require("./marketing-paths");

const MARKETING_ROUTES = new Set([
  "/",
  ...Object.keys(marketingHtmlMap()),
  "/sitemap.xml",
  "/privacy",
  "/terms",
]);

const STATIC_ASSETS = new Set([
  "/marketing/marketing.css",
  "/marketing/marketing-hotels.js",
  "/favicon.svg",
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
  if (href.startsWith("/marketing/") || href === "/favicon.svg") {
    return { ok: STATIC_ASSETS.has(href), reason: "static asset" };
  }
  let pathOnly = href.replace(/^__ORIGIN__/, "").split("?")[0].split("#")[0];
  if (!pathOnly.startsWith("/")) pathOnly = `/${pathOnly}`;
  if (pathOnly !== "/" && pathOnly.endsWith("/")) pathOnly = pathOnly.slice(0, -1);
  if (MARKETING_ROUTES.has(pathOnly)) return { ok: true };
  return { ok: false, pathOnly };
}

async function headOk(url, retries = 3) {
  const isWiki = url.includes("wikimedia.org");
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "TravelByVibe-MarketingAudit/1.0",
          Range: "bytes=0-0",
        },
      });
      if (r.status === 200 || r.status === 206) return 200;
      if (r.status === 405 || r.status === 403) {
        const g = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "TravelByVibe-MarketingAudit/1.0" },
        });
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
    await new Promise((res) => setTimeout(res, 350));
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
    const status = imageResults.get(url);
    if (status !== 200) {
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
  const files = fs.readdirSync(MARKETING_DIR).filter((f) => f.endsWith(".html"));
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
