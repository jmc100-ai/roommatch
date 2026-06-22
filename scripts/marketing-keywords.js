const { searchableLabel } = require("./marketing-city-stats");

const PARIS_COUNT = searchableLabel("Paris");
const CDMX_COUNT = searchableLabel("Mexico City");
const LONDON_COUNT = searchableLabel("London");

/**
 * Per-page SEO copy: titles, descriptions, H1/H2 overrides.
 * Title values are WITHOUT the "| TravelByVibe" suffix (added by applySeoMeta).
 */
const SEO_META = {
  destinations: {
    title: "Paris, Mexico City & London Hotel Guides — Search by Room Photos",
    desc: "Hotel guides for Paris, Mexico City (CDMX), and London: where to stay, neighborhood comparisons, and visual room search using real bathroom and suite photos. Free on TravelByVibe.",
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
    h1: "Best Hotels in Paris",
    desc: `Best hotels in Paris: browse ${PARIS_COUNT} properties with real room photos — plus where to stay in Paris by neighborhood (Marais, Saint-Germain, Montmartre). Free on TravelByVibe.`,
    h2Travel: "Best Paris hotels by neighborhood",
  },
  "travel-paris-hotels": {
    title: "Travel Paris Hotels — Plan Your Stay by Vibe",
    h1: "Travel Paris Hotels",
    desc: `Travel Paris hotels the smart way — pick Le Marais, Saint-Germain, or Montmartre, run the vibe quiz, then search ${PARIS_COUNT} Paris hotels by real room photos before you book.`,
    breadcrumbLabel: "Travel Paris hotels",
    h2Featured: "How to plan travel to Paris hotels",
    h2Hotels: "Best Paris hotels for travellers",
    h2Neighborhoods: "Travel Paris hotels by neighborhood",
  },
  "safe-neighborhoods-paris": {
    title: "Best Areas to Stay in Paris for Tourists — Hotels by Neighborhood",
    h1: "Best Areas to Stay in Paris for Tourists",
    desc: "Where to stay in Paris: Le Marais, Latin Quarter, Saint-Germain, and Montmartre are popular visitor districts. Compare areas, then match hotels by real room photos.",
    breadcrumbLabel: "Best areas for tourists",
    h2Featured: "Best Paris neighborhoods for visitors",
    h2Hotels: "Best hotels in visitor-friendly Paris neighborhoods",
  },
  "paris-walkable-hotels": {
    title: "Best Walkable Hotels in Paris — Le Marais, Latin Quarter & Left Bank",
    h1: "Best Walkable Hotels in Paris",
    desc: "Walkable Paris hotels in Le Marais, Latin Quarter, and Saint-Germain — flat, central districts where museums and bistros are on foot. Search real room photos.",
    h2Intro: "Best walkable Paris hotel neighborhoods",
    h2Featured: "Walkable Paris hotel picks",
  },
  "paris-cafe-vibe-hotels": {
    title: "Best Café Culture Hotels in Paris (Saint-Germain & Le Marais)",
    h1: "Best Café Culture Hotels in Paris",
    desc: "Hotels near Paris café culture — Saint-Germain wine bars, Le Marais terrace mornings, and Left Bank literary calm. Search real room photos by vibe.",
    h2Intro: "Best café-culture hotels in Paris",
    h2Featured: "Paris hotels near great cafés",
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
    desc: "Best boutique hotels in Paris — restored mansions and design-forward small hotels in Le Marais, Saint-Germain, and Montmartre. Search real room photos on TravelByVibe.",
    h2Intro: "Best boutique hotels in Paris by neighborhood",
    h2Featured: "Boutique hotel picks in Le Marais, Saint-Germain & Montmartre",
  },
  "paris-luxury-hotels": {
    title: "Best Luxury Hotels in Paris",
    desc: "Best luxury hotels in Paris — Opéra palace hotels, Left Bank flagships, and suites with real marble baths. Browse indexed room photography before you book.",
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
    desc: `Best hotels in Mexico City (CDMX): browse ${CDMX_COUNT} properties with real room photos — plus where to stay in Mexico City by neighborhood (Condesa, Roma, Polanco). Free on TravelByVibe.`,
    h2Travel: "Best hotels in Mexico City by neighborhood",
  },
  "travel-mexico-city-hotels": {
    title: "Travel Mexico City Hotels — Plan Your Stay by Vibe",
    h1: "Travel Mexico City Hotels",
    desc: `Travel Mexico City hotels the smart way — pick Condesa, Roma Norte, Polanco, or Centro, run the vibe quiz, then search ${CDMX_COUNT} properties by real room photos before you book.`,
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
    desc: "Best boutique hotels in Mexico City — restored mansions and design stays in Condesa, Roma Norte, and Polanco. Search real room photos on TravelByVibe.",
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
    desc: "Best design hotels in Mexico City — mid-century restoration, contemporary glass, and art-filled lobbies in Polanco and Condesa. Search by real room photos.",
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
  // ── London hub pages ───────────────────────────────────────────────────────
  "where-to-stay-in-london": {
    title: "Where to Stay in London — Hotels by Neighborhood (2026)",
    h1: "Where to Stay in London — Hotels by Neighborhood",
    desc: "Where to stay in London: compare Westminster, Covent Garden, South Kensington, Marylebone, and Shoreditch. Match hotels by neighborhood vibe and real room photos.",
    h2Featured: "Best London neighborhoods for hotels",
    h2Hotels: "Best London hotels by neighborhood",
  },
  "london-hotels": {
    title: "London Hotels — Search by Real Room Photos",
    h1: "Best Hotels in London",
    desc: `Best hotels in London: browse ${LONDON_COUNT} properties with real room photos — plus where to stay in London by neighborhood (Westminster, Covent Garden, Marylebone). Free on TravelByVibe.`,
    h2Travel: "Best London hotels by neighborhood",
  },
  "travel-london-hotels": {
    title: "Travel London Hotels — Plan Your Stay by Vibe",
    h1: "Travel London Hotels",
    desc: `Travel London hotels the smart way — pick Westminster, Covent Garden, or South Kensington, run the vibe quiz, then search ${LONDON_COUNT} London hotels by real room photos before you book.`,
    breadcrumbLabel: "Travel London hotels",
    h2Featured: "How to plan travel to London hotels",
    h2Hotels: "Best London hotels for travellers",
    h2Neighborhoods: "Travel London hotels by neighborhood",
  },
  "safe-neighborhoods-london": {
    title: "Best Areas to Stay in London for Tourists — Hotels by Neighborhood",
    h1: "Best Areas to Stay in London for Tourists",
    desc: "Where to stay in London: Westminster, Covent Garden, South Kensington, and Marylebone are popular visitor districts. Compare areas, then match hotels by real room photos.",
    breadcrumbLabel: "Best areas for tourists",
    h2Featured: "Best London neighborhoods for visitors",
    h2Hotels: "Best hotels in visitor-friendly London neighborhoods",
  },
  "london-walkable-hotels": {
    title: "Best Walkable Hotels in London — Westminster, Covent Garden & South Bank",
    h1: "Best Walkable Hotels in London",
    desc: "Walkable London hotels in Westminster, Covent Garden, and South Kensington — central districts where museums and pubs are on foot. Search real room photos.",
    h2Intro: "Best walkable London hotel neighborhoods",
    h2Featured: "Walkable London hotel picks",
  },
  "london-cafe-vibe-hotels": {
    title: "Best Café Culture Hotels in London (Marylebone & Notting Hill)",
    h1: "Best Café Culture Hotels in London",
    desc: "Hotels near London café culture — Marylebone High Street mornings, Notting Hill market weekends, and Soho wine bars. Search real room photos by vibe.",
    h2Intro: "Best café-culture hotels in London",
    h2Featured: "London hotels near great cafés",
  },
  "london-neighborhood-stays": {
    title: "London Hotels by Neighborhood — Where to Stay",
    h1: "London Hotels by Neighborhood",
    desc: "Pick a London district that fits your trip — Westminster, Covent Garden, South Kensington, Shoreditch, or Notting Hill — then find hotels with real room photos.",
  },
  "london-neighborhood-guide": {
    title: "London Neighborhood Guide — Hotels & Where to Stay",
    h1: "London Neighborhood Guide — Hotels by Area",
    desc: "London neighborhood guide: Westminster, Covent Garden, South Kensington, Marylebone, Shoreditch, and Notting Hill — hotel picks and vibe search.",
    h2Hotels: "Best London hotels by neighborhood",
  },
  "london-hotel-finder": {
    title: "London Hotel Finder — Where to Stay by Vibe",
    desc: "Where should you stay in London? Compare Westminster, Covent Garden, South Kensington, and more — then search hotels with real room photos.",
  },
  "london-visual-search": {
    title: "London Hotels — Search by Rainfall Shower & Room Photos",
    h1: "Search London Hotels by Room & Bathroom Photos",
    desc: "Search London hotels by describing your ideal room — rainfall shower, Victorian windows, Thames view — matched to real hotel photography.",
    h2Featured: "London hotel rooms that match your description",
  },
  "london-boutique-hotels": {
    title: "Best Boutique Hotels in London",
    desc: "Best boutique hotels in London — Georgian townhouses and design-forward small hotels in Marylebone, Covent Garden, and Notting Hill. Search real room photos on TravelByVibe.",
    h2Intro: "Best boutique hotels in London by neighborhood",
    h2Featured: "Boutique hotel picks in Westminster, Covent Garden & Marylebone",
  },
  "london-luxury-hotels": {
    title: "Best Luxury Hotels in London",
    desc: "Best luxury hotels in London — Mayfair flagships, South Kensington classics, and suites with real marble baths. Browse indexed room photography before you book.",
    h2Intro: "Best luxury hotels in London — Westminster, Marylebone & South Kensington",
    h2Featured: "Luxury London hotels to start with",
  },
  "london-romantic-hotels": {
    title: "Best Romantic Hotels in London with Soaking Tub",
    h1: "Best Romantic Hotels in London",
    desc: "Romantic London hotels with soaking tubs, moody lighting, and Notting Hill views — search real room photos before you book.",
    h2Intro: "Best romantic hotels in London for couples",
    h2Featured: "Romantic London hotel picks",
  },
  "london-classic-hotels": {
    title: "Best Victorian & Classic Hotels in London",
    h1: "Best Classic & Victorian Hotels in London",
    desc: "Victorian townhouse hotels in London — tall windows, mouldings, and pale morning light. Search real room photography on TravelByVibe.",
    h2Intro: "Best Victorian and classic London hotels",
    h2Featured: "Classic London hotel stays",
  },
  "hotels-in-westminster": {
    title: "Best Hotels in Westminster London",
    desc: "Best hotels in Westminster, London — Big Ben, Westminster Abbey, and St James's Park on your doorstep. See real room and bathroom photos before you book.",
    h2Featured: "Best hotels in Westminster London",
    heroAlt: "Westminster London Big Ben and Parliament",
  },
  "hotels-in-covent-garden": {
    title: "Best Hotels in Covent Garden London",
    desc: "Best hotels in Covent Garden, London — West End theatre, street performers, and buzzy pedestrian streets. Real room photos on TravelByVibe.",
    h2Featured: "Best hotels in Covent Garden London",
    heroAlt: "Covent Garden London market and theatre district",
  },
  "hotels-in-south-kensington": {
    title: "Best Hotels in South Kensington London",
    desc: "Best hotels in South Kensington, London — V&A, Natural History Museum, and refined Victorian streets near Hyde Park.",
    h2Featured: "Best hotels in South Kensington London",
    heroAlt: "South Kensington London museum quarter",
  },
  "hotels-in-marylebone": {
    title: "Best Hotels in Marylebone London",
    desc: "Best hotels in Marylebone, London — boutique charm on Marylebone High Street, leafy squares, minutes from Oxford Street.",
    h2Featured: "Best hotels in Marylebone London",
    heroAlt: "Marylebone High Street London",
  },
  "hotels-in-shoreditch": {
    title: "Best Hotels in Shoreditch London",
    desc: "Best hotels in Shoreditch, London — street art, rooftop bars, and East London warehouse conversions. Browse real suite photos.",
    h2Featured: "Best hotels in Shoreditch London",
    heroAlt: "Shoreditch London street art district",
  },
  "hotels-in-notting-hill": {
    title: "Best Hotels in Notting Hill London",
    desc: "Best hotels in Notting Hill, London — Portobello Road, pastel townhouses, and village feel in west London.",
    h2Featured: "Best hotels in Notting Hill London",
    heroAlt: "Notting Hill London Portobello Road",
  },
  "westminster-vs-covent-garden": {
    title: "Westminster vs Covent Garden: Where to Stay in London",
    desc: "Westminster vs Covent Garden — royal icons or West End buzz? Compare London neighborhoods, then find hotels by real photos.",
  },
  "south-kensington-vs-marylebone": {
    title: "South Kensington vs Marylebone: Where to Stay in London",
    desc: "South Kensington vs Marylebone — museum mornings or village boutiques? Compare London neighborhoods and hotel vibes.",
  },
  "shoreditch-vs-westminster": {
    title: "Shoreditch vs Westminster: Where to Stay in London",
    desc: "Shoreditch vs Westminster — East London edge or postcard icons? Compare London hotel neighborhoods.",
  },
  "best-area-to-stay-in-london-first-time": {
    title: "Best Area to Stay in London for First-Time Visitors — Hotels",
    h1: "Best Area to Stay in London for First-Time Visitors",
    desc: "First trip to London? Compare Westminster, Covent Garden, and South Kensington for walkable museums, pubs, and hotels — then see real room photos.",
    breadcrumbLabel: "Best area for first-time visitors",
    h2Featured: "Best London neighborhoods for first-time visitors",
    h2Hotels: "Best London hotels for first-time visitors",
  },
  "london-hotels-near-big-ben": {
    title: "London Hotels Near Big Ben — See Real Rooms",
    h1: "London Hotels Near Big Ben & Westminster",
    desc: "Hotels near Big Ben and Westminster Abbey in London — river walks, royal London, and indexed room photos you can verify before booking.",
    breadcrumbLabel: "Hotels near Big Ben",
    h2Featured: "Best areas near Westminster and Big Ben",
  },
  "london-hotels-with-rainfall-shower": {
    title: "Best London Hotels with Rainfall Shower",
    h1: "Best London Hotels with Rainfall Shower",
    desc: "Search London hotels whose indexed bathroom photos show rainfall showers — boutique and luxury picks across Westminster, Marylebone, and South Kensington.",
    h2Featured: "London hotels with rainfall shower bathrooms",
  },
  "london-hotels-with-balcony": {
    title: "Best London Hotels with a Balcony",
    h1: "Best London Hotels with a Balcony",
    desc: "Terrace mornings and Thames glimpses — London hotels with balcony room photos you can verify before you book.",
    h2Featured: "London hotels with balcony rooms",
  },
  "london-hotels-for-couples": {
    title: "Best Romantic Hotels in London for Couples",
    h1: "Best London Hotels for Couples",
    desc: "Romantic London hotels with soaking tubs, moody suites, and Notting Hill views — matched to real room photography.",
    h2Featured: "Romantic London hotel picks for couples",
  },
  "london-quiet-hotels": {
    title: "Best Quiet Hotels in London",
    h1: "Best Quiet Hotels in London",
    desc: "Marylebone calm, South Kensington hush, and cozy room moods — for travellers who want rest after busy London days.",
    h2Featured: "Quiet London hotel neighborhoods",
  },
  "london-design-hotels": {
    title: "Best Design Hotels in London",
    h1: "Best Design Hotels in London",
    desc: "Sleek Shoreditch conversions, polished Marylebone boutiques, and design-forward rooms — ranked by real photos, not lobby renders.",
    h2Featured: "Design-forward London hotel picks",
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
