/**
 * Single source of truth for indexable marketing routes (paths, files, titles).
 * Used by build-sitemap.js, build-html-sitemap (via build-sitemap), and server.js.
 */
const fs = require("fs");
const path = require("path");

const GENERATED_ROUTES_PATH = path.join(__dirname, "marketing-routes-generated.json");

function loadGeneratedRoutes() {
  try {
    return JSON.parse(fs.readFileSync(GENERATED_ROUTES_PATH, "utf8"));
  } catch {
    return { routes: [], staysRoutes: [], slugByHotelId: {} };
  }
}

const GENERATED = loadGeneratedRoutes();

const MARKETING_ROUTES = [
  { path: "/destinations", file: "destinations.html", title: "Paris, Mexico City & London Hotel Guides — Search by Room Photos", city: null, category: "hub" },
  { path: "/sitemap", file: "sitemap.html", title: "Site Map — All Destination Guides", city: null, category: "hub" },
  { path: "/mexico-city-hotels", file: "mexico-city-hotels.html", title: "Best Hotels in Mexico City — Search by Real Room Photos", city: "Mexico City", category: "hub" },
  { path: "/hotels-in-mexico-city", file: "mexico-city-hotels.html", title: "Best Hotels in Mexico City", city: "Mexico City", category: "hub", alias: true },
  { path: "/travel-mexico-city-hotels", file: "travel-mexico-city-hotels.html", title: "Travel Mexico City Hotels — Plan Your Stay by Vibe", city: "Mexico City", category: "guide" },
  { path: "/where-to-stay-in-mexico-city", file: "where-to-stay-in-mexico-city.html", title: "Where to Stay in Mexico City — Hotels by Neighborhood", city: "Mexico City", category: "hub" },
  { path: "/mexico-city-neighborhood-guide", file: "mexico-city-neighborhood-guide.html", title: "Mexico City Neighborhood Guide — Hotels & Where to Stay", city: "Mexico City", category: "hub" },
  { path: "/mexico-city-hotel-finder", file: "mexico-city-hotel-finder.html", title: "Mexico City Hotel Finder", city: "Mexico City", category: "hub" },
  { path: "/cdmx-neighborhood-stays", file: "where-to-stay-in-mexico-city.html", title: "Where to Stay in Mexico City", city: "Mexico City", category: "hub", alias: true },
  { path: "/hotels-in-condesa", file: "hotels-in-condesa.html", title: "Hotels in Condesa, Mexico City", city: "Mexico City", category: "neighborhood" },
  { path: "/hotels-in-roma-norte", file: "hotels-in-roma-norte.html", title: "Hotels in Roma Norte, Mexico City", city: "Mexico City", category: "neighborhood" },
  { path: "/hotels-in-polanco", file: "hotels-in-polanco.html", title: "Hotels in Polanco, Mexico City", city: "Mexico City", category: "neighborhood" },
  { path: "/hotels-in-juarez", file: "hotels-in-juarez.html", title: "Hotels in Juárez, Mexico City", city: "Mexico City", category: "neighborhood" },
  { path: "/hotels-in-centro-historico", file: "hotels-in-centro-historico.html", title: "Hotels in Centro Histórico, Mexico City", city: "Mexico City", category: "neighborhood" },
  { path: "/condesa-vs-polanco", file: "condesa-vs-polanco.html", title: "Condesa vs Polanco", city: "Mexico City", category: "comparison" },
  { path: "/roma-norte-vs-condesa", file: "roma-norte-vs-condesa.html", title: "Roma Norte vs Condesa", city: "Mexico City", category: "comparison" },
  { path: "/juarez-vs-condesa", file: "juarez-vs-condesa.html", title: "Juárez vs Condesa", city: "Mexico City", category: "comparison" },
  { path: "/mexico-city-boutique-hotels", file: "mexico-city-boutique-hotels.html", title: "Boutique Hotels in Mexico City", city: "Mexico City", category: "vibe" },
  { path: "/mexico-city-cafe-vibe-hotels", file: "mexico-city-cafe-vibe-hotels.html", title: "Best Café Culture Hotels in Mexico City (Condesa & Roma)", city: "Mexico City", category: "vibe" },
  { path: "/mexico-city-local-neighborhood-hotels", file: "mexico-city-local-neighborhood-hotels.html", title: "Local Neighborhood Hotels in Mexico City", city: "Mexico City", category: "vibe" },
  { path: "/mexico-city-design-hotels", file: "mexico-city-design-hotels.html", title: "Design Hotels in Mexico City", city: "Mexico City", category: "vibe" },
  { path: "/mexico-city-visual-search", file: "mexico-city-visual-search.html", title: "CDMX Hotels — Search by Rainfall Shower & Room Photos", city: "Mexico City", category: "hub" },
  { path: "/paris-hotels", file: "paris-hotels.html", title: "Paris Hotels — Search by Real Room Photos", city: "Paris", category: "hub" },
  { path: "/where-to-stay-in-paris", file: "where-to-stay-in-paris.html", title: "Where to Stay in Paris — Hotels by Neighborhood", city: "Paris", category: "hub" },
  { path: "/paris-neighborhood-stays", file: "paris-neighborhood-stays.html", title: "Paris Hotels by Neighborhood — Where to Stay", city: "Paris", category: "hub" },
  { path: "/paris-neighborhood-guide", file: "paris-neighborhood-guide.html", title: "Paris Neighborhood Guide — Hotels & Where to Stay", city: "Paris", category: "hub" },
  { path: "/paris-hotel-finder", file: "paris-hotel-finder.html", title: "Paris Hotel Finder", city: "Paris", category: "hub" },
  { path: "/hotels-in-le-marais", file: "hotels-in-le-marais.html", title: "Hotels in Le Marais, Paris", city: "Paris", category: "neighborhood" },
  { path: "/hotels-in-saint-germain", file: "hotels-in-saint-germain.html", title: "Hotels in Saint-Germain, Paris", city: "Paris", category: "neighborhood" },
  { path: "/hotels-in-montmartre", file: "hotels-in-montmartre.html", title: "Hotels in Montmartre, Paris", city: "Paris", category: "neighborhood" },
  { path: "/hotels-in-latin-quarter", file: "hotels-in-latin-quarter.html", title: "Hotels in Latin Quarter, Paris", city: "Paris", category: "neighborhood" },
  { path: "/hotels-in-opera", file: "hotels-in-opera.html", title: "Hotels near Opéra, Paris", city: "Paris", category: "neighborhood" },
  { path: "/marais-vs-saint-germain", file: "marais-vs-saint-germain.html", title: "Le Marais vs Saint-Germain", city: "Paris", category: "comparison" },
  { path: "/montmartre-vs-marais", file: "montmartre-vs-marais.html", title: "Montmartre vs Le Marais", city: "Paris", category: "comparison" },
  { path: "/latin-quarter-vs-saint-germain", file: "latin-quarter-vs-saint-germain.html", title: "Latin Quarter vs Saint-Germain", city: "Paris", category: "comparison" },
  { path: "/paris-boutique-hotels", file: "paris-boutique-hotels.html", title: "Boutique Hotels in Paris", city: "Paris", category: "vibe" },
  { path: "/paris-luxury-hotels", file: "paris-luxury-hotels.html", title: "Luxury Hotels in Paris", city: "Paris", category: "vibe" },
  { path: "/paris-romantic-hotels", file: "paris-romantic-hotels.html", title: "Romantic Hotels in Paris", city: "Paris", category: "vibe" },
  { path: "/paris-classic-hotels", file: "paris-classic-hotels.html", title: "Classic & Haussmann Hotels in Paris", city: "Paris", category: "vibe" },
  { path: "/paris-visual-search", file: "paris-visual-search.html", title: "Paris Hotels — Search by Rainfall Shower & Room Photos", city: "Paris", category: "hub" },
  { path: "/best-area-to-stay-in-paris-first-time", file: "best-area-to-stay-in-paris-first-time.html", title: "Best Area to Stay in Paris for First-Time Visitors", city: "Paris", category: "guide" },
  { path: "/paris-hotels-near-eiffel-tower", file: "paris-hotels-near-eiffel-tower.html", title: "Paris Hotels Near the Eiffel Tower", city: "Paris", category: "guide" },
  { path: "/travel-paris-hotels", file: "travel-paris-hotels.html", title: "Travel Paris Hotels — Plan Your Stay by Vibe", city: "Paris", category: "guide" },
  { path: "/safe-neighborhoods-paris", file: "safe-neighborhoods-paris.html", title: "Best Areas to Stay in Paris for Tourists", city: "Paris", category: "guide" },
  { path: "/paris-walkable-hotels", file: "paris-walkable-hotels.html", title: "Best Walkable Hotels in Paris", city: "Paris", category: "guide" },
  { path: "/paris-cafe-vibe-hotels", file: "paris-cafe-vibe-hotels.html", title: "Best Café Culture Hotels in Paris", city: "Paris", category: "vibe" },
  { path: "/safe-neighborhoods-mexico-city", file: "safe-neighborhoods-mexico-city.html", title: "Safe Neighborhoods in Mexico City for Tourists", city: "Mexico City", category: "guide" },
  { path: "/hotels-near-chapultepec", file: "hotels-near-chapultepec.html", title: "Best Hotels near Chapultepec Mexico City", city: "Mexico City", category: "guide" },
  { path: "/best-area-to-stay-in-mexico-city-first-time", file: "best-area-to-stay-in-mexico-city-first-time.html", title: "Best Area to Stay in Mexico City for First-Time Visitors", city: "Mexico City", category: "guide" },
  { path: "/london-hotels", file: "london-hotels.html", title: "London Hotels — Search by Real Room Photos", city: "London", category: "hub" },
  { path: "/hotels-in-london", file: "london-hotels.html", title: "Best Hotels in London", city: "London", category: "hub", alias: true },
  { path: "/where-to-stay-in-london", file: "where-to-stay-in-london.html", title: "Where to Stay in London — Hotels by Neighborhood", city: "London", category: "hub" },
  { path: "/london-neighborhood-stays", file: "london-neighborhood-stays.html", title: "London Hotels by Neighborhood — Where to Stay", city: "London", category: "hub" },
  { path: "/london-neighborhood-guide", file: "london-neighborhood-guide.html", title: "London Neighborhood Guide — Hotels & Where to Stay", city: "London", category: "hub" },
  { path: "/london-hotel-finder", file: "london-hotel-finder.html", title: "London Hotel Finder", city: "London", category: "hub" },
  { path: "/london-visual-search", file: "london-visual-search.html", title: "London Hotels — Search by Rainfall Shower & Room Photos", city: "London", category: "hub" },
  { path: "/travel-london-hotels", file: "travel-london-hotels.html", title: "Travel London Hotels — Plan Your Stay by Vibe", city: "London", category: "guide" },
  { path: "/safe-neighborhoods-london", file: "safe-neighborhoods-london.html", title: "Best Areas to Stay in London for Tourists", city: "London", category: "guide" },
  { path: "/best-area-to-stay-in-london-first-time", file: "best-area-to-stay-in-london-first-time.html", title: "Best Area to Stay in London for First-Time Visitors", city: "London", category: "guide" },
  { path: "/london-hotels-near-big-ben", file: "london-hotels-near-big-ben.html", title: "London Hotels Near Big Ben & Westminster", city: "London", category: "guide" },
  { path: "/hotels-in-westminster", file: "hotels-in-westminster.html", title: "Hotels in Westminster, London", city: "London", category: "neighborhood" },
  { path: "/hotels-in-covent-garden", file: "hotels-in-covent-garden.html", title: "Hotels in Covent Garden, London", city: "London", category: "neighborhood" },
  { path: "/hotels-in-south-kensington", file: "hotels-in-south-kensington.html", title: "Hotels in South Kensington, London", city: "London", category: "neighborhood" },
  { path: "/hotels-in-marylebone", file: "hotels-in-marylebone.html", title: "Hotels in Marylebone, London", city: "London", category: "neighborhood" },
  { path: "/hotels-in-shoreditch", file: "hotels-in-shoreditch.html", title: "Hotels in Shoreditch, London", city: "London", category: "neighborhood" },
  { path: "/hotels-in-notting-hill", file: "hotels-in-notting-hill.html", title: "Hotels in Notting Hill, London", city: "London", category: "neighborhood" },
  { path: "/westminster-vs-covent-garden", file: "westminster-vs-covent-garden.html", title: "Westminster vs Covent Garden", city: "London", category: "comparison" },
  { path: "/south-kensington-vs-marylebone", file: "south-kensington-vs-marylebone.html", title: "South Kensington vs Marylebone", city: "London", category: "comparison" },
  { path: "/shoreditch-vs-westminster", file: "shoreditch-vs-westminster.html", title: "Shoreditch vs Westminster", city: "London", category: "comparison" },
  { path: "/london-boutique-hotels", file: "london-boutique-hotels.html", title: "Boutique Hotels in London", city: "London", category: "vibe" },
  { path: "/london-luxury-hotels", file: "london-luxury-hotels.html", title: "Luxury Hotels in London", city: "London", category: "vibe" },
  { path: "/london-romantic-hotels", file: "london-romantic-hotels.html", title: "Romantic Hotels in London", city: "London", category: "vibe" },
  { path: "/london-classic-hotels", file: "london-classic-hotels.html", title: "Classic & Victorian Hotels in London", city: "London", category: "vibe" },
  { path: "/london-walkable-hotels", file: "london-walkable-hotels.html", title: "Best Walkable Hotels in London", city: "London", category: "guide" },
  { path: "/london-cafe-vibe-hotels", file: "london-cafe-vibe-hotels.html", title: "Best Café Culture Hotels in London", city: "London", category: "vibe" },
  { path: "/london-hotels-with-rainfall-shower", file: "london-hotels-with-rainfall-shower.html", title: "Best London Hotels with Rainfall Shower", city: "London", category: "vibe" },
  { path: "/london-hotels-with-balcony", file: "london-hotels-with-balcony.html", title: "Best London Hotels with a Balcony", city: "London", category: "vibe" },
  { path: "/london-hotels-for-couples", file: "london-hotels-for-couples.html", title: "Best London Hotels for Couples", city: "London", category: "vibe" },
  { path: "/london-quiet-hotels", file: "london-quiet-hotels.html", title: "Best Quiet Hotels in London", city: "London", category: "vibe" },
  { path: "/london-design-hotels", file: "london-design-hotels.html", title: "Best Design Hotels in London", city: "London", category: "vibe" },
  { path: "/london-hotels-by-vibe", file: "london-hotels.html", title: "London Hotels by Vibe — Visual Search", city: "London", category: "hub", alias: true },
];

