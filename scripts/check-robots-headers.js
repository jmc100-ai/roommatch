#!/usr/bin/env node
const urls = [
  "https://www.travelbyvibe.com/",
  "https://www.travelbyvibe.com/paris-visual-search",
  "https://www.travelbyvibe.com/destinations",
];
(async () => {
  for (const url of urls) {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Googlebot/2.1" } });
    const html = await r.text();
    const meta = html.match(/name="robots" content="([^"]+)"/);
    console.log(url);
    console.log("  status:", r.status);
    console.log("  X-Robots-Tag:", r.headers.get("x-robots-tag") || "(none)");
    console.log("  meta robots:", meta ? meta[1] : "(none)");
    console.log("  title:", (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "(none)");
    console.log("");
  }
})();
