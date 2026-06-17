#!/usr/bin/env node
/**
 * Generate Mexico City SEO marketing HTML pages (hub-and-spoke cluster).
 * Run: node scripts/build-mexico-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");

const OUT = path.join(__dirname, "..", "client", "marketing");
const SKYLINE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1920px-Mexico_City_Skyline_%285604867225%29.jpg";
const SKYLINE_OG =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Mexico_City_Skyline_%285604867225%29.jpg/1280px-Mexico_City_Skyline_%285604867225%29.jpg";
const BELLAS =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Palacio_de_Bellas_Artes%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-13%2C_DD_41.jpg/1280px-Palacio_de_Bellas_Artes%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-13%2C_DD_41.jpg";
const SOUMAYA =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Museo_Soumaya%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-18%2C_DD_12.JPG/1280px-Museo_Soumaya%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-18%2C_DD_12.JPG";
const ZOCALO =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Zocalo_-_West_Side_-_Mexico_2024.jpg/1280px-Zocalo_-_West_Side_-_Mexico_2024.jpg";
const COYOACAN =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Coyoac%C3%A1n_-_Plaza_Hidalgo%2C_Coyoacan_-_Mexico_2024.jpg/1280px-Coyoac%C3%A1n_-_Plaza_Hidalgo%2C_Coyoacan_-_Mexico_2024.jpg";
const VASCONCELOS =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Biblioteca_Vasconcelos%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-20%2C_DD_13-15_HDR.jpg/1280px-Biblioteca_Vasconcelos%2C_Ciudad_de_M%C3%A9xico%2C_M%C3%A9xico%2C_2015-07-20%2C_DD_13-15_HDR.jpg";

/** Mexico City neighbourhood card photos (from neighborhoods table / vibe index). */
const NBHD_CONDESA =
  "https://images.unsplash.com/photo-1545504573-edac76c6a487?auto=format&amp;fit=crop&amp;w=1280&amp;q=82";
const NBHD_ROMA =
  "https://images.unsplash.com/photo-1612878731576-1d9ca638b741?auto=format&amp;fit=crop&amp;w=1280&amp;q=82";
const NBHD_POLANCO = "https://live.staticflickr.com/65535/48083283343_36ca392374_b.jpg";
const NBHD_JUAREZ =
  "https://images.unsplash.com/photo-1493857671505-72967e2e2760?auto=format&amp;fit=crop&amp;w=1280&amp;q=82";
const NBHD_CENTRO =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Templo_Mayor_50.jpg/1280px-Templo_Mayor_50.jpg";
const NBHD_COMPARE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/15-07-12-Ciclistas-en-Mexico-RalfR-N3S_8977.jpg/1280px-15-07-12-Ciclistas-en-Mexico-RalfR-N3S_8977.jpg";

function nbhdGuideGrid() {
  return `<div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${NBHD_CONDESA}')"><h3>Condesa</h3><p>Leafy, walkable, café culture — ideal for first-time visitors who want calm days and easy dinners.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_ROMA}')"><h3>Roma Norte</h3><p>Trendy food scene, design hotels, and nightlife — when you want energy after dark.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_POLANCO}')"><h3>Polanco</h3><p>Luxury shopping, museums, and upscale dining — the polished side of CDMX.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_JUAREZ}')"><h3>Juárez</h3><p>Central, connected, and often better value — between Reforma and Roma.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_CENTRO}')"><h3>Centro Histórico</h3><p>Maximum culture and sightseeing — accept more street energy for iconic access.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-centro-historico">Hotels in Centro →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_COMPARE}')"><h3>Condesa vs Polanco</h3><p>Can&apos;t decide between leafy calm and luxury polish? Start here.</p><a class="nbhd-row-cta" href="__ORIGIN__/condesa-vs-polanco">Compare the two →</a></div>
      </div>
      <p class="nbhd-photo-credits">Neighbourhood photos from TravelByVibe&apos;s Mexico City vibe index — Unsplash (Daniel Lerman, Carl Campbell, Roman Bozhko), Flickr / ikarusmedia (CC BY), and Wikimedia Commons.</p>`;
}

const HUB_LINKS = seo.hubLinks("Mexico City");

function utm(content) {
  return `__ORIGIN__/?city=Mexico%20City&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=cdmx_seo_2026&amp;utm_content=${content}`;
}

