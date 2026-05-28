#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "client/marketing/city-marketing-images.json"), "utf8")
);
const banned = new Set(catalog.bannedUnsplashIds || []);
const files = fs
  .readdirSync(path.join(__dirname, "..", "client/marketing"))
  .filter((f) => f.endsWith(".html"));
const re = /https:\/\/(?:images\.unsplash|upload\.wikimedia)[^"')&]+/g;

(async () => {
  let bad = 0;
  for (const f of files) {
    const t = fs.readFileSync(path.join(__dirname, "..", "client/marketing", f), "utf8").replace(/&amp;/g, "&");
    for (const m of t.matchAll(re)) {
      const u = m[0];
      const id = u.match(/photo-([^?]+)/)?.[1];
      if (id && banned.has(id)) {
        console.log("BANNED", f, id);
        bad++;
      }
    }
  }
  for (const u of [...new Set(files.flatMap((f) => {
    const t = fs.readFileSync(path.join(__dirname, "..", "client/marketing", f), "utf8");
    return [...t.matchAll(re)].map((m) => m[0].replace(/&amp;/g, "&"));
  }))]) {
    await new Promise((r) => setTimeout(r, 400));
    const st = (await fetch(u, { headers: { "User-Agent": "RoomMatch/1.0" } })).status;
    if (st < 200 || st >= 400) {
      console.log("HTTP", st, u.slice(0, 90));
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
})();
