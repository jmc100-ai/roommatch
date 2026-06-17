#!/usr/bin/env node
/**
 * Generate Paris SEO marketing HTML pages (hub-and-spoke cluster, parallel to CDMX).
 * Run: node scripts/build-paris-marketing-pages.js
 */
const fs = require("fs");
const path = require("path");
const seo = require("./marketing-seo");
const { seoField } = require("./marketing-keywords");

const OUT = path.join(__dirname, "..", "client", "marketing");
const IMG = JSON.parse(
  fs.readFileSync(path.join(OUT, "city-marketing-images.json"), "utf8")
).paris;

function amp(url) {
  return String(url).replace(/&/g, "&amp;");
}

const EIFFEL_HERO = amp(IMG.hero["1920"]);
const EIFFEL_OG = amp(IMG.hero["1280"]);
const EIFFEL = amp(IMG.eiffel["960"]);
const MARAIS = amp(IMG.marais["960"]);
const SAINT_GERMAIN = amp(IMG.saintGermain["960"]);
const MONTMARTRE = amp(IMG.montmartre["960"]);
const LATIN = amp(IMG.mouffetard["960"]);
const OPERA = amp(IMG.champs["960"]);
const NOTRE_DAME = amp(IMG.notreDame["960"]);
const PONT = amp(IMG.pont["960"]);
const METRO = amp(IMG.metro["960"]);
const GARNIER = amp(IMG.garnier["960"]);

const HUB_LINKS = seo.hubLinks("Paris");

function utm(content) {
  return `__ORIGIN__/?city=Paris&amp;utm_source=travelbyvibe&amp;utm_medium=landing&amp;utm_campaign=paris_seo_2026&amp;utm_content=${content}`;
}

function page(body, meta) {
  return seo.wrapPage(
    body,
    { defaultOgImage: EIFFEL_OG, campaign: "paris_seo_2026", ...meta },
    header(meta.utmNav || meta.canonical.replace(/-/g, "_")),
    "Paris"
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
        <a href="__ORIGIN__/paris-hotels">Paris hotels</a>
        <a href="__ORIGIN__/where-to-stay-in-paris">Where to stay</a>
        <a href="__ORIGIN__/paris-hotel-finder">Hotel finder</a>
        <a href="__ORIGIN__/destinations">Destinations</a>
        <a class="mcta" href="${utm(navCta)}">Try Paris →</a>
      </nav>
    </div>
  </header>`;
}

function hero({ kicker, h1, lead, heroImage, heroAlt, ctaPrimary, ctaSecondary, utmPrimary, utmSecondary }) {
  const aria = heroAlt ? ` role="img" aria-label="${heroAlt.replace(/"/g, "&quot;")}"` : "";
  return `<section class="hero"${aria} style="background-image:url('${heroImage || EIFFEL_HERO}')">
    <div class="hero-inner">
      <p class="hero-kicker">${kicker}</p>
      <h1>${h1}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="hero-cta-row">
        <a class="mcta" href="${utm(utmPrimary)}">${ctaPrimary}</a>
        ${ctaSecondary ? `<a class="mcta-secondary" href="${utm(utmSecondary)}">${ctaSecondary}</a>` : ""}
      </div>
      <div class="social-proof" aria-label="Product scale">
        <span>Thousands of Paris hotels indexed</span>
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
        <span>Thousands of Paris hotels indexed</span>
        <span>Real room photos</span>
        <span>Free to explore</span>
      </div>
    </div>
  </section>`;
}

function hotelTiers(preset, utmBase) {
  return `
      <h3 class="hotel-tier-title">Luxury picks</h3>
      <div data-preset="${preset}" data-tier="luxury" data-city="Paris" data-utm="${utmBase}-luxury" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Boutique picks</h3>
      <div data-preset="${preset}" data-tier="boutique" data-city="Paris" data-utm="${utmBase}-boutique" aria-live="polite"></div>
      <h3 class="hotel-tier-title">Value picks</h3>
      <div data-preset="${preset}" data-tier="value" data-city="Paris" data-utm="${utmBase}-value" aria-live="polite"></div>`;
}

function quizCta(text, utmContent) {
  return `<div class="quiz-callout">
        <p>${text}</p>
        <a class="mcta" href="${utm(utmContent)}">Take the 30-second quiz →</a>
      </div>`;
}

