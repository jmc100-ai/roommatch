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
  { path: "/destinations", file: "destinations.html", title: "Paris & Mexico City Hotel Guides — Search by Room Photos", city: null, category: "hub" },
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
  { path: "/safe-neighborhoods-mexico-city", file: "safe-neighborhoods-mexico-city.html", title: "Safe Neighborhoods in Mexico City for Tourists", city: "Mexico City", category: "guide" },
  { path: "/hotels-near-chapultepec", file: "hotels-near-chapultepec.html", title: "Best Hotels near Chapultepec Mexico City", city: "Mexico City", category: "guide" },
  { path: "/best-area-to-stay-in-mexico-city-first-time", file: "best-area-to-stay-in-mexico-city-first-time.html", title: "Best Area to Stay in Mexico City for First-Time Visitors", city: "Mexico City", category: "guide" },
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
  staySlugForHotelId,
  loadGeneratedRoutes,
};
