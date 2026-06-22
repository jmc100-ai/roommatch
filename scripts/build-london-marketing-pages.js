#!/usr/bin/env node
/**
 * Generate London SEO marketing HTML pages (hub-and-spoke cluster, parallel to Paris).
 * Run: node scripts/build-london-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");
const { searchableLabel, socialProofSpan } = require("./marketing-city-stats");

const LONDON_COUNT = searchableLabel("London");
const LONDON_SOCIAL = socialProofSpan("London");

const OUT = path.join(__dirname, "..", "client", "marketing");
const IMG = JSON.parse(
  fs.readFileSync(path.join(OUT, "city-marketing-images.json"), "utf8")
).london;

function amp(url) {
  return String(url).replace(/&/g, "&amp;");
}

const LONDON_HERO = amp(IMG.hero["1920"]);
const LONDON_OG = amp(IMG.hero["1280"]);
const WESTMINSTER = amp(IMG.westminster["960"]);
const COVENT_GARDEN = amp(IMG.coventGarden["960"]);
const SOUTH_KENSINGTON = amp(IMG.southKensington["960"]);
const MARYLEBONE = amp(IMG.marylebone["960"]);
const SHOREDITCH = amp(IMG.shoreditch["960"]);
const NOTTING_HILL = amp(IMG.nottingHill["960"]);
const SOUTH_BANK = amp(IMG.southBank["960"]);
const SOHO = amp(IMG.soho["960"]);
const TOWER_BRIDGE = amp(IMG.towerBridge["960"]);
const TUBE = amp(IMG.tube["960"]);
const HYDE_PARK = amp(IMG.hydePark["960"]);

const HUB_LINKS = seo.hubLinks("London");

function utm(content) {
  return `__ORIGIN__/?city=London&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=london_seo_2026&amp;utm_content=${content}`;
}

function page(body, meta) {
  return seo.wrapPage(
    body,
    { defaultOgImage: LONDON_OG, campaign: "london_seo_2026", ...meta },
    header(meta.utmNav || meta.canonical.replace(/-/g, "_")),
    "London"
  );
}
function header(navCta) {
  return `<header class="mhead">
    <div class="mhead-inner">
      <a class="mbrand" href="__ORIGIN__/">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="18" cy="18" r="15" stroke="#c9a96e" stroke-width="1.85" opacity=".88"/><circle cx="18" cy="18" r="6.5" fill="#c9a96e"/></svg>
        TravelByVibe
      </a>
      <nav class="mnav" aria-label="Marketing">
        <a href="__ORIGIN__/london-hotels">London hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-london">Where to stay</a>
        <a href="__ORIGIN__/london-hotel-finder">Hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${utm(navCta)}">Try London →</a>
      </nav>
    </div>
  </header>`;
}

function hero({ kicker, h1, lead, heroImage, heroAlt, ctaPrimary, ctaSecondary, utmPrimary, utmSecondary }) {
  const aria = heroAlt ? ` role="img" aria-label="${heroAlt.replace(/"/g, "&quot;")}"` : "";
  return `<section class="hero"${aria} style="background-image:url('${heroImage || LONDON_HERO}')">
    <div class="hero-inner">
      <p class="hero-kicker">${kicker}</p>
      <h1>${h1}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utm(utmPrimary)}">${ctaPrimary}</a>
        ${ctaSecondary ? `<a class="mcta-secondary" href="${utm(utmSecondary)}">${ctaSecondary}</a>` : ""}
      </div>
      <div class="social-proof" aria-label="Product scale">
        <span>${LONDON_SOCIAL}</span>
        <span>Real room photos</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function compareHero({ kicker, h1, lead, leftImage, rightImage, leftLabel, rightLabel, ctaPrimary, utmPrimary }) {
  return `<section class="hero hero--compare">
    <div class="hero-split" aria-hidden="true">
      <div class="hero-split-side" style="background-image:url('${leftImage}')"></div>
      <div class="hero-split-side" style="background-image:url('${rightImage}')"></div>
    </div>
    <div class="hero-split-labels" aria-hidden="true"><span>${leftLabel}</span><span>${rightLabel}</span></div>
    <div class="hero-inner">
      <p class="hero-kicker">${kicker}</p>
      <h1>${h1}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utm(utmPrimary)}">${ctaPrimary}</a>
      </div>
      <div class="social-proof" aria-label="Product scale">
        <span>${LONDON_SOCIAL}</span>
        <span>Real room photos</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
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

function quizCta(text, utmContent) {
  return `<div class="quiz-callout">
        <p>${text}</p>
        <a class="mcta" href="${utm(utmContent)}">Take the 30-second quiz →</a>
      </div>`;
}

function embedSearch(utmContent) {
  return `<div class="embed-search">
      <h3>Find your London hotel match</h3>
      <p>Describe the room you want — rainfall shower, Victorian light, Thames view — and we rank real hotel photos for you.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="London" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="london_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Westminster" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
      <p style="margin-top:14px;font-size:14px"><a href="${utm(utmContent + "-quiz")}">Or start with the vibe wizard →</a></p>
    </div>
    <script>
      document.querySelectorAll('[data-marketing-search]').forEach(function(f){
        f.addEventListener('submit', function(e){
          var q = (f.querySelector('[name=q]')||{}).value;
          if (!q || !String(q).trim()) { e.preventDefault(); window.location.href = '${utm(utmContent + "-quiz")}'; }
        });
      });
    </script>`;
}

function nbhdGuideGrid() {
  return `<div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${WESTMINSTER}')"><h3>Westminster</h3><p>Big Ben, Westminster Abbey, St James&apos;s Park — postcard London and royal icons.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster →</a></div>
        <div class="nbhd-tile" style="background-image:url('${COVENT_GARDEN}')"><h3>Covent Garden</h3><p>West End theatre, street performers, and a buzzy pedestrian core — the default first-timer pick.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SOUTH_KENSINGTON}')"><h3>South Kensington</h3><p>V&amp;A, Natural History Museum, refined Victorian streets near Hyde Park.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington →</a></div>
        <div class="nbhd-tile" style="background-image:url('${MARYLEBONE}')"><h3>Marylebone</h3><p>Marylebone High Street, leafy squares, boutique charm without Oxford Street chaos.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-marylebone">Hotels in Marylebone →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SHOREDITCH}')"><h3>Shoreditch</h3><p>East London street art, rooftop bars, warehouse hotels — edgy over iconic.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-shoreditch">Hotels in Shoreditch →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NOTTING_HILL}')"><h3>Notting Hill</h3><p>Portobello Road, pastel townhouses, village feel in west London.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-notting-hill">Hotels in Notting Hill →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SOUTH_BANK}')"><h3>South Bank</h3><p>Tate Modern, London Eye, Thames promenade — culture along the river.</p><a class="nbhd-row-cta" href="__ORIGIN__/where-to-stay-in-london">London neighborhood guide →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SOHO}')"><h3>Westminster vs Covent Garden</h3><p>Royal icons or theatre buzz? Compare the two.</p><a class="nbhd-row-cta" href="__ORIGIN__/westminster-vs-covent-garden">Compare →</a></div>
      </div>
      <p class="nbhd-photo-credits">Neighborhood photos from TravelByVibe&apos;s London vibe index — Wikimedia Commons, Unsplash, and Flickr.</p>`;
}

const PAGES = [];

// ── Where to stay (primary hub) ─────────────────────────────────────────────
PAGES.push({
  file: "where-to-stay-in-london.html",
  html: page(
    hero({
      kicker: "London · Neighborhood guide",
      h1: seoField("where-to-stay-in-london", "h1", "Where to Stay in London — Hotels by Neighborhood"),
      lead:
        "Westminster, Covent Garden, South Kensington, Marylebone, or Shoreditch? This guide maps <strong>neighborhood character</strong> to hotels that fit — then TravelByVibe matches you using <strong>real room photos</strong>.",
      heroImage: LONDON_HERO,
      ctaPrimary: "Take the 30-second quiz →",
      ctaSecondary: "Browse hotels by vibe",
      utmPrimary: "where-to-stay-london-hero-quiz",
      utmSecondary: "where-to-stay-london-hero-browse",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-lead">Choosing <strong>where to stay in London</strong> is mostly a neighborhood decision — Westminster for royal icons, Covent Garden for West End theatre, South Kensington for museums, Marylebone for village charm, or Shoreditch for East London energy. This guide compares each district, then TravelByVibe matches you to hotels using <strong>real room photos</strong>.</p>
      <h2 class="msec-title">Where to stay in London for first-timers</h2>
      <p class="msec-lead"><strong>Westminster</strong> and <strong>Covent Garden</strong> are the most popular first-time picks — flat, walkable, and packed with landmarks. For a longer breakdown, see our <a href="__ORIGIN__/best-area-to-stay-in-london-first-time">best area to stay in London for first-time visitors</a> guide.</p>
      <p class="msec-kicker">At a glance</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-london", "h2Featured", "Best neighborhoods at a glance")}</h2>
      ${HUB_LINKS}
      <div class="compare-wrap" style="margin-top:24px">
        <table class="compare-table">
          <thead><tr><th scope="col">Neighborhood</th><th scope="col">Best for</th><th scope="col">Vibe</th></tr></thead>
          <tbody>
            <tr><td><a href="__ORIGIN__/hotels-in-westminster">Westminster</a></td><td>First-timers, royal icons, river walks</td><td>Postcard, historic, central</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-covent-garden">Covent Garden</a></td><td>Theatre, dining, walkable West End</td><td>Buzzy, pedestrian, entertainment</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-south-kensington">South Kensington</a></td><td>Museums, Hyde Park, refined stays</td><td>Victorian, cultured, polished</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-marylebone">Marylebone</a></td><td>Boutique charm, village high street</td><td>Leafy, calm, upscale-local</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-shoreditch">Shoreditch</a></td><td>Creative East London, nightlife</td><td>Edgy, warehouse, rooftop bars</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-london", "h2Hotels", "Best London hotels by neighborhood")}</h2>
      <p class="msec-lead">Browse indexed London hotels with real room and bathroom photos in each district — or search all of London by vibe.</p>
      <p class="msec-lead"><a href="__ORIGIN__/london-hotels">All London hotels</a> · <a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster</a> · <a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden</a> · <a href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington</a> · <a href="__ORIGIN__/hotels-in-marylebone">Hotels in Marylebone</a> · <a href="__ORIGIN__/hotels-in-shoreditch">Hotels in Shoreditch</a></p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Match your style</p>
      <h2 class="msec-title">Which London neighborhood fits your trip?</h2>
      <div class="fgrid">
        <div class="fcard"><h3>First visit + walkable icons</h3><p><strong>Westminster</strong> or <strong>Covent Garden</strong> — Big Ben, the Abbey, West End theatre, and river walks without a car. See our <a href="__ORIGIN__/london-walkable-hotels">walkable London hotels</a> guide or compare <a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a>.</p></div>
        <div class="fcard"><h3>Museums + Victorian calm</h3><p><strong>South Kensington</strong> — V&amp;A mornings, Natural History Museum afternoons, and refined streets near Hyde Park.</p></div>
        <div class="fcard"><h3>Boutique village charm</h3><p><strong>Marylebone</strong> — leafy squares and Marylebone High Street without Oxford Street chaos. Pair with <a href="__ORIGIN__/london-boutique-hotels">London boutique hotels</a>.</p></div>
        <div class="fcard"><h3>East London edge</h3><p><strong>Shoreditch</strong> — street art, warehouse hotels, and rooftop bars when iconic postcard London is not the priority.</p></div>
      </div>
      ${quizCta("<strong>Not sure?</strong> Our vibe wizard captures trip pace, must-haves, and neighborhood feel — then ranks London hotels with real room photography.", "where-to-stay-london-quiz")}
    </section>
    <section class="msec">
      <p class="msec-kicker">See the city</p>
      <h2 class="msec-title">Six districts, six different rhythms</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${WESTMINSTER}')"><h3>Westminster</h3><p>Big Ben, Westminster Abbey, and St James&apos;s Park — royal icons on foot.</p></div>
        <div class="nbhd-tile" style="background-image:url('${COVENT_GARDEN}')"><h3>Covent Garden</h3><p>West End theatre, street performers, and a buzzy pedestrian core.</p></div>
        <div class="nbhd-tile" style="background-image:url('${SOUTH_BANK}')"><h3>South Bank</h3><p>Tate Modern, London Eye, and Thames promenade culture.</p></div>
      </div>
    </section>
    ${embedSearch("where-to-stay-london-search")}
  </div>
  <main class="wrap">
    <h2>Find hotels by vibe</h2>
    <p>Area fit is half the decision. TravelByVibe also ranks suites by how closely their <strong>real room photos</strong> match what you describe — bathrooms, Victorian light, layout, and design.</p>
    <p>Explore: <a href="__ORIGIN__/hotels-in-westminster">hotels in Westminster</a>, <a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a>, and our <a href="__ORIGIN__/london-hotel-finder">London hotel finder</a>.</p>
    <div class="cta-band">
      <p>Ready to match neighborhood + room?</p>
      <a class="mcta" href="${utm("where-to-stay-london-footer")}">Start in London — free</a>
    </div>
  </main>`,
    {
      canonical: "where-to-stay-in-london",
      city: "London",
      pageCategory: "hub",
    }
  ),
});

PAGES.push({
  file: "london-neighborhood-guide.html",
  html: page(
    hero({
      kicker: "London neighborhoods",
      h1: seoField("london-neighborhood-guide", "h1", "London Neighborhood Guide"),
      lead: "A practical map of London&apos;s best hotel districts — what each area feels like, who it suits, and where to search next.",
      heroImage: TOWER_BRIDGE,
      ctaPrimary: "Match my neighborhood →",
      ctaSecondary: "Hotel finder",
      utmPrimary: "london-nbhd-guide-hero",
      utmSecondary: "london-nbhd-guide-finder",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      ${HUB_LINKS}
      <p class="msec-lead" style="margin-top:20px">Use this guide alongside <a href="__ORIGIN__/where-to-stay-in-london">Where to Stay in London</a> — comparison tables and vibe matching on the hub page.</p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField("london-neighborhood-guide", "h2Hotels", "Best London hotels by neighborhood")}</h2>
      <p class="msec-lead"><a href="__ORIGIN__/london-hotels">London hotels hub</a> · <a href="__ORIGIN__/hotels-in-westminster">Westminster</a> · <a href="__ORIGIN__/hotels-in-covent-garden">Covent Garden</a> · <a href="__ORIGIN__/hotels-in-south-kensington">South Kensington</a> · <a href="__ORIGIN__/hotels-in-marylebone">Marylebone</a> · <a href="__ORIGIN__/hotels-in-shoreditch">Shoreditch</a> · <a href="__ORIGIN__/hotels-in-notting-hill">Notting Hill</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">Neighborhood deep links</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("london-nbhd-guide-search")}
  </div>`,
    { canonical: "london-neighborhood-guide", city: "London", pageCategory: "hub" }
  ),
});

PAGES.push({
  file: "london-hotel-finder.html",
  html: page(
    hero({
      kicker: "Interactive guide",
      h1: "London Hotel Finder — Where Should You Stay?",
      lead: "Compare Westminster, Covent Garden, South Kensington, Marylebone, and Shoreditch vibes — then jump into TravelByVibe&apos;s photo-first London search.",
      heroImage: TOWER_BRIDGE,
      ctaPrimary: "Start the vibe quiz →",
      ctaSecondary: null,
      utmPrimary: "london-hotel-finder-hero",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Six vibes</p>
      <h2 class="msec-title">Pick the neighborhood energy that fits your trip</h2>
      ${nbhdGuideGrid()}
    </section>
    <section class="msec">
      <p class="msec-kicker">Your turn</p>
      <h2 class="msec-title">Search London hotels by vibe</h2>
      ${embedSearch("london-hotel-finder-embed")}
      ${quizCta("<strong>Prefer a guided flow?</strong> The vibe wizard captures neighborhood pace and room must-haves before you search.", "london-hotel-finder-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
    { canonical: "london-hotel-finder", city: "London", pageCategory: "hub" }
  ),
});

// Main hotels hub
PAGES.push({
  file: "london-hotels.html",
  html: page(
    hero({
      kicker: "London · TravelByVibe",
      h1: seoField("london-hotels", "h1", "Find London hotels that match your vibe"),
      lead: `Search <strong>hotels in London</strong> by neighborhood and <strong>real room photos</strong> — browse ${LONDON_COUNT} London properties and match atmosphere, not just price and stars.`,
      heroImage: LONDON_HERO,
      ctaPrimary: "Take the 30-second quiz →",
      ctaSecondary: "Browse hotels by vibe",
      utmPrimary: "london-hotels-hero-quiz",
      utmSecondary: "london-hotels-hero-browse",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      ${HUB_LINKS}
      <p class="msec-kicker">Plan your trip</p>
      <h2 class="msec-title">${seoField("london-hotels", "h2Travel", "Best London hotels by neighborhood")}</h2>
      <p class="msec-lead">Most travellers start with the neighborhood — then pick a hotel whose rooms actually look like the trip you have in mind. Jump into a district guide or read the full <a href="__ORIGIN__/where-to-stay-in-london">where to stay in London</a> planner.</p>
      <nav class="hub-links" aria-label="London hotel neighborhoods">
        <a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster</a>
        <a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden</a>
        <a href="__ORIGIN__/hotels-in-south-kensington">Hotels in South Kensington</a>
        <a href="__ORIGIN__/hotels-in-marylebone">Hotels in Marylebone</a>
        <a href="__ORIGIN__/hotels-in-shoreditch">Hotels in Shoreditch</a>
        <a href="__ORIGIN__/hotels-in-notting-hill">Hotels in Notting Hill</a>
        <a href="__ORIGIN__/where-to-stay-in-london">Where to stay in London</a>
        <a href="__ORIGIN__/london-neighborhood-guide">London neighborhood guide</a>
      </nav>
    </section>
    <section class="msec trust-block">
      <p class="msec-kicker">Why us</p>
      <h2 class="msec-title">Why TravelByVibe for London?</h2>
      <p class="msec-lead">Most hotel sites show one lobby shot and a star count. We help you judge the <em>room</em> and the <em>neighborhood</em> before you book.</p>
      <ul class="mcheck">
        <li>Match hotels to your travel style — sleek, cozy, moody, classic Victorian</li>
        <li>Browse real guest room and bathroom photos, not marketing clichés</li>
        <li>Discover London neighborhoods visually — Westminster, Covent Garden, Shoreditch, and more</li>
        <li>${LONDON_COUNT} London hotels with indexed room photography — catalog growing weekly</li>
      </ul>
      <div class="section-cta">
        <a class="mcta" href="${utm("london-hotels-trust")}">Find my London hotel match →</a>
      </div>
    </section>
    <section class="msec" style="padding-top:36px">
      <p class="msec-kicker">Visual first</p>
      <h2 class="msec-title">Scroll real rooms—not the same chandelier lobby</h2>
      <p class="msec-lead">London spans grand dame hotels, design boutiques, and warehouse conversions. TravelByVibe is for travellers who decide with their eyes—bathrooms, Victorian light, and layout from actual property photography.</p>
      <div class="vibe-strip" aria-label="London room moods">
        <figure class="vibe-card">
          <img src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Elegant hotel bathroom with marble" loading="lazy" />
          <figcaption><strong>Marble bath</strong>Rainfall shower and double vanity — surfaced from real bathroom photos.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Bright hotel bedroom" loading="lazy" />
          <figcaption><strong>Victorian bright</strong>Tall windows and pale walls — the London morning you picture.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Hotel room with soft evening light" loading="lazy" />
          <figcaption><strong>Moody boutique</strong>Velvet, brass, and low light — find bedrooms that feel intimate.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="${TOWER_BRIDGE}" width="960" height="640" alt="Tower Bridge, London" loading="lazy" />
          <figcaption><strong>Thames energy</strong>River views — pair neighborhood choice with the right room.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="${WESTMINSTER}" width="960" height="640" alt="Westminster, London" loading="lazy" />
          <figcaption><strong>Westminster icons</strong>Postcard London when you want royal landmarks on foot.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="${COVENT_GARDEN}" width="960" height="640" alt="Covent Garden, London" loading="lazy" />
          <figcaption><strong>Covent Garden buzz</strong>West End theatre and pedestrian energy without a car.</figcaption>
        </figure>
      </div>
      <div class="section-cta">
        <a class="mcta" href="${utm("london-hotels-visual")}">Browse hotels by vibe →</a>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Vibe matching</p>
      <h2 class="msec-title">What we mean by “vibe match”</h2>
      <div class="split split-reverse">
        <div class="split-visual">
          <img src="${HYDE_PARK}" width="900" height="700" alt="Hyde Park, London" loading="lazy" />
        </div>
        <div class="split-body">
          <h3>Language you already use</h3>
          <p>No endless filter grids — you type the trip in your head, like <em>Victorian bedroom, rainfall shower, Thames view at golden hour, Marylebone calm</em>. We line that up against real London hotel photos indexed on TravelByVibe.</p>
          <p>Hotels rise to the top when their rooms look close to what you asked for. Add dates when you are ready and we fold in live prices when partners send them.</p>
          <div class="section-cta" style="margin-top:18px">
            <a class="mcta" href="${utm("london-hotels-vibe")}">Take the 30-second quiz →</a>
          </div>
        </div>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">How it works</p>
      <h2 class="msec-title">From daydream to shortlist in four beats</h2>
      <p class="msec-lead">London rewards a visual approach — ${LONDON_COUNT} searchable hotels with room photography and neighborhood vibe matching.</p>
      <div class="how-row">
        <article class="how-card">
          <div class="how-txt"><span class="how-num">1</span><h3>Shape your vibe</h3><p>A friendly wizard captures trip context, neighborhood pace, and must-haves — fast taps, zero spreadsheets.</p></div>
        </article>
        <article class="how-card">
          <div class="how-txt"><span class="how-num">2</span><h3>Pick a neighborhood</h3><p>Westminster icons, Covent Garden buzz, Shoreditch edge — compare on our <a href="__ORIGIN__/where-to-stay-in-london">where to stay guide</a>.</p></div>
        </article>
        <article class="how-card">
          <div class="how-txt"><span class="how-num">3</span><h3>See real rooms</h3><p>Describe rainfall shower, Victorian light, or moody boutique mood. We rank hotels whose photos match.</p></div>
        </article>
        <article class="how-card">
          <div class="how-txt"><span class="how-num">4</span><h3>Book when ready</h3><p>Add dates for live rates. Until then, browsing and visual search stay free.</p></div>
        </article>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">City + room</p>
      <h2 class="msec-title">London on the map—then inside the suite</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("london-hotels-search")}
  </div>
  <main class="wrap">
    <h2>Plan London with both eyes open</h2>
    <p>Guides: <a href="__ORIGIN__/where-to-stay-in-london">Where to stay in London</a> · <a href="__ORIGIN__/london-visual-search">Visual room search</a> · <a href="__ORIGIN__/london-walkable-hotels">Walkable London hotels</a> · <a href="__ORIGIN__/london-boutique-hotels">London boutique hotels</a></p>
    <p>Popular searches: Victorian light · rainfall shower · romantic soaking tub · Thames view · Marylebone boutique</p>
    <div class="cta-band">
      <p>Describe your London room—see matches in seconds.</p>
      <a class="mcta" href="${utm("london-hotels-footer")}">Search London hotels</a>
    </div>
  </main>`,
    { canonical: "london-hotels", city: "London", pageCategory: "hub" }
  ),
});

// Neighborhood stays (vibe-focused spoke)
PAGES.push({
  file: "london-neighborhood-stays.html",
  html: page(
    hero({
      kicker: "London · Neighborhoods",
      h1: seoField("london-neighborhood-stays", "h1", "London Hotels by Neighborhood"),
      lead: "TravelByVibe connects <strong>neighborhood energy</strong> with <strong>hotel room reality</strong>. Tell us if you want icons-and-buzz, museum calm, village high streets, or East London edge.",
      heroImage: LONDON_HERO,
      ctaPrimary: "Start in London →",
      ctaSecondary: "Neighborhood guide",
      utmPrimary: "london-nbhd-stays-hero",
      utmSecondary: "london-nbhd-stays-guide",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Feel the city first</p>
      <h2 class="msec-title">London is dozens of villages in one capital</h2>
      <div class="vibe-strip" aria-label="London neighborhoods">
        <figure class="vibe-card"><img src="${TUBE}" width="960" height="640" alt="London Underground sign" loading="lazy" /><figcaption><strong>Tube rhythm</strong>Every borough has a different pulse.</figcaption></figure>
        <figure class="vibe-card"><img src="${SOHO}" width="960" height="640" alt="Soho, London" loading="lazy" /><figcaption><strong>Soho nights</strong>Chinatown, nightlife, creative dining core.</figcaption></figure>
        <figure class="vibe-card"><img src="${SOUTH_KENSINGTON}" width="960" height="640" alt="South Kensington, London" loading="lazy" /><figcaption><strong>Museum mornings</strong>V&amp;A and Natural History within easy reach.</figcaption></figure>
        <figure class="vibe-card"><img src="${SHOREDITCH}" width="960" height="640" alt="Shoreditch, London" loading="lazy" /><figcaption><strong>Shoreditch edge</strong>Street art and warehouse hotel moods.</figcaption></figure>
        <figure class="vibe-card"><img src="${NOTTING_HILL}" width="960" height="640" alt="Notting Hill, London" loading="lazy" /><figcaption><strong>Notting Hill village</strong>Portobello Road and pastel townhouses.</figcaption></figure>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">Which London neighborhood sounds like you?</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("london-nbhd-stays-search")}
  </div>`,
    { canonical: "london-neighborhood-stays", city: "London", pageCategory: "hub" }
  ),
});

// Visual search
PAGES.push({
  file: "london-visual-search.html",
  html: page(
    hero({
      kicker: "London · Visual search",
      h1: seoField("london-visual-search", "h1", "Search the room you can picture—not the brochure cliché"),
      lead: "Type the scene: <strong>Victorian bedroom, rainfall shower, Thames view, warehouse boutique suite</strong>. We line up <strong>real London hotel room photos</strong> so you judge with your eyes.",
      heroImage: LONDON_HERO,
      ctaPrimary: "Search London hotels →",
      ctaSecondary: "Take the quiz",
      utmPrimary: "london-visual-search-hero",
      utmSecondary: "london-visual-search-quiz",
    }) +
      `<div class="wrap-wide">
    <div class="query-board" style="background-image:url('${COVENT_GARDEN}');margin-top:36px" role="img" aria-label="Covent Garden, London">
      <div class="query-board-inner">
        <h3>Drop a sentence—see hotels that look the part</h3>
        <div class="query-chips">
          <span class="query-chip">Victorian light, soaking tub, quiet street</span>
          <span class="query-chip">Rainfall shower, marble bathroom</span>
          <span class="query-chip">Moody boutique, velvet and brass</span>
          <span class="query-chip">Thames view, tall windows at golden hour</span>
        </div>
      </div>
    </div>
    <section class="msec">
      <p class="msec-kicker">Visual vocabulary</p>
      <h2 class="msec-title">London textures that echo what you ask for</h2>
      <div class="vibe-strip">
        <figure class="vibe-card"><img src="${WESTMINSTER}" width="960" height="640" alt="Westminster, London" loading="lazy" /><figcaption><strong>Westminster grandeur</strong>Classic London drama in your room search.</figcaption></figure>
        <figure class="vibe-card"><img src="${MARYLEBONE}" width="960" height="640" alt="Marylebone, London" loading="lazy" /><figcaption><strong>Marylebone calm</strong>Boutique village moods in central London.</figcaption></figure>
        <figure class="vibe-card"><img src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Luxury hotel bathroom" loading="lazy" /><figcaption><strong>Marble bath</strong>Search rain shower and see real tile.</figcaption></figure>
        <figure class="vibe-card"><img src="${TOWER_BRIDGE}" width="960" height="640" alt="Tower Bridge, London" loading="lazy" /><figcaption><strong>View requests</strong>Thames glimpses with neighborhood fit.</figcaption></figure>
      </div>
    </section>
    ${embedSearch("london-visual-search-embed")}
  </div>
  <main class="wrap">
    <h2>Popular London visual searches</h2>
    <ul>
      <li>Victorian hotel room, tall windows, classic mouldings</li>
      <li>Boutique hotel, rainfall shower, marble bathroom</li>
      <li>Romantic London suite, moody lighting, soaking tub</li>
      <li>Warehouse conversion, exposed brick, Shoreditch edge</li>
    </ul>
    <p>Pair with the <a href="__ORIGIN__/where-to-stay-in-london">neighborhood guide</a> when location matters as much as the bathroom.</p>
    <div class="cta-band"><p>Describe your London room.</p><a class="mcta" href="${utm("london-visual-search-footer")}">Search London hotels</a></div>
  </main>`,
    { canonical: "london-visual-search", city: "London", pageCategory: "hub" }
  ),
});

const nbhdPages = [
  {
    file: "hotels-in-westminster.html",
    slug: "hotels-in-westminster",
    preset: "london-westminster",
    h1: "Best Hotels in Westminster London",
    lead: "Westminster is postcard London — <strong>Big Ben, Westminster Abbey, and St James&apos;s Park</strong> within walking distance of royal icons.",
    hero: WESTMINSTER,
    why: "The political and royal heart of the city. Mornings in St James&apos;s Park, afternoons at the Abbey, evenings along the Thames. Ideal when you want the London of guidebook covers without leaving Zone 1.",
    who: "First-timers, royal landmark seekers, and travellers who picture Big Ben from the hotel window over East London warehouse vibes.",
    compare: '<a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a> · <a href="__ORIGIN__/shoreditch-vs-westminster">Shoreditch vs Westminster</a>',
  },
  {
    file: "hotels-in-covent-garden.html",
    slug: "hotels-in-covent-garden",
    preset: "london-covent-garden",
    h1: "Best Hotels in Covent Garden London",
    lead: "Covent Garden is the <strong>default first-timer pick</strong> — West End theatre, street performers, and a buzzy pedestrian core.",
    hero: COVENT_GARDEN,
    why: "Theatreland on foot, restaurant density, and energy without needing a car. Less formal than Westminster; more entertainment-led than Marylebone.",
    who: "First-time visitors, theatre trips, food lovers, and anyone who wants maximum walkability in the West End.",
    compare: '<a href="__ORIGIN__/westminster-vs-covent-garden">Westminster vs Covent Garden</a> · <a href="__ORIGIN__/where-to-stay-in-london">Soho &amp; West End guide</a>',
  },
  {
    file: "hotels-in-south-kensington.html",
    slug: "hotels-in-south-kensington",
    preset: "london-south-kensington",
    h1: "Best Hotels in South Kensington London",
    lead: "South Kensington pairs <strong>V&amp;A, Natural History Museum, and refined Victorian streets</strong> near Hyde Park.",
    hero: SOUTH_KENSINGTON,
    why: "Museum mornings, leafy squares, and a polished residential feel. Quieter than Covent Garden; more cultured than Shoreditch.",
    who: "Families, museum lovers, couples who want Victorian calm, and travellers who prefer South Kensington&apos;s residential polish.",
    compare: '<a href="__ORIGIN__/south-kensington-vs-marylebone">South Kensington vs Marylebone</a> · <a href="__ORIGIN__/london-classic-hotels">London classic hotels</a>',
  },
  {
    file: "hotels-in-marylebone.html",
    slug: "hotels-in-marylebone",
    preset: "london-marylebone",
    h1: "Best Hotels in Marylebone London",
    lead: "Marylebone offers <strong>Marylebone High Street, leafy squares, and boutique charm</strong> without Oxford Street chaos.",
    hero: MARYLEBONE,
    why: "Village high street energy inside Zone 1. Independent shops, quiet squares, and boutique hotels that feel residential rather than tourist-packed.",
    who: "Boutique hotel fans, repeat visitors, and travellers who want upscale calm steps from Regent&apos;s Park.",
    compare: '<a href="__ORIGIN__/south-kensington-vs-marylebone">South Kensington vs Marylebone</a> · <a href="__ORIGIN__/london-boutique-hotels">London boutique hotels</a>',
  },
  {
    file: "hotels-in-shoreditch.html",
    slug: "hotels-in-shoreditch",
    preset: "london-shoreditch",
    h1: "Best Hotels in Shoreditch London",
    lead: "Shoreditch trades royal icons for <strong>East London street art, rooftop bars, and warehouse hotels</strong> — edgy over iconic.",
    hero: SHOREDITCH,
    why: "Creative East London energy. Converted warehouses, rooftop cocktails, and a younger nightlife pulse than Westminster or Covent Garden.",
    who: "Creative travellers, nightlife seekers, and guests who prefer warehouse boutique moods over postcard landmarks.",
    compare: '<a href="__ORIGIN__/shoreditch-vs-westminster">Shoreditch vs Westminster</a> · <a href="__ORIGIN__/where-to-stay-in-london">All neighborhoods</a>',
  },
  {
    file: "hotels-in-notting-hill.html",
    slug: "hotels-in-notting-hill",
    preset: "london-notting-hill",
    h1: "Best Hotels in Notting Hill London",
    lead: "Notting Hill brings <strong>Portobello Road, pastel townhouses, and village feel</strong> to west London.",
    hero: NOTTING_HILL,
    why: "Colourful terraces, market mornings, and a residential village mood farther west than the central tourist core.",
    who: "Romantic trips, market lovers, and travellers who want west London charm without staying in the city centre.",
    compare: '<a href="__ORIGIN__/hotels-in-marylebone">Marylebone</a> · <a href="__ORIGIN__/london-romantic-hotels">London romantic hotels</a>',
  },
];

for (const n of nbhdPages) {
  const nbhdName = n.h1.replace(/^Best Hotels in | London$/g, "").replace(/&amp;/g, "&");
  PAGES.push({
    file: n.file,
    html: page(
      hero({
        kicker: "London hotels",
        h1: seoField(n.slug, "h1", n.h1),
        lead: n.lead,
        heroImage: n.hero,
        heroAlt: seoField(n.slug, "heroAlt", ""),
        ctaPrimary: "Find more hotels by vibe →",
        ctaSecondary: "Take the quiz",
        utmPrimary: `${n.slug}-hero`,
        utmSecondary: `${n.slug}-quiz`,
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Why stay here</p>
      <h2 class="msec-title">Why stay in ${nbhdName}?</h2>
      <p class="msec-lead">${n.why}</p>
      <p class="msec-lead"><strong>Who it&apos;s best for:</strong> ${n.who}</p>
      ${HUB_LINKS}
    </section>
    <section class="msec">
      <p class="msec-kicker">Top picks</p>
      <h2 class="msec-title">${seoField(n.slug, "h2Featured", "Hotel recommendations")}</h2>
      <p class="msec-lead">Cards load live names and photos from our indexed London catalog. Open any hotel for room galleries.</p>
      ${hotelTiers(n.preset, n.slug)}
      <div class="section-cta"><a class="mcta" href="${utm(n.slug + "-more")}">Find more hotels by vibe →</a></div>
      <p style="margin-top:16px;font-size:14px">Also compare: ${n.compare}</p>
    </section>
    ${quizCta("Want hotels ranked to your room description? TravelByVibe searches real London room photos.", n.slug + "-quiz-block")}
  </div>
  <main class="wrap">
    <h2>How we pick hotels</h2>
    <p>We index London room photos and match them to plain-language searches — bathrooms, light, and layout first.</p>
    <div class="cta-band"><p>Explore ${n.kw || n.h1.toLowerCase()} with real photography.</p><a class="mcta" href="${utm(n.slug + "-footer")}">Search London hotels</a></div>
  </main>`,
      {
        canonical: n.slug,
        city: "London",
        pageCategory: "neighborhood",
        breadcrumbLabel: seoField(n.slug, "h2Featured", n.h1.replace(/^Best Hotels in /, "Hotels in ").replace(/ London$/, "")),
      }
    ),
  });
}

const comparisons = [
  {
    file: "westminster-vs-covent-garden.html",
    slug: "westminster-vs-covent-garden",
    leftImage: WESTMINSTER,
    rightImage: COVENT_GARDEN,
    leftLabel: "Westminster",
    rightLabel: "Covent Garden",
    h1: "Westminster vs Covent Garden: Which London Neighborhood Is Better?",
    lead: "Royal icons or West End buzz? Two of London&apos;s most loved central districts — here is how to choose.",
    rows: [
      ["Atmosphere", "Postcard, historic, royal landmarks", "Theatre-led, buzzy, pedestrian core"],
      ["Walkability", "Excellent — parks and Thames paths", "Excellent — flat West End streets"],
      ["Restaurants", "Classic pubs, hotel dining", "Dense terraces, global dining"],
      ["Nightlife", "Earlier evenings, pub culture", "Theatre, bars, late West End energy"],
      ["Luxury", "Grand dame hotels near Parliament", "Boutique design near theatreland"],
      ["Price", "Premium central", "Mid to upper-mid"],
    ],
    leftWho: "First-timers who want Big Ben, Westminster Abbey, and St James&apos;s Park within walking distance.",
    rightWho: "Travellers who want West End theatre, street performers, and a buzzy pedestrian core as the default first-timer pick.",
    verdict: "Choose <strong>Westminster</strong> for royal icons and Thames walks. Choose <strong>Covent Garden</strong> for theatre buzz and dining density. Either way, match the <em>room</em> on TravelByVibe.",
    links: '<a href="__ORIGIN__/hotels-in-westminster">Hotels in Westminster</a> · <a href="__ORIGIN__/hotels-in-covent-garden">Hotels in Covent Garden</a>',
    whoBLabel: "Who should stay in Covent Garden?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in Westminster?",
    whoAKey: "leftWho",
  },
  {
    file: "south-kensington-vs-marylebone.html",
    slug: "south-kensington-vs-marylebone",
    leftImage: SOUTH_KENSINGTON,
    rightImage: MARYLEBONE,
    leftLabel: "South Kensington",
    rightLabel: "Marylebone",
    h1: "South Kensington vs Marylebone: Where to Stay in London",
    lead: "Museum mornings versus village high street charm — two polished central neighborhoods with different rhythms.",
    rows: [
      ["Atmosphere", "Museum-led, Victorian, cultured", "Village high street, leafy, boutique"],
      ["Walkability", "Excellent — Hyde Park and museums", "Excellent — quiet squares and shops"],
      ["Restaurants", "Classic brasseries, hotel dining", "Independent cafés, local tables"],
      ["Nightlife", "Quieter evenings", "Wine bars, relaxed nights"],
      ["Luxury", "Grand hotels near museums", "Boutique townhouses"],
      ["Price", "Upper-mid to luxury", "Mid to upper-mid"],
    ],
    leftWho: "Museum lovers, families, and travellers who want V&amp;A and Natural History mornings near Hyde Park.",
    rightWho: "Boutique fans who want Marylebone High Street calm without Oxford Street chaos.",
    verdict: "<strong>South Kensington</strong> for museums and Victorian polish. <strong>Marylebone</strong> for village charm and boutique hotels. Both reward walkers — pick the room aesthetic on TravelByVibe after you pick the neighborhood.",
    links: '<a href="__ORIGIN__/hotels-in-south-kensington">South Kensington hotels</a> · <a href="__ORIGIN__/hotels-in-marylebone">Marylebone hotels</a>',
    whoBLabel: "Who should stay in Marylebone?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in South Kensington?",
    whoAKey: "leftWho",
  },
  {
    file: "shoreditch-vs-westminster.html",
    slug: "shoreditch-vs-westminster",
    leftImage: SHOREDITCH,
    rightImage: WESTMINSTER,
    leftLabel: "Shoreditch",
    rightLabel: "Westminster",
    h1: "Shoreditch vs Westminster: Which London Fit Is Yours?",
    lead: "East London edge versus royal postcard London — warehouse hotels and rooftop bars or Big Ben and the Abbey.",
    rows: [
      ["Atmosphere", "Edgy, creative, warehouse-led", "Historic, royal, landmark-led"],
      ["Walkability", "Good — flatter East London grid", "Excellent — central icons on foot"],
      ["Restaurants", "Trendy terraces, global street food", "Classic pubs, hotel dining"],
      ["Nightlife", "Rooftop bars, late creative scene", "Earlier evenings, pub culture"],
      ["Luxury", "Design boutiques, conversions", "Grand dame hotels"],
      ["Price", "Mid-range to upper-mid", "Premium central"],
    ],
    leftWho: "Creative travellers, nightlife seekers, and guests who prefer warehouse boutique moods over royal landmarks.",
    rightWho: "First-timers who want Big Ben, Westminster Abbey, and postcard London within walking distance.",
    verdict: "<strong>Shoreditch</strong> for East London edge and rooftop bars. <strong>Westminster</strong> for royal icons and Thames walks. If you will taxi everywhere anyway, Shoreditch&apos;s creative energy wins; if you walk all day among landmarks, Westminster is hard to beat.",
    links: '<a href="__ORIGIN__/hotels-in-shoreditch">Shoreditch hotels</a> · <a href="__ORIGIN__/hotels-in-westminster">Westminster hotels</a>',
    whoBLabel: "Who should stay in Westminster?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in Shoreditch?",
    whoAKey: "leftWho",
  },
];

for (const c of comparisons) {
  PAGES.push({
    file: c.file,
    html: page(
      compareHero({
        kicker: "Compare neighborhoods",
        h1: c.h1,
        lead: c.lead,
        leftImage: c.leftImage,
        rightImage: c.rightImage,
        leftLabel: c.leftLabel,
        rightLabel: c.rightLabel,
        ctaPrimary: "Find matching hotels →",
        utmPrimary: `${c.slug}-hero`,
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Quick compare</p>
      <h2 class="msec-title">At a glance</h2>
      <div class="compare-wrap">
        <table class="compare-table">
          <thead><tr><th scope="col">Factor</th><th scope="col">${c.leftLabel}</th><th scope="col">${c.rightLabel}</th></tr></thead>
          <tbody>${c.rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">${c.whoALabel}</h2>
      <p class="msec-lead">${c[c.whoAKey]}</p>
      <h2 class="msec-title">${c.whoBLabel}</h2>
      <p class="msec-lead">${c[c.whoBKey]}</p>
      <div class="verdict-box"><p><strong>Our verdict:</strong> ${c.verdict}</p></div>
      <p style="font-size:14px">${c.links}</p>
      ${quizCta("Let TravelByVibe rank hotels for your neighborhood vibe and room description.", c.slug + "-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
      {
        canonical: c.slug,
        ogImage: c.leftImage,
        city: "London",
        pageCategory: "comparison",
        breadcrumbLabel: c.h1.split(":")[0],
      }
    ),
  });
}

const vibePages = [
  {
    file: "london-boutique-hotels.html",
    slug: "london-boutique-hotels",
    preset: "london-boutique",
    h1: "Best Boutique Hotels in London",
    lead: "Boutique in London means townhouses, design-forward small hotels, and rooms with Victorian mouldings — not anonymous tower blocks.",
    sections: [
      { sub: "westminster", title: "Best boutique hotels in Westminster" },
      { sub: "covent-garden", title: "Best boutique hotels in Covent Garden" },
      { sub: "marylebone", title: "Best boutique hotels in Marylebone" },
      { sub: "romantic", title: "Best romantic boutique hotels" },
    ],
    intro: "We index real room photos and rank properties by how closely they match your description.",
  },
  {
    file: "london-luxury-hotels.html",
    slug: "london-luxury-hotels",
    preset: "london-luxury",
    h1: "Best Luxury Hotels in London",
    lead: "Grand dame hotels in Westminster, Mayfair flagships, and suites with real marble baths — search by what the room actually looks like.",
    array: true,
    intro: "Westminster, Covent Garden, and Marylebone lead for five-star stays; TravelByVibe surfaces bathrooms and suites that match your brief.",
  },
  {
    file: "london-romantic-hotels.html",
    slug: "london-romantic-hotels",
    preset: "london-romantic",
    h1: "Best Romantic Hotels in London",
    lead: "Soaking tubs, moody lighting, Notting Hill townhouses — London romance is as much the room as the neighborhood.",
    array: true,
    intro: "Notting Hill and Marylebone lead for intimate stays; match cosy, moody, or classic room moods in search.",
  },
  {
    file: "london-classic-hotels.html",
    slug: "london-classic-hotels",
    preset: "london-classic",
    h1: "Best Classic &amp; Victorian Hotels in London",
    lead: "Tall windows, plaster mouldings, and pale London light — search Victorian classic intent and see real room photography.",
    array: true,
    intro: "South Kensington and Westminster skew classic; grand dame hotels add formal luxury when you want the full Victorian drama.",
  },
  {
    file: "london-cafe-vibe-hotels.html",
    slug: "london-cafe-vibe-hotels",
    preset: "london-cafe-vibe",
    h1: seoField("london-cafe-vibe-hotels", "h1", "Best Café Culture Hotels in London"),
    lead: "Terrace mornings and Marylebone coffee rituals are part of the London stay. These hotels put you within walking distance of the city&apos;s best café culture.",
    array: true,
    intro: "Marylebone and Covent Garden dominate café culture — look for hotels near village high streets or West End courtyard calm.",
  },
  {
    file: "london-walkable-hotels.html",
    slug: "london-walkable-hotels",
    preset: "london-walkable",
    h1: seoField("london-walkable-hotels", "h1", "Best Walkable Hotels in London"),
    lead: "Flat, central neighborhoods where museums, theatres, and Thames walks happen on foot — Westminster, Covent Garden, and South Kensington lead.",
    sections: [
      { sub: "westminster", title: "Walkable hotels in Westminster" },
      { sub: "covent-garden", title: "Walkable hotels in Covent Garden" },
      { sub: "south-kensington", title: "Walkable hotels in South Kensington" },
    ],
    intro: "London rewards walkers in the centre — pick Westminster or Covent Garden if minimizing tube hops is the priority.",
  },
];

for (const v of vibePages) {
  const vm = seo.applySeoMeta({
    canonical: v.slug,
    city: "London",
    pageCategory: "vibe",
    title: `${v.h1} | TravelByVibe`,
    breadcrumbLabel: v.h1.replace(/&amp;/g, "&"),
  });
  let hotelBlocks = "";
  if (v.sections) {
    hotelBlocks = v.sections
      .map(
        (s) =>
          `<h3 class="hotel-tier-title">${s.title}</h3><div data-preset="${v.preset}" data-sub="${s.sub}" data-city="London" data-utm="${v.slug}-${s.sub}" aria-live="polite"></div>`
      )
      .join("\n");
  } else if (v.array) {
    hotelBlocks = `<div data-preset="${v.preset}" data-city="London" data-utm="${v.slug}-grid" aria-live="polite"></div>`;
  }
  PAGES.push({
    file: v.file,
    html: page(
      hero({
        kicker: "TravelByVibe picks",
        h1: vm.h1 || v.h1,
        lead: v.lead,
        heroImage: MARYLEBONE,
        ctaPrimary: "Discover more by vibe →",
        ctaSecondary: "Take the quiz",
        utmPrimary: `${v.slug}-hero`,
        utmSecondary: `${v.slug}-quiz`,
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">What makes a match</p>
      <h2 class="msec-title">${vm.h2Intro || "What we mean by vibe match"}</h2>
      <p class="msec-lead">${v.intro}</p>
      ${HUB_LINKS}
    </section>
    <section class="msec">
      <p class="msec-kicker">Featured stays</p>
      <h2 class="msec-title">${vm.h2Featured || "Hotels to start with"}</h2>
      ${hotelBlocks}
      <div class="section-cta"><a class="mcta" href="${utm(v.slug + "-more")}">Discover more London hotels →</a></div>
    </section>
    ${embedSearch(v.slug + "-search")}
  </div>`,
      vm,
    ),
  });
}

for (const p of PAGES) {
  const fp = path.join(OUT, p.file);
  fs.writeFileSync(fp, p.html, "utf8");
  console.log("wrote", p.file);
}

console.log(`Done — ${PAGES.length} London marketing pages.`);
