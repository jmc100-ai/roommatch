#!/usr/bin/env node
/**
 * Deduped image URL audit with Wikimedia-friendly pacing.
 * Usage: node scripts/audit-images-only.js
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "client", "marketing");

function extractImageUrls(html) {
  const urls = new Set();
  const patterns = [
    /(?:src|content)=["'](https?:\/\/[^"']+)["']/gi,
    /background-image:\s*url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) urls.add(m[1].replace(/&amp;/g, "&"));
  }
  return [...urls];
}

function wikimediaMismatch(url) {
  const m = url.match(
    /\/commons\/thumb\/([^/]+\/[^/]+)\/([^/]+)\/(\d+px-)([^/?#]+)/
  );
  if (!m) return null;
  const [, , fileInPath, , fileInWidth] = m;
  const norm = (s) => decodeURIComponent(s).replace(/ /g, "_").toLowerCase();
  if (norm(fileInPath) !== norm(fileInWidth)) {
    return { fileInPath, fileInWidth };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "TravelByVibe-MarketingAudit/1.0",
          Range: "bytes=0-0",
        },
      });
      if (r.status === 200 || r.status === 206) return r.status;
      if (r.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      return r.status;
    } catch (e) {
      if (i === 3) return `ERR:${e.message}`;
      await sleep(1000);
    }
  }
  return 429;
}

async function main() {
  const byUrl = new Map();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const url of extractImageUrls(html)) {
      if (!byUrl.has(url)) byUrl.set(url, { files: [], mismatch: wikimediaMismatch(url) });
      byUrl.get(url).files.push(f);
    }
  }

  const bad = [];
  let n = 0;
  for (const [url, meta] of [...byUrl.entries()].sort()) {
    n++;
    if (meta.mismatch) {
      bad.push({ type: "mismatch", url, ...meta.mismatch, files: meta.files });
    }
    const st = await check(url);
    if (st !== 200 && st !== 206) {
      bad.push({ type: "http", status: st, url, files: meta.files });
    }
    if (url.includes("wikimedia.org")) await sleep(350);
    else if (n % 15 === 0) await sleep(200);
  }

  console.log(`Checked ${byUrl.size} unique image URLs across marketing pages`);
  if (!bad.length) {
    console.log("All images OK");
    process.exit(0);
  }
  console.log(`${bad.length} issue(s):`);
  for (const b of bad) console.log(JSON.stringify(b));
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
