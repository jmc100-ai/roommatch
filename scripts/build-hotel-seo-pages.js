#!/usr/bin/env node
/**
 * Generate indexable /stays/{slug} hotel entity pages (Phase 2).
 * Run: node scripts/build-hotel-seo-pages.js [--city="Mexico City"] [--limit=200]
 */
const seo = require("./marketing-seo");
const {
  getDb,
  escHtml,
  loadGeneratedRoutes,
  saveGeneratedRoutes,
  mergeRoutes,
  writePage,
  STAYS_DIR,
  ensureDir,
  fetchLiteMetaBatch,
  topHotelsForCity,
  samplePhotos,
  hotelTopFacts,
  factLabel,
  utmLink,
  saveManifest,
} = require("./marketing-build-core");
const { hotelStaySlug } = require("./marketing-slug");

const args = process.argv.slice(2);
function arg(name, def) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}

const LIMITS = {
  "Mexico City": Number(arg("mxLimit", arg("limit", "200"))) || 200,
  Paris: Number(arg("parisLimit", "200")) || 200,
};
const ONLY_CITY = arg("city", "");

function stars(n) {
  const s = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  if (!s) return "";
  return "★".repeat(s) + "☆".repeat(5 - s);
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
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${utmLink(city, campaign, slug + "-nav")}">Search ${isParis ? "Paris" : "CDMX"} →</a>
      </nav>
    </div>
  </header>`;
}

function photoGrid(photos, hotelName) {
  if (!photos.length) return "";
  return `<div class="mhotel-grid" style="margin-top:20px">${photos
    .map(
      (p) =>
        `<figure class="mhotel-card"><img src="${escHtml(p.photo_url)}" alt="${escHtml(hotelName)} ${escHtml(p.photo_type || "room")} photo" loading="lazy" width="400" height="260" style="width:100%;height:220px;object-fit:cover;border-radius:8px" /><figcaption style="padding:8px 4px;font-size:13px;color:var(--muted)">${escHtml(p.room_name || p.photo_type || "Room")}</figcaption></figure>`
    )
    .join("")}</div>`;
}

function whoIsItFor(facts, city) {
  const labels = facts.map(factLabel);
  if (!labels.length) {
    return `Travellers who want to verify the actual room before booking a ${city} hotel — browse indexed photography, then add dates for live rates.`;
  }
  return `Strong match if you care about ${labels.slice(0, 4).join(", ")}. TravelByVibe indexed this property's room photos so you can see the suite — not just the lobby — before you book elsewhere.`;
}

function stayFaqs(name, city, facts) {
  const feat = facts.slice(0, 3).map(factLabel).join(", ") || "room photography";
  return [
    {
      q: `Who is ${name} best for?`,
      a: whoIsItFor(facts, city),
    },
    {
      q: `Does ${name} have ${feat}?`,
      a: `Browse the room photos on this page — TravelByVibe indexes real property photography. Search for ${feat} to see how this hotel ranks for your trip.`,
    },
    {
      q: "How is this different from Booking or Expedia?",
      a: "We help you choose the right room and neighborhood vibe first. Booking happens through our partners once you've found a visual match.",
    },
  ];
}

function hotelSchema(name, slug, meta, city, photos) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name,
    url: `__ORIGIN__/stays/${slug}`,
    image: meta.mainPhoto || photos[0]?.photo_url || undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: city,
      streetAddress: meta.address || undefined,
    },
  };
  if (meta.starRating) {
    schema.starRating = { "@type": "Rating", ratingValue: meta.starRating, bestRating: 5 };
  }
  if (meta.guestRating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(meta.guestRating).toFixed(1),
      bestRating: 10,
      ratingCount: 1,
    };
  }
  return schema;
}

