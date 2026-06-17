#!/usr/bin/env node
/** Raster favicons for Google Search + browsers. Run after editing client/favicon.svg */
const fs = require("fs");
const path = require("path");

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("Install sharp first: npm install --save-dev sharp");
  process.exit(1);
}

const OUT = path.join(__dirname, "..", "client");
const svg = fs.readFileSync(path.join(OUT, "favicon.svg"));

async function writePng(size, name) {
  const out = path.join(OUT, name);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log("wrote", name, `${size}x${size}`);
}

async function main() {
  await writePng(48, "favicon-48.png");
  await writePng(32, "favicon-32.png");
  await writePng(192, "favicon-192.png");
  await writePng(180, "apple-touch-icon.png");
  // Google Search prefers /favicon.ico; include 16+32+48 for crisp tabs/bookmarks.
  await sharp(svg)
    .resize(48, 48)
    .toFile(path.join(OUT, "favicon.ico"));
  console.log("wrote favicon.ico");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