function page(body, meta) {
  return seo.wrapPage(
    body,
    { defaultOgImage: SKYLINE_OG, campaign: "cdmx_seo_2026", ...meta },
    header(meta.utmNav || meta.canonical.replace(/-/g, "_")),
    "Mexico City"
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
        <a href="__ORIGIN__/mexico-city-hotels">CDMX hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-mexico-city">Where to stay</a>
        <a href="__ORIGIN__/mexico-city-hotel-finder">Hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${utm(navCta)}">Try Mexico City →</a>
      </nav>
    </div>
  </header>`;
}

function hero({ kicker, h1, lead, heroImage, heroAlt, ctaPrimary, ctaSecondary, utmPrimary, utmSecondary }) {
  const aria = heroAlt ? ` role="img" aria-label="${heroAlt.replace(/"/g, "&quot;")}"` : "";
  return `<section class="hero"${aria} style="background-image:url('${heroImage || SKYLINE}')">
    <div class="hero-inner">
      <p class="hero-kicker">${kicker}</p>
      <h1>${h1}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utm(utmPrimary)}">${ctaPrimary}</a>
        ${ctaSecondary ? `<a class="mcta-secondary" href="${utm(utmSecondary)}">${ctaSecondary}</a>` : ""}
      </div>
      <div class="social-proof" aria-label="Product scale">
        <span>3,600+ Mexico City hotels indexed</span>
        <span>Real room photos</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function compareHero({
  kicker,
  h1,
  lead,
  leftImage,
  rightImage,
  leftLabel,
  rightLabel,
  ctaPrimary,
  utmPrimary,
}) {
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
        <span>3,600+ Mexico City hotels indexed</span>
        <span>Real room photos</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function hotelTiers(preset, utmBase) {
  return `
      <h3 class="hotel-tier-title">Luxury picks</h3>
      <div data-preset="${preset}" data-tier="luxury" data-utm="${utmBase}-luxury" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Boutique picks</h3>
      <div data-preset="${preset}" data-tier="boutique" data-utm="${utmBase}-boutique" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Value picks</h3>
      <div data-preset="${preset}" data-tier="value" data-utm="${utmBase}-value" aria-live="polite"></div>`;
}

function quizCta(text, utmContent) {
  return `<div class="quiz-callout">
        <p>${text}</p>
        <a class="mcta" href="${utm(utmContent)}">Take the 30-second quiz →</a>
      </div>`;
}

function embedSearch(utmContent) {
  return `<div class="embed-search">
      <h3>Find your Mexico City hotel match</h3>
      <p>Describe the room you want — soaking tub, bright suite, walkable neighbourhood — and we rank real hotel photos for you.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="Mexico City" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="cdmx_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Roma Norte" aria-label="Describe your ideal room" />
        <button type="submit">Search by vibe →</button>
      </form>
      <p style="margin-top:14px;font-size:14px"><a href="${utm(utmContent + '-quiz')}">Or start with the vibe wizard →</a></p>
    </div>
    <script>
      document.querySelectorAll('[data-marketing-search]').forEach(function(f){
        f.addEventListener('submit', function(e){
          var q = (f.querySelector('[name=q]')||{}).value;
          if (!q || !String(q).trim()) { e.preventDefault(); window.location.href = '${utm(utmContent + '-quiz')}'; }
        });
      });
    </script>`;
}

const PAGES = [];

// ── Where to stay (primary hub) ─────────────────────────────────────────────
PAGES.push({
  file: "where-to-stay-in-mexico-city.html",
  html: page(
    hero({
      kicker: "Mexico City · Neighbourhood guide",
      h1: seoField("where-to-stay-in-mexico-city", "h1", "Where to Stay in Mexico City — Hotels by Neighbourhood"),
      lead:
        "Condesa, Roma Norte, Polanco, Juárez, or Centro Histórico? This guide maps <strong>neighbourhood character</strong> to the hotels that actually fit — then TravelByVibe matches you using <strong>real room photos</strong>.",
      heroImage: SKYLINE,
      ctaPrimary: "Take the 30-second quiz →",
      ctaSecondary: "Browse hotels by vibe",
      utmPrimary: "where-to-stay-hero-quiz",
      utmSecondary: "where-to-stay-hero-browse",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">At a glance</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-mexico-city", "h2Featured", "Best neighbourhoods at a glance")}</h2>
      ${HUB_LINKS}
      <div class="compare-wrap" style="margin-top:24px">
        <table class="compare-table">
          <thead><tr><th scope="col">Neighbourhood</th><th scope="col">Best for</th><th scope="col">Vibe</th></tr></thead>
          <tbody>
            <tr><td><a href="__ORIGIN__/hotels-in-condesa">Condesa</a></td><td>First-time visitors, cafés, parks</td><td>Leafy, walkable, relaxed</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-roma-norte">Roma Norte</a></td><td>Foodies, design, nightlife</td><td>Trendy, energetic</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-polanco">Polanco</a></td><td>Luxury, museums, shopping</td><td>Upscale, polished</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-juarez">Juárez</a></td><td>Central stays, value, connectivity</td><td>Urban, well-connected</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-centro-historico">Centro Histórico</a></td><td>Sightseeing, culture, history</td><td>Iconic, vibrant</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-mexico-city", "h2Hotels", "Best Mexico City hotels by neighbourhood")}</h2>
      <p class="msec-lead">Browse indexed CDMX hotels with real room photos in each barrio — or search all of Mexico City by vibe.</p>
      <p class="msec-lead"><a href="__ORIGIN__/mexico-city-hotels">All Mexico City hotels</a> · <a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a> · <a href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte</a> · <a href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco</a> · <a href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez</a> · <a href="__ORIGIN__/hotels-in-centro-historico">Hotels in Centro</a></p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Match your style</p>
      <h2 class="msec-title">Which neighbourhood fits your travel style?</h2>
      <div class="fgrid">
        <div class="fcard"><h3>First visit + walkable days</h3><p><strong>Condesa</strong> or <strong>Roma Norte</strong> — tree-lined blocks, independent cafés, and galleries without a car. See <a href="__ORIGIN__/safe-neighborhoods-mexico-city">safe neighborhoods for tourists</a>.</p></div>
        <div class="fcard"><h3>Luxury + fine dining</h3><p><strong>Polanco</strong> — parks, flagship restaurants, and design museums within a short radius. Browse <a href="__ORIGIN__/hotels-near-chapultepec">hotels near Chapultepec</a>.</p></div>
        <div class="fcard"><h3>Maximum sightseeing</h3><p><strong>Centro Histórico</strong> — Zócalo, Templo Mayor, and cantina culture outside your door.</p></div>
        <div class="fcard"><h3>Central + connected</h3><p><strong>Juárez</strong> — Reforma access, creative energy, and strong value between Roma and Polanco.</p></div>
      </div>
      ${quizCta("<strong>Not sure?</strong> Our vibe wizard captures trip pace, must-haves, and neighbourhood feel — then ranks Mexico City hotels with real room photography.", "where-to-stay-quiz")}
    </section>
    <section class="msec">
      <p class="msec-kicker">See the city</p>
      <h2 class="msec-title">Five barrios, five different rhythms</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${BELLAS}')"><h3>Condesa &amp; Roma</h3><p>Jacaranda streets, terrace dining, and the CDMX everyone photographs.</p></div>
        <div class="nbhd-tile" style="background-image:url('${SOUMAYA}')"><h3>Polanco</h3><p>Museum mile, leafy avenues, and polished hotel lobbies.</p></div>
        <div class="nbhd-tile" style="background-image:url('${ZOCALO}')"><h3>Centro Histórico</h3><p>Cathedral mass, cantinas, and postcard corners on foot.</p></div>
      </div>
    </section>
    ${embedSearch("where-to-stay-search")}
  </div>
  <main class="wrap">
    <h2>Find hotels by vibe</h2>
    <p>Area fit is half the decision. TravelByVibe also ranks suites by how closely their <strong>real room photos</strong> match what you describe — bathrooms, light, layout, and design.</p>
    <p>Explore deeper guides: <a href="__ORIGIN__/hotels-in-condesa">hotels in Condesa</a>, <a href="__ORIGIN__/hotels-in-polanco">hotels in Polanco</a>, <a href="__ORIGIN__/condesa-vs-polanco">Condesa vs Polanco</a>, and our <a href="__ORIGIN__/mexico-city-hotel-finder">interactive hotel finder</a>.</p>
    <div class="cta-band">
      <p>Ready to match neighbourhood + room?</p>
      <a class="mcta" href="${utm("where-to-stay-footer")}">Start in Mexico City — free</a>
    </div>
  </main>`,
    { canonical: "where-to-stay-in-mexico-city", city: "Mexico City", pageCategory: "hub" }
  ),
});

