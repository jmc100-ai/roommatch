/**
 * Shared SEO helpers for marketing page generators (FAQ, breadcrumbs, hub links).
 */
const { escHtml } = require("./marketing-seo-utils");

const HUB_FAQS = {
  "where-to-stay-in-paris": [
    {
      q: "What is the best neighbourhood to stay in Paris for first-time visitors?",
      a: "Le Marais and the Latin Quarter are the most popular first-timer picks: walkable, central, and full of cafés and museums. Saint-Germain suits travellers who want Left Bank calm. Use our neighbourhood guide, then match hotels by real room photos.",
    },
    {
      q: "Is Le Marais a good area to stay in Paris?",
      a: "Yes — Le Marais is one of Paris's best-loved districts for hotels: flat, gallery-dense, and lively without needing a car. Compare it with Saint-Germain if you prefer quieter evenings.",
    },
    {
      q: "Which Paris neighbourhood is best for couples?",
      a: "Montmartre and Saint-Germain lead for romance — village stairs and views versus literary café culture. Search for moody lighting, soaking tubs, or Haussmann light on TravelByVibe.",
    },
    {
      q: "Can I search Paris hotels by bathroom photos?",
      a: "Yes. TravelByVibe indexes real room and bathroom photography. Describe rainfall shower, marble bath, or double vanity and we rank hotels whose photos match.",
    },
    {
      q: "How does TravelByVibe differ from Booking or Expedia?",
      a: "We rank hotels by neighbourhood vibe and actual room photos — not just star ratings and lobby shots. Describe the room you want, then browse matches before you add dates.",
    },
  ],
  "paris-hotels": [
    {
      q: "How do I find Paris hotels with real room photos?",
      a: "TravelByVibe indexes hotel room photography and matches it to plain-language searches — bathrooms, light, layout, and design mood — so you see suites before you book elsewhere.",
    },
    {
      q: "What is visual hotel search for Paris?",
      a: "Type the room you picture — Haussmann bedroom, rainfall shower, balcony view — and we rank Paris hotels whose indexed photos look like your description.",
    },
    {
      q: "Are Paris hotel reviews used in search?",
      a: "Guest reviews are shown on hotel detail pages when available. Search ranking uses room photos and neighbourhood vibe, not review text.",
    },
    {
      q: "Which Paris arrondissement has the best boutique hotels?",
      a: "Le Marais, Saint-Germain, and Montmartre have the deepest boutique stock. Browse our boutique hotels guide or search by vibe for design-forward small hotels.",
    },
    {
      q: "Is TravelByVibe free to use?",
      a: "Yes — browsing and visual search are free. Add travel dates when you are ready to see live rates, then book through our partner links.",
    },
  ],
  "paris-hotel-finder": [
    {
      q: "Where should I stay in Paris for 3 days?",
      a: "For a short trip, stay central: Le Marais, Latin Quarter, or Saint-Germain keep museums and dinner within walking distance. Our vibe quiz narrows neighbourhood and room style in under a minute.",
    },
    {
      q: "Le Marais or Saint-Germain — which is better?",
      a: "Le Marais is buzzier and gallery-led; Saint-Germain is calmer and literary. See our Marais vs Saint-Germain comparison, then search hotels by room photos.",
    },
    {
      q: "Is Montmartre too far from central Paris?",
      a: "Montmartre is north of the core but well connected by métro. Trade a few extra minutes on the line for village atmosphere and skyline views.",
    },
    {
      q: "What is the vibe wizard?",
      a: "A short quiz that captures trip pace, neighbourhood feel, and room must-haves — then opens TravelByVibe with your city and context pre-loaded.",
    },
  ],
  "paris-visual-search": [
    {
      q: "Can I search Paris hotels by describing the bathroom?",
      a: "Yes — try rainfall shower, marble bathroom, soaking tub, or walk-in shower. We surface hotels whose indexed bathroom photos match.",
    },
    {
      q: "What should I type for a Haussmann-style Paris hotel room?",
      a: "Try Haussmann light, tall windows, mouldings, or classic Paris apartment hotel. Visual search ranks rooms with that photography.",
    },
    {
      q: "Does visual search work for luxury Paris hotels?",
      a: "Yes. Opéra and Saint-Germain have strong luxury coverage. Describe palace bath, Eiffel view, or art-deco mood to see matching suites.",
    },
    {
      q: "Do I need an account to search?",
      a: "No account required during beta. Open a city, describe your room, and browse ranked results.",
    },
  ],
  "where-to-stay-in-mexico-city": [
    {
      q: "What is the best neighbourhood to stay in Mexico City for first-time visitors?",
      a: "Condesa and Roma Norte are the default first-timer picks: leafy, walkable, and full of cafés. Polanco suits luxury and museums; Centro Histórico suits maximum sightseeing.",
    },
    {
      q: "Is Condesa safe and walkable for tourists?",
      a: "Condesa is one of CDMX's most walkable visitor districts — parks, restaurants, and galleries in a compact radius. Always use normal big-city awareness at night.",
    },
    {
      q: "Condesa or Polanco — which is better?",
      a: "Condesa is leafier and café-led; Polanco is upscale with museums and fine dining. See our Condesa vs Polanco guide, then match hotels by room photos.",
    },
    {
      q: "Can I search Mexico City hotels by room photos?",
      a: "Yes. TravelByVibe is built for CDMX with thousands of indexed hotels. Describe rainfall shower, bright suite, or design-forward room and browse real matches.",
    },
    {
      q: "Is Centro Histórico good for hotels?",
      a: "Centro is unbeatable for Zócalo and Templo Mayor access but busier and louder. Choose it when culture density beats quiet evenings.",
    },
  ],
  "mexico-city-hotels": [
    {
      q: "How do I find Mexico City hotels with real room photos?",
      a: "TravelByVibe indexes room photography across 3,600+ CDMX hotels. Search by vibe — bathroom features, natural light, design mood — before you commit on a booking site.",
    },
    {
      q: "What is visual hotel search for Mexico City?",
      a: "Describe the room you want in plain language. We rank hotels whose indexed photos match, plus neighbourhood vibe from our CDMX map.",
    },
    {
      q: "Which CDMX neighbourhood has the best boutique hotels?",
      a: "Roma Norte and Condesa lead for design boutiques; Polanco for polished luxury. Browse our boutique hotels page or run the vibe wizard.",
    },
    {
      q: "Is TravelByVibe the launch city for Mexico?",
      a: "Yes — Mexico City has our deepest visual index and neighbourhood tooling. Paris guides are expanding on the same platform.",
    },
    {
      q: "Is browsing free?",
      a: "Yes. Add dates when you want live rates; booking hands off to partners when you are ready.",
    },
  ],
  "mexico-city-hotel-finder": [
    {
      q: "Where should I stay in Mexico City for food and nightlife?",
      a: "Roma Norte and Condesa — independent restaurants, bars, and terrace culture. Juárez sits between them with strong connectivity.",
    },
    {
      q: "Where should I stay for museums in CDMX?",
      a: "Polanco for Museo Soumaya and Chapultepec; Centro for historic core sites. Match your days to the barrio, then pick a room you actually like.",
    },
    {
      q: "Roma Norte vs Condesa — how do I choose?",
      a: "Roma skews trendier and louder after dark; Condesa is leafier and calmer. Our comparison page breaks down walkability, price, and vibe.",
    },
    {
      q: "What is the vibe wizard?",
      a: "A quick quiz for trip pace, neighbourhood feel, and room must-haves — then opens CDMX search with your context.",
    },
  ],
  "mexico-city-visual-search": [
    {
      q: "Can I search CDMX hotels by bathroom features?",
      a: "Yes — rainfall shower, soaking tub, walk-in shower, and double vanity are common searches. We rank hotels with matching bathroom photos.",
    },
    {
      q: "What should I type for a bright design hotel in Roma?",
      a: "Try bright suite, floor-to-ceiling windows, minimalist room, or polished concrete. Visual search surfaces design-forward matches.",
    },
    {
      q: "Does visual search include neighbourhood fit?",
      a: "Yes — neighbourhood vibe blends into ranking when you use the vibe wizard or boop flow. Room match stays the primary signal.",
    },
    {
      q: "Do I need dates to search?",
      a: "No — browse by photos first. Add check-in and check-out when you want live rates.",
    },
  ],
};

