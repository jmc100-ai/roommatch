#!/usr/bin/env node
/**
 * Generate London tier-3 SEO spoke pages (first-time, travel, safe areas, Big Ben).
 * Run: node scripts/build-london-spoke-seo-pages.js
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");
const { searchableLabel } = require("./marketing-city-stats");

const LONDON_COUNT = searchableLabel("London");
const OUT = path.join(__dirname, "..", "client", "marketing");
const IMG = JSON.parse(fs.readFileSync(path.join(OUT, "city-marketing-images.json"), "utf8")).london;

function amp(url) {
  return String(url).replace(/&/g, "&amp;");
}

const LONDON_HERO = amp(IMG.hero["1920"]);
const LONDON_OG = amp(IMG.hero["1280"]);
const WESTMINSTER = amp(IMG.westminster["960"]);
const COVENT_GARDEN = amp(IMG.coventGarden["960"]);
const SOUTH_KENSINGTON = amp(IMG.southKensington["960"]);
const MARYLEBONE = amp(IMG.marylebone["960"]);
const SOUTH_BANK = amp(IMG.southBank["960"]);

function londonUtm(content) {
  return `__ORIGIN__/?city=London&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=london_seo_2026&amp;utm_content=${content}`;
}

function londonHeader(utmContent) {
  return `<header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/london-hotels">London hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-london">Where to stay in London</a>
        <a href="__ORIGIN__/london-hotel-finder">London hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${londonUtm(utmContent)}">Try London →</a>
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
      <div class="hero-cta-row"><a class="mcta" href="${ctaHref}">${ctaLabel}</a></div>
      <div class="social-proof" aria-label="Product scale">
        <span>Real room photos</span>
        <span>Neighborhood vibe matching</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function embedLondon(utmContent) {
  return `<div class="embed-search">
      <h3>Find your London hotel match</h3>
      <p>Describe the room you want — rainfall shower, Victorian light, Thames view — and we rank real London hotel photos.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="London" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="london_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Westminster" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
    </div>
    <script>
      document.querySelectorAll('[data-marketing-search]').forEach(function(f){
        f.addEventListener('submit', function(e){
          var q = (f.querySelector('[name=q]')||{}).value;
          if (!q || !String(q).trim()) { e.preventDefault(); window.location.href = '${londonUtm(utmContent + "-quiz")}'; }
        });
      });
    </script>`;
}

function hotelTiers(preset, utmBase) {
  return `
      <h3 class="hotel-tier-title">Luxury picks</h3>
      <div data-preset="${preset}" data-tier="luxury" data-city="London" data-utm="${utmBase}-luxury" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Boutique picks</h3>
      <div data-preset="${preset}" data-tier="boutique" data-city="London" data-utm="${utmBase}-boutique" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Value picks</h3>
      <div data-preset="${preset}" data-tier="value" data-city="London" data-utm="${utmBase}-value" aria-live="polite"></div>`;
}

function writePage(file, html) {
  fs.writeFileSync(path.join(OUT, file), html, "utf8");
  console.log("wrote", file);
}

{
  const canonical = "best-area-to-stay-in-london-first-time";
  const h1 = seoField(canonical, "h1", "Best Area to Stay in London for First-Time Visitors");
  writePage(
    `${canonical}.html`,
    seo.wrapPage(
      hero({
        kicker: "London · First visit",
        h1,
        lead:
          "First trip to London? <strong>Westminster</strong> and <strong>Covent Garden</strong> are the easiest bases — walkable, central, and full of icons. <strong>South Kensington</strong> suits museum-heavy days. Compare areas, then match hotels by real room photos.",
        image: WESTMINSTER,
        ctaHref: londonUtm("london-first-time-hero"),
        ctaLabel: "Take the 30-second quiz →",
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Quick picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best London neighborhoods for first-time visitors")}</h2>
      <div class="fgrid">
        <div class="fcard"><h3>Westminster</h3><p>Big Ben, Westminster Abbey, and St James&apos;s Park — postcard London on foot.</p><p><a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster →</a></p></div>
        <div class="fcard"><h3>Covent Garden</h3><p>West End theatre, street performers, and buzzy pedestrian streets — the default first-timer pick.</p><p><a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden →</a></p></div>
        <div class="fcard"><h3>South Kensington</h3><p>V&amp;A, Natural History Museum, and refined Victorian streets near Hyde Park.</p><p><a href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington →</a></p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Still deciding? Read <a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a> or the full <a href="__ORIGIN__/where-to-stay-in-london">where to stay in London</a> guide.</p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best London hotels for first-time visitors")}</h2>
      ${hotelTiers("london-westminster", "london-first-time-westminster")}
    </section>
    ${embedLondon("london-first-time-search")}
  </div>`,
      { canonical, city: "London", pageCategory: "guide", defaultOgImage: LONDON_OG, campaign: "london_seo_2026" },
      londonHeader("london-first-time-nav"),
      "London"
    )
  );
}

{
  const canonical = "london-hotels-near-big-ben";
  const h1 = seoField(canonical, "h1", "London Hotels Near Big Ben & Westminster");
  writePage(
    `${canonical}.html`,
    seo.wrapPage(
      hero({
        kicker: "London · Westminster",
        h1,
        lead:
          "Hotels near <strong>Big Ben</strong> and <strong>Westminster Abbey</strong> put royal London on your doorstep — river walks, St James&apos;s Park, and indexed room photos you can verify before booking.",
        image: WESTMINSTER,
        ctaHref: londonUtm("london-bigben-hero"),
        ctaLabel: "Search Westminster rooms →",
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Best areas</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best areas near Westminster and Big Ben")}</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${WESTMINSTER}')"><h3>Westminster</h3><p>Closest to Big Ben, Parliament, and the Abbey — the classic first-timer base.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SOUTH_BANK}')"><h3>South Bank</h3><p>Thames views across from Westminster — London Eye and Tate Modern walks.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-south-bank">Hotels in South Bank →</a></div>
        <div class="nbhd-tile" style="background-image:url('${COVENT_GARDEN}')"><h3>Covent Garden</h3><p>Short Tube hop north — West End theatre after daytime sightseeing.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden →</a></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Try visual search: <a href="__ORIGIN__/london-visual-search">London hotels by room photos</a> — query <em>Thames view, Victorian windows</em>.</p>
    </section>
    <section class="msec">
      <h2 class="msec-title">Hotel picks near Big Ben</h2>
      ${hotelTiers("london-westminster", "london-bigben-westminster")}
    </section>
    ${embedLondon("london-bigben-search")}
  </div>`,
      { canonical, city: "London", pageCategory: "guide", defaultOgImage: LONDON_OG, campaign: "london_seo_2026" },
      londonHeader("london-bigben-nav"),
      "London"
    )
  );
}

{
  const canonical = "travel-london-hotels";
  const h1 = seoField(canonical, "h1", "Travel London Hotels");
  writePage(
    `${canonical}.html`,
    seo.wrapPage(
      hero({
        kicker: "London · Travel planning",
        h1,
        lead:
          `Planning <strong>travel to London</strong>? Pick a district that fits your trip, run the vibe quiz, then search <strong>${LONDON_COUNT} London hotels</strong> by real room and bathroom photos — before you commit on a booking site.`,
        image: LONDON_HERO,
        ctaHref: londonUtm("london-travel-hotels-hero"),
        ctaLabel: "Take the 30-second quiz →",
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Start here</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "How to plan travel to London hotels")}</h2>
      <div class="how-row">
        <article class="how-card"><div class="how-txt"><span class="how-num">1</span><h3>Pick your neighborhood</h3><p>Westminster and Covent Garden for first trips; South Kensington for museums; Marylebone for boutique calm. Read <a href="__ORIGIN__/where-to-stay-in-london">where to stay in London</a>.</p></div></article>
        <article class="how-card"><div class="how-txt"><span class="how-num">2</span><h3>Shape your vibe</h3><p>Our wizard captures trip pace, must-haves, and room mood — sleek, cozy, Victorian, or design-forward.</p></div></article>
        <article class="how-card"><div class="how-txt"><span class="how-num">3</span><h3>See real rooms</h3><p>Describe rainfall shower, bright suite, or Thames view. We rank hotels whose indexed photos match.</p></div></article>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Neighborhoods", "Travel London hotels by neighborhood")}</h2>
      <nav class="hub-links" aria-label="London hotel neighborhoods">
        <a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster</a>
        <a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden</a>
        <a href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington</a>
        <a href="__ORIGIN__/hotels-in-marylebone">Hotels in Marylebone</a>
        <a href="__ORIGIN__/hotels-in-shoreditch">Hotels in Shoreditch</a>
      </nav>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best London hotels for travellers")}</h2>
      ${hotelTiers("london-covent-garden", "london-travel-covent")}
    </section>
    ${embedLondon("london-travel-hotels-search")}
  </div>`,
      { canonical, city: "London", pageCategory: "guide", defaultOgImage: LONDON_OG, campaign: "london_seo_2026" },
      londonHeader("london-travel-hotels-nav"),
      "London"
    )
  );
}

{
  const canonical = "safe-neighborhoods-london";
  const h1 = seoField(canonical, "h1", "Best Areas to Stay in London for Tourists");
  writePage(
    `${canonical}.html`,
    seo.wrapPage(
      hero({
        kicker: "London · Visitor areas",
        h1,
        lead:
          "<strong>Westminster</strong>, <strong>Covent Garden</strong>, <strong>South Kensington</strong>, and <strong>Marylebone</strong> are the most common tourist hotel districts in London — walkable, well served, and familiar to international visitors. Pick your vibe, then see real room photos.",
        image: MARYLEBONE,
        ctaHref: londonUtm("london-safe-hero"),
        ctaLabel: "Find hotels by vibe →",
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Visitor districts</p>
      <h2 class="msec-title">${seoField(canonical, "h2Featured", "Best London neighborhoods for visitors")}</h2>
      <div class="fgrid">
        <div class="fcard"><h3>Westminster</h3><p>Icons, parks, and river walks — the postcard London most first-timers expect.</p><p><a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster →</a></p></div>
        <div class="fcard"><h3>Covent Garden</h3><p>Central, flat, and theatre-dense — lively without needing a car.</p><p><a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden →</a></p></div>
        <div class="fcard"><h3>South Kensington</h3><p>Museum mornings and refined Victorian streets near Hyde Park.</p><p><a href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington →</a></p></div>
        <div class="fcard"><h3>Marylebone</h3><p>Upscale village calm on Marylebone High Street — minutes from Oxford Street.</p><p><a href="__ORIGIN__/hotels-in-marylebone">Hotels in Marylebone →</a></p></div>
      </div>
      <p class="msec-lead" style="margin-top:20px">Compare: <a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a> · <a href="__ORIGIN__/where-to-stay-in-london">Where to stay in London</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField(canonical, "h2Hotels", "Best hotels in visitor-friendly London neighborhoods")}</h2>
      ${hotelTiers("london-westminster", "london-safe-westminster")}
    </section>
    ${embedLondon("london-safe-search")}
  </div>`,
      { canonical, city: "London", pageCategory: "guide", defaultOgImage: LONDON_OG, campaign: "london_seo_2026" },
      londonHeader("london-safe-nav"),
      "London"
    )
  );
}

console.log("Done — 4 London spoke pages.");
