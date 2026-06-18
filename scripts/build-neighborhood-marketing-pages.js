#!/usr/bin/env node
/**
 * Generate neighborhood marketing pages from Supabase `neighborhoods` table (Phase 1B).
 * Skips neighborhoods that already have /hotels-in-* pages in marketing-paths.js.
 * Run: node scripts/build-neighborhood-marketing-pages.js
 */
const { MARKETING_ROUTES } = require("./marketing-paths");
const seo = require("./marketing-seo");
const { neighborhoodPathSlug, hotelsInPath } = require("./marketing-slug");
const {
  getDb,
  escHtml,
  loadGeneratedRoutes,
  saveGeneratedRoutes,
  mergeRoutes,
  writePage,
  fetchLiteMetaBatch,
  samplePhotos,
  utmLink,
} = require("./marketing-build-core");

const EXISTING_PATHS = new Set(MARKETING_ROUTES.map((r) => r.path));

const IMG = {
  Paris: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/1280px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg",
  "Mexico City":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1280px-Mexico_City_Skyline_%285604867225%29.jpg",
};

function header(city, campaign, slug) {
  const isParis = city === "Paris";
  return `<header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/${isParis ? "paris-hotels" : "mexico-city-hotels"}">${isParis ? "Paris hotels" : "CDMX hotels"}</a>
        <a href="__ORIGIN__/${isParis ? "where-to-stay-in-paris" : "where-to-stay-in-mexico-city"}">Where to stay</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${utmLink(city, campaign, slug + "-nav")}">Try search →</a>
      </nav>
    </div>
  </header>`;
}

function heroBg(nbhd, city) {
  if (nbhd.photo_url) return nbhd.photo_url.replace(/&/g, "&amp;");
  return IMG[city];
}

async function hotelsInBbox(db, city, bbox, limit = 6) {
  if (!bbox || bbox.lat_min == null) return [];
  const { data, error } = await db
    .from("v2_hotels_cache")
    .select("hotel_id, lat, lng")
    .eq("city", city)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error) throw error;
  const ids = [];
  for (const row of data || []) {
    if (
      row.lat >= bbox.lat_min &&
      row.lat <= bbox.lat_max &&
      row.lng >= bbox.lon_min &&
      row.lng <= bbox.lon_max
    ) {
      ids.push(row.hotel_id);
      if (ids.length >= limit) break;
    }
  }
  return ids;
}

function staticCards(ids, meta, photosByHotel, city, campaign, slug) {
  return ids
    .map((id) => {
      const m = meta[id] || {};
      const photo = m.mainPhoto || photosByHotel[id]?.[0]?.photo_url || "";
      const name = m.name || `${city} hotel`;
      const href = `__ORIGIN__/hotel/${encodeURIComponent(id)}?city=${encodeURIComponent(city)}`;
      return `<article class="mhotel-card">
        <a class="mhotel-img" href="${href}"><img src="${escHtml(photo)}" alt="${escHtml(name)}" loading="lazy" width="400" height="260" /></a>
        <div class="mhotel-body">
          <h3 class="mhotel-name"><a href="${href}">${escHtml(name)}</a></h3>
          <p class="mhotel-actions"><a class="mhotel-link" href="${href}">View hotel →</a></p>
        </div>
      </article>`;
    })
    .join("\n");
}

function nbhdFaqs(name, city) {
  return [
    {
      q: `Is ${name} a good area to stay in ${city}?`,
      a: `${name} is one of the neighborhoods TravelByVibe indexes for ${city}. Compare vibe and hotel room photos here, then search by the room features you care about.`,
    },
    {
      q: `What kind of traveller loves ${name}?`,
      a: `Use the vibe summary and tags on this page to see if ${name} matches your trip pace — then browse hotels with real room photography before you book elsewhere.`,
    },
    {
      q: "Can I search hotels by room photos in this neighborhood?",
      a: "Yes — open TravelByVibe with this city, describe your ideal room, and use neighborhood vibe ranking to keep results area-relevant.",
    },
  ];
}