// Neighborhood guide (spoke linking hub)
PAGES.push({
  file: "mexico-city-neighborhood-guide.html",
  html: page(
    hero({
      kicker: "CDMX neighbourhoods",
      h1: seoField("mexico-city-neighborhood-guide", "h1", "Mexico City Neighborhood Guide"),
      lead:
        "A practical map of Mexico City&apos;s best hotel districts — what each area feels like, who it suits, and where to search next.",
      heroImage: BELLAS,
      ctaPrimary: "Match my neighbourhood →",
      ctaSecondary: "Hotel finder",
      utmPrimary: "nbhd-guide-hero",
      utmSecondary: "nbhd-guide-finder",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      ${HUB_LINKS}
      <p class="msec-lead" style="margin-top:20px">Use this guide alongside <a href="__ORIGIN__/where-to-stay-in-mexico-city">Where to Stay in Mexico City</a> — the hub page with comparison tables and vibe matching.</p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField("mexico-city-neighborhood-guide", "h2Hotels", "Best Mexico City hotels by neighbourhood")}</h2>
      <p class="msec-lead"><a href="__ORIGIN__/mexico-city-hotels">Mexico City hotels hub</a> · <a href="__ORIGIN__/hotels-in-condesa">Condesa</a> · <a href="__ORIGIN__/hotels-in-roma-norte">Roma Norte</a> · <a href="__ORIGIN__/hotels-in-polanco">Polanco</a> · <a href="__ORIGIN__/hotels-in-juarez">Juárez</a> · <a href="__ORIGIN__/hotels-in-centro-historico">Centro Histórico</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">Neighbourhood deep links</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("nbhd-guide-search")}
  </div>`,
    { canonical: "mexico-city-neighborhood-guide", city: "Mexico City", pageCategory: "hub" }
  ),
});

// Hotel finder (primary SEO landing with embed)
PAGES.push({
  file: "mexico-city-hotel-finder.html",
  html: page(
    hero({
      kicker: "Interactive guide",
      h1: "Mexico City Hotel Finder — Where Should You Stay?",
      lead:
        "Compare Condesa, Roma Norte, Polanco, Juárez, and Centro Histórico vibes — then jump straight into TravelByVibe&apos;s photo-first hotel search.",
      heroImage: VASCONCELOS,
      ctaPrimary: "Start the vibe quiz →",
      ctaSecondary: null,
      utmPrimary: "hotel-finder-hero",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Five vibes</p>
      <h2 class="msec-title">Pick the neighbourhood energy that fits your trip</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${BELLAS}')"><h3>Condesa vibe</h3><p>Parque México mornings, terrace cafés, and art deco walks — relaxed but never sleepy.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa →</a></div>
        <div class="nbhd-tile" style="background-image:url('${COYOACAN}')"><h3>Roma Norte vibe</h3><p>Gallery openings, mezcal bars, and the city&apos;s best restaurant density.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SOUMAYA}')"><h3>Polanco vibe</h3><p>Chapultepec runs, flagship dining, and suites that feel intentionally polished.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco →</a></div>
        <div class="nbhd-tile" style="background-image:url('${NBHD_JUAREZ}')"><h3>Juárez vibe</h3><p>Reforma skyline, creative studios, and a central base without Polanco prices.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez →</a></div>
        <div class="nbhd-tile" style="background-image:url('${ZOCALO}')"><h3>Centro vibe</h3><p>Zócalo drama, museum blocks, and cantina nights — maximum city in one weekend.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-centro-historico">Hotels in Centro →</a></div>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Your turn</p>
      <h2 class="msec-title">Search Mexico City hotels by vibe</h2>
      ${embedSearch("hotel-finder-embed")}
      ${quizCta("<strong>Prefer a guided flow?</strong> The 30-second vibe wizard captures neighbourhood pace and room must-haves before you search.", "hotel-finder-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
    { canonical: "mexico-city-hotel-finder", city: "Mexico City", pageCategory: "hub" }
  ),
});

// Neighborhood hotel pages
const nbhdPages = [
  {
    file: "hotels-in-condesa.html",
    slug: "hotels-in-condesa",
    preset: "condesa",
    kw: "hotels in Condesa Mexico City",
    h1: "Best Hotels in Condesa Mexico City",
    lead: "Condesa is leafy, walkable, and café-dense — one of the best neighbourhoods in Mexico City for first-time visitors. These hotels pair <strong>park-side calm</strong> with easy access to Roma Norte.",
    hero: BELLAS,
    why: "Parque México and Parque España anchor the barrio. Mornings feel residential; evenings spill onto terraces. It is the CDMX sweet spot when you want beauty without Polanco formality.",
    who: "Couples, first-time visitors, remote workers who want walkable coffee runs, and anyone who pictures jacaranda streets over skyline towers.",
    compare: '<a href="__ORIGIN__/condesa-vs-polanco">Condesa vs Polanco</a> · <a href="__ORIGIN__/roma-norte-vs-condesa">Roma Norte vs Condesa</a>',
  },
  {
    file: "hotels-in-roma-norte.html",
    slug: "hotels-in-roma-norte",
    preset: "roma-norte",
    kw: "hotels in Roma Norte Mexico City",
    h1: "Best Hotels in Roma Norte Mexico City",
    lead: "Roma Norte is CDMX at its most <strong>trendy</strong> — design-forward hotels, serious restaurants, and nightlife that rewards staying close.",
    hero: COYOACAN,
    why: "Art deco facades, independent galleries, and a food scene that rivals any Latin American capital. Expect more buzz than Condesa, especially on weekends.",
    who: "Foodies, design lovers, return visitors, and travellers who want cocktail bars and galleries within a ten-minute walk.",
    compare: '<a href="__ORIGIN__/roma-norte-vs-condesa">Roma Norte vs Condesa</a> · <a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a>',
  },
  {
    file: "hotels-in-polanco.html",
    slug: "hotels-in-polanco",
    preset: "polanco",
    kw: "hotels in Polanco Mexico City",
    h1: "Best Hotels in Polanco Mexico City",
    lead: "Polanco is Mexico City&apos;s <strong>luxury address</strong> — parks, flagship dining, museum mile, and hotels built for business and celebration travel.",
    hero: SOUMAYA,
    why: "Wide avenues, embassy quiet, and Chapultepec at your doorstep. Polanco suits travellers who want polish, security, and reservation-ready restaurants.",
    who: "Luxury travellers, business visitors, families who want parks nearby, and shoppers heading to Antara or Masaryk.",
    compare: '<a href="__ORIGIN__/condesa-vs-polanco">Condesa vs Polanco</a> · <a href="__ORIGIN__/mexico-city-boutique-hotels">Boutique hotels</a>',
  },
  {
    file: "hotels-in-juarez.html",
    slug: "hotels-in-juarez",
    preset: "juarez",
    kw: "hotels in Juárez Mexico City",
    h1: "Best Hotels in Juárez Mexico City",
    lead: "Juárez sits between Roma and Reforma — <strong>central, connected, and often better value</strong> than Polanco while keeping skyline access.",
    hero: SKYLINE,
    why: "Creative offices, solid metro links, and Reforma views without always paying Polanco premiums. A smart base when you will Uber across town anyway.",
    who: "Value-conscious travellers, business guests on Reforma, and visitors who want Roma nightlife with a slightly calmer home block.",
    compare: '<a href="__ORIGIN__/juarez-vs-condesa">Juárez vs Condesa</a> · <a href="__ORIGIN__/where-to-stay-in-mexico-city">Where to stay guide</a>',
  },
  {
    file: "hotels-in-centro-historico.html",
    slug: "hotels-in-centro-historico",
    preset: "centro-historico",
    kw: "hotels in Centro Histórico Mexico City",
    h1: "Best Hotels in Centro Histórico Mexico City",
    lead: "Centro Histórico puts the <strong>Zócalo, Templo Mayor, and cantina culture</strong> outside your door — maximum sightseeing, maximum city energy.",
    hero: ZOCALO,
    why: "This is postcard CDMX. Mornings at the cathedral, afternoons in museums, evenings in century-old cantinas. You trade leafy calm for iconic access.",
    who: "First-time visitors on a culture sprint, history buffs, and travellers who want to walk to everything and hear the city at night.",
    compare: '<a href="__ORIGIN__/where-to-stay-in-mexico-city">Compare all neighbourhoods</a> · <a href="__ORIGIN__/mexico-city-hotel-finder">Hotel finder</a>',
  },
];

for (const n of nbhdPages) {
  PAGES.push({
    file: n.file,
    html: page(
      hero({
        kicker: "Mexico City hotels",
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
      <h2 class="msec-title">Why stay in ${n.h1.replace(/^Best Hotels in | Mexico City$/g, "")}?</h2>
      <p class="msec-lead">${n.why}</p>
      <p class="msec-lead"><strong>Who it&apos;s best for:</strong> ${n.who}</p>
      ${HUB_LINKS}
    </section>
    <section class="msec">
      <p class="msec-kicker">Top picks</p>
      <h2 class="msec-title">${seoField(n.slug, "h2Featured", "Hotel recommendations")}</h2>
      <p class="msec-lead">Cards below load live names and photos from our indexed catalog. Open any hotel for room galleries, then match your vibe across thousands of CDMX properties.</p>
      ${hotelTiers(n.preset, n.slug)}
      <div class="section-cta">
        <a class="mcta" href="${utm(n.slug + "-more")}">Find more hotels by vibe →</a>
      </div>
      <p style="margin-top:16px;font-size:14px">Also compare: ${n.compare}</p>
    </section>
    ${quizCta("Want hotels ranked to your room description — rainfall shower, balcony, minimalist suite? TravelByVibe searches real photos.", n.slug + "-quiz-block")}
  </div>
  <main class="wrap">
    <h2>How we pick hotels</h2>
    <p>We index thousands of Mexico City room photos and match them to plain-language searches. Star ratings help, but <strong>what the room looks like</strong> is what we surface first.</p>
    <div class="cta-band">
      <p>Explore ${n.kw} with real photography.</p>
      <a class="mcta" href="${utm(n.slug + "-footer")}">Search Mexico City hotels</a>
    </div>
  </main>`,
      {
        canonical: n.slug,
        city: "Mexico City",
        pageCategory: "neighbourhood",
        breadcrumbLabel: seoField(n.slug, "h2Featured", `Hotels in ${n.kw}`),
      }
    ),
  });
}