function embedSearch(utmContent) {
  return `<div class="embed-search">
      <h3>Find your Paris hotel match</h3>
      <p>Describe the room you want — rainfall shower, Haussmann light, balcony view — and we rank real hotel photos for you.</p>
      <form class="embed-search-row" action="__ORIGIN__/" method="get" data-marketing-search>
        <input type="hidden" name="city" value="Paris" />
        <input type="hidden" name="utm_source" value="travelbyvibe" />
        <input type="hidden" name="utm_medium" value="landing" />
        <input type="hidden" name="utm_campaign" value="paris_seo_2026" />
        <input type="hidden" name="utm_content" value="${utmContent}" />
        <input type="search" name="q" placeholder="e.g. boutique hotel, rainfall shower, Le Marais" aria-label="Describe your ideal room" />
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
        <div class="nbhd-tile" style="background-image:url('${MARAIS}')"><h3>Le Marais</h3><p>Medieval lanes, galleries, and falafel queues — hip without needing a car.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-le-marais">Hotels in Le Marais →</a></div>
        <div class="nbhd-tile" style="background-image:url('${SAINT_GERMAIN}')"><h3>Saint-Germain-des-Prés</h3><p>Bookshops, wine bars, and Left Bank literary calm.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-saint-germain">Hotels in Saint-Germain →</a></div>
        <div class="nbhd-tile" style="background-image:url('${MONTMARTRE}')"><h3>Montmartre</h3><p>Village stairs, artists, and sunset views over the city.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-montmartre">Hotels in Montmartre →</a></div>
        <div class="nbhd-tile" style="background-image:url('${LATIN}')"><h3>Latin Quarter</h3><p>Market streets, students, and short walks to the river.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-latin-quarter">Hotels in Latin Quarter →</a></div>
        <div class="nbhd-tile" style="background-image:url('${OPERA}')"><h3>Opéra &amp; Champs</h3><p>Grand boulevards, palace hotels, and evening sparkle.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-opera">Hotels near Opéra →</a></div>
        <div class="nbhd-tile" style="background-image:url('${PONT}')"><h3>Marais vs Saint-Germain</h3><p>Historic buzz or Left Bank calm? Compare the two.</p><a class="nbhd-row-cta" href="__ORIGIN__/marais-vs-saint-germain">Compare →</a></div>
      </div>
      <p class="nbhd-photo-credits">Neighbourhood photos from TravelByVibe&apos;s Paris vibe index — Wikimedia Commons, Unsplash, and Flickr.</p>`;
}

const PAGES = [];