const CITY_HUB = {
  Paris: {
    hotels: "/paris-hotels",
    hotelsLabel: "Paris hotels",
    where: "/where-to-stay-in-paris",
    whereLabel: "Where to stay in Paris",
    finder: "/paris-hotel-finder",
    finderLabel: "Paris hotel finder",
    visual: "/paris-visual-search",
    visualLabel: "Paris visual search",
    crossCity: { href: "/where-to-stay-in-mexico-city", label: "Where to stay in Mexico City" },
    footerLine: "photo-first hotel discovery for Paris travellers",
  },
  "Mexico City": {
    hotels: "/mexico-city-hotels",
    hotelsLabel: "Mexico City hotels",
    where: "/where-to-stay-in-mexico-city",
    whereLabel: "Where to stay in Mexico City",
    finder: "/mexico-city-hotel-finder",
    finderLabel: "Mexico City hotel finder",
    visual: "/mexico-city-visual-search",
    visualLabel: "Mexico City visual search",
    crossCity: { href: "/where-to-stay-in-paris", label: "Where to stay in Paris" },
    footerLine: "photo-first hotel discovery for Mexico City travellers",
  },
};

function hubLinks(city) {
  const c = CITY_HUB[city];
  if (!c) return "";
  return `
    <nav class="hub-links" aria-label="${city} guides">
      <a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a>
      <a href="__ORIGIN__${c.where}">${c.whereLabel}</a>
      <a href="__ORIGIN__/hotels-in-${city === "Paris" ? "le-marais" : "condesa"}">${city === "Paris" ? "Hotels in Le Marais" : "Hotels in Condesa"}</a>
      <a href="__ORIGIN__/hotels-in-${city === "Paris" ? "saint-germain" : "polanco"}">${city === "Paris" ? "Hotels in Saint-Germain" : "Hotels in Polanco"}</a>
      <a href="__ORIGIN__/${city === "Paris" ? "marais-vs-saint-germain" : "condesa-vs-polanco"}">${city === "Paris" ? "Marais vs Saint-Germain" : "Condesa vs Polanco"}</a>
      <a href="__ORIGIN__/${city === "Paris" ? "paris-boutique-hotels" : "mexico-city-boutique-hotels"}">${city === "Paris" ? "Paris boutique hotels" : "Boutique hotels in Mexico City"}</a>
      <a href="__ORIGIN__${c.finder}">${c.finderLabel}</a>
    </nav>`;
}