async function main() {
  const db = getDb();
  const generated = loadGeneratedRoutes();
  const newRoutes = [];

  const { data: neighborhoods, error } = await db
    .from("neighborhoods")
    .select("name, city, vibe_short, vibe_long, tags, photo_url, bbox, attributes, hotel_count")
    .in("city", ["Mexico City", "Paris"])
    .order("hotel_count", { ascending: false });
  if (error) throw error;

  let written = 0;
  for (const nbhd of neighborhoods || []) {
    const slug = neighborhoodPathSlug(nbhd.name);
    const pathKey = hotelsInPath(nbhd.name);
    if (EXISTING_PATHS.has(pathKey)) continue;

    const fileSlug = `hotels-in-${slug}`;
    if (EXISTING_PATHS.has(`/${fileSlug}`)) continue;

    const campaign = nbhd.city === "Paris" ? "paris_seo_2026" : "cdmx_seo_2026";
    const h1 = `Best Hotels in ${nbhd.name}, ${nbhd.city === "Paris" ? "Paris" : "Mexico City"}`;
    const hotelIds = await hotelsInBbox(db, nbhd.city, nbhd.bbox, 6);
    const meta = await fetchLiteMetaBatch(hotelIds);
    const photosByHotel = {};
    for (const id of hotelIds) photosByHotel[id] = await samplePhotos(db, id, 1);

    const tags = Array.isArray(nbhd.tags) ? nbhd.tags.slice(0, 5) : [];
    const tagHtml = tags.map((t) => `<span class="tag-pill">${escHtml(t)}</span>`).join(" ");

    const vm = seo.applySeoMeta({
      canonical: fileSlug,
      city: nbhd.city,
      pageCategory: "neighborhood",
      title: `${h1} | TravelByVibe`,
      desc: (nbhd.vibe_short || nbhd.vibe_long || h1).slice(0, 155),
      breadcrumbLabel: `Hotels in ${nbhd.name}`,
      faqs: nbhdFaqs(nbhd.name, nbhd.city),
    });

    const body = `<section class="hero" style="background-image:url('${heroBg(nbhd, nbhd.city)}')">
    <div class="hero-inner">
      <p class="hero-kicker">${escHtml(nbhd.vibe_short || nbhd.city + " neighborhood")}</p>
      <h1>${escHtml(h1)}</h1>
      <p class="hero-lead">${escHtml((nbhd.vibe_long || "").slice(0, 280))}${nbhd.vibe_long && nbhd.vibe_long.length > 280 ? "…" : ""}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utmLink(nbhd.city, campaign, fileSlug + "-hero")}">Search ${escHtml(nbhd.name)} hotels →</a>
      </div>
      ${tags.length ? `<div class="tag-row" style="margin-top:16px">${tagHtml}</div>` : ""}
    </div>
  </section>
  <div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Why stay here</p>
      <h2 class="msec-title">Who ${escHtml(nbhd.name)} is for</h2>
      <p class="msec-lead">${escHtml(nbhd.vibe_long || nbhd.vibe_short || "")}</p>
      ${seo.hubLinks(nbhd.city)}
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">Hotels in ${escHtml(nbhd.name)}</h2>
      <div class="mhotel-grid">${staticCards(hotelIds, meta, photosByHotel, nbhd.city, campaign, fileSlug)}</div>
      <div class="section-cta"><a class="mcta" href="${utmLink(nbhd.city, campaign, fileSlug + "-more")}">Find more by vibe →</a></div>
    </section>
  </div>`;

    const html = seo.wrapPage(
      body,
      { ...vm, defaultOgImage: heroBg(nbhd, nbhd.city), campaign, faqs: nbhdFaqs(nbhd.name, nbhd.city) },
      header(nbhd.city, campaign, fileSlug),
      nbhd.city
    );

    writePage(`${fileSlug}.html`, html);
    newRoutes.push({
      path: `/${fileSlug}`,
      file: `${fileSlug}.html`,
      title: h1,
      city: nbhd.city,
      category: "neighborhood",
    });
    written++;
    console.log("neighborhood:", fileSlug);
  }

  mergeRoutes(generated, newRoutes);
  saveGeneratedRoutes(generated);
  console.log(`Done — ${written} new neighborhood pages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
