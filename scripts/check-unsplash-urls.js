#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const files = [
  "client/app.js",
  "client/marketing/mexico-city-hotels.html",
  "scripts/neighborhood-vibe-data.js",
];
let text = "";
for (const f of files) text += fs.readFileSync(path.join(root, f), "utf8");
const urls = [...new Set(text.match(/https:\/\/images\.unsplash\.com\/photo-[^"'?]+/g) || [])];

async function check(url) {
  const u = url.includes("?") ? url : `${url}?w=200&q=80`;
  const r = await fetch(u, { method: "HEAD", redirect: "follow" });
  return r.ok;
}

(async () => {
  const ok = [];
  for (const url of urls) {
    if (await check(url)) ok.push(url);
    await new Promise((x) => setTimeout(x, 40));
  }
  console.log(JSON.stringify(ok, null, 2));
})();