async function buildCity(db, city) {
  const campaign = city === "Paris" ? "paris_seo_2026" : "cdmx_seo_2026";
  const limit = LIMITS[city];
  const ranked = await topHotelsForCity(db, city, limit);
  const ids = ranked.map((r) => r.id);
  const meta = await fetchLiteMetaBatch(ids);

  const slugByHotelId = {};
  const usedSlugs = new Set();
  const staysRoutes = [];
  const manifestHotels = [];

  ensureDir(STAYS_DIR);

  for (const row of ranked) {
    const m = meta[row.id] || {};
    const name = m.name || row.name || row.id;
    let slug = hotelStaySlug(name, city, row.id);
    if (usedSlugs.has(slug)) slug = `${slug}-${String(row.id).slice(-6)}`;
    usedSlugs.add(slug);

    const photos = await samplePhotos(db, row.id, 6);
    const facts = await hotelTopFacts(db, row.id);
    const heroPhoto = m.mainPhoto || photos[0]?.photo_url || "";
    const factPills = facts
      .slice(0, 6)
      .map((f) => `<span class="tag-pill">${escHtml(factLabel(f))}</span>`)
      .join(" ");

    const canonical = `stays/${slug}`;
    const title = `${name} — ${city} Hotel Photos & Vibe Match`;
    const desc = `See real room photos at ${name} in ${city}. ${facts.length ? `Indexed features include ${facts.slice(0, 3).map(factLabel).join(", ")}.` : ""} Match your trip vibe on TravelByVibe.`.slice(
      0,
      158
    );
    const faqs = stayFaqs(name, city, facts);

    const vm = seo.applySeoMeta({
      canonical,
      city,
      pageCategory: "guide",
      title: `${title} | TravelByVibe`,
      desc,
      breadcrumbLabel: name,
      faqs,
    });
    if (!vm.breadcrumbs) vm.breadcrumbs = seo.breadcrumbsFor(vm);

    const appHref = `__ORIGIN__/hotel/${encodeURIComponent(row.id)}?city=${encodeURIComponent(city)}`;
    const searchHref = utmLink(city, campaign, `stay-${slug}`, { hotel: row.id });

    const body = `<section class="hero" style="background-image:url('${escHtml(heroPhoto)}')">
    <div class="hero-inner">
      <p class="hero-kicker">${escHtml(city)} hotel · indexed on TravelByVibe</p>
      <h1>${escHtml(name)}</h1>
      <p class="hero-lead">${escHtml(whoIsItFor(facts, city))}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${appHref}">Open hotel page →</a>
        <a class="mcta-secondary" href="${searchHref}">Match vibe →</a>
      </div>
      <div class="social-proof" aria-label="Hotel ratings">
        ${m.starRating ? `<span>${stars(m.starRating)} ${escHtml(String(m.starRating))}-star</span>` : ""}
        ${m.guestRating ? `<span>${escHtml(Number(m.guestRating).toFixed(1))}/10 guest rating</span>` : ""}
        <span>${photos.length}+ room photos indexed</span>
      </div>
      ${factPills ? `<div class="tag-row" style="margin-top:14px">${factPills}</div>` : ""}
    </div>
  </section>
  <div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Why stay here</p>
      <h2 class="msec-title">What this hotel is like</h2>
      <p class="msec-lead">${escHtml(whoIsItFor(facts, city))}</p>
      <p class="msec-lead">Why stay here vs booking blind: you see indexed ${city} room photography before you pick dates. Why not a nearby alternative? Run TravelByVibe search with your must-haves — rainfall shower, design mood, quiet street — and compare ranked matches.</p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Room photos</p>
      <h2 class="msec-title">Real rooms at ${escHtml(name)}</h2>
      ${photoGrid(photos, name)}
    </section>
    <section class="msec">
      <p class="msec-kicker">Explore</p>
      <h2 class="msec-title">Plan your stay</h2>
      <p class="msec-lead"><a href="${appHref}">View full hotel details</a> · <a href="${searchHref}">Search similar hotels</a> · <a href="__ORIGIN__/${city === "Paris" ? "where-to-stay-in-paris" : "where-to-stay-in-mexico-city"}">Where to stay in ${escHtml(city)}</a></p>
    </section>
  </div>`;

    const extraSchema = hotelSchema(name, slug, m, city, photos);
    const html =
      seo.marketingHead({ ...vm, defaultOgImage: heroPhoto, campaign }, heroPhoto) +
      `\n  <script type="application/ld+json">\n  ${JSON.stringify(extraSchema)}\n  </script>\n` +
      `\n<body data-marketing-city="${city}" data-marketing-campaign="${campaign}">\n` +
      header(city, campaign, slug) +
      (vm.breadcrumbs ? seo.breadcrumbNav(vm.breadcrumbs) : "") +
      body +
      seo.faqSection(faqs) +
      seo.footer(city);

    writePage(`stays/${slug}.html`, html);

    slugByHotelId[row.id] = slug;
    staysRoutes.push({
      path: `/stays/${slug}`,
      file: `stays/${slug}.html`,
      title: name,
      city,
      category: "stay",
      hotelId: row.id,
    });
    manifestHotels.push({ hotelId: row.id, slug, city, name, path: `/stays/${slug}` });
    if (staysRoutes.length % 25 === 0) console.log(`  ${city}: ${staysRoutes.length}/${limit}`);
  }

  return { slugByHotelId, staysRoutes, manifestHotels };
}

async function main() {
  const db = getDb();
  const generated = loadGeneratedRoutes();
  generated.staysRoutes = [];
  generated.slugByHotelId = {};

  const cities = ONLY_CITY ? [ONLY_CITY] : ["Mexico City", "Paris"];
  const allManifest = { slugByHotelId: {}, hotels: [] };

  for (const city of cities) {
    console.log(`Building stays for ${city} (limit ${LIMITS[city]})…`);
    const { slugByHotelId, staysRoutes, manifestHotels } = await buildCity(db, city);
    Object.assign(generated.slugByHotelId, slugByHotelId);
    generated.staysRoutes.push(...staysRoutes);
    Object.assign(allManifest.slugByHotelId, slugByHotelId);
    allManifest.hotels.push(...manifestHotels);
    console.log(`${city}: ${staysRoutes.length} stay pages`);
  }

  saveGeneratedRoutes(generated);
  saveManifest(allManifest);
  console.log(`Done — ${generated.staysRoutes.length} total stay pages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