// ── Where to stay (primary hub) ─────────────────────────────────────────────
PAGES.push({
  file: "where-to-stay-in-paris.html",
  html: page(
    hero({
      kicker: "Paris · Neighbourhood guide",
      h1: seoField("where-to-stay-in-paris", "h1", "Where to Stay in Paris — Hotels by Neighbourhood"),
      lead:
        "Le Marais, Saint-Germain, Montmartre, Latin Quarter, or Opéra? This guide maps <strong>arrondissement character</strong> to hotels that fit — then TravelByVibe matches you using <strong>real room photos</strong>.",
      heroImage: EIFFEL_HERO,
      ctaPrimary: "Take the 30-second quiz →",
      ctaSecondary: "Browse hotels by vibe",
      utmPrimary: "where-to-stay-paris-hero-quiz",
      utmSecondary: "where-to-stay-paris-hero-browse",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">At a glance</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-paris", "h2Featured", "Best neighbourhoods at a glance")}</h2>
      ${HUB_LINKS}
      <div class="compare-wrap" style="margin-top:24px">
        <table class="compare-table">
          <thead><tr><th scope="col">Neighbourhood</th><th scope="col">Best for</th><th scope="col">Vibe</th></tr></thead>
          <tbody>
            <tr><td><a href="__ORIGIN__/hotels-in-le-marais">Le Marais</a></td><td>First-timers, galleries, walkable buzz</td><td>Historic, artsy, café-led</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-saint-germain">Saint-Germain</a></td><td>Left Bank calm, bookshops, museums</td><td>Literary, polished, relaxed</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-montmartre">Montmartre</a></td><td>Romance, views, village feel</td><td>Hilly, artistic, intimate</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-latin-quarter">Latin Quarter</a></td><td>River walks, bistros, students</td><td>Lively, classic, central</td></tr>
            <tr><td><a href="__ORIGIN__/hotels-in-opera">Opéra &amp; Champs</a></td><td>Luxury, grand boulevards, shopping</td><td>Palace hotels, skyline drama</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">Hotel picks</p>
      <h2 class="msec-title">${seoField("where-to-stay-in-paris", "h2Hotels", "Best Paris hotels by neighbourhood")}</h2>
      <p class="msec-lead">Browse indexed Paris hotels with real room and bathroom photos in each arrondissement — or search all of Paris by vibe.</p>
      <p class="msec-lead"><a href="__ORIGIN__/paris-hotels">All Paris hotels</a> · <a href="__ORIGIN__/hotels-in-le-marais">Hotels in Le Marais</a> · <a href="__ORIGIN__/hotels-in-saint-germain">Hotels in Saint-Germain</a> · <a href="__ORIGIN__/hotels-in-montmartre">Hotels in Montmartre</a> · <a href="__ORIGIN__/hotels-in-latin-quarter">Hotels in Latin Quarter</a> · <a href="__ORIGIN__/hotels-in-opera">Hotels near Opéra</a></p>
    </section>
    <section class="msec">
      <p class="msec-kicker">Match your style</p>
      <h2 class="msec-title">Which arrondissement fits your trip?</h2>
      <div class="fgrid">
        <div class="fcard"><h3>First visit + walkable icons</h3><p><strong>Le Marais</strong> or <strong>Latin Quarter</strong> — cobblestones, river access, and museum density without a car. See our <a href="__ORIGIN__/best-area-to-stay-in-paris-first-time">first-time Paris guide</a>.</p></div>
        <div class="fcard"><h3>Left Bank literary calm</h3><p><strong>Saint-Germain</strong> — wine bars, bookshops, and classic Paris mornings.</p></div>
        <div class="fcard"><h3>Romance + skyline views</h3><p><strong>Montmartre</strong> — steep streets, Sacré-Cœur sunsets, and cosy room moods. For Eiffel views, see <a href="__ORIGIN__/paris-hotels-near-eiffel-tower">hotels near the Eiffel Tower</a>.</p></div>
        <div class="fcard"><h3>Luxury + grand avenues</h3><p><strong>Opéra &amp; Champs</strong> — palace hotels and evening lights when you want the postcard.</p></div>
      </div>
      ${quizCta("<strong>Not sure?</strong> Our vibe wizard captures trip pace, must-haves, and neighbourhood feel — then ranks Paris hotels with real room photography.", "where-to-stay-paris-quiz")}
    </section>
    <section class="msec">
      <p class="msec-kicker">See the city</p>
      <h2 class="msec-title">Five districts, five different rhythms</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${MARAIS}')"><h3>Le Marais</h3><p>Galleries, falafel queues, and cobblestones — hip without needing a car.</p></div>
        <div class="nbhd-tile" style="background-image:url('${SAINT_GERMAIN}')"><h3>Saint-Germain</h3><p>Bookshops, wine bars, and museum mornings on the Left Bank.</p></div>
        <div class="nbhd-tile" style="background-image:url('${OPERA}')"><h3>Opéra district</h3><p>Grand boulevards and palace hotels — classic Paris sparkle.</p></div>
      </div>
    </section>
    ${embedSearch("where-to-stay-paris-search")}
  </div>
  <main class="wrap">
    <h2>Find hotels by vibe</h2>
    <p>Area fit is half the decision. TravelByVibe also ranks suites by how closely their <strong>real room photos</strong> match what you describe — bathrooms, Haussmann light, layout, and design.</p>
    <p>Explore: <a href="__ORIGIN__/hotels-in-le-marais">hotels in Le Marais</a>, <a href="__ORIGIN__/marais-vs-saint-germain">Marais vs Saint-Germain</a>, and our <a href="__ORIGIN__/paris-hotel-finder">Paris hotel finder</a>.</p>
    <div class="cta-band">
      <p>Ready to match neighbourhood + room?</p>
      <a class="mcta" href="${utm("where-to-stay-paris-footer")}">Start in Paris — free</a>
    </div>
  </main>`,
    {
      canonical: "where-to-stay-in-paris",
      city: "Paris",
      pageCategory: "hub",
    }
  ),
});

PAGES.push({
  file: "paris-neighborhood-guide.html",
  html: page(
    hero({
      kicker: "Paris neighbourhoods",
      h1: seoField("paris-neighborhood-guide", "h1", "Paris Neighborhood Guide"),
      lead: "A practical map of Paris&apos;s best hotel districts — what each area feels like, who it suits, and where to search next.",
      heroImage: NOTRE_DAME,
      ctaPrimary: "Match my neighbourhood →",
      ctaSecondary: "Hotel finder",
      utmPrimary: "paris-nbhd-guide-hero",
      utmSecondary: "paris-nbhd-guide-finder",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      ${HUB_LINKS}
      <p class="msec-lead" style="margin-top:20px">Use this guide alongside <a href="__ORIGIN__/where-to-stay-in-paris">Where to Stay in Paris</a> — comparison tables and vibe matching on the hub page.</p>
    </section>
    <section class="msec">
      <h2 class="msec-title">${seoField("paris-neighborhood-guide", "h2Hotels", "Best Paris hotels by neighbourhood")}</h2>
      <p class="msec-lead"><a href="__ORIGIN__/paris-hotels">Paris hotels hub</a> · <a href="__ORIGIN__/hotels-in-le-marais">Le Marais</a> · <a href="__ORIGIN__/hotels-in-saint-germain">Saint-Germain</a> · <a href="__ORIGIN__/hotels-in-montmartre">Montmartre</a> · <a href="__ORIGIN__/hotels-in-latin-quarter">Latin Quarter</a> · <a href="__ORIGIN__/hotels-in-opera">Opéra</a></p>
    </section>
    <section class="msec">
      <h2 class="msec-title">Neighbourhood deep links</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("paris-nbhd-guide-search")}
  </div>`,
    { canonical: "paris-neighborhood-guide", city: "Paris", pageCategory: "hub" }
  ),
});

