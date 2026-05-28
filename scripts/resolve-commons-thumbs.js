#!/usr/bin/env node
/** Resolve Commons File: titles to thumb URLs (960 / 1280 / 1920). */
const files = [
  "Paris - Pont des Arts - 2016.jpg",
  "Seine and Eiffel Tower from Tour Montparnasse, Paris July 2014.jpg",
  "Paris metro sign.jpg",
  "Paris - Avenue des Champs-Élysées - 2016.jpg",
  "Le Marais, Paris, France - panoramio.jpg",
  "Palais Garnier, Paris 16 March 2014.jpg",
  "Paris - Rue Mouffetard - 2016.jpg",
  "View of Louvre from Jardin des Tuileries, Paris 22 June 2014.jpg",
  "Tour Eiffel Wikimedia Commons (cropped).jpg",
  "Notre-Dame de Paris, 4 October 2017.jpg",
  "Montmartre - Sacré-Cœur 01.jpg",
  "Sacré-Cœur de Montmartre - panoramio (1).jpg",
  "Basilique du Sacré-Cœur, Paris 7 May 2014.jpg",
];

async function thumb(fileTitle, width) {
  const title = `File:${fileTitle}`;
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
    `&titles=${encodeURIComponent(title)}&iiprop=url&iiurlwidth=${width}`;
  const r = await fetch(api, {
    headers: { "User-Agent": "RoomMatchMarketing/1.0 (commons-thumb-resolve)" },
  });
  const j = await r.json();
  const page = Object.values(j.query?.pages || {})[0];
  if (page?.missing) return { missing: true, title: fileTitle };
  const ii = page.imageinfo?.[0];
  return {
    title: fileTitle,
    thumb: ii?.thumburl,
    url: ii?.url,
    width,
  };
}

(async () => {
  for (const f of files) {
    await new Promise((x) => setTimeout(x, 1500));
    const r960 = await thumb(f, 960);
    console.log(JSON.stringify(r960));
  }
})();
