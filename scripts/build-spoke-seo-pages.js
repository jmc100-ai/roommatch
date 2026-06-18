#!/usr/bin/env node
/**
 * Generate tier-3 SEO spoke pages (long-tail query targets).
 * Run: node scripts/build-spoke-seo-pages.js
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");

const OUT = path.join(__dirname, "..", "client", "marketing");

const PARIS_IMG = JSON.parse(
  fs.readFileSync(path.join(OUT, "city-marketing-images.json"), "utf8")
).paris;

function amp(url) {
  return String(url).replace(/&/g, "&amp;");
}

const EIFFEL_HERO = amp(PARIS_IMG.hero["1920"]);
const EIFFEL_OG = amp(PARIS_IMG.hero["1280"]);
const MARAIS = amp(PARIS_IMG.marais["960"]);
const LATIN = amp(PARIS_IMG.mouffetard["960"]);
const SAINT_GERMAIN = amp(PARIS_IMG.saintGermain["960"]);
const MONTMARTRE = amp(PARIS_IMG.montmartre["960"]);
const OPERA = amp(PARIS_IMG.champs["960"]);

const SKYLINE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1920px-Mexico_City_Skyline_%285604867225%29.jpg";
const SKYLINE_OG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1280px-Mexico_City_Skyline_%285604867225%29.jpg";
const SOUMAYA =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Museo_Soumaya%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-18%2C_DD_12.JPG/1280px-Museo_Soumaya%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-18%2C_DD_12.JPG";
const NBHD_CONDESA =
  "https://images.unsplash.com/photo-1545504573-edac76c6a487?auto=format&amp;fit=crop&amp;w=1280&amp;q=82";
const NBHD_POLANCO = "https://live.staticflickr.com/65535/48083283343_36ca392374_b.jpg";
const NBHD_ROMA =
  "https://images.unsplash.com/photo-1612878731576-1d9ca638b741?auto=format&amp;fit=crop&amp;w=1280&amp;q=82";

function parisUtm(content) {
  return `__ORIGIN__/?city=Paris&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=paris_seo_2026&amp;utm_content=${content}`;
}
function cdmxUtm(content) {
  return `__ORIGIN__/?city=Mexico%20City&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=cdmx_seo_2026&amp;utm_content=${content}`;
}

function parisHeader(utmContent) {
  return `<header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/paris-hotels">Paris hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-paris">Where to stay in Paris</a>
        <a href="__ORIGIN__/paris-hotel-finder">Paris hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${parisUtm(utmContent)}">Try Paris →</a>
      </nav>
    </div>
  </header>`;
}

function cdmxHeader(utmContent) {
  return `<header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/mexico-city-hotels">Mexico City hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-mexico-city">Where to stay in Mexico City</a>
        <a href="__ORIGIN__/mexico-city-hotel-finder">Hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${cdmxUtm(utmContent)}">Try Mexico City →</a>
      </nav>
    </div>
  </header>`;
}

function hero({ kicker, h1, lead, image, ctaHref, ctaLabel }) {
  return `<section class="hero" style="background-image:url('${image}')">
    <div class="hero-inner">
      <p class="hero-kicker">${kicker}</p>
      <h1>${h1}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${ctaHref}">${ctaLabel}</a>
      </div>
      <div class="social-proof" aria-label="Product scale">
        <span>Real room photos</span>
        <span>Neighborhood vibe matching</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function embedParis(utmContent) {
  return `<div class="embed-search">
      <h3>Find your Paris hotel match</h3>
      <p>Describe the room you want — rainfall shower, Haussmann light, balcony view — and we rank real hotel photos.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="Paris" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="paris_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Le Marais" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
    </div>
    <script>
      document.querySelectorAll('[data-marketing-search]').forEach(function(f){
        f.addEventListener('submit', function(e){
          var q = (f.querySelector('[name=q]')||{}).value;
          if (!q || !String(q).trim()) { e.preventDefault(); window.location.href = '${parisUtm(utmContent + "-quiz")}'; }
        });
      });
    </script>`;
}

function embedCdmx(utmContent) {
  return `<div class="embed-search">
      <h3>Find your Mexico City hotel match</h3>
      <p>Describe the room you want — rainfall shower, bright suite, Roma Norte walkability — and we rank real CDMX hotel photos.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="Mexico City" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="cdmx_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Condesa" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
    </div>
    <script>
      document.querySelectorAll('[data-marketing-search]').forEach(function(f){
        f.addEventListener('submit', function(e){
          var q = (f.querySelector('[name=q]')||{}).value;
          if (!q || !String(q).trim()) { e.preventDefault(); window.location.href = '${cdmxUtm(utmContent + "-quiz")}'; }
        });
      });
    </script>`;
}

function hotelTiers(preset, city, utmBase) {
  return `
      <h3 class="hotel-tier-title">Luxury picks</h3>
      <div data-preset="${preset}" data-tier="luxury" data-city="${city}" data-utm="${utmBase}-luxury" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Boutique picks</h3>
      <div data-preset="${preset}" data-tier="boutique" data-city="${city}" data-utm="${utmBase}-boutique" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Value picks</h3>
      <div data-preset="${preset}" data-tier="value" data-city="${city}" data-utm="${utmBase}-value" aria-live="polite"></div>`;
}

function writePage(file, html) {
  fs.writeFileSync(path.join(OUT, file), html, "utf8");
  console.log("wrote", file);
}

// ── Paris: first-time visitors ───────────────────────────────────────────────
{
  const canonical = "best-area-to-stay-in-paris-first-time";
  const h1 = seoField(canonical, "h1", "Best Area to Stay in Paris for First-Time Visitors");
  const body =
    hero({
      kicker: "Paris · First visit",
      h1,
      lead:
        "First trip to Paris? <strong>Le Marais</strong> and the <strong>Latin Quarter</strong> are the easiest bases — flat, central, and full of cafés. <strong>Saint-Germain</strong> suits Left Bank calm. Compare areas, then match hotels by real room photos.",
      image: MARAIS,
      ctaHref: parisUtm("paris-first-time-hero"),
      ctaLabel: "Take the 30-second quiz →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Quick picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best Paris neighborhoods for first-time visitors")}</h2>
      <div class="fgrid">
        <div class="fcard"><h3>Le Marais</h3><p>Walkable, gallery-dense, and lively without a car — the default first-timer pick.</p><p><a href="__ORIGIN__/hotels-in-le-marais">Hotels in Le Marais →</a></p></div>
        <div class="fcard"><h3>Latin Quarter</h3><p>River walks, bistros, and museum density near Notre-Dame.</p><p><a href="__ORIGIN__/hotels-in-latin-quarter">Hotels in Latin Quarter →</a></p></div>
        <div class="fcard"><h3>Saint-Germain</h3><p>Left Bank literary calm when you prefer wine bars over weekend buzz.</p><p><a href="__ORIGIN__/hotels-in-saint-germain">Hotels in Saint-Germain →</a></p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Still deciding? Read <a href="__ORIGIN__/marais-vs-saint-germain">Le Marais vs Saint-Germain</a> or the full <a href="__ORIGIN__/where-to-stay-in-paris">where to stay in Paris</a> guide.</p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best hotels in Le Marais for first-time visitors")}</h2>
      ${hotelTiers("paris-le-marais", "Paris", "paris-first-time-marais")}
    </section>
    ${embedParis("paris-first-time-search")}
  </div>`;
  writePage(
    "best-area-to-stay-in-paris-first-time.html",
    seo.wrapPage(
      body,
      { canonical, city: "Paris", pageCategory: "guide", defaultOgImage: EIFFEL_OG, campaign: "paris_seo_2026" },
      parisHeader("paris-first-time-nav"),
      "Paris"
    )
  );
}

// ── Paris: Eiffel Tower ──────────────────────────────────────────────────────
{
  const canonical = "paris-hotels-near-eiffel-tower";
  const h1 = seoField(canonical, "h1", "Paris Hotels Near the Eiffel Tower");
  const body =
    hero({
      kicker: "Paris · Eiffel views",
      h1,
      lead:
        "Hotels near the Eiffel Tower span the <strong>7th arrondissement</strong>, <strong>Latin Quarter</strong> glimpses, and <strong>Trocadéro</strong> skyline views. Search <strong>Eiffel view</strong> rooms with real photography — not brochure lobby shots.",
      image: EIFFEL_HERO,
      ctaHref: parisUtm("paris-eiffel-hero"),
      ctaLabel: "Search Eiffel view rooms →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Best areas</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best areas for Eiffel Tower views")}</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${LATIN}')"><h3>Latin Quarter</h3><p>Central Left Bank — partial tower glimpses and river walks.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-latin-quarter">Hotels in Latin Quarter →</a></div>
        <div class="nbhd-tile" style="background-image:url('${OPERA}')"><h3>Opéra &amp; 7th</h3><p>Grand avenues and palace hotels closer to the monument.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-opera">Hotels near Opéra →</a></div>
        <div class="nbhd-tile" style="background-image:url('${MONTMARTRE}')"><h3>Montmartre</h3><p>Skyline views from the north — village mood, métro to the tower.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-montmartre">Hotels in Montmartre →</a></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Try visual search: <a href="__ORIGIN__/paris-visual-search">Paris hotels by room photos</a> — query <em>Eiffel view, balcony at golden hour</em>.</p>
    </section>
    <section class="msec">
      <h2 class="msec-title">Hotel picks near the Eiffel Tower</h2>
      ${hotelTiers("paris-latin-quarter", "Paris", "paris-eiffel-latin")}
      <h3 class="hotel-tier-title" style="margin-top:28px">Opéra &amp; Champs picks</h3>
      <div data-preset="paris-opera" data-tier="luxury" data-city="Paris" data-utm="paris-eiffel-opera" aria-live="polite"></div>
    </section>
    ${embedParis("paris-eiffel-search")}
  </div>`;
  writePage(
    "paris-hotels-near-eiffel-tower.html",
    seo.wrapPage(
      body,
      { canonical, city: "Paris", pageCategory: "guide", defaultOgImage: EIFFEL_OG, campaign: "paris_seo_2026" },
      parisHeader("paris-eiffel-nav"),
      "Paris"
    )
  );
}

// ── CDMX: travel Mexico City hotels ─────────────────────────────────────────
{
  const canonical = "travel-mexico-city-hotels";
  const h1 = seoField(canonical, "h1", "Travel Mexico City Hotels");
  const body =
    hero({
      kicker: "CDMX · Travel planning",
      h1,
      lead:
        "Planning <strong>travel to Mexico City</strong>? Pick a neighborhood that fits your trip, run the vibe quiz, then search <strong>3,600+ hotels</strong> by real room and bathroom photos — before you commit on a booking site.",
      image: SKYLINE,
      ctaHref: cdmxUtm("cdmx-travel-hotels-hero"),
      ctaLabel: "Take the 30-second quiz →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Start here</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "How to plan travel to Mexico City hotels")}</h2>
      <div class="how-row">
        <article class="how-card">
          <div class="how-txt"><span class="how-num">1</span><h3>Pick your neighborhood</h3><p>Condesa and Roma Norte for first trips; Polanco for museums and luxury; Centro for sightseeing density. Read <a href="__ORIGIN__/where-to-stay-in-mexico-city">where to stay in Mexico City</a>.</p></div>
        </article>
        <article class="how-card">
          <div class="how-txt"><span class="how-num">2</span><h3>Shape your vibe</h3><p>Our wizard captures trip pace, must-haves, and room mood — sleek, cozy, design-forward, or classic.</p></div>
        </article>
        <article class="how-card">
          <div class="how-txt"><span class="how-num">3</span><h3>See real rooms</h3><p>Describe rainfall shower, bright suite, or terrace mornings. We rank hotels whose indexed photos match.</p></div>
        </article>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Who you are</p>
      <h2 class="msec-title">Which traveller are you?</h2>
      <div class="fgrid">
        <div class="fcard"><h3>First Mexico City trip</h3><p><strong>Condesa</strong> or <strong>Roma Norte</strong> — walkable parks, cafés, and galleries without a car. See <a href="__ORIGIN__/safe-neighborhoods-mexico-city">safe neighborhoods for tourists</a>.</p></div>
        <div class="fcard"><h3>Food &amp; nightlife</h3><p><strong>Roma Norte</strong> leads for restaurants and bars; Condesa is calmer after dark. Compare <a href="__ORIGIN__/roma-norte-vs-condesa">Roma Norte vs Condesa</a>.</p></div>
        <div class="fcard"><h3>Museums &amp; parks</h3><p><strong>Polanco</strong> and <strong>Juárez</strong> near Chapultepec — browse <a href="__ORIGIN__/hotels-near-chapultepec">hotels near Chapultepec</a>.</p></div>
        <div class="fcard"><h3>Culture sprint</h3><p><strong>Centro Histórico</strong> — Zócalo, Templo Mayor, and cantina culture outside your door.</p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Full hub: <a href="__ORIGIN__/mexico-city-hotels">travel Mexico City hotels on TravelByVibe</a> · <a href="__ORIGIN__/mexico-city-visual-search">visual room search</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Neighborhoods", "Travel Mexico City hotels by neighborhood")}</h2>
      <nav class="hub-links" aria-label="CDMX hotel neighborhoods">
        <a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a>
        <a href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte</a>
        <a href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco</a>
        <a href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez</a>
        <a href="__ORIGIN__/hotels-in-centro-historico">Hotels in Centro Histórico</a>
      </nav>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best Mexico City hotels for travellers")}</h2>
      ${hotelTiers("condesa", "Mexico City", "cdmx-travel-condesa")}
    </section>
    ${embedCdmx("cdmx-travel-hotels-search")}
  </div>`;
  writePage(
    "travel-mexico-city-hotels.html",
    seo.wrapPage(
      body,
      { canonical, city: "Mexico City", pageCategory: "guide", defaultOgImage: SKYLINE_OG, campaign: "cdmx_seo_2026" },
      cdmxHeader("cdmx-travel-hotels-nav"),
      "Mexico City"
    )
  );
}

// ── CDMX: safe neighborhoods ───────────────────────────────────────────────
{
  const canonical = "safe-neighborhoods-mexico-city";
  const h1 = seoField(canonical, "h1", "Safe Neighborhoods in Mexico City for Tourists");
  const body =
    hero({
      kicker: "CDMX · Visitor areas",
      h1,
      lead:
        "<strong>Condesa</strong>, <strong>Roma Norte</strong>, <strong>Polanco</strong>, and <strong>Juárez</strong> are the most common tourist hotel districts in Mexico City — walkable, well served, and familiar to international visitors. Pick your vibe, then see real room photos.",
      image: SKYLINE,
      ctaHref: cdmxUtm("cdmx-safe-hero"),
      ctaLabel: "Find hotels by vibe →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Visitor districts</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best CDMX neighborhoods for visitors")}</h2>
      <div class="fgrid">
        <div class="fcard"><h3>Condesa</h3><p>Leafy parks, terrace cafés, and a compact visitor radius — popular first-timer base.</p><p><a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa →</a></p></div>
        <div class="fcard"><h3>Polanco</h3><p>Upscale, embassy-adjacent, and close to Chapultepec museums.</p><p><a href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco →</a></p></div>
        <div class="fcard"><h3>Roma Norte</h3><p>Trendy food scene and design hotels — livelier after dark than Condesa.</p><p><a href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte →</a></p></div>
        <div class="fcard"><h3>Juárez</h3><p>Central Reforma access and strong value between Roma and Polanco.</p><p><a href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez →</a></p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Compare: <a href="__ORIGIN__/condesa-vs-polanco">Condesa vs Polanco</a> · <a href="__ORIGIN__/where-to-stay-in-mexico-city">Where to stay in Mexico City</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best hotels in visitor-friendly neighborhoods")}</h2>
      ${hotelTiers("condesa", "Mexico City", "cdmx-safe-condesa")}
    </section>
    ${embedCdmx("cdmx-safe-search")}
  </div>`;
  writePage(
    "safe-neighborhoods-mexico-city.html",
    seo.wrapPage(
      body,
      { canonical, city: "Mexico City", pageCategory: "guide", defaultOgImage: SKYLINE_OG, campaign: "cdmx_seo_2026" },
      cdmxHeader("cdmx-safe-nav"),
      "Mexico City"
    )
  );
}

// ── CDMX: Chapultepec ───────────────────────────────────────────────────────
{
  const canonical = "hotels-near-chapultepec";
  const h1 = seoField(canonical, "h1", "Best Hotels near Chapultepec Park");
  const body =
    hero({
      kicker: "CDMX · Chapultepec",
      h1,
      lead:
        "<strong>Polanco</strong> is the classic Chapultepec base — Museo Soumaya, leafy avenues, and park runs. <strong>Juárez</strong> and <strong>Condesa</strong> sit slightly south with café culture and Reforma access.",
      image: SOUMAYA,
      ctaHref: cdmxUtm("cdmx-chapultepec-hero"),
      ctaLabel: "Search CDMX hotels →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Near the park</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best hotels near Chapultepec Park")}</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${NBHD_POLANCO}')"><h3>Polanco</h3><p>Museum mile and Chapultepec&apos;s eastern edge — best for park + luxury.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_CONDESA}')"><h3>Condesa</h3><p>Leafy mornings and Parque México — slightly south of the park.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_ROMA}')"><h3>Juárez</h3><p>Reforma corridor and quick Chapultepec access without Polanco rates.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez →</a></div>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">Best hotels in Polanco near Chapultepec</h2>
      ${hotelTiers("polanco", "Mexico City", "cdmx-chapultepec-polanco")}
    </section>
    ${embedCdmx("cdmx-chapultepec-search")}
  </div>`;
  writePage(
    "hotels-near-chapultepec.html",
    seo.wrapPage(
      body,
      { canonical, city: "Mexico City", pageCategory: "guide", defaultOgImage: SKYLINE_OG, campaign: "cdmx_seo_2026" },
      cdmxHeader("cdmx-chapultepec-nav"),
      "Mexico City"
    )
  );
}

// ── CDMX: first-time visitors ────────────────────────────────────────────────
{
  const canonical = "best-area-to-stay-in-mexico-city-first-time";
  const h1 = seoField(canonical, "h1", "Best Area to Stay in Mexico City for First-Time Visitors");
  const body =
    hero({
      kicker: "CDMX · First visit",
      h1,
      lead:
        "First trip to Mexico City? <strong>Condesa</strong> and <strong>Roma Norte</strong> are the easiest bases — leafy, walkable, and full of cafés. <strong>Polanco</strong> suits museums and upscale dining. Compare areas, then match hotels by real room photos.",
      image: NBHD_CONDESA,
      ctaHref: cdmxUtm("cdmx-first-time-hero"),
      ctaLabel: "Take the 30-second quiz →",
    }) +
    `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Quick picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best Mexico City neighborhoods for first-time visitors")}</h2>
      <div class="fgrid">
        <div class="fcard"><h3>Condesa</h3><p>Leafy parks, terrace cafés, and a compact visitor radius — the default first-timer pick.</p><p><a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa →</a></p></div>
        <div class="fcard"><h3>Roma Norte</h3><p>Trendy food scene, design hotels, and galleries — livelier after dark than Condesa.</p><p><a href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte →</a></p></div>
        <div class="fcard"><h3>Polanco</h3><p>Museum mile, Chapultepec access, and polished dining when luxury is the priority.</p><p><a href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco →</a></p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Still deciding? Read <a href="__ORIGIN__/roma-norte-vs-condesa">Roma Norte vs Condesa</a> or the full <a href="__ORIGIN__/where-to-stay-in-mexico-city">where to stay in Mexico City</a> guide.</p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best Mexico City hotels for first-time visitors")}</h2>
      ${hotelTiers("condesa", "Mexico City", "cdmx-first-time-condesa")}
    </section>
    ${embedCdmx("cdmx-first-time-search")}
  </div>`;
  writePage(
    "best-area-to-stay-in-mexico-city-first-time.html",
    seo.wrapPage(
      body,
      { canonical, city: "Mexico City", pageCategory: "guide", defaultOgImage: SKYLINE_OG, campaign: "cdmx_seo_2026" },
      cdmxHeader("cdmx-first-time-nav"),
      "Mexico City"
    )
  );
}

console.log("Done — 6 spoke SEO pages.");
