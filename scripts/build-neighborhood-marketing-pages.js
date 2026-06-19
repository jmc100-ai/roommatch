#!/usr/bin/env node
/**
 * Generate neighborhood marketing pages from Supabase `neighborhoods` table (Phase 1B).
 * Skips neighborhoods that already have /hotels-in-* pages in marketing-paths.js.
 * Run: node scripts/build-neighborhood-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");
const { MARKETING_ROUTES } = require("./marketing-paths");
const seo = require("./marketing-seo");
const { neighborhoodPathSlug, hotelsInPath, stripAccents } = require("./marketing-slug");
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
  MARKETING_DIR,
} = require("./marketing-build-core");

const EXISTING_PATHS = new Set(MARKETING_ROUTES.map((r) => r.path));

/** Hand-built Paris slugs — skip DB pages that overlap these. */
const PARIS_HAND_BUILT = new Set(["le-marais", "saint-germain", "montmartre", "latin-quarter", "opera"]);

const SKIP_NBHD_SLUGS = new Set([
  "saint-germain-des-pres",
  "opera-grands-boulevards",
  "saint-germain-des-pres-paris",
]);

const IMG = {
  Paris: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/1280px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg",
  "Mexico City":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1280px-Mexico_City_Skyline_%285604867225%29.jpg",
};

function normalizeName(name) {
  return stripAccents(String(name || ""))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shouldSkipNeighborhood(name) {
  const slug = neighborhoodPathSlug(name);
  const pathKey = hotelsInPath(name);
  if (EXISTING_PATHS.has(pathKey)) return true;
  if (EXISTING_PATHS.has(`/${slug}`)) return true;
  if (SKIP_NBHD_SLUGS.has(slug)) return true;

  const norm = normalizeName(name);
  for (const hs of PARIS_HAND_BUILT) {
    const hsNorm = hs.replace(/-/g, " ");
    if (norm.includes(hsNorm) || slug.startsWith(hs + "-") || slug === hs) {
      if (EXISTING_PATHS.has(`/hotels-in-${hs}`)) return true;
    }
  }
  return false;
}

function buildMetaDesc(nbhd, city, h1) {
  const cityLabel = city === "Paris" ? "Paris" : "Mexico City (CDMX)";
  const long = (nbhd.vibe_long || "").replace(/\s+/g, " ").trim();
  const short = (nbhd.vibe_short || "").trim();
  const tags = Array.isArray(nbhd.tags) ? nbhd.tags.slice(0, 3).join(", ") : "";
  let base = long || short || h1;
  if (tags && !base.toLowerCase().includes(tags.split(",")[0].toLowerCase())) {
    base = `${base} — ${tags}.`;
  }
  base = `${base} Best hotels in ${nbhd.name}, ${cityLabel}: real room photos on TravelByVibe.`;
  if (base.length > 158) base = base.slice(0, 155).replace(/\s+\S*$/, "") + "…";
  return base;
}

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

async function hotelsInBbox(db, city, bbox, limit = 9) {
  if (!bbox || bbox.lat_min == null) return [];
  const { data, error } = await db
    .from("v2_hotels_cache")
    .select("hotel_id, lat, lng")
    .eq("city", city)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error) throw error;

  const { data: inv } = await db.from("v2_room_inventory").select("hotel_id").eq("city", city);
  const photoCounts = new Map();
  for (const row of inv || []) {
    photoCounts.set(row.hotel_id, (photoCounts.get(row.hotel_id) || 0) + 1);
  }

  const ids = [];
  for (const row of data || []) {
    if (
      row.lat >= bbox.lat_min &&
      row.lat <= bbox.lat_max &&
      row.lng >= bbox.lon_min &&
      row.lng <= bbox.lon_max &&
      (photoCounts.get(row.hotel_id) || 0) >= 4
    ) {
      ids.push(row.hotel_id);
    }
  }
  const unique = [...new Set(ids)];
  const meta = await fetchLiteMetaBatch(unique.slice(0, limit * 3));
  return unique
    .map((id) => ({
      id,
      photos: photoCounts.get(id) || 0,
      guestRating: Number(meta[id]?.guestRating) || 0,
      starRating: Number(meta[id]?.starRating) || 0,
    }))
    .sort((a, b) => b.guestRating * 2 + b.starRating + b.photos * 0.01 - (a.guestRating * 2 + a.starRating + a.photos * 0.01))
    .slice(0, limit)
    .map((r) => r.id);
}