PAGES.push({
  file: "paris-hotel-finder.html",
  html: page(
    hero({
      kicker: "Interactive guide",
      h1: "Paris Hotel Finder — Where Should You Stay?",
      lead: "Compare Le Marais, Saint-Germain, Montmartre, Latin Quarter, and Opéra vibes — then jump into TravelByVibe&apos;s photo-first Paris search.",
      heroImage: PONT,
      ctaPrimary: "Start the vibe quiz →",
      ctaSecondary: null,
      utmPrimary: "paris-hotel-finder-hero",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Five vibes</p>
      <h2 class="msec-title">Pick the arrondissement energy that fits your trip</h2>
      ${nbhdGuideGrid()}
    </section>
    <section class="msec">
      <p class="msec-kicker">Your turn</p>
      <h2 class="msec-title">Search Paris hotels by vibe</h2>
      ${embedSearch("paris-hotel-finder-embed")}
      ${quizCta("<strong>Prefer a guided flow?</strong> The vibe wizard captures neighbourhood pace and room must-haves before you search.", "paris-hotel-finder-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
    { canonical: "paris-hotel-finder", city: "Paris", pageCategory: "hub" }
  ),
});

// Main hotels hub
PAGES.push({
  file: "paris-hotels.html",
  html: page(
    hero({
      kicker: "Paris · TravelByVibe",
      h1: "Find Paris hotels that match your vibe",
      lead: "Browse <strong>real room photos</strong> and discover hotels by <strong>atmosphere</strong>—Haussmann light, rainfall shower, Left Bank mood—not just star ratings and lobby shots.",
      heroImage: EIFFEL_HERO,
      ctaPrimary: "Take the 30-second quiz →",
      ctaSecondary: "Browse hotels by vibe",
      utmPrimary: "paris-hotels-hero-quiz",
      utmSecondary: "paris-hotels-hero-browse",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      ${HUB_LINKS}
      <p class="msec-kicker">Visual first</p>
      <h2 class="msec-title">Scroll real rooms—not the same chandelier lobby</h2>
      <p class="msec-lead">Paris spans palace hotels, design boutiques, and pied-à-terre charm. TravelByVibe is for travellers who decide with their eyes.</p>
      <div class="vibe-strip" aria-label="Paris room moods">
        <figure class="vibe-card">
          <img src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Elegant hotel bathroom with marble" loading="lazy" />
          <figcaption><strong>Marble bath</strong>Rainfall shower and double vanity — surfaced from real bathroom photos.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Bright hotel bedroom" loading="lazy" />
          <figcaption><strong>Haussmann bright</strong>Tall windows and pale walls — the Paris morning you picture.</figcaption>
        </figure>
        <figure class="vibe-card">
          <img src="${EIFFEL}" width="960" height="640" alt="Eiffel Tower, Paris" loading="lazy" />
          <figcaption><strong>View energy</strong>Eiffel glimpses — pair neighbourhood choice with the right room.</figcaption>
        </figure>
      </div>
    </section>
    <section class="msec">
      <p class="msec-kicker">City + room</p>
      <h2 class="msec-title">Paris on the map—then inside the suite</h2>
      <div class="nbhd-grid">
        <div class="nbhd-tile" style="background-image:url('${NOTRE_DAME}')"><h3>Île de la Cité &amp; icons</h3><p>Cathedral views, river walks, museum density.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-latin-quarter">Latin Quarter hotels →</a></div>
        <div class="nbhd-tile" style="background-image:url('${MARAIS}')"><h3>Le Marais</h3><p>Cobblestones, bistros, gallery pace.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-le-marais">Le Marais hotels →</a></div>
        <div class="nbhd-tile" style="background-image:url('${OPERA}')"><h3>Opéra &amp; Champs</h3><p>Grand boulevards and palace hotels.</p><a class="nbhd-row-cta" href="__ORIGIN__/hotels-in-opera">Opéra hotels →</a></div>
      </div>
    </section>
    ${embedSearch("paris-hotels-search")}
  </div>
  <main class="wrap">
    <h2>Plan Paris with both eyes open</h2>
    <p>Guides: <a href="__ORIGIN__/where-to-stay-in-paris">Where to stay in Paris</a> · <a href="__ORIGIN__/paris-visual-search">Visual room search</a> · <a href="__ORIGIN__/paris-neighborhood-stays">Neighbourhood stays</a></p>
    <div class="cta-band">
      <p>Describe your Paris room—see matches in seconds.</p>
      <a class="mcta" href="${utm("paris-hotels-footer")}">Search Paris hotels</a>
    </div>
  </main>`,
    { canonical: "paris-hotels", city: "Paris", pageCategory: "hub" }
  ),
});

// Neighbourhood stays (vibe-focused spoke)
PAGES.push({
  file: "paris-neighborhood-stays.html",
  html: page(
    hero({
      kicker: "Paris · Neighbourhoods",
      h1: seoField("paris-neighborhood-stays", "h1", "Paris Hotels by Neighbourhood"),
      lead: "TravelByVibe connects <strong>neighbourhood energy</strong> with <strong>hotel room reality</strong>. Tell us if you want icons-and-buzz, calm-and-central, village-like streets, or grand boulevard sparkle.",
      heroImage: EIFFEL_HERO,
      ctaPrimary: "Start in Paris →",
      ctaSecondary: "Neighbourhood guide",
      utmPrimary: "paris-nbhd-stays-hero",
      utmSecondary: "paris-nbhd-stays-guide",
    }) +
      `<div class="wrap-wide">
    <section class="msec" style="padding-top:36px;margin-top:0;border-top:none">
      <p class="msec-kicker">Feel the city first</p>
      <h2 class="msec-title">Paris is twenty villages in one coat</h2>
      <div class="vibe-strip" aria-label="Paris neighbourhoods">
        <figure class="vibe-card"><img src="${METRO}" width="960" height="640" alt="Paris Métro sign" loading="lazy" /><figcaption><strong>Métro rhythm</strong>Every arrondissement has a different pulse.</figcaption></figure>
        <figure class="vibe-card"><img src="${LATIN}" width="960" height="640" alt="Rue Mouffetard, Paris" loading="lazy" /><figcaption><strong>Market streets</strong>Latin Quarter energy — bistros and river walks.</figcaption></figure>
        <figure class="vibe-card"><img src="${SAINT_GERMAIN}" width="960" height="640" alt="Saint-Germain-des-Prés" loading="lazy" /><figcaption><strong>Museum mornings</strong>Left Bank culture within easy reach.</figcaption></figure>
        <figure class="vibe-card"><img src="${MONTMARTRE}" width="960" height="640" alt="Montmartre, Paris" loading="lazy" /><figcaption><strong>Montmartre hills</strong>Village stairs and skyline views.</figcaption></figure>
        <figure class="vibe-card"><img src="${OPERA}" width="960" height="640" alt="Opéra district, Paris" loading="lazy" /><figcaption><strong>Grand avenues</strong>Champs and Opéra — the classic postcard.</figcaption></figure>
      </div>
    </section>
    <section class="msec">
      <h2 class="msec-title">Which Paris neighbourhood sounds like you?</h2>
      ${nbhdGuideGrid()}
    </section>
    ${embedSearch("paris-nbhd-stays-search")}
  </div>`,
    { canonical: "paris-neighborhood-stays", city: "Paris", pageCategory: "hub" }
  ),
});

// Visual search
PAGES.push({
  file: "paris-visual-search.html",
  html: page(
    hero({
      kicker: "Paris · Visual search",
      h1: seoField("paris-visual-search", "h1", "Search the room you can picture—not the brochure cliché"),
      lead: "Type the scene: <strong>Haussmann bedroom, rainfall shower, balcony over rooftops, art-deco suite</strong>. We line up <strong>real Paris hotel room photos</strong> so you judge with your eyes.",
      heroImage: EIFFEL_HERO,
      ctaPrimary: "Search Paris hotels →",
      ctaSecondary: "Take the quiz",
      utmPrimary: "paris-visual-search-hero",
      utmSecondary: "paris-visual-search-quiz",
    }) +
      `<div class="wrap-wide">
    <div class="query-board" style="background-image:url('${OPERA}');margin-top:36px" role="img" aria-label="Opéra district, Paris">
      <div class="query-board-inner">
        <h3>Drop a sentence—see hotels that look the part</h3>
        <div class="query-chips">
          <span class="query-chip">Haussmann light, soaking tub, quiet street</span>
          <span class="query-chip">Rainfall shower, marble bathroom</span>
          <span class="query-chip">Moody boutique, velvet and brass</span>
          <span class="query-chip">Eiffel view, balcony at golden hour</span>
        </div>
      </div>
    </div>
    <section class="msec">
      <p class="msec-kicker">Visual vocabulary</p>
      <h2 class="msec-title">Paris textures that echo what you ask for</h2>
      <div class="vibe-strip">
        <figure class="vibe-card"><img src="${GARNIER}" width="960" height="640" alt="Palais Garnier, Paris" loading="lazy" /><figcaption><strong>Opéra grandeur</strong>Palace-hotel drama in your room search.</figcaption></figure>
        <figure class="vibe-card"><img src="${MARAIS}" width="960" height="640" alt="Le Marais, Paris" loading="lazy" /><figcaption><strong>Marais cobbles</strong>Village-in-the-city boutique moods.</figcaption></figure>
        <figure class="vibe-card"><img src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&amp;fit=crop&amp;w=640&amp;h=480&amp;q=82" width="640" height="480" alt="Luxury hotel bathroom" loading="lazy" /><figcaption><strong>Marble bath</strong>Search rain shower and see real tile.</figcaption></figure>
        <figure class="vibe-card"><img src="${EIFFEL}" width="960" height="640" alt="Eiffel Tower" loading="lazy" /><figcaption><strong>View requests</strong>Eiffel glimpses with neighbourhood fit.</figcaption></figure>
      </div>
    </section>
    ${embedSearch("paris-visual-search-embed")}
  </div>
  <main class="wrap">
    <h2>Popular Paris visual searches</h2>
    <ul>
      <li>Haussmann apartment-style hotel room, tall windows</li>
      <li>Boutique hotel, rainfall shower, marble bathroom</li>
      <li>Romantic Paris suite, moody lighting, soaking tub</li>
      <li>Art-deco hotel interior, polished brass details</li>
    </ul>
    <p>Pair with the <a href="__ORIGIN__/where-to-stay-in-paris">neighbourhood guide</a> when location matters as much as the bathroom.</p>
    <div class="cta-band"><p>Describe your Paris room.</p><a class="mcta" href="${utm("paris-visual-search-footer")}">Search Paris hotels</a></div>
  </main>`,
    { canonical: "paris-visual-search", city: "Paris", pageCategory: "hub" }
  ),
});

const nbhdPages = [
  {
    file: "hotels-in-le-marais.html",
    slug: "hotels-in-le-marais",
    preset: "paris-le-marais",
    h1: "Best Hotels in Le Marais Paris",
    lead: "Le Marais is historic, walkable, and gallery-dense — one of the best neighbourhoods for first-time Paris visitors who want cobblestones without a car.",
    hero: MARAIS,
    why: "Medieval lanes meet contemporary galleries. Mornings feel local; evenings spill onto terrace tables. Ideal when you want the Louvre within reach but prefer neighbourhood buzz to grand boulevards.",
    who: "First-timers, gallery lovers, foodies, and travellers who picture falafel queues and hidden courtyards over skyline towers.",
    compare: '<a href="__ORIGIN__/marais-vs-saint-germain">Marais vs Saint-Germain</a> · <a href="__ORIGIN__/montmartre-vs-marais">Montmartre vs Marais</a>',
  },
  {
    file: "hotels-in-saint-germain.html",
    slug: "hotels-in-saint-germain",
    preset: "paris-saint-germain",
    h1: "Best Hotels in Saint-Germain-des-Prés Paris",
    lead: "Saint-Germain is the <strong>Left Bank classic</strong> — bookshops, wine bars, and literary calm steps from the Seine.",
    hero: SAINT_GERMAIN,
    why: "Café culture without the Marais weekend crush. Strong museum access, polished bistros, and the Paris of novels and black-and-white photos.",
    who: "Couples, return visitors, museum mornings, and anyone who wants to live inside a Left Bank novel for a week.",
    compare: '<a href="__ORIGIN__/marais-vs-saint-germain">Marais vs Saint-Germain</a> · <a href="__ORIGIN__/latin-quarter-vs-saint-germain">Latin Quarter vs Saint-Germain</a>',
  },
  {
    file: "hotels-in-montmartre.html",
    slug: "hotels-in-montmartre",
    preset: "paris-montmartre",
    h1: "Best Hotels in Montmartre Paris",
    lead: "Montmartre trades central flatness for <strong>village stairs and skyline views</strong> — romantic, artistic, slightly removed from the core.",
    hero: MONTMARTRE,
    why: "Steep streets, painters, and Sacré-Cœur at golden hour. Quieter nights than Marais; more character than Opéra tower blocks.",
    who: "Romantic trips, photographers, travellers who want a cosy room mood and do not mind métro hops to the centre.",
    compare: '<a href="__ORIGIN__/montmartre-vs-marais">Montmartre vs Marais</a> · <a href="__ORIGIN__/where-to-stay-in-paris">All neighbourhoods</a>',
  },
  {
    file: "hotels-in-latin-quarter.html",
    slug: "hotels-in-latin-quarter",
    preset: "paris-latin-quarter",
    h1: "Best Hotels in the Latin Quarter Paris",
    lead: "The Latin Quarter keeps <strong>river walks, market streets, and student energy</strong> within walking distance of Notre-Dame.",
    hero: LATIN,
    why: "Rue Mouffetard markets, cheap bistros, and classic Paris corners. Less polished than Saint-Germain; more lived-in and central.",
    who: "Budget-conscious travellers, first-timers who want maximum sightseeing on foot, and anyone who loves market mornings.",
    compare: '<a href="__ORIGIN__/latin-quarter-vs-saint-germain">Latin Quarter vs Saint-Germain</a> · <a href="__ORIGIN__/hotels-in-le-marais">Le Marais</a>',
  },
  {
    file: "hotels-in-opera.html",
    slug: "hotels-in-opera",
    preset: "paris-opera",
    h1: "Best Hotels near Opéra &amp; Champs-Élysées Paris",
    lead: "Opéra and the Champs are Paris at its most <strong>grand</strong> — palace hotels, flagship shopping, and horizon-line boulevards.",
    hero: OPERA,
    why: "Wide avenues, embassy quiet on side streets, and the Paris of postcards. Perfect when luxury service and evening sparkle matter more than village cobbles.",
    who: "Luxury travellers, shoppers, business guests, and celebration trips where the hotel lobby is part of the experience.",
    compare: '<a href="__ORIGIN__/paris-luxury-hotels">Paris luxury hotels</a> · <a href="__ORIGIN__/marais-vs-saint-germain">Compare Left Bank areas</a>',
  },
];

for (const n of nbhdPages) {
  const nbhdName = n.h1.replace(/^Best Hotels in | Paris$/g, "").replace(/&amp;/g, "&");
  PAGES.push({
    file: n.file,
    html: page(
      hero({
        kicker: "Paris hotels",
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
      <p class="msec-lead">Cards load live names and photos from our indexed Paris catalog. Open any hotel for room galleries.</p>
      ${hotelTiers(n.preset, n.slug)}
      <div class="section-cta"><a class="mcta" href="${utm(n.slug + "-more")}">Find more hotels by vibe →</a></div>
      <p style="margin-top:16px;font-size:14px">Also compare: ${n.compare}</p>
    </section>
    ${quizCta("Want hotels ranked to your room description? TravelByVibe searches real Paris room photos.", n.slug + "-quiz-block")}
  </div>
  <main class="wrap">
    <h2>How we pick hotels</h2>
    <p>We index Paris room photos and match them to plain-language searches — bathrooms, light, and layout first.</p>
    <div class="cta-band"><p>Explore ${n.kw || n.h1.toLowerCase()} with real photography.</p><a class="mcta" href="${utm(n.slug + "-footer")}">Search Paris hotels</a></div>
  </main>`,
      {
        canonical: n.slug,
        city: "Paris",
        pageCategory: "neighbourhood",
        breadcrumbLabel: seoField(n.slug, "h2Featured", n.h1.replace(/^Best Hotels in /, "Hotels in ").replace(/ Paris$/, "")),
      }
    ),
  });
}

const comparisons = [
  {
    file: "marais-vs-saint-germain.html",
    slug: "marais-vs-saint-germain",
    leftImage: MARAIS,
    rightImage: SAINT_GERMAIN,
    leftLabel: "Le Marais",
    rightLabel: "Saint-Germain",
    h1: "Le Marais vs Saint-Germain: Which Paris Neighborhood Is Better?",
    lead: "Historic buzz or Left Bank calm? Two of Paris&apos;s most loved districts — here is how to choose.",
    rows: [
      ["Atmosphere", "Artsy, buzzing, medieval lanes", "Literary, polished, café-led"],
      ["Walkability", "Excellent — compact and flat", "Excellent — Seine-side strolls"],
      ["Restaurants", "Bistros, falafel, wine bars", "Classic bistros, bookshop cafés"],
      ["Nightlife", "Bars, galleries, weekend energy", "Wine bars, earlier evenings"],
      ["Luxury", "Boutique design hotels", "Left Bank flagships"],
      ["Price", "Mid to upper-mid", "Mid to upper-mid"],
    ],
    leftWho: "First-timers who want galleries, cobblestones, and weekend buzz without leaving the centre.",
    rightWho: "Travellers who want Left Bank calm, museum mornings, and literary café culture.",
    verdict: "Choose <strong>Le Marais</strong> for historic buzz and gallery density. Choose <strong>Saint-Germain</strong> for polished Left Bank calm. Either way, match the <em>room</em> on TravelByVibe.",
    links: '<a href="__ORIGIN__/hotels-in-le-marais">Hotels in Le Marais</a> · <a href="__ORIGIN__/hotels-in-saint-germain">Hotels in Saint-Germain</a>',
    whoBLabel: "Who should stay in Saint-Germain?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in Le Marais?",
    whoAKey: "leftWho",
  },
  {
    file: "montmartre-vs-marais.html",
    slug: "montmartre-vs-marais",
    leftImage: MONTMARTRE,
    rightImage: MARAIS,
    leftLabel: "Montmartre",
    rightLabel: "Le Marais",
    h1: "Montmartre vs Le Marais: Where to Stay in Paris",
    lead: "Village hills versus central cobblestones — romantic remove or gallery buzz in the heart of the city.",
    rows: [
      ["Atmosphere", "Village, artistic, hilly", "Historic, buzzing, flat"],
      ["Walkability", "Steep — métro helps", "Excellent"],
      ["Restaurants", "Cosy bistros, local tables", "Trendy terraces, falafel"],
      ["Nightlife", "Quiet hills, local bars", "Weekend energy, galleries"],
      ["Luxury", "Boutique romantic", "Design boutiques"],
      ["Price", "Mid-range", "Mid to upper-mid"],
    ],
    leftWho: "Romantic trips, sunset photographers, and travellers who want village feel over flat centrality.",
    rightWho: "First-timers who want maximum walkability and gallery density in the centre.",
    verdict: "<strong>Montmartre</strong> for romance and views. <strong>Le Marais</strong> for central buzz. If you will taxi everywhere anyway, Montmartre&apos;s charm wins; if you walk all day, Marais is hard to beat.",
    links: '<a href="__ORIGIN__/hotels-in-montmartre">Hotels in Montmartre</a> · <a href="__ORIGIN__/hotels-in-le-marais">Hotels in Le Marais</a>',
    whoBLabel: "Who should stay in Le Marais?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in Montmartre?",
    whoAKey: "leftWho",
  },
  {
    file: "latin-quarter-vs-saint-germain.html",
    slug: "latin-quarter-vs-saint-germain",
    leftImage: LATIN,
    rightImage: SAINT_GERMAIN,
    leftLabel: "Latin Quarter",
    rightLabel: "Saint-Germain",
    h1: "Latin Quarter vs Saint-Germain: Which Left Bank Fit Is Yours?",
    lead: "Neighbours on the Left Bank with different price points and rhythms — market streets versus literary polish.",
    rows: [
      ["Atmosphere", "Student-led, market streets", "Literary, polished, classic"],
      ["Walkability", "Excellent — river and Île access", "Excellent — Luxembourg gardens"],
      ["Restaurants", "Cheap bistros, market food", "Classic bistros, wine bars"],
      ["Nightlife", "Student bars, lively squares", "Wine bars, jazz clubs"],
      ["Luxury", "Fewer flagships", "Left Bank luxury staples"],
      ["Price", "Often better value", "Mid to upper-mid"],
    ],
    leftWho: "Budget-conscious travellers, students-at-heart, and anyone who wants market mornings and river walks.",
    rightWho: "Couples and return visitors who want polished Left Bank cafés and museum access.",
    verdict: "<strong>Latin Quarter</strong> for value and lively streets. <strong>Saint-Germain</strong> for polish and calm. Both reward walkers — pick the room aesthetic on TravelByVibe after you pick the arrondissement.",
    links: '<a href="__ORIGIN__/hotels-in-latin-quarter">Latin Quarter hotels</a> · <a href="__ORIGIN__/hotels-in-saint-germain">Saint-Germain hotels</a>',
    whoBLabel: "Who should stay in Saint-Germain?",
    whoBKey: "rightWho",
    whoALabel: "Who should stay in the Latin Quarter?",
    whoAKey: "leftWho",
  },
];

for (const c of comparisons) {
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
      ${quizCta("Let TravelByVibe rank hotels for your neighbourhood vibe and room description.", c.slug + "-quiz")}
    </section>
    ${HUB_LINKS}
  </div>`,
      {
        canonical: c.slug,
        ogImage: c.leftImage,
        city: "Paris",
        pageCategory: "comparison",
        breadcrumbLabel: c.h1.split(":")[0],
      }
    ),
  });
}

const vibePages = [
  {
    file: "paris-boutique-hotels.html",
    slug: "paris-boutique-hotels",
    preset: "paris-boutique",
    h1: "Best Boutique Hotels in Paris",
    lead: "Boutique in Paris means restored mansions, design-forward small hotels, and rooms with mouldings — not anonymous tower blocks.",
    sections: [
      { sub: "marais", title: "Best boutique hotels in Le Marais" },
      { sub: "saint-germain", title: "Best boutique hotels in Saint-Germain" },
      { sub: "montmartre", title: "Best boutique hotels in Montmartre" },
      { sub: "romantic", title: "Best romantic boutique hotels" },
    ],
    intro: "We index real room photos and rank properties by how closely they match your description.",
  },
  {
    file: "paris-luxury-hotels.html",
    slug: "paris-luxury-hotels",
    preset: "paris-luxury",
    h1: "Best Luxury Hotels in Paris",
    lead: "Palace hotels on the Right Bank, Left Bank flagships, and suites with real marble baths — search by what the room actually looks like.",
    array: true,
    intro: "Opéra, Champs-Élysées, and Saint-Germain lead for five-star stays; TravelByVibe surfaces bathrooms and suites that match your brief.",
  },
  {
    file: "paris-romantic-hotels.html",
    slug: "paris-romantic-hotels",
    preset: "paris-romantic",
    h1: "Best Romantic Hotels in Paris",
    lead: "Soaking tubs, moody lighting, Montmartre views — Paris romance is as much the room as the arrondissement.",
    array: true,
    intro: "Montmartre and Saint-Germain lead for intimate stays; match cosy, moody, or classic room moods in search.",
  },
  {
    file: "paris-classic-hotels.html",
    slug: "paris-classic-hotels",
    preset: "paris-classic",
    h1: "Best Classic &amp; Haussmann Hotels in Paris",
    lead: "Tall windows, plaster mouldings, and pale Paris light — search Haussmann intent and see real room photography.",
    array: true,
    intro: "Latin Quarter and Saint-Germain skew classic; Opéra adds palace grandeur when you want formal luxury.",
  },
];

for (const v of vibePages) {
  const vm = seo.applySeoMeta({
    canonical: v.slug,
    city: "Paris",
    pageCategory: "vibe",
    title: `${v.h1} | TravelByVibe`,
    breadcrumbLabel: v.h1.replace(/&amp;/g, "&"),
  });
  let hotelBlocks = "";
  if (v.sections) {
    hotelBlocks = v.sections
      .map(
        (s) =>
          `<h3 class="hotel-tier-title">${s.title}</h3><div data-preset="${v.preset}" data-sub="${s.sub}" data-city="Paris" data-utm="${v.slug}-${s.sub}" aria-live="polite"></div>`
      )
      .join("\n");
  } else {
    hotelBlocks = `<div data-preset="${v.preset}" data-city="Paris" data-utm="${v.slug}-grid" aria-live="polite"></div>`;
  }
  PAGES.push({
    file: v.file,
    html: page(
      hero({
        kicker: "TravelByVibe picks",
        h1: vm.h1 || v.h1,
        lead: v.lead,
        heroImage: GARNIER,
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
      <div class="section-cta"><a class="mcta" href="${utm(v.slug + "-more")}">Discover more Paris hotels →</a></div>
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

console.log(`Done — ${PAGES.length} Paris marketing pages.`);