// Comparison pages
const comparisons = [
  {
    file: "condesa-vs-polanco.html",
    slug: "condesa-vs-polanco",
    leftImage: NBHD_CONDESA,
    rightImage: NBHD_POLANCO,
    leftLabel: "Condesa",
    rightLabel: "Polanco",
    h1: "Condesa vs Polanco: Which Mexico City Neighborhood Is Better?",
    lead: "Condesa or Polanco? One is leafy and walkable; the other is polished and luxury-forward. Here is how to choose — and how to find hotels that fit.",
    rows: [
      ["Atmosphere", "Relaxed, residential, café-led", "Upscale, embassy-quiet, polished"],
      ["Walkability", "Excellent — parks and corners on foot", "Good on Masaryk; wider avenues"],
      ["Restaurants", "Terrace bistros, neighbourhood gems", "Flagship dining, reservations"],
      ["Nightlife", "Wine bars, low-key mezcal", "Hotel bars, refined cocktails"],
      ["Luxury", "Boutique design hotels", "Five-star flagship properties"],
      ["Price", "Mid to upper-mid", "Upper-mid to luxury"],
    ],
    condesa: "First-time visitors, café culture lovers, and anyone who wants jacaranda streets without a car.",
    polanco: "Luxury travellers, business guests, museum mornings, and shoppers who want Chapultepec nearby.",
    verdict:
      "Choose <strong>Condesa</strong> for walkable, leafy days and a younger creative rhythm. Choose <strong>Polanco</strong> when luxury service, parks, and flagship dining matter more than neighbourhood buzz. Either way, match the <em>room</em> on TravelByVibe — a perfect barrio still fails if the suite feels wrong.",
    links: '<a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a> · <a href="__ORIGIN__/hotels-in-polanco">Hotels in Polanco</a>',
  },
  {
    file: "roma-norte-vs-condesa.html",
    slug: "roma-norte-vs-condesa",
    leftImage: NBHD_ROMA,
    rightImage: NBHD_CONDESA,
    leftLabel: "Roma Norte",
    rightLabel: "Condesa",
    h1: "Roma Norte vs Condesa: Where to Stay in Mexico City",
    lead: "Neighbours on the map, different energies in practice. Roma Norte trends louder and food-forward; Condesa trends leafier and calmer.",
    rows: [
      ["Atmosphere", "Trendy, gallery-led, energetic", "Leafy, park-centered, relaxed"],
      ["Walkability", "Excellent", "Excellent"],
      ["Restaurants", "Highest density, hot tables", "Strong, more terrace-led"],
      ["Nightlife", "Bars and late kitchens", "Wine bars, earlier evenings"],
      ["Luxury", "Design boutiques", "Boutique + a few luxury flags"],
      ["Price", "Mid to upper-mid", "Mid to upper-mid"],
    ],
    condesa: "Travellers who want parks, morning runs, and a slightly calmer base — still close to Roma's restaurants.",
    roma: "Roma Norte suits food obsessives, nightlife, and return visitors chasing the newest openings.",
    juarez: "Juárez when you want Reforma skyline, metro links, and a central pin without Polanco rates.",
    polanco: "Luxury travellers, business guests, museum mornings, and shoppers who want Chapultepec nearby.",
    verdict:
      "Stay in <strong>Condesa</strong> if Parque México mornings matter. Stay in <strong>Roma Norte</strong> if you are planning dinners first and walks second. Many visitors split the week — pick the hotel vibe that matches how you actually travel.",
    links: '<a href="__ORIGIN__/hotels-in-roma-norte">Hotels in Roma Norte</a> · <a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a>',
    altKey: "roma",
  },
  {
    file: "juarez-vs-condesa.html",
    slug: "juarez-vs-condesa",
    leftImage: NBHD_JUAREZ,
    rightImage: NBHD_CONDESA,
    leftLabel: "Juárez",
    rightLabel: "Condesa",
    h1: "Juárez vs Condesa: Which Neighborhood Should You Pick?",
    lead: "Juárez trades leafy residential charm for Reforma connectivity and central value. Condesa keeps the park-side CDMX dream intact.",
    rows: [
      ["Atmosphere", "Urban, central, creative", "Leafy, residential, café-led"],
      ["Walkability", "Good; Reforma crossings", "Excellent within the barrio"],
      ["Restaurants", "Mixed — Roma access nearby", "Neighbourhood terraces"],
      ["Nightlife", "Roma spillover", "Wine bars, local cantinas"],
      ["Luxury", "Reforma towers", "Boutique design"],
      ["Price", "Often better value", "Mid to upper-mid"],
    ],
    condesa: "Park mornings, terrace coffees, and the classic Condesa/Roma photo walk.",
    juarez: "Reforma access, creative studios, and strong value between Roma and Polanco.",
    verdict:
      "<strong>Condesa</strong> wins on vibe and walkable green space. <strong>Juárez</strong> wins on centrality and value. If you will rideshare everywhere anyway, Juárez can be the smarter spend — then use TravelByVibe to nail the room aesthetic.",
    links: '<a href="__ORIGIN__/hotels-in-juarez">Hotels in Juárez</a> · <a href="__ORIGIN__/hotels-in-condesa">Hotels in Condesa</a>',
    altKey: "juarez",
  },
];