function staticCards(ids, meta, photosByHotel, city, campaign, slug, staySlugById) {
  return ids
    .map((id) => {
      const m = meta[id] || {};
      const photo = m.mainPhoto || photosByHotel[id]?.[0]?.photo_url || "";
      const name = m.name || `${city} hotel`;
      const stars =
        m.starRating && Number(m.starRating) > 0
          ? `<span class="mhotel-stars" aria-label="${Number(m.starRating)} stars">${"★".repeat(Math.min(5, Math.round(Number(m.starRating))))}</span>`
          : "";
      const rating =
        m.guestRating && Number(m.guestRating) > 0
          ? `<span class="mhotel-rating">${Number(m.guestRating).toFixed(1)}/10</span>`
          : "";
      const href = `__ORIGIN__/hotel/${encodeURIComponent(id)}?city=${encodeURIComponent(city)}`;
      const staySlug = staySlugById[id];
      const stayLink = staySlug
        ? `<a class="mhotel-link" href="__ORIGIN__/stays/${escHtml(staySlug)}">SEO stay page →</a>`
        : "";
      return `<article class="mhotel-card">
        <a class="mhotel-img" href="${href}"><img src="${escHtml(photo)}" alt="${escHtml(name)}" loading="lazy" width="400" height="260" /></a>
        <div class="mhotel-body">
          <h3 class="mhotel-name"><a href="${href}">${escHtml(name)}</a></h3>
          <p class="mhotel-meta">${stars} ${rating}</p>
          <p class="mhotel-actions"><a class="mhotel-link" href="${href}">View hotel →</a> ${stayLink}</p>
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

function removeStaleNbhdPages(activePaths) {
  const generated = loadGeneratedRoutes();
  const stale = (generated.routes || []).filter(
    (r) => r.category === "neighborhood" && r.path.startsWith("/hotels-in-") && !activePaths.has(r.path)
  );
  for (const r of stale) {
    const fp = path.join(MARKETING_DIR, r.file);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      console.log("removed stale:", r.file);
    }
  }
  if (stale.length) {
    generated.routes = (generated.routes || []).filter((r) => !stale.includes(r));
    saveGeneratedRoutes(generated);
  }
}

async function main() {
  const db = getDb();
  const generated = loadGeneratedRoutes();
  const newRoutes = [];
  const activePaths = new Set();

  const { data: neighborhoods, error } = await db
    .from("neighborhoods")
    .select("name, city, vibe_short, vibe_long, tags, photo_url, bbox, attributes, hotel_count")
    .in("city", ["Mexico City", "Paris"])
    .order("hotel_count", { ascending: false });
  if (error) throw error;

  const staySlugById = generated.slugByHotelId || {};

  let written = 0;
  let skipped = 0;
  for (const nbhd of neighborhoods || []) {
    if (shouldSkipNeighborhood(nbhd.name)) {
      skipped++;
      continue;
    }

    const slug = neighborhoodPathSlug(nbhd.name);
    const fileSlug = `hotels-in-${slug}`;
    const pathKey = `/${fileSlug}`;
    activePaths.add(pathKey);

    const campaign = nbhd.city === "Paris" ? "paris_seo_2026" : "cdmx_seo_2026";
    const h1 = `Best Hotels in ${nbhd.name}, ${nbhd.city === "Paris" ? "Paris" : "Mexico City"}`;
    const hotelIds = await hotelsInBbox(db, nbhd.city, nbhd.bbox, 9);
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
      desc: buildMetaDesc(nbhd, nbhd.city, h1),
      breadcrumbLabel: `Hotels in ${nbhd.name}`,
      faqs: nbhdFaqs(nbhd.name, nbhd.city),
    });

    const leadText = (nbhd.vibe_long || nbhd.vibe_short || "").replace(/\s+/g, " ").trim();
    const body = `<section class="hero" style="background-image:url('${heroBg(nbhd, nbhd.city)}')">
    <div class="hero-inner">
      <p class="hero-kicker">${escHtml(nbhd.vibe_short || nbhd.city + " neighborhood")}</p>
      <h1>${escHtml(h1)}</h1>
      <p class="hero-lead">${escHtml(leadText.slice(0, 320))}${leadText.length > 320 ? "…" : ""}</p>
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
      ${nbhd.hotel_count ? `<p class="msec-lead"><strong>${Number(nbhd.hotel_count).toLocaleString("en-US")}</strong> indexed hotels in this area on TravelByVibe.</p>` : ""}
      ${seo.hubLinks(nbhd.city)}
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">Hotels in ${escHtml(nbhd.name)}</h2>
      <p class="msec-lead">Top picks ranked by guest ratings and indexed room photography in ${escHtml(nbhd.name)}.</p>
      <div class="mhotel-grid">${staticCards(hotelIds, meta, photosByHotel, nbhd.city, campaign, fileSlug, staySlugById)}</div>
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
      path: pathKey,
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
  removeStaleNbhdPages(activePaths);
  console.log(`Done — ${written} neighborhood pages (${skipped} skipped overlaps)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
