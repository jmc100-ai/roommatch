#!/usr/bin/env node
/**
 * Apply client/marketing/city-marketing-images.json to marketing HTML.
 * Run after editing the catalog: node scripts/apply-marketing-city-images.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "client/marketing/city-marketing-images.json"), "utf8")
);

function w960(url, width) {
  if (!url) return url;
  return url
    .replace(/\/\d+px-/g, `/${width}px-`)
    .replace(/w=\d+/g, `w=${width}`)
    .replace(/w=960/g, `w=${width}`);
}

function pick(city, key, width = 960) {
  const base = catalog[city]?.[key]?.["960"];
  if (!base) return null;
  if (base.includes("images.unsplash.com")) return w960(base, width);
  if (base.includes("upload.wikimedia.org")) return w960(base, width);
  return base;
}

function htmlAmp(url) {
  return url.replace(/&/g, "&amp;");
}

function bannedReplace(html, city) {
  const fallback =
    city === "paris"
      ? pick("paris", "skyline", 960)
      : pick("mexicoCity", "skyline", 960);
  let out = html;
  for (const id of catalog.bannedUnsplashIds || []) {
    const re = new RegExp(
      `https://images\\.unsplash\\.com/photo-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?[^"'\\s]*)?`,
      "g"
    );
    out = out.replace(re, (m) => {
      const wm = m.match(/w=(\d+)/);
      const width = wm ? wm[1] : "960";
      const fb = city === "paris" ? pick("paris", "skyline", width) : pick("mexicoCity", "skyline", width);
      return htmlAmp(fb || fallback);
    });
  }
  return out;
}

const FILES = {
  "client/marketing/paris-hotels.html": () => {
    const h = pick("paris", "eiffelUnsplash", 2000);
    const og = pick("paris", "skyline", 1280);
    return [
      [/background-image:url\('[^']+'\)(?=[^]*<div class="hero-inner">)/, `background-image:url('${htmlAmp(h)}')`],
      [/<meta property="og:image" content="[^"]+"/, `<meta property="og:image" content="${htmlAmp(og)}"`],
      [
        /alt="Seine river[^"]*"[^>]*src="[^"]+"/,
        (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "skyline", 960))}"`),
      ],
      [
        /alt="Louvre and Tuileries[^"]*"[^>]*src="[^"]+"/,
        (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "museum", 960))}"`),
      ],
      [
        /<img src="[^"]+" width="960" height="640" alt="Louvre/,
        `<img src="${htmlAmp(pick("paris", "museum", 960))}" width="960" height="640" alt="Louvre`,
      ],
      [
        /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Left Bank/,
        `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "museum", 960))}')">\n          <h3>Left Bank`,
      ],
      [
        /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Le Marais/,
        `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "street", 960))}')">\n          <h3>Le Marais`,
      ],
      [
        /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Grand avenues/,
        `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "bridge", 960))}')">\n          <h3>Grand avenues`,
      ],
      [
        /alt="Paris Métro sign"[^>]*src="[^"]+"/,
        (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "metro", 960))}"`),
      ],
      [
        /<img src="[^"]+" width="640" height="360" alt="Paris Métro sign"/,
        `<img src="${htmlAmp(pick("paris", "metro", 960))}" width="640" height="360" alt="Paris Métro sign"`,
      ],
    ];
  },
  "client/marketing/paris-neighborhood-stays.html": () => [
    [/<meta property="og:image" content="[^"]+"/, `<meta property="og:image" content="${htmlAmp(pick("paris", "skyline", 1280))}"`],
    [
      /<section class="hero" style="background-image:url\('[^']+'\)">/,
      `<section class="hero" style="background-image:url('${htmlAmp(pick("paris", "skyline", 1920))}')">`,
    ],
    [
      /alt="Paris Métro entrance sign"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "metro", 960))}"`),
    ],
    [
      /alt="Rue Mouffetard, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "street", 960))}"`),
    ],
    [
      /alt="Louvre from Tuileries Garden"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "museum", 960))}"`),
    ],
    [
      /alt="Sacré-Cœur, Montmartre, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "eiffelUnsplash", 960))}"`),
    ],
    [
      /alt="Champs-Élysées, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "bridge", 960))}"`),
    ],
    [
      /alt="Pont des Arts over the Seine, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "skyline", 960))}"`),
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Left Bank/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "museum", 960))}')">\n          <h3>Left Bank`,
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Le Marais/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "street", 960))}')">\n          <h3>Le Marais`,
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Montmartre/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("paris", "eiffelUnsplash", 960))}')">\n          <h3>Montmartre`,
    ],
  ],
  "client/marketing/paris-visual-search.html": () => [
    [/<meta property="og:image" content="[^"]+"/, `<meta property="og:image" content="${htmlAmp(pick("paris", "bridge", 1280))}"`],
    [
      /<section class="hero" style="background-image:url\('[^']+'\)">/,
      `<section class="hero" style="background-image:url('${htmlAmp(pick("paris", "skyline", 1920))}')">`,
    ],
    [
      /query-board" style="background-image:url\('[^']+'\)/,
      `query-board" style="background-image:url('${htmlAmp(pick("paris", "museum", 1400))}')`,
    ],
    [
      /alt="Palais Garnier, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "museum", 960))}"`),
    ],
    [
      /alt="Street in Le Marais, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "street", 960))}"`),
    ],
    [
      /alt="Eiffel Tower, Paris"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("paris", "eiffel", 960))}"`),
    ],
  ],
  "client/marketing/mexico-city-hotels.html": () => [
    [/<meta property="og:image" content="[^"]+"/, `<meta property="og:image" content="${htmlAmp(pick("mexicoCity", "skyline", 1200))}"`],
    [
      /<section class="hero" style="background-image:url\('[^']+'\)">/,
      `<section class="hero" style="background-image:url('${htmlAmp(pick("mexicoCity", "skyline", 2000))}')">`,
    ],
    [
      /alt="Mexico City street scene[^"]*"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("mexicoCity", "bellasEvening", 900))}"`),
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Centro Histórico/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("mexicoCity", "postal", 900))}')">\n          <h3>Centro Histórico`,
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Roma/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("mexicoCity", "bellasArtes", 900))}')">\n          <h3>Roma`,
    ],
    [
      /nbhd-tile" style="background-image:url\('[^']+'\)">\s*<h3>Polanco/,
      `nbhd-tile" style="background-image:url('${htmlAmp(pick("mexicoCity", "soumaya", 900))}')">\n          <h3>Polanco`,
    ],
    [
      /alt="Aerial view of dense urban city blocks[^"]*"[^>]*src="[^"]+"/,
      (m) => m.replace(/src="[^"]+"/, `src="${htmlAmp(pick("mexicoCity", "skyline", 640))}"`),
    ],
  ],
  "client/marketing/destinations.html": () => [
    [
      /<img src="[^"]+" alt="Paris"[^>]+>/,
      `<img src="${htmlAmp(pick("paris", "eiffel", 960))}" alt="Paris" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`,
    ],
    [
      /<img src="[^"]+" alt="Mexico City"[^>]+>/,
      `<img src="${htmlAmp(pick("mexicoCity", "skyline", 960))}" alt="Mexico City" loading="lazy" style="width:100%;height:100%;object-fit:cover" />`,
    ],
  ],
};

function patchFile(rel) {
  const fp = path.join(root, rel);
  let html = fs.readFileSync(fp, "utf8");
  const city = rel.includes("paris") ? "paris" : rel.includes("mexico") ? "mexicoCity" : null;
  if (city) html = bannedReplace(html, city === "paris" ? "paris" : "mexico");
  const rules = FILES[rel];
  if (rules) {
    for (const [re, repl] of rules()) {
      html = typeof repl === "function" ? html.replace(re, repl) : html.replace(re, repl);
    }
  }
  fs.writeFileSync(fp, html);
  console.log("patched", rel);
}

for (const rel of Object.keys(FILES)) patchFile(rel);

// Global ban sweep on remaining marketing pages
for (const rel of [
  "client/marketing/cdmx-neighborhood-stays.html",
  "client/marketing/mexico-city-visual-search.html",
]) {
  const fp = path.join(root, rel);
  let html = bannedReplace(fs.readFileSync(fp, "utf8"), "mexico");
  fs.writeFileSync(fp, html);
  console.log("ban-sweep", rel);
}
