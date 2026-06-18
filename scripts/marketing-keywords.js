/**
 * Per-page SEO copy: titles, descriptions, H1/H2 overrides.
 * Title values are WITHOUT the "| TravelByVibe" suffix (added by applySeoMeta).
 */
const SEO_META = {
  destinations: {
    title: "Paris & Mexico City Hotel Guides — Search by Room Photos",
    desc: "Hotel guides for Paris and Mexico City (CDMX): where to stay, neighborhood comparisons, and visual room search using real bathroom and suite photos. Free on TravelByVibe.",
  },
  "where-to-stay-in-paris": {
    title: "Where to Stay in Paris — Hotels by Neighborhood (2026)",
    h1: "Where to Stay in Paris — Hotels by Neighborhood",
    desc: "Where to stay in Paris: compare Le Marais, Saint-Germain, Montmartre, Latin Quarter, and Opéra. Match hotels by neighborhood vibe and real room photos.",
    h2Featured: "Best Paris neighborhoods for hotels",
    h2Hotels: "Best Paris hotels by neighborhood",
  },
  "paris-hotels": {
    title: "Paris Hotels — Search by Real Room Photos",
    desc: "Find Paris hotels by vibe and actual room photography — Haussmann light, rainfall shower, Left Bank mood. Browse free before you book.",
  },
  "paris-neighborhood-stays": {
    title: "Paris Hotels by Neighborhood — Where to Stay",
    h1: "Paris Hotels by Neighborhood",
    desc: "Pick a Paris arrondissement that fits your trip — Marais, Saint-Germain, Montmartre, Latin Quarter, or Opéra — then find hotels with real room photos.",
  },
  "paris-neighborhood-guide": {
    title: "Paris Neighborhood Guide — Hotels & Where to Stay",
    h1: "Paris Neighborhood Guide — Hotels by Area",
    desc: "Paris neighborhood guide: Le Marais, Saint-Germain, Montmartre, Latin Quarter, and Opéra — hotel picks and vibe search.",
    h2Hotels: "Best Paris hotels by neighborhood",
  },
  "paris-hotel-finder": {
    title: "Paris Hotel Finder — Where to Stay by Vibe",
    desc: "Where should you stay in Paris? Compare Marais, Saint-Germain, Montmartre, and more — then search hotels with real room photos.",
  },
  "paris-visual-search": {
    title: "Paris Hotels — Search by Rainfall Shower & Room Photos",
    h1: "Search Paris Hotels by Room & Bathroom Photos",
    desc: "Search Paris hotels by describing your ideal room — rainfall shower, Haussmann light, soaking tub, Eiffel view — matched to real hotel photography.",
    h2Featured: "Paris hotel rooms that match your description",
  },
  "paris-boutique-hotels": {
    title: "Best Boutique Hotels in Paris",
    h2Intro: "Best boutique hotels in Paris by neighborhood",
    h2Featured: "Boutique hotel picks in Le Marais, Saint-Germain & Montmartre",
  },
  "paris-luxury-hotels": {
    title: "Best Luxury Hotels in Paris",
    h2Intro: "Best luxury hotels in Paris — Opéra, Saint-Germain & Champs",
    h2Featured: "Luxury Paris hotels to start with",
  },
  "paris-romantic-hotels": {
    title: "Best Romantic Hotels in Paris with Soaking Tub",
    h1: "Best Romantic Hotels in Paris",
    desc: "Romantic Paris hotels with soaking tubs, moody lighting, and Montmartre views — search real room photos before you book.",
    h2Intro: "Best romantic hotels in Paris for couples",
    h2Featured: "Romantic Paris hotel picks",
  },
  "paris-classic-hotels": {
    title: "Best Haussmann & Classic Hotels in Paris",
    h1: "Best Classic & Haussmann Hotels in Paris",
    desc: "Haussmann apartment-style hotels in Paris — tall windows, mouldings, pale Paris light. Search real room photography on TravelByVibe.",
    h2Intro: "Best Haussmann and classic Paris hotels",
    h2Featured: "Classic Paris hotel stays",
  },
  "hotels-in-le-marais": {
    title: "Best Hotels in Le Marais Paris",
    desc: "Best hotels in Le Marais, Paris — walkable, gallery-dense picks for first-time visitors. See real room and bathroom photos before you book.",
    h2Featured: "Best hotels in Le Marais Paris",
    heroAlt: "Le Marais Paris hotel neighborhood, Musée Picasso garden",
  },
  "hotels-in-saint-germain": {
    title: "Best Hotels in Saint-Germain Paris (Left Bank)",
    desc: "Best hotels in Saint-Germain-des-Prés, Paris — Left Bank cafés, bookshops, and museum mornings. Real room photos on TravelByVibe.",
    h2Featured: "Best hotels in Saint-Germain Paris",
    heroAlt: "Saint-Germain-des-Prés Paris Left Bank neighborhood",
  },
  "hotels-in-montmartre": {
    title: "Best Hotels in Montmartre Paris",
    desc: "Best hotels in Montmartre, Paris — village stairs, Sacré-Cœur views, and romantic room moods. Browse real suite photos.",
    h2Featured: "Best hotels in Montmartre Paris",
    heroAlt: "Montmartre Paris hillside neighborhood at dusk",
  },
  "hotels-in-latin-quarter": {
    title: "Best Hotels in the Latin Quarter Paris",
    desc: "Best hotels in the Latin Quarter, Paris — river walks, bistros, and Notre-Dame access. Search real room photos by vibe.",
    h2Featured: "Best hotels in the Latin Quarter Paris",
    heroAlt: "Latin Quarter Paris market street, Rue Mouffetard",
  },
  "hotels-in-opera": {
    title: "Best Hotels near Opéra & Champs-Élysées Paris",
    desc: "Best hotels near Opéra and the Champs-Élysées, Paris — palace hotels and grand boulevards. See real luxury suite photos.",
    h2Featured: "Best hotels near Opéra Paris",
    heroAlt: "Opéra district and Champs-Élysées area, Paris",
  },
  "marais-vs-saint-germain": {
    title: "Le Marais vs Saint-Germain: Where to Stay in Paris",
    desc: "Le Marais vs Saint-Germain — compare atmosphere, walkability, and hotels. Then search Paris rooms by real photos.",
  },
  "montmartre-vs-marais": {
    title: "Montmartre vs Le Marais: Where to Stay in Paris",
    desc: "Montmartre vs Le Marais — village hills or central cobblestones? Compare neighborhoods, then find Paris hotels by vibe.",
  },
  "latin-quarter-vs-saint-germain": {
    title: "Latin Quarter vs Saint-Germain: Where to Stay in Paris",
    desc: "Latin Quarter vs Saint-Germain on the Left Bank — lively markets or literary calm? Compare, then search hotel room photos.",
  },
  "where-to-stay-in-mexico-city": {
    title: "Where to Stay in Mexico City — Hotels by Neighborhood",
    h1: "Where to Stay in Mexico City — Hotels by Neighborhood",
    desc: "Where to stay in Mexico City (CDMX): Condesa, Roma Norte, Polanco, Juárez, and Centro Histórico — find hotels by vibe and real room photos.",
    h2Featured: "Best CDMX neighborhoods for hotels",
    h2Hotels: "Best Mexico City hotels by neighborhood",
  },
  "mexico-city-hotels": {
    title: "Best Hotels in Mexico City — Search by Real Room Photos",
    h1: "Best Hotels in Mexico City",
    desc: "Best hotels in Mexico City (CDMX): browse 3,600+ properties by neighborhood vibe and real room photos — rainfall shower, bright suite, design mood — free on TravelByVibe.",
    h2Travel: "Best hotels in Mexico City by neighborhood",
  },
  "travel-mexico-city-hotels": {
    title: "Travel Mexico City Hotels — Plan Your Stay by Vibe",
    h1: "Travel Mexico City Hotels",
    desc: "Travel Mexico City hotels the smart way — pick Condesa, Roma Norte, Polanco, or Centro, run the vibe quiz, then search 3,600+ properties by real room photos before you book.",
    breadcrumbLabel: "Travel Mexico City hotels",
    h2Featured: "How to plan travel to Mexico City hotels",
    h2Hotels: "Best Mexico City hotels for travellers",
    h2Neighborhoods: "Travel Mexico City hotels by neighborhood",
  },
  "mexico-city-neighborhood-guide": {
    title: "Mexico City Neighborhood Guide — Hotels & Where to Stay",
    h1: "Mexico City Neighborhood Guide — Hotels by Area",
    desc: "Mexico City neighborhood guide: Condesa, Roma Norte, Polanco, Juárez, and Centro — hotel picks and visual search.",
    h2Hotels: "Best Mexico City hotels by neighborhood",
  },
  "mexico-city-hotel-finder": {
    title: "Mexico City Hotel Finder — Where to Stay in CDMX",
    desc: "Where should you stay in Mexico City? Compare Condesa, Roma, Polanco, Juárez, and Centro — search hotels with real room photos.",
  },
  "mexico-city-visual-search": {
    title: "CDMX Hotels — Search by Rainfall Shower & Room Photos",
    h1: "Search Mexico City Hotels by Room & Bathroom Photos",
    desc: "Search Mexico City hotels by room description — rainfall shower, soaking tub, bright Roma suite — matched to real CDMX hotel photography.",
    h2Featured: "Mexico City hotel rooms that match your search",
  },
  "mexico-city-boutique-hotels": {
    title: "Best Boutique Hotels in Mexico City",
    h2Intro: "Best boutique hotels in Mexico City by neighborhood",
    h2Featured: "Boutique hotel picks in Condesa, Roma Norte & Polanco",
  },
  "mexico-city-cafe-vibe-hotels": {
    title: "Best Café Culture Hotels in Mexico City (Condesa & Roma)",
    h1: "Best Café Culture Hotels in Mexico City",
    desc: "Hotels near CDMX's best café culture — Condesa and Roma Norte terrace mornings, third-wave espresso, and walkable park blocks.",
    h2Intro: "Best café-culture hotels in Condesa and Roma Norte",
    h2Featured: "CDMX hotels near great cafés",
  },
  "mexico-city-local-neighborhood-hotels": {
    title: "Best Neighborhood Hotels in Mexico City",
    h1: "Best Neighborhood Hotels in Mexico City",
    desc: "Local-feeling Mexico City hotels in Condesa, Roma Norte, and Juárez — residential rhythm, mercados, and corner cantinas.",
    h2Intro: "Best local neighborhood hotels in CDMX",
    h2Featured: "Neighborhood-led hotel picks",
  },
  "mexico-city-design-hotels": {
    title: "Best Design Hotels in Mexico City",
    h2Intro: "Best design hotels in Mexico City",
    h2Featured: "Design-forward CDMX hotel stays",
  },
  "hotels-in-condesa": {
    title: "Best Hotels in Condesa Mexico City",
    desc: "Best hotels in Condesa, CDMX — leafy, walkable, café-dense picks for first-time visitors. Real room photos before you book.",
    h2Featured: "Best hotels in Condesa Mexico City",
    heroAlt: "Condesa Mexico City leafy neighborhood park",
  },
  "hotels-in-roma-norte": {
    title: "Best Hotels in Roma Norte Mexico City",
    desc: "Best hotels in Roma Norte, CDMX — trendy food scene, design hotels, and nightlife. Search real room photos.",
    h2Featured: "Best hotels in Roma Norte Mexico City",
    heroAlt: "Roma Norte Mexico City art deco streets",
  },
  "hotels-in-polanco": {
    title: "Best Hotels in Polanco Mexico City",
    desc: "Best hotels in Polanco, CDMX — luxury shopping, museums, and Chapultepec access. Browse real suite photography.",
    h2Featured: "Best hotels in Polanco Mexico City",
    heroAlt: "Polanco Mexico City museum district skyline",
  },
  "hotels-in-juarez": {
    title: "Best Hotels in Juárez Mexico City",
    desc: "Best hotels in Juárez, CDMX — central, Reforma-connected, and strong value between Roma and Polanco.",
    h2Featured: "Best hotels in Juárez Mexico City",
    heroAlt: "Juárez Mexico City central neighborhood near Reforma",
  },
  "hotels-in-centro-historico": {
    title: "Best Hotels in Centro Histórico Mexico City",
    desc: "Best hotels in Centro Histórico, CDMX — Zócalo, Templo Mayor, and cantina culture outside your door.",
    h2Featured: "Best hotels in Centro Histórico Mexico City",
    heroAlt: "Centro Histórico Mexico City Zócalo area",
  },
  "condesa-vs-polanco": {
    title: "Condesa vs Polanco: Where to Stay in Mexico City",
    desc: "Condesa vs Polanco — leafy calm or luxury polish? Compare CDMX neighborhoods, then search hotels by room photos.",
  },
  "roma-norte-vs-condesa": {
    title: "Roma Norte vs Condesa: Where to Stay in CDMX",
    desc: "Roma Norte vs Condesa — trendy energy or park-side calm? Compare Mexico City neighborhoods and hotel vibes.",
  },
  "juarez-vs-condesa": {
    title: "Juárez vs Condesa: Where to Stay in Mexico City",
    desc: "Juárez vs Condesa — central Reforma access or leafy residential calm? Compare CDMX hotel neighborhoods.",
  },
  // ── New spoke pages (tier-3 query targets) ─────────────────────────────────
  "best-area-to-stay-in-paris-first-time": {
    title: "Best Area to Stay in Paris for First-Time Visitors — Hotels",
    h1: "Best Area to Stay in Paris for First-Time Visitors",
    desc: "First trip to Paris? Compare Le Marais, Latin Quarter, and Saint-Germain for walkable museums, cafés, and hotels — then see real room photos.",
    breadcrumbLabel: "Best area for first-time visitors",
    h2Featured: "Best Paris neighborhoods for first-time visitors",
    h2Hotels: "Best Paris hotels for first-time visitors",
  },
  "paris-hotels-near-eiffel-tower": {
    title: "Paris Hotels Near the Eiffel Tower — See Real Rooms",
    h1: "Paris Hotels Near the Eiffel Tower",
    desc: "Hotels near the Eiffel Tower in Paris — Latin Quarter, Opéra, and Trocadéro-side stays. Search Eiffel view rooms with real photos.",
    breadcrumbLabel: "Hotels near Eiffel Tower",
    h2Featured: "Best areas for Eiffel Tower views",
  },
  "safe-neighborhoods-mexico-city": {
    title: "Safe Neighborhoods in Mexico City — Hotels for Tourists",
    h1: "Safe Neighborhoods in Mexico City for Tourists",
    desc: "Where to stay in CDMX: Condesa, Polanco, Roma Norte, and Juárez are popular visitor districts. Compare areas, then match hotels by real room photos.",
    breadcrumbLabel: "Safe neighborhoods for tourists",
    h2Featured: "Best CDMX neighborhoods for visitors",
    h2Hotels: "Best hotels in safe CDMX neighborhoods",
  },
  "hotels-near-chapultepec": {
    title: "Best Hotels near Chapultepec Mexico City",
    h1: "Best Hotels near Chapultepec Park",
    desc: "Hotels near Chapultepec in Mexico City — Polanco, Juárez, and Condesa picks for museum mornings and park runs. Real room photos.",
    breadcrumbLabel: "Hotels near Chapultepec",
    h2Featured: "Best hotels near Chapultepec Park",
  },
  "best-area-to-stay-in-mexico-city-first-time": {
    title: "Best Area to Stay in Mexico City for First-Time Visitors — Hotels",
    h1: "Best Area to Stay in Mexico City for First-Time Visitors",
    desc: "First trip to Mexico City? Compare Condesa, Roma Norte, and Polanco for walkable cafés, parks, and hotels — then see real room photos.",
    breadcrumbLabel: "Best area for first-time visitors",
    h2Featured: "Best Mexico City neighborhoods for first-time visitors",
    h2Hotels: "Best Mexico City hotels for first-time visitors",
  },
};

