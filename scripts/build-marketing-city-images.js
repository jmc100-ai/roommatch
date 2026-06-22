#!/usr/bin/env node
/**
 * Resolve Wikimedia Commons thumbs for marketing cityscapes (Paris + CDMX + London).
 * Writes client/marketing/city-marketing-images.json (run rarely; commit output).
 */
const fs = require("fs");
const path = require("path");

const PARIS_FILES = {
  hero: "Seine and Eiffel Tower from Tour Montparnasse, Paris July 2014.jpg",
  eiffel: "Tour Eiffel Wikimedia Commons (cropped).jpg",
  louvre: "View of Louvre from Jardin des Tuileries, Paris 22 June 2014.jpg",
  pont: "Paris - Pont des Arts - 2016.jpg",
  marais: "Le Marais, Paris, France - panoramio.jpg",
  metro: "Paris metro sign.jpg",
  montmartre: "Basilique du Sacré-Cœur, Paris 7 May 2014.jpg",
  champs: "Paris - Avenue des Champs-Élysées - 2016.jpg",
  mouffetard: "Paris - Rue Mouffetard - 2016.jpg",
  garnier: "Palais Garnier, Paris 16 March 2014.jpg",
  notreDame: "Notre-Dame de Paris, 4 October 2017.jpg",
};

const CDMX_FILES = {
  hero: "Mexico City Skyline (5604867225).jpg",
  skyline: "Mexico City Skyline (5604867225).jpg",
  bellasArtes: "Palacio de Bellas Artes, México D.F., México, 2013-10-13, DD 41.jpg",
  bellasEvening:
    "Palaco de Bellas Artes, Mexico City, from across Eje Central Lazaro Cardenas in evening.jpg",
  postal: "Palacio Postal, México D.F., México, 2013-10-16, DD 59.JPG",
  soumaya: "Museo Soumaya, Ciudad de México, México, 2015-07-18, DD 16.JPG",
  azulejos: "Casa de los Azulejos, México D.F., México, 2014-10-13, DD 47.JPG",
  zocalo: "Zocalo - West Side - Mexico 2024.jpg",
  coyoacan: "Coyoacán - Plaza Hidalgo, Coyoacan - Mexico 2024.jpg",
  chapultepec: "Old Guard House - Chapultepec Castle - Mexico 2024.jpg",
  garibaldi: "Mariachi playing - Plaza Garibaldi - Mexico 2024.jpg",
  anthropology:
    "Museo Nacional de Antropología - Sala Grandeza y Diversidad Cultural de México - 99.jpg",
};

const LONDON_FILES = {
  hero: "Palace of Westminster, London - Feb 2007.jpg",
  westminster: "Palace of Westminster, London - Feb 2007.jpg",
  coventGarden: "Covent Garden, London, UK.jpg",
  southKensington: "Natural History Museum, London, UK.jpg",
  marylebone: "Marylebone High Street, London.jpg",
  nottingHill: "Portobello Road, Notting Hill, London.jpg",
  shoreditch: "Street art in Chance Street, Shoreditch - geograph.org.uk - 3810142.jpg",
  southBank: "London Eye - panoramio.jpg",
  soho: "London, Piccadilly Circus -- 2016 -- 4866.jpg",
  towerBridge: "Tower Bridge from Shad Thames.jpg",
  tube: "Westminster station entrance 2020.jpg",
  hydePark: "Hyde Park July 2015-1.jpg",
};

const HERO_WIDTHS = [960, 1280, 1920];
const WIDTHS = [960];

async function commonsThumb(fileTitle, width) {
  const title = `File:${fileTitle}`;
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
    `&titles=${encodeURIComponent(title)}&iiprop=url&iiurlwidth=${width}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 2000 + attempt * 1500));
    const res = await fetch(api, {
      headers: { "User-Agent": "RoomMatchMarketing/1.0 (build-city-images)" },
    });
    const text = await res.text();
    if (text.startsWith("You are making")) continue;
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      continue;
    }
    const page = Object.values(j.query?.pages || {})[0];
    if (page?.missing) return null;
    return page.imageinfo?.[0]?.thumburl || null;
  }
  return null;
}

async function resolveSet(files, { heroKey = "hero" } = {}) {
  const out = {};
  for (const [key, title] of Object.entries(files)) {
    out[key] = {};
    const widths = key === heroKey ? HERO_WIDTHS : WIDTHS;
    for (const w of widths) {
      const url = await commonsThumb(title, w);
      if (url) out[key][String(w)] = url;
      process.stderr.write(url ? "." : "x");
    }
    process.stderr.write(` ${key}\n`);
  }
  return out;
}

(async () => {
  process.stderr.write("Paris…\n");
  const paris = await resolveSet(PARIS_FILES);
  process.stderr.write("CDMX…\n");
  const mexicoCity = await resolveSet(CDMX_FILES);
  process.stderr.write("London…\n");
  const london = await resolveSet(LONDON_FILES);
  const catalog = {
    generatedAt: new Date().toISOString(),
    /** Unsplash IDs that must not be used for city/landmark slots (wrong city). */
    bannedUnsplashIds: [
      "1477959858617-67f85cf4f1df", // Chicago skyline
      "1521216774850-01bc1c5fe0da", // generic travel / not Paris
      "1619872978981-e9885a014ba3", // not CDMX (misused as Mexico street)
      "1514565131-fce0801e5785", // generic aerial, not CDMX
    ],
    paris,
    mexicoCity,
    london,
  };
  const outPath = path.join(__dirname, "..", "client", "marketing", "city-marketing-images.json");
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2));
  console.log("Wrote", outPath);
})();