function breadcrumbNav(crumbs) {
  if (!crumbs || !crumbs.length) return "";
  const items = crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      if (isLast) return `<span aria-current="page">${escHtml(c.label)}</span>`;
      return `<a href="__ORIGIN__${c.path}">${escHtml(c.label)}</a>`;
    })
    .join('<span class="bc-sep" aria-hidden="true">›</span>');
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items}</nav>`;
}

function breadcrumbSchema(crumbs, pagePath) {
  const list = [
    { "@type": "ListItem", position: 1, name: "Destinations", item: "__ORIGIN__/destinations" },
    ...crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 2,
      name: c.label,
      item: `__ORIGIN__${c.path}`,
    })),
  ];
  if (pagePath && crumbs.length && crumbs[crumbs.length - 1].path !== pagePath) {
    list.push({
      "@type": "ListItem",
      position: list.length + 1,
      name: crumbs[crumbs.length - 1].label,
      item: `__ORIGIN__${pagePath}`,
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list,
  };
}

function faqSection(faqs) {
  if (!faqs || !faqs.length) return "";
  const items = faqs
    .map(
      (f) => `<details class="faq-item">
      <summary>${escHtml(f.q)}</summary>
      <p>${escHtml(f.a)}</p>
    </details>`
    )
    .join("\n");
  return `<section class="msec faq-sec" aria-labelledby="faq-heading">
      <p class="msec-kicker">FAQ</p>
      <h2 class="msec-title" id="faq-heading">Common questions</h2>
      <div class="faq-list">${items}</div>
    </section>`;
}

function faqSchema(faqs) {
  if (!faqs || !faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function jsonLdScripts(schemas) {
  return (schemas || [])
    .filter(Boolean)
    .map((s) => `  <script type="application/ld+json">\n  ${JSON.stringify(s)}\n  </script>`)
    .join("\n");
}

function headJsonLd(meta) {
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: meta.title,
      description: meta.desc,
      url: `__ORIGIN__/${meta.canonical}`,
      isPartOf: { "@type": "WebSite", name: "TravelByVibe", url: "__ORIGIN__/" },
    },
  ];
  if (meta.breadcrumbs) schemas.push(breadcrumbSchema(meta.breadcrumbs, `/${meta.canonical}`));
  if (meta.faqs) {
    const fs = faqSchema(meta.faqs);
    if (fs) schemas.push(fs);
  }
  return jsonLdScripts(schemas);
}

function footer(city, extraLinks) {
  const c = city ? CITY_HUB[city] : null;
  const cross = c
    ? ` · <a href="__ORIGIN__${c.crossCity.href}">${c.crossCity.label}</a>`
    : "";
  const cityLinks = c
    ? `<a href="__ORIGIN__/">Home</a> · <a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a> · <a href="__ORIGIN__${c.where}">${c.whereLabel}</a> · <a href="__ORIGIN__${c.visual}">${c.visualLabel}</a>`
    : `<a href="__ORIGIN__/">Home</a> · <a href="__ORIGIN__/destinations">Destinations</a>`;
  const tag = c ? c.footerLine : "photo-first hotel discovery";
  return `<footer class="mfoot">
    <p>TravelByVibe — ${tag}. · TravelBoop, LLC</p>
    <p>${cityLinks} · <a href="__ORIGIN__/sitemap">Site map</a>${cross}${extraLinks || ""}</p>
    <div class="credits-block">
      City photos from <a href="https://commons.wikimedia.org/" rel="noopener">Wikimedia Commons</a>, <a href="https://unsplash.com" rel="noopener">Unsplash</a>, and partner catalogs where noted.
    </div>
  </footer>
  <script src="/marketing/marketing.js" defer></script>
</body>
</html>`;
}

function breadcrumbsFor(meta) {
  const city = meta.city;
  const c = city ? CITY_HUB[city] : null;
  if (!c) return null;
  const base = [{ path: c.hotels, label: c.hotelsLabel }];
  const cat = meta.pageCategory;
  const pageLabel = meta.breadcrumbLabel || meta.title.split(" | ")[0].split(" — ")[0];

  if (cat === "hub" || !cat) return null;

  if (cat === "neighbourhood" || cat === "comparison") {
    return [...base, { path: c.where, label: c.whereLabel }, { path: `/${meta.canonical}`, label: pageLabel }];
  }
  if (cat === "vibe") {
    return [...base, { path: `/${meta.canonical}`, label: pageLabel }];
  }
  return null;
}

module.exports = {
  HUB_FAQS,
  CITY_HUB,
  hubLinks,
  breadcrumbNav,
  faqSection,
  headJsonLd,
  footer,
  breadcrumbsFor,
};
