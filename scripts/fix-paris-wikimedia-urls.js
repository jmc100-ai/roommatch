#!/usr/env node
/** One-shot: print search/replace pairs for Paris marketing Wikimedia thumbs (wrong MD5 dirs). */
const crypto = require("crypto");

const REPLACEMENTS = [
  ["0/0e/Montmartre_-_Sacr%C3%A9-C%C5%93ur_01.jpg", "d/d1/Montmartre_-_Sacr%C3%A9-C%C5%93ur_01.jpg"],
  ["0/0f/Notre-Dame_de_Paris%2C_4_October_2017.jpg", "f/f7/Notre-Dame_de_Paris%2C_4_October_2017.jpg"],
  ["1/1a/Paris_-_Pont_des_Arts_-_2016.jpg", "5/5a/Paris_-_Pont_des_Arts_-_2016.jpg"],
  ["4/4b/Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg", "9/96/Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg"],
  ["5/5a/Paris_metro_sign.jpg", "8/8b/Paris_metro_sign.jpg"],
  ["8/85/Paris_metro_sign.jpg", "8/8b/Paris_metro_sign.jpg"],
  ["6/6e/Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg", "8/8e/Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg"],
  ["7/7a/Le_Marais%2C_Paris%2C_France_-_panoramio.jpg", "3/39/Le_Marais%2C_Paris%2C_France_-_panoramio.jpg"],
  ["8/81/Palais_Garnier%2C_Paris_16_March_2014.jpg", "8/86/Palais_Garnier%2C_Paris_16_March_2014.jpg"],
  ["8/85/Paris_-_Rue_Mouffetard_-_2016.jpg", "4/4a/Paris_-_Rue_Mouffetard_-_2016.jpg"],
  ["9/9d/View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg", "c/c7/View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg"],
  ["a/a8/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg", "8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg"],
];

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const files = [
  "client/marketing/paris-hotels.html",
  "client/marketing/paris-neighborhood-stays.html",
  "client/marketing/paris-visual-search.html",
  "client/marketing/destinations.html",
];

for (const rel of files) {
  const fp = path.join(root, rel);
  let html = fs.readFileSync(fp, "utf8");
  let n = 0;
  for (const [from, to] of REPLACEMENTS) {
    const before = html;
    html = html.split(`/commons/thumb/${from}/`).join(`/commons/thumb/${to}/`);
    if (html !== before) n++;
  }
  // Broken Unsplash bathroom shot → working marble bath from MX page
  html = html.replace(
    /photo-1611892440504-42a79e384f00/g,
    "photo-1600566753190-17f0baa2a6c3"
  );
  fs.writeFileSync(fp, html);
  console.log(rel, "patched", n, "wikimedia path groups");
}
