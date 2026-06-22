/**
 * Shared SEO helpers for marketing page generators (FAQ, breadcrumbs, hub links).
 */
const { escHtml } = require("./marketing-seo-utils");
const { applySeoMeta } = require("./marketing-keywords");
const { searchableLabel } = require("./marketing-city-stats");

const PARIS_COUNT = searchableLabel("Paris");
const CDMX_COUNT = searchableLabel("Mexico City");
const LONDON_COUNT = searchableLabel("London");

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

const COPYRIGHT_LINE = "© 2026 TravelBoop, LLC. All rights reserved.";

const HUB_FAQS = {
  "where-to-stay-in-paris": [
    {
      q: "What is the best neighborhood to stay in Paris for first-time visitors?",
      a: "Le Marais and the Latin Quarter are the most popular first-timer picks: walkable, central, and full of cafés and museums. Saint-Germain suits travellers who want Left Bank calm. Use our neighborhood guide, then match hotels by real room photos.",
    },
    {
      q: "Is Le Marais a good area to stay in Paris?",
      a: "Yes — Le Marais is one of Paris's best-loved districts for hotels: flat, gallery-dense, and lively without needing a car. Compare it with Saint-Germain if you prefer quieter evenings.",
    },
    {
      q: "Which Paris neighborhood is best for couples?",
      a: "Montmartre and Saint-Germain lead for romance — village stairs and views versus literary café culture. Search for moody lighting, soaking tubs, or Haussmann light on TravelByVibe.",
    },
    {
      q: "Can I search Paris hotels by bathroom photos?",
      a: "Yes. TravelByVibe indexes real room and bathroom photography. Describe rainfall shower, marble bath, or double vanity and we rank hotels whose photos match.",
    },
    {
      q: "How does TravelByVibe differ from Booking or Expedia?",
      a: "We rank hotels by neighborhood vibe and actual room photos — not just star ratings and lobby shots. Describe the room you want, then browse matches before you add dates.",
    },
  ],
  "paris-hotels": [
    {
      q: "How do I find Paris hotels with real room photos?",
      a: `TravelByVibe indexes room photography across ${PARIS_COUNT} Paris hotels with searchable room photos. Search by vibe — bathroom features, Haussmann light, design mood — before you commit on a booking site.`,
    },
    {
      q: "What is visual hotel search for Paris?",
      a: "Type the room you picture — Haussmann bedroom, rainfall shower, balcony view — and we rank Paris hotels whose indexed photos look like your description.",
    },
    {
      q: "Are Paris hotel reviews used in search?",
      a: "Guest reviews are shown on hotel detail pages when available. Search ranking uses room photos and neighborhood vibe, not review text.",
    },
    {
      q: "Which Paris arrondissement has the best boutique hotels?",
      a: "Le Marais, Saint-Germain, and Montmartre have the deepest boutique stock. Browse our boutique hotels guide or search by vibe for design-forward small hotels.",
    },
    {
      q: "Is TravelByVibe free to use?",
      a: "Yes — browsing and visual search are free. Add travel dates when you are ready to see live rates, then book through our partner links.",
    },
    {
      q: "How many Paris hotels does TravelByVibe cover?",
      a: `We index ${PARIS_COUNT} Paris hotels with enough room photography for visual search. Mexico City (${CDMX_COUNT}) remains comparably deep on the same platform.`,
    },
  ],
  "paris-hotel-finder": [
    {
      q: "Where should I stay in Paris for 3 days?",
      a: "For a short trip, stay central: Le Marais, Latin Quarter, or Saint-Germain keep museums and dinner within walking distance. Our vibe quiz narrows neighborhood and room style in under a minute.",
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
      a: "A short quiz that captures trip pace, neighborhood feel, and room must-haves — then opens TravelByVibe with your city and context pre-loaded.",
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
      q: "What is the best neighborhood to stay in Mexico City for first-time visitors?",
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
      a: `TravelByVibe indexes room photography across ${CDMX_COUNT} CDMX hotels. Search by vibe — bathroom features, natural light, design mood — before you commit on a booking site.`,
    },
    {
      q: "What are the best hotels in Mexico City?",
      a: "Condesa and Roma Norte suit first-time visitors; Polanco for luxury and museums; Centro Histórico for maximum sightseeing. Compare neighborhoods on our where-to-stay guide, then match hotels by real room photos.",
    },
    {
      q: "Where should tourists stay when traveling to Mexico City?",
      a: "Most international travellers base in Condesa, Roma Norte, Polanco, or Juárez — walkable, well served, and familiar visitor districts. See our safe neighborhoods guide, then browse hotels by vibe.",
    },
    {
      q: "What is visual hotel search for Mexico City?",
      a: "Describe the room you want in plain language. We rank hotels whose indexed photos match, plus neighborhood vibe from our CDMX map.",
    },
    {
      q: "Which CDMX neighborhood has the best boutique hotels?",
      a: "Roma Norte and Condesa lead for design boutiques; Polanco for polished luxury. Browse our boutique hotels page or run the vibe wizard.",
    },
    {
      q: "Is TravelByVibe the launch city for Mexico?",
      a: "Yes — Mexico City has our deepest visual index and neighborhood tooling. Paris guides are expanding on the same platform.",
    },
    {
      q: "Is browsing free?",
      a: "Yes. Add dates when you want live rates; booking hands off to partners when you are ready.",
    },
  ],
  "travel-mexico-city-hotels": [
    {
      q: "How do I find hotels when traveling to Mexico City?",
      a: `Start with neighborhood — Condesa, Roma Norte, Polanco, Juárez, or Centro Histórico — then run TravelByVibe's vibe quiz or describe the room you want. We rank ${CDMX_COUNT} CDMX hotels by real photography before you book elsewhere.`,
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
      a: "No. Explore neighborhoods and room photos for free. Add check-in and check-out when you want live rates from partners.",
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
      a: "A quick quiz for trip pace, neighborhood feel, and room must-haves — then opens CDMX search with your context.",
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
      q: "Does visual search include neighborhood fit?",
      a: "Yes — neighborhood vibe blends into ranking when you use the vibe wizard or boop flow. Room match stays the primary signal.",
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
      a: "You can, but many first-timers prefer Le Marais or the Latin Quarter for neighborhood character and dinner options. Search Eiffel-view rooms on our visual search if the tower is a must.",
    },
    {
      q: "Is Montmartre good for a first Paris trip?",
      a: "Montmartre is romantic and scenic but hillier and slightly removed from the core. Great for a second half of a trip or couples; Marais/Latin Quarter are easier for sightseeing on foot.",
    },
    {
      q: "How do I pick a hotel once I choose the area?",
      a: "Use TravelByVibe to describe the room you want — rainfall shower, Haussmann light, quiet street — and we rank real Paris hotel photos in your chosen neighborhood.",
    },
  ],
  "paris-hotels-near-eiffel-tower": [
    {
      q: "Which Paris neighborhood is best for Eiffel Tower views?",
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
  "travel-paris-hotels": [
    {
      q: "How do I find hotels when traveling to Paris?",
      a: `Start with neighborhood — Le Marais, Latin Quarter, Saint-Germain, or Montmartre — then run TravelByVibe's vibe quiz or describe the room you want. We rank ${PARIS_COUNT} Paris hotels by real photography before you book elsewhere.`,
    },
    {
      q: "What is the best area to stay when traveling to Paris?",
      a: "First-time visitors often pick Le Marais or the Latin Quarter for walkable museums and cafés. Saint-Germain suits Left Bank calm; Montmartre suits romance and views.",
    },
    {
      q: "Can I see hotel rooms before booking my Paris trip?",
      a: "Yes — TravelByVibe is built for that. Search rainfall shower, Haussmann light, or moody boutique mood and browse indexed room and bathroom photos across Paris.",
    },
    {
      q: "Do I need dates to browse travel Paris hotels?",
      a: "No. Explore neighborhoods and room photos for free. Add check-in and check-out when you want live rates from partners.",
    },
  ],
  "safe-neighborhoods-paris": [
    {
      q: "What are the best areas to stay in Paris for tourists?",
      a: "Le Marais, Latin Quarter, Saint-Germain-des-Prés, and Montmartre are the most common visitor hotel districts — walkable, well served by métro, and familiar to international travellers. Use normal big-city awareness at night.",
    },
    {
      q: "Is Le Marais a good area for tourists?",
      a: "Le Marais is one of Paris's most popular visitor districts — flat, central, and full of galleries and restaurants. It is a standard first-timer base.",
    },
    {
      q: "Is Montmartre safe for tourists?",
      a: "Montmartre is a well-trodden visitor area with village charm and skyline views. It is hillier and slightly north of the core — plan on métro hops for some sights.",
    },
    {
      q: "Should I avoid any Paris arrondissement entirely?",
      a: "Most visitors choose among central Left Bank and Marais districts rather than avoiding whole areas. Pick based on trip vibe — then match the room on TravelByVibe.",
    },
  ],
  "paris-walkable-hotels": [
    {
      q: "What is the most walkable neighborhood in Paris for hotels?",
      a: "Le Marais and the Latin Quarter lead for flat, central walks — museums, bistros, and river access without a car. Saint-Germain adds Left Bank polish on foot.",
    },
    {
      q: "Can I walk everywhere in Paris from one hotel?",
      a: "Central districts reward walkers, but Paris is large — métro fills gaps. Stay in Marais or Latin Quarter if maximizing on-foot sightseeing is the priority.",
    },
    {
      q: "Are walkable Paris hotels more expensive?",
      a: "Central arrondissements span boutique to palace price points. Compare room photos on TravelByVibe — a perfect location still fails if the suite feels wrong.",
    },
  ],
  "paris-cafe-vibe-hotels": [
    {
      q: "Which Paris neighborhood has the best café culture for hotels?",
      a: "Saint-Germain-des-Prés and Le Marais lead — literary Left Bank cafés versus Marais terrace mornings. Both are walkable and full of independent tables.",
    },
    {
      q: "Can I search Paris hotels near café culture?",
      a: "Yes — browse our café-culture picks, then describe terrace mornings or wine-bar evenings in visual search to match room photos.",
    },
  ],
  "paris-boutique-hotels": [
    {
      q: "What are the best boutique hotels in Paris?",
      a: "Le Marais, Saint-Germain, and Montmartre have the deepest boutique stock — restored mansions and design-forward small hotels. Browse our picks or search by room photos.",
    },
    {
      q: "How is a Paris boutique hotel different from a palace hotel?",
      a: "Boutiques skew intimate and design-led; palace hotels on Opéra and the Champs skew grand lobby and formal service. TravelByVibe helps you judge the actual room in either case.",
    },
  ],
  "paris-luxury-hotels": [
    {
      q: "What are the best luxury hotels in Paris?",
      a: "Opéra, Saint-Germain, and the Champs lead for five-star stays. Search palace bath, marble shower, or Haussmann suite on TravelByVibe before you book elsewhere.",
    },
    {
      q: "Can I search luxury Paris hotels by bathroom photos?",
      a: "Yes — rainfall shower, soaking tub, and double vanity are common searches. We surface hotels whose indexed bathroom photos match.",
    },
  ],
  "paris-romantic-hotels": [
    {
      q: "What are the best romantic hotels in Paris?",
      a: "Montmartre and Saint-Germain lead for couples — village views or Left Bank intimacy. Search moody lighting, soaking tub, or cosy boutique mood in visual search.",
    },
  ],
  "paris-classic-hotels": [
    {
      q: "What is a Haussmann-style hotel room in Paris?",
      a: "Tall windows, plaster mouldings, and pale Paris light — the classic apartment feel. Search Haussmann or classic Paris apartment hotel on TravelByVibe.",
    },
  ],
  "mexico-city-boutique-hotels": [
    {
      q: "What are the best boutique hotels in Mexico City?",
      a: "Roma Norte and Condesa lead for design boutiques; Polanco for polished luxury. Browse our boutique page or search by real room photos.",
    },
  ],
  "mexico-city-design-hotels": [
    {
      q: "What are the best design hotels in Mexico City?",
      a: "Polanco and Condesa lead for architecture-forward stays — mid-century restoration and contemporary glass. Search sleek, eclectic, or minimalist room moods.",
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
  "best-area-to-stay-in-mexico-city-first-time": [
    {
      q: "What is the best area to stay in Mexico City for the first time?",
      a: "Condesa and Roma Norte lead for first-timers: leafy, walkable, and full of cafés without needing a car. Polanco suits museum and luxury trips; Centro Histórico puts the Zócalo on your doorstep.",
    },
    {
      q: "Should first-time visitors stay in Centro Histórico?",
      a: "Centro is unbeatable for sightseeing density but busier and louder. Many first-timers prefer Condesa or Roma Norte for evening calm, then metro or Uber to the historic core.",
    },
    {
      q: "Condesa or Roma Norte for a first Mexico City trip?",
      a: "Condesa is leafier and calmer after dark; Roma Norte skews trendier for food and nightlife. Our Roma Norte vs Condesa comparison breaks down the trade-offs.",
    },
    {
      q: "Is Polanco good for first-time visitors?",
      a: "Yes if museums and upscale dining are priorities — Chapultepec and Polanco's restaurant scene reward a polished base. Condesa or Roma are easier if you want café culture on foot.",
    },
    {
      q: "Can I see hotel rooms before booking my first CDMX trip?",
      a: `Yes — TravelByVibe ranks ${CDMX_COUNT} Mexico City hotels by real room and bathroom photos. Describe rainfall shower, bright suite, or design mood before you commit elsewhere.`,
    },
  ],
  "where-to-stay-in-london": [
    {
      q: "What is the best neighborhood to stay in London for first-time visitors?",
      a: "Westminster and Covent Garden are the most popular first-timer picks: walkable, central, and full of icons. South Kensington suits museum-heavy trips. Use our neighborhood guide, then match hotels by real room photos.",
    },
    {
      q: "Is Covent Garden a good area to stay in London?",
      a: "Yes — Covent Garden is one of London's best-loved districts for hotels: flat, theatre-dense, and lively without needing a car. Compare it with Marylebone if you prefer quieter evenings.",
    },
    {
      q: "Which London neighborhood is best for couples?",
      a: "Notting Hill and South Kensington lead for romance — village streets and museum mornings versus pastel townhouses. Search for moody lighting, soaking tubs, or Thames views on TravelByVibe.",
    },
    {
      q: "Can I search London hotels by bathroom photos?",
      a: "Yes. TravelByVibe indexes real room and bathroom photography. Describe rainfall shower, marble bath, or double vanity and we rank hotels whose photos match.",
    },
    {
      q: "How does TravelByVibe differ from Booking or Expedia?",
      a: "We rank hotels by neighborhood vibe and actual room photos — not just star ratings and lobby shots. Describe the room you want, then browse matches before you add dates.",
    },
  ],
  "london-hotels": [
    {
      q: "How do I find London hotels with real room photos?",
      a: `TravelByVibe indexes room photography across ${LONDON_COUNT} London hotels with searchable room photos. Search by vibe — bathroom features, Victorian light, design mood — before you commit on a booking site.`,
    },
    {
      q: "What is visual hotel search for London?",
      a: "Type the room you picture — Victorian bedroom, rainfall shower, Thames view — and we rank London hotels whose indexed photos look like your description.",
    },
    {
      q: "Which London district has the best boutique hotels?",
      a: "Marylebone, Covent Garden, and Notting Hill have the deepest boutique stock. Browse our boutique hotels guide or search by vibe for design-forward small hotels.",
    },
    {
      q: "Is TravelByVibe free to use?",
      a: "Yes — browsing and visual search are free. Add travel dates when you are ready to see live rates, then book through our partner links.",
    },
    {
      q: "How many London hotels does TravelByVibe cover?",
      a: `We index ${LONDON_COUNT} London hotels with enough room photography for visual search. Paris (${PARIS_COUNT}) and Mexico City (${CDMX_COUNT}) are comparably deep on the same platform.`,
    },
  ],
  "london-hotel-finder": [
    {
      q: "Where should I stay in London for 3 days?",
      a: "For a short trip, stay central: Westminster, Covent Garden, or South Kensington keep museums and dinner within walking distance. Our vibe quiz narrows neighborhood and room style in under a minute.",
    },
    {
      q: "Westminster or Covent Garden — which is better?",
      a: "Westminster is iconic and park-led; Covent Garden is buzzier and theatre-focused. See our Westminster vs Covent Garden comparison, then search hotels by room photos.",
    },
    {
      q: "Is Shoreditch too far from central London?",
      a: "Shoreditch is east of the core but well connected by Tube and Overground. Trade a few extra minutes on the line for street art and rooftop bars.",
    },
    {
      q: "What is the vibe wizard?",
      a: "A short quiz that captures trip pace, neighborhood feel, and room must-haves — then opens TravelByVibe with your city and context pre-loaded.",
    },
  ],
  "london-visual-search": [
    {
      q: "Can I search London hotels by describing the bathroom?",
      a: "Yes — try rainfall shower, marble bathroom, soaking tub, or walk-in shower. We surface hotels whose indexed bathroom photos match.",
    },
    {
      q: "What should I type for a classic Victorian London hotel room?",
      a: "Try Victorian light, tall windows, mouldings, or classic London townhouse hotel. Visual search ranks rooms with that photography.",
    },
    {
      q: "Does visual search work for luxury London hotels?",
      a: "Yes. Westminster and Marylebone have strong luxury coverage. Describe palace bath, Thames view, or art-deco mood to see matching suites.",
    },
    {
      q: "Do I need an account to search?",
      a: "No account required during beta. Open a city, describe your room, and browse ranked results.",
    },
  ],
  "travel-london-hotels": [
    {
      q: "How do I find hotels when traveling to London?",
      a: `Start with neighborhood — Westminster, Covent Garden, South Kensington, Marylebone, or Shoreditch — then run TravelByVibe's vibe quiz or describe the room you want. We rank ${LONDON_COUNT} London hotels by real photography before you book elsewhere.`,
    },
    {
      q: "What is the best area to stay when traveling to London?",
      a: "First-time visitors often pick Westminster or Covent Garden for walkable icons and theatres. South Kensington suits museum trips; Marylebone for boutique calm.",
    },
    {
      q: "Can I see hotel rooms before booking my London trip?",
      a: "Yes — TravelByVibe is built for that. Search rainfall shower, bright suite, or design mood and browse indexed room and bathroom photos across the city.",
    },
  ],
};

const CITY_HUB = {
  Paris: {
    hotels: "/paris-hotels",
    hotelsLabel: "Paris hotels",
    travelGuide: "/travel-paris-hotels",
    travelGuideLabel: "Travel Paris hotels",
    where: "/where-to-stay-in-paris",
    whereLabel: "Where to stay in Paris",
    finder: "/paris-hotel-finder",
    finderLabel: "Paris hotel finder",
    visual: "/paris-visual-search",
    visualLabel: "Paris visual search",
    crossCity: { href: "/where-to-stay-in-mexico-city", label: "Where to stay in Mexico City" },
    footerLine: "photo-first hotel discovery for Paris travellers",
  },
  London: {
    hotels: "/london-hotels",
    hotelsLabel: "London hotels",
    travelGuide: "/travel-london-hotels",
    travelGuideLabel: "Travel London hotels",
    where: "/where-to-stay-in-london",
    whereLabel: "Where to stay in London",
    finder: "/london-hotel-finder",
    finderLabel: "London hotel finder",
    visual: "/london-visual-search",
    visualLabel: "London visual search",
    crossCity: { href: "/where-to-stay-in-paris", label: "Where to stay in Paris" },
    footerLine: "photo-first hotel discovery for London travellers",
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
  const guideByCity = {
    Paris: `<a href="__ORIGIN__/best-area-to-stay-in-paris-first-time">Paris first-time guide</a>
      <a href="__ORIGIN__/travel-paris-hotels">Travel Paris hotels</a>
      <a href="__ORIGIN__/safe-neighborhoods-paris">Best areas for tourists</a>
      <a href="__ORIGIN__/paris-walkable-hotels">Walkable Paris hotels</a>
      <a href="__ORIGIN__/paris-hotels-near-eiffel-tower">Hotels near Eiffel Tower</a>
      <a href="__ORIGIN__/paris-cafe-vibe-hotels">Café culture hotels</a>`,
    "Mexico City": `<a href="__ORIGIN__/best-area-to-stay-in-mexico-city-first-time">Mexico City first-time guide</a>
      <a href="__ORIGIN__/travel-mexico-city-hotels">Travel Mexico City hotels</a>
      <a href="__ORIGIN__/safe-neighborhoods-mexico-city">Safe neighborhoods CDMX</a>
      <a href="__ORIGIN__/hotels-near-chapultepec">Hotels near Chapultepec</a>`,
    London: `<a href="__ORIGIN__/best-area-to-stay-in-london-first-time">London first-time guide</a>
      <a href="__ORIGIN__/travel-london-hotels">Travel London hotels</a>
      <a href="__ORIGIN__/safe-neighborhoods-london">Best areas for tourists</a>
      <a href="__ORIGIN__/london-walkable-hotels">Walkable London hotels</a>
      <a href="__ORIGIN__/london-hotels-near-big-ben">Hotels near Big Ben</a>
      <a href="__ORIGIN__/london-cafe-vibe-hotels">Café culture hotels</a>`,
  };
  const nbhdByCity = {
    Paris: {
      a: "le-marais",
      aLabel: "Hotels in Le Marais",
      b: "saint-germain",
      bLabel: "Hotels in Saint-Germain",
      cmp: "marais-vs-saint-germain",
      cmpLabel: "Marais vs Saint-Germain",
      vibe: "paris-boutique-hotels",
      vibeLabel: "Paris boutique hotels",
    },
    "Mexico City": {
      a: "condesa",
      aLabel: "Hotels in Condesa",
      b: "polanco",
      bLabel: "Hotels in Polanco",
      cmp: "condesa-vs-polanco",
      cmpLabel: "Condesa vs Polanco",
      vibe: "mexico-city-boutique-hotels",
      vibeLabel: "Boutique hotels in Mexico City",
    },
    London: {
      a: "westminster",
      aLabel: "Hotels in Westminster",
      b: "covent-garden",
      bLabel: "Hotels in Covent Garden",
      cmp: "westminster-vs-covent-garden",
      cmpLabel: "Westminster vs Covent Garden",
      vibe: "london-boutique-hotels",
      vibeLabel: "London boutique hotels",
    },
  };
  const n = nbhdByCity[city] || nbhdByCity.Paris;
  const guide = guideByCity[city] || guideByCity.Paris;
  return `
    <nav class="hub-links" aria-label="${city} guides">
      <a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a>
      <a href="__ORIGIN__${c.where}">${c.whereLabel}</a>
      ${guide}
      <a href="__ORIGIN__/hotels-in-${n.a}">${n.aLabel}</a>
      <a href="__ORIGIN__/hotels-in-${n.b}">${n.bLabel}</a>
      <a href="__ORIGIN__/${n.cmp}">${n.cmpLabel}</a>
      <a href="__ORIGIN__/${n.vibe}">${n.vibeLabel}</a>
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
      "@type": "Organization",
      name: "TravelByVibe",
      legalName: "TravelBoop, LLC",
      url: "__ORIGIN__/",
      logo: "__ORIGIN__/og-image.png",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "TravelByVibe",
      url: "__ORIGIN__/",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "__ORIGIN__/?city={city}&q={search_term_string}",
        },
        "query-input": "required name=city required name=search_term_string",
      },
    },
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

function footerExploreLinks(city) {
  const c = city ? CITY_HUB[city] : null;
  if (!c) {
    return `<li><a href="__ORIGIN__/destinations">All destination guides</a></li>
            <li><a href="__ORIGIN__/sitemap">Site map</a></li>`;
  }
  const cross = c.crossCity
    ? `<li><a href="__ORIGIN__${c.crossCity.href}">${c.crossCity.label}</a></li>`
    : "";
  return `<li><a href="__ORIGIN__${c.hotels}">${c.hotelsLabel}</a></li>
          <li><a href="__ORIGIN__${c.where}">${c.whereLabel}</a></li>
          ${c.travelGuide ? `<li><a href="__ORIGIN__${c.travelGuide}">${c.travelGuideLabel}</a></li>` : ""}
          <li><a href="__ORIGIN__${c.finder}">${c.finderLabel}</a></li>
          <li><a href="__ORIGIN__${c.visual}">${c.visualLabel}</a></li>
          ${cross}
          <li><a href="__ORIGIN__/sitemap">Site map</a></li>`;
}

function footer(city, extraLinks) {
  const c = city ? CITY_HUB[city] : null;
  const tag = c ? c.footerLine : "photo-first hotel discovery";
  const exploreHeading = c ? "Explore" : "Company";
  return `<footer class="mfoot">
    <div class="mfoot-inner">
      <div class="mfoot-grid">
        <div class="mfoot-col mfoot-brand">
          <p class="mfoot-logo">TravelByVibe</p>
          <p class="mfoot-tagline">${tag}.</p>
        </div>
        <div class="mfoot-col">
          <p class="mfoot-heading">Destinations</p>
          <ul class="mfoot-links">
            <li><a href="__ORIGIN__/mexico-city-hotels">Mexico City hotels</a></li>
            <li><a href="__ORIGIN__/paris-hotels">Paris hotels</a></li>
            <li><a href="__ORIGIN__/london-hotels">London hotels</a></li>
            <li><a href="__ORIGIN__/destinations">All destination guides</a></li>
          </ul>
        </div>
        <div class="mfoot-col">
          <p class="mfoot-heading">${exploreHeading}</p>
          <ul class="mfoot-links">
            ${footerExploreLinks(city)}
            <li><a href="__ORIGIN__/privacy">Privacy</a></li>
            <li><a href="__ORIGIN__/terms">Terms</a></li>
          </ul>
        </div>
      </div>
      <div class="mfoot-bottom">
        <p>${COPYRIGHT_LINE}</p>
        <p class="mfoot-credits">City photos from <a href="https://commons.wikimedia.org/" rel="noopener">Wikimedia Commons</a>, <a href="https://unsplash.com" rel="noopener">Unsplash</a>, and partner catalogs where noted.${extraLinks || ""}</p>
      </div>
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

  if (cat === "neighborhood" || cat === "comparison" || cat === "guide") {
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
  footerExploreLinks,
  COPYRIGHT_LINE,
  breadcrumbsFor,
  applySeoMeta,
};