for (const c of comparisons) {
  const colA = c.slug.includes("polanco") ? "Condesa" : c.slug.includes("roma") ? "Roma Norte" : "Juárez";
  const colB = c.slug.includes("polanco") ? "Polanco" : "Condesa";
  const whoBLabel = c.altKey === "roma" ? "Who should stay in Roma Norte?" : c.altKey === "juarez" ? "Who should stay in Juárez?" : "Who should stay in Polanco?";
  const whoBText = c[c.altKey || "polanco"];
  PAGES.push({
    file: c.file,
    html: page(
      compareHero({
        kicker: "Compare neighbourhoods",
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
          <thead><tr><th scope="col">Factor</th><th scope="col">${colA}</th><th scope="col">${colB}</th></tr></thead>
          <tbody>${c.rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">Who should stay in Condesa?</h2>
      <p class="msec-lead">${c.condesa}</p>
      <h2 class="msec-title">${whoBLabel}</h2>
      <p class="msec-lead">${whoBText}</p>
      <div class="verdict-box"><p><strong>Our verdict:</strong> ${c.verdict}</p></div>
      <p style="font-size:14px">${c.links}</p>
      ${quizCta("Let TravelByVibe rank hotels for your neighbourhood vibe and room description.", c.slug + "-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
      {
        canonical: c.slug,
        ogImage: c.leftImage.replace(/&amp;/g, "&"),
        city: "Mexico City",
        pageCategory: "comparison",
        breadcrumbLabel: c.h1.split(":")[0],
      }
    ),
  });
}

// Vibe pages
const vibePages = [
  {
    file: "mexico-city-boutique-hotels.html",
    slug: "mexico-city-boutique-hotels",
    h1: "Best Boutique Hotels in Mexico City",
    lead: "Boutique in CDMX means restored mansions, design-forward small hotels, and rooms with personality — not generic tower blocks.",
    preset: "boutique",
    sections: [
      { sub: "condesa", title: "Best boutique hotels in Condesa" },
      { sub: "roma-norte", title: "Best boutique hotels in Roma Norte" },
      { sub: "polanco", title: "Best boutique hotels in Polanco" },
      { sub: "design", title: "Best boutique hotels for design lovers" },
      { sub: "foodies", title: "Best boutique hotels for foodies" },
    ],
  },
  {
    file: "mexico-city-cafe-vibe-hotels.html",
    slug: "mexico-city-cafe-vibe-hotels",
    h1: seoField("mexico-city-cafe-vibe-hotels", "h1", "Mexico City Café-Vibe Hotels"),
    lead: "Morning pastry runs and third-wave espresso are part of the CDMX ritual. These stays put you within walking distance of the city's best café culture.",
    preset: "cafe-vibe",
    array: true,
    intro: "Condesa and Roma Norte dominate café culture — look for hotels near Parque México, Parque España, or Álvaro Obregón for the rhythm you want.",
  },
  {
    file: "mexico-city-local-neighborhood-hotels.html",
    slug: "mexico-city-local-neighborhood-hotels",
    h1: seoField("mexico-city-local-neighborhood-hotels", "h1", "Mexico City Local Neighborhood Hotels"),
    lead: "Skip the anonymous tower lobby. These areas and hotels skew residential — local cantinas, corner mercados, and the CDMX people actually live in.",
    preset: "local-neighborhood",
    array: true,
    intro: "Juárez, Roma Norte, and Condesa balance visitor infrastructure with everyday neighbourhood life.",
  },
  {
    file: "mexico-city-design-hotels.html",
    slug: "mexico-city-design-hotels",
    h1: "Best Design Hotels in Mexico City",
    lead: "CDMX is a design capital — mid-century restoration, contemporary glass, and art-filled lobbies. Search by what the room actually looks like.",
    preset: "design",
    array: true,
    intro: "Polanco and Condesa lead for architecture-forward stays; TravelByVibe surfaces suites that match sleek, eclectic, or classic cues.",
  },
];

for (const v of vibePages) {
  const vm = seo.applySeoMeta({
    canonical: v.slug,
    city: "Mexico City",
    pageCategory: "vibe",
    title: `${v.h1} | TravelByVibe`,
    breadcrumbLabel: v.h1,
  });
  let hotelBlocks = "";
  if (v.sections) {
    hotelBlocks = v.sections
      .map(
        (s) =>
          `<h3 class="hotel-tier-title">${s.title}</h3><div data-preset="${v.preset}" data-sub="${s.sub}" data-utm="${v.slug}-${s.sub}" aria-live="polite"></div>`
      )
      .join("\n");
  } else {
    hotelBlocks = `<div data-preset="${v.preset}" data-utm="${v.slug}-grid" aria-live="polite"></div>`;
  }
  PAGES.push({
    file: v.file,
    html: page(
      hero({
        kicker: "TravelByVibe picks",
        h1: vm.h1 || v.h1,
        lead: v.lead,
        heroImage: BELLAS,
        ctaPrimary: "Discover more by vibe →",
        ctaSecondary: "Take the quiz",
        utmPrimary: `${v.slug}-hero`,
        utmSecondary: `${v.slug}-quiz`,
      }) +
        `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">What makes a match</p>
      <h2 class="msec-title">${vm.h2Intro || "What we mean by vibe match"}</h2>
      <p class="msec-lead">${v.intro || "We index real hotel room photos and rank properties by how closely they match your description — not just stars and lobby shots."}</p>
      ${HUB_LINKS}
    </section>
    <section class="msec">
      <p class="msec-kicker">Featured stays</p>
      <h2 class="msec-title">${vm.h2Featured || "Hotels to start with"}</h2>
      ${hotelBlocks}
      <div class="section-cta"><a class="mcta" href="${utm(v.slug + "-more")}">Discover more boutique hotels →</a></div>
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

console.log(`Done — ${PAGES.length} pages.`);
