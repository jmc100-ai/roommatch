#!/usr/bin/env node
/**
 * Generate feature/vibe marketing pages (Phase 1A) + by-vibe alias routes.
 * Run: node scripts/build-vibe-marketing-pages.js
 */
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");
const {
  getDb,
  escHtml,
  loadGeneratedRoutes,
  saveGeneratedRoutes,
  mergeRoutes,
  writePage,
  hotelsWithFact,
  hotelsWithVisualStyle,
  fetchLiteMetaBatch,
  samplePhotos,
  topHotelsForCity,
  utmLink,
  loadManifest,
} = require("./marketing-build-core");
const { hotelStaySlug } = require("./marketing-slug");

const IMG = {
  Paris: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/1280px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg",
  "Mexico City":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1280px-Mexico_City_Skyline_%285604867225%29.jpg",
};

const VIBE_PAGES = [
  {
    slug: "mexico-city-hotels-with-rainfall-shower",
    city: "Mexico City",
    campaign: "cdmx_seo_2026",
    fact: "rainfall_shower",
    h1: "Best Hotels in Mexico City with Rainfall Shower",
    lead: "Skip the phone call to the front desk — browse CDMX hotels whose indexed bathroom photos actually show rainfall showers.",
    searchQ: "rainfall shower",
  },
  {
    slug: "mexico-city-hotels-with-balcony",
    city: "Mexico City",
    campaign: "cdmx_seo_2026",
    fact: "balcony",
    h1: "Best Hotels in Mexico City with a Balcony",
    lead: "Terrace mornings in Condesa and Roma — hotels with balcony room photos you can verify before you book.",
    searchQ: "balcony room",
  },
  {
    slug: "mexico-city-hotels-for-couples",
    city: "Mexico City",
    campaign: "cdmx_seo_2026",
    fact: "soaking_tub",
    h1: "Best Romantic Hotels in Mexico City for Couples",
    lead: "Soaking tubs, moody lighting, and intimate suites — match couples-friendly rooms with real photography.",
    searchQ: "romantic soaking tub",
  },
  {
    slug: "mexico-city-quiet-hotels",
    city: "Mexico City",
    campaign: "cdmx_seo_2026",
    style: "cozy_warm",
    h1: "Best Quiet Hotels in Mexico City",
    lead: "Leafy Condesa calm, cozy room moods, and residential rhythm — for travellers who want rest after busy days.",
    searchQ: "quiet cozy room",
  },
  {
    slug: "mexico-city-walkable-hotels",
    city: "Mexico City",
    campaign: "cdmx_seo_2026",
    fact: "floor_to_ceiling_windows",
    h1: "Best Walkable Neighborhood Hotels in Mexico City",
    lead: "Base in Condesa, Roma Norte, or Polanco and keep cafés, parks, and dinner on foot — then match the room you want.",
    searchQ: "bright walkable neighborhood",
  },
  {
    slug: "paris-hotels-with-rainfall-shower",
    city: "Paris",
    campaign: "paris_seo_2026",
    fact: "rainfall_shower",
    h1: "Best Paris Hotels with Rainfall Shower",
    lead: "Palace baths and boutique rain showers — search Paris hotels by real bathroom photography.",
    searchQ: "rainfall shower",
  },
  {
    slug: "paris-hotels-with-balcony",
    city: "Paris",
    campaign: "paris_seo_2026",
    fact: "balcony",
    h1: "Best Paris Hotels with a Balcony",
    lead: "Haussmann balconies, Left Bank glimpses, Montmartre views — verify the room before you commit.",
    searchQ: "balcony view",
  },
  {
    slug: "paris-hotels-for-couples",
    city: "Paris",
    campaign: "paris_seo_2026",
    fact: "soaking_tub",
    h1: "Best Paris Hotels for Couples",
    lead: "Romantic Paris is in the details — soaking tubs, moody suites, and village-hill views matched to photos.",
    searchQ: "romantic soaking tub",
  },
  {
    slug: "paris-quiet-hotels",
    city: "Paris",
    campaign: "paris_seo_2026",
    style: "cozy_warm",
    h1: "Best Quiet Hotels in Paris",
    lead: "Saint-Germain calm, cozy room moods, and courtyard hush — when you want Paris without the late-night buzz.",
    searchQ: "quiet cozy Left Bank",
  },
  {
    slug: "paris-design-hotels",
    city: "Paris",
    campaign: "paris_seo_2026",
    style: "sleek_polished",
    h1: "Best Design Hotels in Paris",
    lead: "Sleek lines, statement baths, and design-forward boutiques — ranked by real room photos, not lobby renders.",
    searchQ: "sleek design hotel room",
  },
];