const BRAND_SUFFIX = " | TravelByVibe";

function applySeoMeta(meta) {
  const kw = SEO_META[meta.canonical];
  const out = { ...meta };
  if (!kw) {
    if (out.title && !out.title.includes("TravelByVibe")) out.title += BRAND_SUFFIX;
    return out;
  }
  if (kw.title) out.title = kw.title + BRAND_SUFFIX;
  if (kw.desc) out.desc = kw.desc;
  if (kw.h1) out.h1 = kw.h1;
  if (kw.lead) out.lead = kw.lead;
  if (kw.breadcrumbLabel) out.breadcrumbLabel = kw.breadcrumbLabel;
  if (kw.h2Intro) out.h2Intro = kw.h2Intro;
  if (kw.h2Featured) out.h2Featured = kw.h2Featured;
  if (kw.h2Hotels) out.h2Hotels = kw.h2Hotels;
  if (kw.h2Travel) out.h2Travel = kw.h2Travel;
  if (kw.h2Neighborhoods) out.h2Neighborhoods = kw.h2Neighborhoods;
  if (kw.heroAlt) out.heroAlt = kw.heroAlt;
  return out;
}

function seoField(canonical, field, fallback) {
  const kw = SEO_META[canonical];
  return (kw && kw[field]) || fallback;
}

module.exports = { SEO_META, applySeoMeta, seoField, BRAND_SUFFIX };