/** Hand-curated + generator output (vibe pages, neighborhoods, /stays/*). */
function allMarketingRoutes() {
  return [...MARKETING_ROUTES, ...(GENERATED.routes || []), ...(GENERATED.staysRoutes || [])];
}

/** Routes for XML sitemap (unique paths, no alias duplicates). */
function sitemapPaths() {
  const seen = new Set();
  return allMarketingRoutes().filter((r) => {
    if (r.alias || seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  }).map((r) => r.path);
}

function staysSitemapPaths(city) {
  return (GENERATED.staysRoutes || [])
    .filter((r) => !city || r.city === city)
    .map((r) => r.path);
}

/** Map path → HTML filename for Express routing. */
function marketingHtmlMap() {
  const map = {};
  for (const r of allMarketingRoutes()) {
    if (!map[r.path]) map[r.path] = r.file;
  }
  return map;
}

/** Map marketing HTML file (under client/marketing/) → canonical public path for static redirects. */
function marketingStaticRedirectMap() {
  const map = {};
  for (const r of allMarketingRoutes()) {
    if (r.alias || map[r.file]) continue;
    map[r.file] = r.path;
  }
  return map;
}

function staySlugForHotelId(hotelId) {
  return (GENERATED.slugByHotelId || {})[hotelId] || null;
}

module.exports = {
  MARKETING_ROUTES,
  GENERATED,
  allMarketingRoutes,
  sitemapPaths,
  staysSitemapPaths,
  marketingHtmlMap,
  marketingStaticRedirectMap,
  staySlugForHotelId,
  loadGeneratedRoutes,
};