const ALIAS_ROUTES = [
  {
    path: "/mexico-city-hotels-by-vibe",
    file: "mexico-city-hotels.html",
    title: "Mexico City Hotels by Vibe — Visual Search",
    city: "Mexico City",
    category: "hub",
    alias: true,
  },
  {
    path: "/paris-hotels-by-vibe",
    file: "paris-hotels.html",
    title: "Paris Hotels by Vibe — Visual Search",
    city: "Paris",
    category: "hub",
    alias: true,
  },
];

function header(city, campaign, navUtm) {
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
        <a class="mcta" href="${utmLink(city, campaign, navUtm)}">Try ${isParis ? "Paris" : "Mexico City"} →</a>
      </nav>
    </div>
  </header>`;
}

function stars(n) {
  const s = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  if (!s) return "";
  return "★".repeat(s) + "☆".repeat(5 - s);
}

function staticHotelCards(hotelIds, meta, photosByHotel, slugMap, city, campaign, utmBase) {
  const cards = hotelIds
    .map((id) => {
      const m = meta[id] || {};
      const photos = photosByHotel[id] || [];
      const photo = m.mainPhoto || photos[0]?.photo_url || "";
      const name = m.name || `${city} hotel`;
      const slug = slugMap[id];
      const stayHref = slug ? `__ORIGIN__/stays/${slug}` : `__ORIGIN__/hotel/${encodeURIComponent(id)}?city=${encodeURIComponent(city)}`;
      const searchHref = utmLink(city, campaign, `${utmBase}-${id}`, { q: "" });
      return `<article class="mhotel-card">
        <a class="mhotel-img" href="${stayHref}"><img src="${escHtml(photo)}" alt="${escHtml(name)} room photo" loading="lazy" width="400" height="260" /></a>
        <div class="mhotel-body">
          <h3 class="mhotel-name"><a href="${stayHref}">${escHtml(name)}</a></h3>
          ${m.starRating ? `<p class="mhotel-stars">${stars(m.starRating)}</p>` : ""}
          ${m.guestRating ? `<p class="mhotel-rating">${escHtml(Number(m.guestRating).toFixed(1))}/10 guests</p>` : ""}
          <p class="mhotel-actions">
            <a class="mhotel-link" href="${stayHref}">View stay guide →</a>
            <a class="mhotel-link mhotel-link-muted" href="${searchHref}">Search vibe →</a>
          </p>
        </div>
      </article>`;
    })
    .join("\n");
  return `<div class="mhotel-grid">${cards}</div>`;
}

function embedSearch(city, campaign, slug, defaultQ) {
  const cVal = city === "Paris" ? "Paris" : "Mexico City";
  return `<div class="embed-search">
      <h3>Find your ${city === "Paris" ? "Paris" : "CDMX"} hotel match</h3>
      <p>Describe the room you want — then we rank real hotel photos for you.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get">
        <input type="hidden" name="city" value="${escHtml(cVal)}" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="${campaign}" />
        <input type="hidden" name="utm_content" value="${slug}-search" />
        <input type="search" name="q" value="${escHtml(defaultQ || "")}" placeholder="Describe your ideal room" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
    </div>`;
}

function faqsFor(page) {
  return [
    {
      q: `How do I find ${page.city} hotels with ${page.searchQ || "this feature"}?`,
      a: `TravelByVibe indexes real room and bathroom photos across ${page.city}. Search by description or browse our curated picks — each verified against indexed photography.`,
    },
    {
      q: "Can I see bathroom photos before booking?",
      a: "Yes — our visual search ranks hotels whose indexed photos match your words. Browsing is free; add dates when you want live rates.",
    },
    {
      q: "Who is this page for?",
      a: `Travellers planning a ${page.city} trip who care about room truth — not just star ratings and lobby shots. Match neighborhood vibe and the actual suite you'll sleep in.`,
    },
  ];
}

