/**
 * Shared SEO helpers for marketing page generators (FAQ, breadcrumbs, hub links).
 */
const { escHtml } = require("./marketing-seo-utils");
const { applySeoMeta } = require("./marketing-keywords");

function attrEsc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

/** Google Search often ignores SVG-only favicons — include /favicon.ico + PNG sizes. */
const FAVICON_HEAD = `  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/png" href="/favicon-48.png" sizes="48x48" />
  <link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0c0c0e" />`;

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
      q: "What are the best hotels for traveling to Mexico City?",
      a: "Condesa and Roma Norte suit first-time visitors; Polanco for luxury and museums; Centro Histórico for maximum sightseeing. Compare neighbourhoods on our travel guide, then match hotels by real room photos.",
    },
    {
      q: "Where should tourists stay when traveling to Mexico City?",
      a: "Most international travellers base in Condesa, Roma Norte, Polanco, or Juárez — walkable, well served, and familiar visitor districts. See our safe neighborhoods guide, then browse hotels by vibe.",
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
  "travel-mexico-city-hotels": [
    {
      q: "How do I find hotels when traveling to Mexico City?",
      a: "Start with neighbourhood — Condesa, Roma Norte, Polanco, Juárez, or Centro Histórico — then run TravelByVibe's vibe quiz or describe the room you want. We rank 3,600+ CDMX hotels by real photography before you book elsewhere.",
    },
    {
      q: "What is the best area to stay when traveling to Mexico City?",
      a: "First-time visitors often pick Condesa or Roma Norte for walkable cafés and parks. Polanco suits museum and luxury trips; Centro Histórico puts the Zócalo on your doorstep.",
    },
    {
      q: "Is it safe to travel to Mexico City for hotels in Roma or Condesa?",
      a: "Condesa, Roma Norte, Polanco, and Juárez are standard tourist hotel districts — use normal big-city awareness. Our safe neighborhoods guide compares visitor-friendly areas.",
    },
    {
      q: "Can I see hotel rooms before booking my Mexico City trip?",
      a: "Yes — TravelByVibe is built for that. Search rainfall shower, bright suite, or design mood and browse indexed room and bathroom photos across the city.",
    },
    {
      q: "Do I need dates to browse travel Mexico City hotels?",
      a: "No. Explore neighbourhoods and room photos for free. Add check-in and check-out when you want live rates from partners.",
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
  "best-area-to-stay-in-paris-first-time": [
    {
      q: "What is the best area to stay in Paris for the first time?",
      a: "Le Marais and the Latin Quarter lead for first-timers: flat, central, and walkable to major sights. Saint-Germain suits travellers who want Left Bank calm over weekend buzz.",
    },
    {
      q: "Should first-time visitors stay near the Eiffel Tower?",
      a: "You can, but many first-timers prefer Le Marais or the Latin Quarter for neighbourhood character and dinner options. Search Eiffel-view rooms on our visual search if the tower is a must.",
    },
    {
      q: "Is Montmartre good for a first Paris trip?",
      a: "Montmartre is romantic and scenic but hillier and slightly removed from the core. Great for a second half of a trip or couples; Marais/Latin Quarter are easier for sightseeing on foot.",
    },
    {
      q: "How do I pick a hotel once I choose the area?",
      a: "Use TravelByVibe to describe the room you want — rainfall shower, Haussmann light, quiet street — and we rank real Paris hotel photos in your chosen neighbourhood.",
    },
  ],
  "paris-hotels-near-eiffel-tower": [
    {
      q: "Which Paris neighbourhood is best for Eiffel Tower views?",
      a: "Trocadéro and parts of the 7th arrondissement face the tower; Latin Quarter and Opéra hotels often advertise partial Eiffel glimpses. Search visual keywords like Eiffel view or balcony.",
    },
    {
      q: "Are hotels near the Eiffel Tower expensive?",
      a: "The immediate Trocadéro area skews upscale. Latin Quarter and Montmartre can offer view-adjacent stays with more variety — compare on TravelByVibe by room photos, not just price.",
    },
    {
      q: "Can I search for hotels with an Eiffel Tower view?",
      a: "Yes — try Eiffel view, balcony at golden hour, or tower glimpse in visual search. We surface hotels whose indexed photos match.",
    },
  ],
  "safe-neighborhoods-mexico-city": [
    {
      q: "What are the safest neighborhoods in Mexico City for tourists?",
      a: "Condesa, Roma Norte, Polanco, and Juárez are the most common visitor bases — walkable, well served, and familiar to international travellers. Use normal big-city awareness at night.",
    },
    {
      q: "Is Condesa safe for tourists?",
      a: "Condesa is one of CDMX's most popular visitor districts — parks, restaurants, and galleries in a compact radius. Stay aware as you would in any major city.",
    },
    {
      q: "Is Polanco safer than Roma Norte?",
      a: "Polanco feels more residential and embassy-adjacent; Roma Norte is livelier at night. Both are standard tourist choices — pick based on vibe, not fear.",
    },
    {
      q: "Should I avoid Centro Histórico?",
      a: "Centro is vibrant and iconic but busier and louder. Many visitors stay in Condesa/Roma and day-trip to the Zócalo — others love being in the thick of it.",
    },
  ],
  "hotels-near-chapultepec": [
    {
      q: "What is the best area to stay near Chapultepec Park?",
      a: "Polanco is the classic Chapultepec base — Museo Soumaya, leafy avenues, and quick park access. Juárez and Condesa are slightly south with strong café culture.",
    },
    {
      q: "Which hotels are walking distance to Chapultepec?",
      a: "Browse our Polanco and Juárez hotel picks — many properties sit within a 10–15 minute walk of the park's eastern edge.",
    },
    {
      q: "Is Polanco or Condesa better for Chapultepec?",
      a: "Polanco for museum mile and upscale dining; Condesa for park-adjacent mornings with a leafier, café-led rhythm.",
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
    travelGuide: "/travel-mexico-city-hotels",
    travelGuideLabel: "Travel Mexico City hotels",
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
  const guide =
    city === "Paris"
      ? `<a href="__ORIGIN__/best-area-to-stay-in-paris-first-time">Paris first-time guide</a>
      <a href="__ORIGIN__/paris-hotels-near-eiffel-tower">Hotels near Eiffel Tower</a>`
      : `<a href="__ORIGIN__/travel-mexico-city-hotels">Travel Mexico City hotels</a>
      <a href="__ORIGIN__/safe-neighborhoods-mexico-city">Safe neighborhoods CDMX</a>
      <a href="__ORIGIN__/hotels-near-chapultepec">Hotels near Chapultepec</a>`;
  return `
    <nav class="hub-links" aria-label="${city} guides">
      <a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a>
      <a href="__ORIGIN__${c.where}">${c.whereLabel}</a>
      ${guide}
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
  return `<div class="wrap-wide">
    <section class="msec faq-sec" aria-labelledby="faq-heading">
      <p class="msec-kicker">FAQ</p>
      <h2 class="msec-title" id="faq-heading">Common questions</h2>
      <div class="faq-list">${items}</div>
    </section>
  </div>`;
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

function marketingHead(m, defaultOgImage) {
  const { title, desc, canonical, ogImage } = m;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <title>${title}</title>
  <meta name="description" content="${attrEsc(desc)}" />
  <link rel="canonical" href="__ORIGIN__/${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="TravelByVibe" />
  <meta property="og:title" content="${attrEsc(title)}" />
  <meta property="og:description" content="${attrEsc(desc)}" />
  <meta property="og:url" content="__ORIGIN__/${canonical}" />
  <meta property="og:image" content="${ogImage || defaultOgImage}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${attrEsc(title)}" />
  <meta name="twitter:description" content="${attrEsc(desc)}" />
${FAVICON_HEAD}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&amp;family=DM+Sans:wght@400;500;600&amp;display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/marketing/marketing.css" />
${headJsonLd(m)}
</head>`;
}

function wrapPage(body, meta, headerHtml, city) {
  const m = applySeoMeta(meta);
  if (!m.faqs && HUB_FAQS[m.canonical]) m.faqs = HUB_FAQS[m.canonical];
  if (!m.breadcrumbs) m.breadcrumbs = breadcrumbsFor(m);
  const bc = m.breadcrumbs ? breadcrumbNav(m.breadcrumbs) : "";
  let outBody = body;
  if (m.faqs && !body.includes("faq-sec")) outBody = body + faqSection(m.faqs);
  return (
    marketingHead(m, meta.defaultOgImage) +
    `\n<body data-marketing-city="${city || ""}" data-marketing-campaign="${meta.campaign || ""}">\n` +
    headerHtml +
    bc +
    outBody +
    footer(city, meta.footerExtra)
  );
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
    ? `<a href="__ORIGIN__/">Home</a> · <a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a>${c.travelGuide ? ` · <a href="__ORIGIN__${c.travelGuide}">${c.travelGuideLabel}</a>` : ""} · <a href="__ORIGIN__${c.where}">${c.whereLabel}</a> · <a href="__ORIGIN__${c.visual}">${c.visualLabel}</a>`
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

  if (cat === "neighbourhood" || cat === "comparison" || cat === "guide") {
    return [...base, { path: c.where, label: c.whereLabel }, { path: `/${meta.canonical}`, label: pageLabel }];
  }
  if (cat === "vibe") {
    return [...base, { path: `/${meta.canonical}`, label: pageLabel }];
  }
  return null;
}

module.exports = {
  FAVICON_HEAD,
  HUB_FAQS,
  CITY_HUB,
  hubLinks,
  breadcrumbNav,
  faqSection,
  headJsonLd,
  marketingHead,
  wrapPage,
  footer,
  breadcrumbsFor,
  applySeoMeta,
};