async function main() {
  const db = getDb();
  const manifest = loadManifest();
  const slugMap = manifest.slugByHotelId || {};
  const generated = loadGeneratedRoutes();
  const newRoutes = [...ALIAS_ROUTES];

  for (const page of VIBE_PAGES) {
    let hotelIds = [];
    if (page.fact) hotelIds = await hotelsWithFact(db, page.city, page.fact, 8);
    else if (page.style) hotelIds = await hotelsWithVisualStyle(db, page.city, page.style, 8);
    if (!hotelIds.length) {
      const fallback = await topHotelsForCity(db, page.city, 6);
      hotelIds = fallback.map((h) => h.id);
    }

    const meta = await fetchLiteMetaBatch(hotelIds);
    const photosByHotel = {};
    for (const id of hotelIds) {
      photosByHotel[id] = await samplePhotos(db, id, 1);
    }

    const vm = seo.applySeoMeta({
      canonical: page.slug,
      city: page.city,
      pageCategory: "vibe",
      title: `${page.h1} | TravelByVibe`,
      desc: page.lead.slice(0, 155),
      faqs: faqsFor(page),
    });

    const body = `<section class="hero" style="background-image:url('${IMG[page.city]}')">
    <div class="hero-inner">
      <p class="hero-kicker">TravelByVibe · ${page.city}</p>
      <h1>${escHtml(vm.h1 || page.h1)}</h1>
      <p class="hero-lead">${escHtml(page.lead)}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utmLink(page.city, page.campaign, page.slug + "-hero", { q: page.searchQ })}">Search by vibe →</a>
        <a class="mcta-secondary" href="${utmLink(page.city, page.campaign, page.slug + "-quiz")}">Take the quiz</a>
      </div>
    </div>
  </section>
  <div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Who this is for</p>
      <h2 class="msec-title">${escHtml(seoField(page.slug, "h2Featured", "Hotels that match your trip"))}</h2>
      <p class="msec-lead">We rank ${page.city} hotels by real room photography — ideal when you already know the neighborhood and need proof the room fits.</p>
      ${seo.hubLinks(page.city)}
    </section>
    <section class="msec">
      <p class="msec-kicker">Featured stays</p>
      <h2 class="msec-title">Hotels to start with</h2>
      ${staticHotelCards(hotelIds, meta, photosByHotel, slugMap, page.city, page.campaign, page.slug)}
      <div class="section-cta"><a class="mcta" href="${utmLink(page.city, page.campaign, page.slug + "-more", { q: page.searchQ })}">Discover more hotels →</a></div>
    </section>
    ${embedSearch(page.city, page.campaign, page.slug, page.searchQ)}
  </div>`;

    const html = seo.wrapPage(
      body,
      { ...vm, defaultOgImage: IMG[page.city], campaign: page.campaign, faqs: faqsFor(page) },
      header(page.city, page.campaign, page.slug + "-nav"),
      page.city
    );

    writePage(`${page.slug}.html`, html);
    newRoutes.push({
      path: `/${page.slug}`,
      file: `${page.slug}.html`,
      title: page.h1,
      city: page.city,
      category: "vibe",
    });
    console.log("vibe page:", page.slug, `(${hotelIds.length} hotels)`);
  }

  mergeRoutes(generated, newRoutes);
  saveGeneratedRoutes(generated);
  console.log(`Done — ${VIBE_PAGES.length} vibe pages + ${ALIAS_ROUTES.length} aliases`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
