/**
 * neighborhood-generator.js — shared module
 * Generates neighborhood cards (with Gemini) and Unsplash photos for any indexed city.
 * Imported by both server.js and index-city.js — no circular deps.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const {
  buildNeighborhoodVibeData,
  fetchOverpassPOIs,
  computeCityMaxCounts,
  bboxAreaKm2,
  ringAreaKm2,
  normalizePolygonRing,
  pointInPolygon,
  bboxFromRing,
  ringCentroid,
  maxRadiusFromCentroidM,
  placeInsideNeighborhoodFence,
  isPlaygroundLikePlaceName,
  isParkLikePlaceName,
} = require("./neighborhood-vibe-data");

// Canonical Gemini prompt for neighborhood generation
function buildNeighborhoodPrompt(city) {
  return `Act as a local travel expert with deep knowledge of hotel neighborhoods.

For ${city}, return the top 8–10 distinct areas where travelers typically stay.
Cover ALL of these zone types that exist in the city — do NOT omit any category that applies:
1. Iconic first-timer neighborhoods (historic centre, top cultural district)
2. Trendy / bohemian areas (café culture, art galleries, local dining)
3. Upscale / luxury residential areas
4. Major hotel & business corridors (grand boulevards, financial districts with 4-5 star hotels)
   — these are often NOT residential but ARE major hotel zones; include them (e.g. Paseo de la Reforma
   in Mexico City, Champs-Élysées in Paris, Mayfair in London, Midtown in NYC)
5. Authentic local neighborhoods for returning travelers
Do NOT bundle two distinct areas into one entry (e.g. "Reforma/Juárez" should be two separate entries).
If a grand boulevard or hotel strip is distinct from the colonia it runs through, list it separately.
Include a mix of areas for first-time visitors AND returning travelers who want to go deeper.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences, just the array.

Each item must follow this exact structure:
{
  "name": "Le Marais",
  "bbox": { "lat_min": 48.851, "lat_max": 48.866, "lon_min": 2.345, "lon_max": 2.365 },
  "polygon": { "ring": [
    { "lat": 48.851, "lng": 2.352 },
    { "lat": 48.854, "lng": 2.345 },
    { "lat": 48.860, "lng": 2.348 },
    { "lat": 48.866, "lng": 2.350 },
    { "lat": 48.865, "lng": 2.365 },
    { "lat": 48.858, "lng": 2.363 },
    { "lat": 48.853, "lng": 2.360 },
    { "lat": 48.851, "lng": 2.352 }
  ]},
  "vibe_short": "Historic, artsy, buzzing café scene",
  "vibe_long": "One of Paris's most atmospheric quarters, Le Marais blends medieval architecture with cutting-edge galleries and some of the city's best falafel. Ideal for first-timers who want to feel immersed in Parisian street life without venturing far from the Louvre.",
  "visitor_type": "first-timer",
  "tags": ["walkable", "historic", "artsy", "nightlife"],
  "walkability_dining": "excellent",
  "walkability_tourist_spots": "excellent",
  "green_spaces": "some",
  "skyline_character": "low-rise historic",
  "street_energy": "lively"
}

CRITICAL polygon rules — read carefully:
- polygon.ring MUST have at least 6 vertices (plus the repeated closing point = at least 7 points total). A 4-corner rectangle is NEVER acceptable.
- The ring traces the ACTUAL irregular shape of the neighbourhood following real streets, diagonal roads, rivers, rail lines, or park edges — NOT an axis-aligned box.
- Vertices are irregular and at different lat AND lng values — not snapped to a grid.
- The last point in the ring must repeat the first point (closed ring).
- bbox is the minimal axis-aligned box that tightly contains ALL polygon vertices.
- SIZE CONSTRAINT: each neighbourhood polygon must cover 1–12 km² (the area a hotel guest experiences on foot).
  Use the COLONIA / QUARTIER / NEIGHBOURHOOD boundary — NOT the administrative borough or arrondissement boundary.
  A bbox spanning more than ~0.05° in BOTH directions is almost certainly too large (maps an entire borough).
  Exception: linear hotel corridors (grand boulevards, riverfronts) may be elongated — up to ~0.06° long × ~0.02° wide.
  Example bad: Coyoacán alcaldía (0.06° × 0.11° = 65 km²). Example good: Colonia Coyoacán centre (0.027° × 0.030° = ~9 km²).
  Example corridor: Reforma hotel district, Mexico City (0.050° lon × 0.016° lat = ~8 km²) — elongated shape is correct for a boulevard zone.

Field rules:
- bbox: approximate decimal degree bounds (must tightly contain the polygon); lat_min/lat_max/lon_min/lon_max
- polygon.ring: 6–14 vertices (plus closing repeat) tracing the true irregular boundary of the neighbourhood.
  Vertices use "lat" and "lng" (WGS84). Follow real street boundaries, waterways, railway lines, or park edges.
- vibe_short: max 6 words, comma-separated — punchy and vivid (no more than 6 words total)
- vibe_long: exactly 2 sentences — first describes character, second says who it's ideal for
- visitor_type: "first-timer" | "returning" | "both"
- tags: 3-5 values from: walkable, nightlife, historic, artsy, family, luxury, local-feel,
  beachfront, business, quiet, green, romantic, foodie, shopping
- walkability_dining: "excellent" | "good" | "limited"
- walkability_tourist_spots: "excellent" | "good" | "limited"
- green_spaces: "lots" | "some" | "minimal"
  (Represents tree-lined street canopy and leafy walkability, NOT just park count.
   "lots" = neighbourhood famously defined by leafy streets, boulevard trees, jacarandas, canopied avenues.
   "some" = a mix of tree-lined and open streets. "minimal" = mostly open/concrete streets.)
- skyline_character: "low-rise historic" | "modern high-rise" | "mixed" | "tree-lined"
- street_energy: "lively" | "moderate" | "quiet"
- photo_queries: object — 2 specific Unsplash search strings per element key.
  Keys must be exactly: parks, restaurants, cafes, street_feel, icon_spots, museums, shops, greenery.
  Each value is an array of 2 strings. Use NAMED real places, streets, or landmarks — NOT
  generic category words. Be specific enough that a photographer would use this as a caption.
  Rules:
  * parks: a named park or garden (e.g. "Parque España Mexico City", "Luxembourg Gardens Paris")
  * restaurants: a well-known local restaurant name or distinctive food street
  * cafes: a well-known local cafe name or a distinctive cafe-lined street
  * street_feel: the most visually distinctive street or visual feature of the neighbourhood
    (e.g. "Roma Norte jacaranda tree lined street", "Montmartre cobblestone steps")
  * icon_spots: the defining landmark, tower, or square (e.g. "Torre Mayor Polanco skyline",
    "Sacré-Cœur Montmartre", "Eiffel Tower 7th arrondissement")
  * museums: a specific museum name (e.g. "Musée d'Orsay Paris", "Museo Frida Kahlo Coyoacan")
  * shops: a specific shopping street, market, or boutique area
  * greenery: the most photogenic tree-lined street, leafy boulevard, or canopied avenue
    (e.g. "Roma Norte jacaranda avenue", "Paseo de la Reforma tree-lined boulevard",
    "Champs-Elysées tree-lined Paris", "Avenue Montaigne Paris")
  Example for Roma Norte, Mexico City:
  "photo_queries": {
    "parks": ["Parque España Mexico City", "Parque Luis Cabrera Roma Norte"],
    "restaurants": ["Contramar restaurant Mexico City", "Roma Norte outdoor terrace dining"],
    "cafes": ["Panaderia Rosetta Mexico City", "independent cafe Roma Norte street"],
    "street_feel": ["Roma Norte jacaranda tree lined street", "Colonia Roma art deco boulevard"],
    "icon_spots": ["Fuente de la Cibeles Mexico City", "Roma Norte art nouveau facade"],
    "museums": ["Museo del Objeto del Objeto Mexico City", "Casa Lamm Roma Norte"],
    "shops": ["vintage shops Colonia Roma", "design boutique Roma Norte"],
    "greenery": ["Roma Norte jacaranda tree lined avenue", "Colonia Roma leafy boulevard"]
  }`;
}

async function callGemini(prompt, geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Visual keywords extracted from vibe_short — skip filler words, keep concrete nouns/adjectives
function vibeVisualTerms(vibeShort = "", maxWords = 3) {
  const stop = new Set(["with","and","the","for","its","feel","that","this","from","very","also","area","lots","some","many","has"]);
  return (vibeShort || "")
    .replace(/[,;]/g, " ")
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(w => w.length > 3 && !stop.has(w))
    .slice(0, maxWords)
    .join(" ");
}

// Map neighbourhood tags to concrete visual search terms Unsplash responds well to
const TAG_VISUAL = {
  walkable:   "pedestrian street promenade",
  artsy:      "street art mural gallery",
  historic:   "historic architecture buildings",
  green:      "urban park trees grass",
  foodie:     "restaurant terrace outdoor dining",
  nightlife:  "bar nightlife neon",
  shopping:   "boutique shops street",
  romantic:   "romantic cobblestone evening",
  luxury:     "luxury upscale elegant",
  quiet:      "quiet residential street",
  "local-feel": "local market street life",
  // Avoid "playground" — Unsplash skews to play structures, not leafy parks.
  family:     "family friendly walkable neighborhood",
  business:   "modern office district",
  beachfront: "beach waterfront seaside",
};

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_NEARBY_URL      = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_MEDIA_BASE      = "https://places.googleapis.com/v1";

// Types used for hero photo nearby search — prefer landmark/attraction photos
// over generic businesses so the hero actually shows the neighbourhood character.
const HERO_NEARBY_TYPES = [
  ["tourist_attraction", "historical_landmark"],  // landmarks first
  ["park", "national_park"],                       // parks as second pass
];

/**
 * fetchPlacesPhotoUrl — fetch the actual image URL for a Places photo reference.
 * Returns null on failure.
 */
async function fetchPlacesPhotoUrl(photoName, placesKey, maxWidth = 1400) {
  try {
    const res = await fetch(
      `${PLACES_MEDIA_BASE}/${photoName}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.photoUri || null;
  } catch { return null; }
}

/**
 * fetchGooglePlacesHeroPhoto — two-strategy approach:
 *
 * Strategy 1 (preferred): nearby search inside the neighbourhood bbox for
 *   tourist_attraction / historical_landmark types, ranked by popularity.
 *   This returns photos of the actual monuments, plazas, parks in that area.
 *
 * Strategy 2 (fallback): text search for "{name}, {city}" — used when there
 *   is no bbox or strategy 1 yields no photos.
 */
async function fetchGooglePlacesHeroPhoto(name, city, bbox, placesKey, polygonRing = null) {
  if (!placesKey) return null;
  const simpleName = name.replace(/\s*\([^)]*\)/g, "").trim();
  const poly = polygonRing?.length >= 4 ? polygonRing : null;

  // ── Strategy 1: nearby landmark search within bbox ─────────────────────────
  if (bbox?.lat_min != null) {
    const center = poly ? ringCentroid(poly) : null;
    const centerLat = center ? center.lat : (bbox.lat_min + bbox.lat_max) / 2;
    const centerLng = center ? center.lng : (bbox.lon_min + bbox.lon_max) / 2;
    const radiusM = poly
      ? Math.min(2000, maxRadiusFromCentroidM(poly))
      : Math.min(2000, Math.round(
          Math.sqrt((bbox.lat_max - bbox.lat_min) ** 2 + (bbox.lon_max - bbox.lon_min) ** 2) * 111000 / 2
        ));

    for (const types of HERO_NEARBY_TYPES) {
      try {
        const res = await fetch(PLACES_NEARBY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": placesKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
          },
          body: JSON.stringify({
            includedTypes: types,
            maxResultCount: 10,
            rankPreference: "POPULARITY",
            locationRestriction: {
              circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusM },
            },
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) continue;
        const data = await res.json();

        for (const place of (data.places || [])) {
          if (!place.photos?.length) continue;
          const plat = place.location?.latitude;
          const plng = place.location?.longitude;
          if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
          if (!placeInsideNeighborhoodFence(plat, plng, bbox, poly)) continue;
          if (isPlaygroundLikePlaceName(place.displayName?.text)) continue;
          // For park pass: also require the name to actually look like a green space.
          if (types.includes("park") && !isParkLikePlaceName(place.displayName?.text)) continue;
          const photoUrl = await fetchPlacesPhotoUrl(place.photos[0].name, placesKey);
          if (!photoUrl) continue;
          const attr = place.photos[0].authorAttributions?.[0];
          console.log(`[photos] Google Places hero (nearby ${types[0]}) for ${name}: ${place.displayName?.text}`);
          return {
            url:          photoUrl,
            photographer: attr?.displayName || "Google Maps contributor",
            profile_url:  attr?.uri || null,
            query_used:   `google_places_nearby:${place.displayName?.text}`,
            source:       "google_places",
          };
        }
      } catch { continue; }
    }
  }

  // ── Strategy 2: text search fallback ──────────────────────────────────────
  for (const textQuery of [`${simpleName}, ${city}`, simpleName]) {
    try {
      const res = await fetch(PLACES_SEARCH_TEXT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": placesKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
        },
        body: JSON.stringify({ textQuery, maxResultCount: 5 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const place of (data.places || [])) {
        if (!place.photos?.length) continue;
        const plat = place.location?.latitude;
        const plng = place.location?.longitude;
        if (bbox?.lat_min != null && (!Number.isFinite(plat) || !Number.isFinite(plng) ||
            !placeInsideNeighborhoodFence(plat, plng, bbox, poly))) {
          continue;
        }
        const photoUrl = await fetchPlacesPhotoUrl(place.photos[0].name, placesKey);
        if (!photoUrl) continue;
        const attr = place.photos[0].authorAttributions?.[0];
        console.log(`[photos] Google Places hero (text) for ${name}: ${textQuery}`);
        return {
          url:          photoUrl,
          photographer: attr?.displayName || "Google Maps contributor",
          profile_url:  attr?.uri || null,
          query_used:   `google_places_text:${textQuery}`,
          source:       "google_places",
        };
      }
    } catch { continue; }
  }

  return null;
}

/**
 * fetchNeighborhoodPhoto — Google Places primary, Unsplash fallback.
 */
async function fetchNeighborhoodPhoto(name, city, unsplashKey, vibeShort = "", tags = [], bbox = null, googlePlacesKey = null, polygonRing = null) {
  // 1. Try Google Places first (geo-accurate real neighbourhood photos)
  if (googlePlacesKey) {
    const placesPhoto = await fetchGooglePlacesHeroPhoto(name, city, bbox, googlePlacesKey, polygonRing).catch(() => null);
    if (placesPhoto) return placesPhoto;
  }

  // 2. Fall back to Unsplash
  if (!unsplashKey) return null;

  const simpleName = name.replace(/\s*\([^)]*\)/g, "").trim();
  const vibeTerms  = vibeVisualTerms(vibeShort);
  const tagTerms   = (tags || []).slice(0, 2)
    .map(t => TAG_VISUAL[t] || t)
    .join(" ")
    .split(/\s+/).slice(0, 4).join(" ");

  const queries = [
    `${simpleName} ${city}`,
    simpleName,
    tagTerms   ? `${simpleName} ${tagTerms}`           : null,
    vibeTerms  ? `${simpleName} ${city} ${vibeTerms}`  : null,
    tagTerms   ? `${city} ${tagTerms}`                 : null,
    `${city} street neighborhood`,
  ].filter(Boolean).filter((q, i, arr) => arr.indexOf(q) === i);

  for (const query of queries) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
      const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` } });
      if (!res.ok) continue;
      const data  = await res.json();
      const photo = (data.results || []).sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
      if (!photo) continue;
      return {
        url:          photo.urls.regular,
        photographer: photo.user.name,
        profile_url:  photo.user.links.html,
        query_used:   query,
        source:       "unsplash",
      };
    } catch { continue; }
  }
  return null;
}

/**
 * pickHeroFromVibePhotos — DB hero = best photo from the single highest-scoring
 * vibe element. Carousel order on the client mirrors the same ranking (one URL
 * per element, best pick within each array: new place-photos URL, then any
 * non-fallback, then fallback).
 */
function pickFirstPhotoFromElementList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const list = arr.map(p => (typeof p === "string" ? { url: p, is_fallback: false } : p));
  const isNewFormat = (p) => p?.url?.includes('/place-photos/');
  const tiers = [
    (p) => p?.url && !p.is_fallback && isNewFormat(p),
    (p) => p?.url && !p.is_fallback,
    (p) => p?.url,
  ];
  for (const match of tiers) {
    const pick = list.find(match);
    if (pick) return pick;
  }
  return null;
}

function pickHeroFromVibePhotos(vibeElements, vibePhotos) {
  if (!vibeElements || !vibePhotos) return null;

  const ranked = Object.entries(vibeElements)
    .filter(([key]) => Array.isArray(vibePhotos[key]) && vibePhotos[key].length > 0)
    .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0));

  if (ranked.length === 0) return null;

  const topKey = ranked[0][0];
  const pick   = pickFirstPhotoFromElementList(vibePhotos[topKey]);
  if (!pick?.url) return null;

  console.log(`[photos] hero from top vibe [${topKey}] (${ranked[0][1]?.score ?? "?"}%): ${pick.source || "?"} — ${pick.query}`);
  return {
    url:          pick.url,
    photographer: pick.attribution?.photographer || "Google Maps contributor",
    profile_url:  pick.attribution?.profile_url  || null,
    query_used:   `vibe pick:${pick.query || pick.source || "unknown"}`,
    source:       pick.source || "google_places",
  };
}

/**
 * osmSimplifyRing — reduce a GeoJSON coordinate array to at most maxPts vertices.
 * Uses evenly-spaced sampling; keeps the shape representative.
 * Input/output: [[lng, lat], ...] with a closing duplicate at the end.
 */
function osmSimplifyRing(coords, maxPts) {
  let pts = coords;
  // Remove closing duplicate if present
  const frst = pts[0], last = pts[pts.length - 1];
  if (frst[0] === last[0] && frst[1] === last[1]) pts = pts.slice(0, -1);
  if (pts.length <= maxPts) return [...pts, pts[0]];
  const step = pts.length / maxPts;
  const out = [];
  for (let i = 0; i < maxPts; i++) out.push(pts[Math.round(i * step) % pts.length]);
  out.push(out[0]); // re-close
  return out;
}

/**
 * fetchOsmBoundary — query Nominatim for the real OSM administrative/neighbourhood polygon.
 * Returns a normalised ring [{lat, lng}, ...] (closed) or null if not found / no match.
 * Nominatim ToS: User-Agent required, max 1 req/sec. Callers must space invocations.
 */
async function fetchOsmBoundary(name, city, hintBbox = null) {
  const q = encodeURIComponent(`${name}, ${city}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&polygon_geojson=1&limit=5&addressdetails=0`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "TravelBoop/1.0 (https://www.travelboop.com; neighbourhood-boundary-lookup)" },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    console.warn(`[osm-boundary] fetch error for "${name}": ${e.message}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[osm-boundary] Nominatim HTTP ${res.status} for "${name}"`);
    return null;
  }
  const results = await res.json();
  if (!Array.isArray(results) || !results.length) return null;

  // Pick the best result: prefer OSM relations, require a Polygon/MultiPolygon geojson,
  // and reject anything whose bbox doesn't plausibly overlap OR is far too large vs the hint.
  //
  // The size guard prevents using an administrative borough when the hint describes a walkable
  // neighbourhood core — e.g. "Coyoacán, Mexico City" returns the full Alcaldía (~54 km²)
  // when we want the colonia village (~3 km²).  Allow up to MAX_AREA_RATIO × hint area.
  const MAX_AREA_RATIO = 4; // OSM bbox must not exceed 4× hint bbox in either lat or lon span

  // Compute hint spans once
  const hintLatSpan = hintBbox?.lat_min != null ? (hintBbox.lat_max - hintBbox.lat_min) : null;
  const hintLonSpan = hintBbox?.lat_min != null ? (hintBbox.lon_max - hintBbox.lon_min) : null;

  let best = null;
  for (const r of results) {
    if (!r.geojson) continue;
    if (!["Polygon", "MultiPolygon"].includes(r.geojson.type)) continue;

    if (hintBbox?.lat_min != null && r.boundingbox) {
      const bb = r.boundingbox; // Nominatim: ["lat_min","lat_max","lon_min","lon_max"]
      const ob = { lat_min: +bb[0], lat_max: +bb[1], lon_min: +bb[2], lon_max: +bb[3] };
      const tol = 0.05;

      // Overlap check
      if (ob.lat_max < hintBbox.lat_min - tol || ob.lat_min > hintBbox.lat_max + tol ||
          ob.lon_max < hintBbox.lon_min - tol || ob.lon_min > hintBbox.lon_max + tol) {
        console.log(`[osm-boundary] "${name}" candidate rejected: bbox no overlap`);
        continue;
      }

      // Size guard: reject if OSM result is much larger than hint in lat or lon span
      const osmLatSpan = ob.lat_max - ob.lat_min;
      const osmLonSpan = ob.lon_max - ob.lon_min;
      if (hintLatSpan > 0 && osmLatSpan > hintLatSpan * MAX_AREA_RATIO) {
        console.log(`[osm-boundary] "${name}" candidate rejected: too large (lat span ${osmLatSpan.toFixed(3)} > ${(hintLatSpan * MAX_AREA_RATIO).toFixed(3)})`);
        continue;
      }
      if (hintLonSpan > 0 && osmLonSpan > hintLonSpan * MAX_AREA_RATIO) {
        console.log(`[osm-boundary] "${name}" candidate rejected: too large (lon span ${osmLonSpan.toFixed(3)} > ${(hintLonSpan * MAX_AREA_RATIO).toFixed(3)})`);
        continue;
      }
    }
    best = r;
    if (r.osm_type === "relation") break; // relations are the most authoritative boundaries
  }
  if (!best?.geojson) return null;

  // Extract outer ring coords ([lng, lat] GeoJSON order)
  let coords;
  if (best.geojson.type === "Polygon") {
    coords = best.geojson.coordinates[0];
  } else {
    // MultiPolygon: take the ring with the most vertices (usually the main contiguous area)
    coords = best.geojson.coordinates
      .map((poly) => poly[0])
      .sort((a, b) => b.length - a.length)[0];
  }
  if (!coords?.length) return null;

  // Simplify to ≤50 vertices — still far more accurate than Gemini's 6-point guesses
  const simplified = osmSimplifyRing(coords, 50);

  // Convert GeoJSON [lng, lat] → {lat, lng}, round to 6dp
  const ring = simplified.map(([lng, lat]) => ({
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  }));
  if (ring.length < 4) return null;

  // Ensure closed ring
  const first = ring[0], last2 = ring[ring.length - 1];
  if (first.lat !== last2.lat || first.lng !== last2.lng) ring.push({ lat: first.lat, lng: first.lng });

  return ring;
}

async function getHotelCountForBbox(city, bbox, db) {
  const { lat_min, lat_max, lon_min, lon_max } = bbox;
  const { count } = await db
    .from("hotels_cache")
    .select("hotel_id", { count: "exact", head: true })
    .eq("city", city)
    .gte("lat", lat_min).lte("lat", lat_max)
    .gte("lng", lon_min).lte("lng", lon_max);
  return count ?? 0;
}

/** Counts hotels whose coordinates fall inside the bbox.
 * Deliberately uses bbox only (not polygon) so that hotels 100-200m outside
 * the precise colonia polygon boundary are still attributed to the neighbourhood
 * for display purposes.  Polygon precision is reserved for POI density scoring.
 */
async function getHotelCountForFence(city, bbox, polygonRing, db) {
  return getHotelCountForBbox(city, bbox, db);
}

/**
 * generateNeighborhoods — calls Gemini, fetches Unsplash photos, upserts to DB.
 * Returns array of neighborhood rows.
 */
async function generateNeighborhoods(city, db, geminiKey, unsplashKey, googlePlacesKey = null, pexelsKey = null, flickrKey = null) {
  const prompt = buildNeighborhoodPrompt(city);
  const raw    = await callGemini(prompt, geminiKey);

  // Strip markdown code fences if Gemini added them anyway
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let items;
  try {
    items = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini returned invalid JSON for ${city}: ${e.message}\n${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Gemini returned empty neighborhoods array for ${city}`);
  }

  // Process sequentially to stay within Overpass + Nominatim fair-use rate limits
  const rows = [];
  for (const item of items) {
    // Start with Gemini's polygon as a fallback
    let polygonRing = normalizePolygonRing(item.polygon);
    let bbox = item.bbox && item.bbox.lat_min != null ? item.bbox : {};
    if (polygonRing?.length >= 4) {
      const derived = bboxFromRing(polygonRing);
      if (derived) bbox = derived;
    }

    // Try to fetch a real OSM boundary — more accurate than Gemini's approximation.
    // Nominatim ToS: 1 req/sec max. Sequential loop + Overpass 3s gap keeps us well under that.
    try {
      const osmRing = await fetchOsmBoundary(item.name, city, bbox.lat_min != null ? bbox : null);
      if (osmRing) {
        polygonRing = osmRing;
        const osmBbox = bboxFromRing(osmRing);
        if (osmBbox) bbox = osmBbox;
        console.log(`[neighborhoods] OSM boundary for "${item.name}": ${osmRing.length - 1} vertices`);
      } else {
        console.log(`[neighborhoods] No OSM boundary for "${item.name}" — using Gemini polygon`);
      }
    } catch (e) {
      console.warn(`[neighborhoods] OSM lookup failed for "${item.name}": ${e.message}`);
    }
    // Small pause after Nominatim call before hotel-count DB query
    await new Promise((r) => setTimeout(r, 1100));

    // Hotel count (skip if no lat/lng backfill done yet)
    let hotelCount = 0;
    if (bbox.lat_min != null) {
      hotelCount = await getHotelCountForFence(city, bbox, polygonRing, db);
      // Widen bbox by 0.01° if no hotels found (covers sparse backfill)
      if (hotelCount === 0) {
        const widened = {
          lat_min: bbox.lat_min - 0.01, lat_max: bbox.lat_max + 0.01,
          lon_min: bbox.lon_min - 0.01, lon_max: bbox.lon_max + 0.01,
        };
        hotelCount = await getHotelCountForFence(city, widened, polygonRing, db);
      }
    }

    // Fetch real POI counts from Overpass — 3s gap before each call
    let poiCounts = null;
    if (bbox.lat_min != null) {
      await new Promise((r) => setTimeout(r, 3000));
      poiCounts = await fetchOverpassPOIs(bbox, polygonRing).catch((e) => {
        console.warn(`[neighborhoods] Overpass failed for ${item.name}: ${e.message}`);
        return null;
      });
      if (poiCounts) {
        console.log(`[neighborhoods] Overpass ${item.name}: cafes=${poiCounts.cafes} restaurants=${poiCounts.restaurants} parks=${poiCounts.parks} shops=${poiCounts.shops} museums=${poiCounts.museums} icon_spots=${poiCounts.icon_spots}`);
      }
    }

    // Pack dimension scores + real POI counts into attributes JSONB
    const attributes = {
      walkability_dining:        item.walkability_dining,
      walkability_tourist_spots: item.walkability_tourist_spots,
      green_spaces:              item.green_spaces,
      skyline_character:         item.skyline_character,
      street_energy:             item.street_energy,
      ...(poiCounts ? { poi_counts: poiCounts } : {}),
    };

    // Validate photo_queries structure from Gemini — must be an object with array values
    const rawPQ = item.photo_queries;
    const photoQueries = (rawPQ && typeof rawPQ === "object" && !Array.isArray(rawPQ))
      ? Object.fromEntries(
          Object.entries(rawPQ)
            .filter(([, v]) => Array.isArray(v) && v.length > 0)
            .map(([k, v]) => [k, v.filter(q => typeof q === "string" && q.trim()).slice(0, 3)])
        )
      : {};
    if (Object.keys(photoQueries).length > 0) {
      console.log(`[neighborhoods] photo_queries for "${item.name}": ${Object.keys(photoQueries).join(", ")}`);
    }

    rows.push({
      city,
      name:          item.name,
      bbox:          bbox,
      polygon:       polygonRing ? { ring: polygonRing } : null,
      vibe_short:    item.vibe_short,
      vibe_long:     item.vibe_long,
      tags:          item.tags || [],
      visitor_type:  item.visitor_type,
      attributes,
      photo_queries: photoQueries,
      photo_url:     null, // set after vibe photos are computed below
      photo_credit:  null,
      hotel_count:   hotelCount,
      _poiCounts:    poiCounts, // transient — used below, not persisted as top-level column
      _polygonRing:  polygonRing || null,
    });
  }

  // ── Apply manual_override preservation EARLY ──────────────────────────────
  // Must happen before cityMaxCounts and vibeData computation so that the
  // hand-tuned polygon, bbox, and poi_counts are used throughout (not just
  // before the final upsert).  Without this, a wide Gemini-generated polygon
  // could inflate _poiCounts for a manual_override neighborhood (e.g. Reforma
  // counting 624 restaurants from the wide bbox instead of 236 from the
  // corridor polygon) and corrupt both cityMaxCounts normalization and the
  // vibe_elements scores stored to the DB.
  const { data: manualRows } = await db
    .from("neighborhoods")
    .select("name, polygon, bbox, manual_override, attributes")
    .eq("city", city)
    .eq("manual_override", true);
  const manualMap = new Map((manualRows || []).map(r => [r.name, r]));

  for (const row of rows) {
    const saved = manualMap.get(row.name);
    if (saved) {
      row.polygon         = saved.polygon;
      row.bbox            = saved.bbox;
      row.manual_override = true;
      if (saved.attributes?.poi_counts) {
        row.attributes    = { ...(row.attributes || {}), poi_counts: saved.attributes.poi_counts };
        row._poiCounts    = saved.attributes.poi_counts; // use validated counts for cityMaxCounts + vibeData
      }
      if (saved.polygon?.ring?.length >= 4) {
        row._polygonRing  = normalizePolygonRing(saved.polygon); // use saved ring for area calculation
      }
      console.log(`[neighborhoods] "${row.name}": preserved manual_override polygon (${(saved.polygon?.ring?.length ?? 0) - 1} verts)${saved.attributes?.poi_counts ? ' + poi_counts' : ''}`);
    }
  }

  // Compute city-level peak densities for per-city score normalisation.
  // Uses {counts, areaKm2} pairs so scores reflect POI density not raw counts.
  const allNeighbourhoodData = rows
    .filter(r => r._poiCounts && r.bbox?.lat_min != null)
    .map(r => ({
      counts: r._poiCounts,
      areaKm2: r._polygonRing?.length >= 4
        ? (ringAreaKm2(r._polygonRing) ?? bboxAreaKm2(r.bbox))
        : bboxAreaKm2(r.bbox),
    }));
  const cityMaxCounts = allNeighbourhoodData.length > 0 ? computeCityMaxCounts(allNeighbourhoodData) : null;
  if (cityMaxCounts) {
    console.log(`[neighborhoods] city peak densities for ${city}: ${JSON.stringify(Object.fromEntries(Object.entries(cityMaxCounts).map(([k,v]) => [k, Math.round(v * 10) / 10])))} per km²`);
  }

  // Track hero photo_url values already assigned in this run so each
  // neighborhood gets a unique primary hero across the city.
  const assignedHeroUrls = new Set();

  // Compute per-element vibe payloads and photos, then derive hero from top elements.
  // Sequential to avoid hammering Google Places.
  for (const row of rows) {
    try {
      const vibeData = await buildNeighborhoodVibeData({
        city,
        neighborhoodName: row.name,
        attributes: row.attributes || {},
        tags: row.tags || [],
        vibeLong: row.vibe_long || "",
        hotelCount: row.hotel_count || 0,
        unsplashKey,
        poiCounts: row._poiCounts || null,
        cityMaxCounts,
        bbox: row.bbox || null,
        polygon: row.polygon || null,
        googlePlacesKey,
        geminiKey,
        photoQueries: row.photo_queries || null,
        pexelsKey,
        flickrKey,
      });
      row.vibe_elements = vibeData.vibeElements;
      row.vibe_photos   = vibeData.vibePhotos;
      row.vibe_data_version    = "v1";
      row.vibe_last_computed_at = new Date().toISOString();
    } catch (e) {
      console.warn(`[neighborhoods] vibe data generation failed for ${city}/${row.name}: ${e.message}`);
      row.vibe_elements = {};
      row.vibe_photos   = {};
      row.vibe_data_version    = "v1";
      row.vibe_last_computed_at = new Date().toISOString();
    }

    // Hero photo: pick from top-scoring vibe elements (geo-accurate, reflects character)
    let heroPick = pickHeroFromVibePhotos(row.vibe_elements, row.vibe_photos);

    // If the chosen hero is already assigned to another neighborhood in this run,
    // try the next photo from the pool rather than clashing.
    if (heroPick?.url && assignedHeroUrls.has(heroPick.url)) {
      console.log(`[dedup] ${row.name}: hero collision detected, picking alternate`);
      const pool = Object.entries(row.vibe_photos || {})
        .flatMap(([, arr]) => (Array.isArray(arr) ? arr : []))
        .filter(p => {
          const u = typeof p === 'string' ? p : p?.url;
          return u && !assignedHeroUrls.has(u);
        });
      if (pool.length > 0) {
        const alt = pool[Math.floor(Math.random() * pool.length)];
        heroPick = { url: typeof alt === 'string' ? alt : alt.url, photographer: alt?.attribution?.photographer || "Google Maps contributor", profile_url: alt?.attribution?.profile_url || null, query_used: "dedup_alt" };
      }
    }

    if (heroPick) {
      row.photo_url    = heroPick.url;
      row.photo_credit = { photographer: heroPick.photographer, profile_url: heroPick.profile_url, query_used: heroPick.query_used };
    } else {
      const photo = await fetchNeighborhoodPhoto(
        row.name, city, unsplashKey, row.vibe_short, row.tags, row.bbox, googlePlacesKey, row._polygonRing
      ).catch(() => null);
      if (photo) {
        row.photo_url    = photo.url;
        row.photo_credit = { photographer: photo.photographer, profile_url: photo.profile_url, query_used: photo.query_used };
      }
    }

    if (heroPick?.url) assignedHeroUrls.add(heroPick.url);

    // Remove transient fields — not DB columns
    delete row._poiCounts;
    delete row._polygonRing;
  }

  // Final safety pass before upsert: re-apply manual_override fields in case the
  // vibeData loop mutated attributes (manualMap already fetched above).
  for (const row of rows) {
    const saved = manualMap.get(row.name);
    if (saved) {
      row.polygon         = saved.polygon;
      row.bbox            = saved.bbox;
      row.manual_override = true;
      if (saved.attributes?.poi_counts) {
        row.attributes = { ...(row.attributes || {}), poi_counts: saved.attributes.poi_counts };
      }
    }
  }

  // Upsert all rows
  const { error } = await db
    .from("neighborhoods")
    .upsert(rows, { onConflict: "city,name" });
  if (error) throw new Error(`neighborhoods upsert failed: ${error.message}`);

  return rows;
}

/**
 * backfillNeighborhoodPhotos — re-fetches only the hero photo_url/photo_credit for
 * existing rows without regenerating Gemini data.  Useful when UNSPLASH_KEY is first
 * set or when photo quality needs improvement.
 */
async function backfillNeighborhoodPhotos(city, db, unsplashKey, googlePlacesKey = null, pexelsKey = null, flickrKey = null) {
  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, name, vibe_short, tags, bbox, polygon, vibe_elements, vibe_photos")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  const assignedHeroUrls = new Set();

  let updated = 0;
  for (const row of rows) {
    // Primary: pick hero from top-scoring vibe elements (no extra API call)
    let photo = pickHeroFromVibePhotos(row.vibe_elements, row.vibe_photos);

    // Dedup: if this hero is already used by another neighborhood, pick an alternate
    if (photo?.url && assignedHeroUrls.has(photo.url)) {
      console.log(`[dedup] ${row.name}: hero collision detected, picking alternate`);
      const pool = Object.entries(row.vibe_photos || {})
        .flatMap(([, arr]) => (Array.isArray(arr) ? arr : []))
        .filter(p => {
          const u = typeof p === 'string' ? p : p?.url;
          return u && !assignedHeroUrls.has(u);
        });
      if (pool.length > 0) {
        const alt = pool[Math.floor(Math.random() * pool.length)];
        photo = { url: typeof alt === 'string' ? alt : alt.url, photographer: alt?.attribution?.photographer || "Google Maps contributor", profile_url: alt?.attribution?.profile_url || null, query_used: "dedup_alt" };
      }
    }

    // Fallback: fetch directly via Places / Unsplash
    if (!photo) {
      if (!unsplashKey && !googlePlacesKey) {
        console.warn(`[photos] no vibe photos and no API keys for ${row.name} — skipping`);
        continue;
      }
      photo = await fetchNeighborhoodPhoto(
        row.name, city, unsplashKey, row.vibe_short || "", row.tags || [], row.bbox || null, googlePlacesKey,
        normalizePolygonRing(row.polygon)
      ).catch(() => null);
    }

    if (photo?.url) assignedHeroUrls.add(photo.url);

    if (photo) {
      const { error: upErr } = await db
        .from("neighborhoods")
        .update({
          photo_url:    photo.url,
          photo_credit: { photographer: photo.photographer, profile_url: photo.profile_url, query_used: photo.query_used },
        })
        .eq("id", row.id);
      if (upErr) console.warn(`[photos] update ${row.name} failed: ${upErr.message}`);
      else {
        console.log(`[photos] ${row.name} → ${photo.query_used} (${photo.source || "unknown"})`);
        updated++;
      }
    } else {
      console.warn(`[photos] no photo found for ${row.name} (${city})`);
    }
  }
  return updated;
}

/**
 * recomputeNeighborhoodVibes — refresh vibe elements/photos for existing rows.
 * Uses stored poi_counts from attributes when present; re-fetches from Overpass
 * when missing so older rows are automatically enriched on first recompute.
 */
async function recomputeNeighborhoodVibes(city, db, unsplashKey, googlePlacesKey = null, geminiKey = null, pexelsKey = null, flickrKey = null) {
  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, city, name, bbox, polygon, vibe_long, tags, attributes, hotel_count, vibe_photos, photo_url, photo_credit, photo_queries")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  // Always re-fetch Overpass counts (sequential, 20s gap) so any query changes
  // propagate without a separate migration step. 20s cooldown between neighbourhoods
  // lets the public Overpass endpoint recover from the previous pair of requests.
  for (const row of rows) {
    if (row.bbox?.lat_min != null) {
      await new Promise((r) => setTimeout(r, 20000));
      const fetched = await fetchOverpassPOIs(row.bbox, normalizePolygonRing(row.polygon)).catch((e) => {
        console.warn(`[recompute] Overpass failed for ${row.name}: ${e.message}`);
        return null;
      });
      if (fetched) {
        // parks=null means the green-area Overpass query failed (not that there are 0 parks).
        // Always fall back to the existing DB value so a flaky Overpass request never
        // zeroes out a neighbourhood that genuinely has parks.
        if (fetched.parks == null) {
          const oldParks = row.attributes?.poi_counts?.parks ?? null;
          fetched.parks = oldParks;
          console.warn(`[recompute] ${row.name}: green query failed — keeping stored parks=${oldParks ?? "none"}`);
        }
        console.log(`[recompute] Overpass ${row.name}: cafes=${fetched.cafes} restaurants=${fetched.restaurants} parks=${fetched.parks} shops=${fetched.shops} museums=${fetched.museums} icon_spots=${fetched.icon_spots}`);
        const updatedAttrs = { ...(row.attributes || {}), poi_counts: fetched };
        await db.from("neighborhoods").update({ attributes: updatedAttrs }).eq("id", row.id);
        row.attributes = updatedAttrs;
      }
    }
  }

  // Compute city-level peak densities from stored counts + bbox areas
  const allNeighbourhoodData = rows
    .filter(r => r.attributes?.poi_counts && r.bbox?.lat_min != null)
    .map(r => {
      const pr = normalizePolygonRing(r.polygon);
      return {
        counts: r.attributes.poi_counts,
        areaKm2: pr?.length >= 4 ? (ringAreaKm2(pr) ?? bboxAreaKm2(r.bbox)) : bboxAreaKm2(r.bbox),
      };
    });
  const cityMaxCounts = allNeighbourhoodData.length > 0 ? computeCityMaxCounts(allNeighbourhoodData) : null;
  if (cityMaxCounts) {
    console.log(`[recompute] city peak densities for ${city}: ${JSON.stringify(Object.fromEntries(Object.entries(cityMaxCounts).map(([k,v]) => [k, Math.round(v * 10) / 10])))} per km²`);
  }

  // Track hero photo_url values already assigned in this run so each
  // neighborhood gets a unique primary hero across the city.
  const assignedHeroUrls = new Set(rows.map(r => r.photo_url).filter(Boolean));

  for (const row of rows) {
    const poiCounts = row.attributes?.poi_counts || null;

    const vibeData = await buildNeighborhoodVibeData({
      city: row.city,
      neighborhoodName: row.name,
      attributes: row.attributes || {},
      tags: row.tags || [],
      vibeLong: row.vibe_long || "",
      hotelCount: row.hotel_count || 0,
      unsplashKey,
      poiCounts,
      cityMaxCounts,
      bbox: row.bbox || null,
      photoQueries: row.photo_queries || null,
      polygon: row.polygon || null,
      googlePlacesKey,
      geminiKey,
      pexelsKey,
      flickrKey,
    });
    // Merge fresh + stored photos (only override categories with real fresh results).
    const mergedForHero = { ...(row.vibe_photos || {}) };
    for (const [key, photos] of Object.entries(vibeData.vibePhotos)) {
      if (Array.isArray(photos) && photos.length > 0) mergedForHero[key] = photos;
    }

    let heroPick = pickHeroFromVibePhotos(vibeData.vibeElements, mergedForHero);
    if (!heroPick) console.log(`[photos] ${row.name}: pickHeroFromVibePhotos returned null — trying external fallback`);

    // If the chosen hero is already assigned to another neighborhood in this run,
    // try the next photo from the pool rather than clashing.
    if (heroPick?.url && assignedHeroUrls.has(heroPick.url) && heroPick.url !== row.photo_url) {
      console.log(`[dedup] ${row.name}: hero collision detected, picking alternate`);
      const pool = Object.entries(mergedForHero)
        .flatMap(([, arr]) => (Array.isArray(arr) ? arr : []))
        .filter(p => {
          const u = typeof p === 'string' ? p : p?.url;
          return u && !assignedHeroUrls.has(u);
        });
      if (pool.length > 0) {
        const alt = pool[Math.floor(Math.random() * pool.length)];
        heroPick = { url: typeof alt === 'string' ? alt : alt.url, photographer: alt?.attribution?.photographer || "Google Maps contributor", profile_url: alt?.attribution?.profile_url || null, query_used: "dedup_alt" };
      }
    }

    if (!heroPick) {
      // Last resort: fetch directly via Places / Unsplash
      const fallback = await fetchNeighborhoodPhoto(
        row.name, row.city, unsplashKey, row.vibe_short || "", row.tags || [], row.bbox || null, googlePlacesKey,
        normalizePolygonRing(row.polygon)
      ).catch(() => null);
      if (fallback) heroPick = { url: fallback.url, photographer: fallback.photographer, profile_url: fallback.profile_url, query_used: fallback.query_used };
    }

    // mergedForHero is the merged set for storing.
    const mergedVibePhotos = mergedForHero;

    if (heroPick?.url) assignedHeroUrls.add(heroPick.url);

    // Refresh hotel_count in the same update pass.
    const pr = normalizePolygonRing(row.polygon);
    const freshHotelCount = await getHotelCountForFence(row.city, row.bbox || {}, pr, db);

    const updatePayload = {
      vibe_elements: vibeData.vibeElements,
      vibe_photos:   mergedVibePhotos,
      vibe_data_version:    "v1",
      vibe_last_computed_at: new Date().toISOString(),
      photo_url:    heroPick?.url    || row.photo_url || null,
      photo_credit: heroPick ? { photographer: heroPick.photographer, profile_url: heroPick.profile_url, query_used: heroPick.query_used } : (row.photo_credit || null),
      hotel_count:  freshHotelCount,
    };

    const { error: upErr } = await db
      .from("neighborhoods")
      .update(updatePayload)
      .eq("id", row.id);
    if (upErr) throw new Error(`update ${row.name} failed: ${upErr.message}`);
    console.log(`[recompute] ${row.name}: hotel_count=${freshHotelCount}`);
  }

  return rows.length;
}

/**
 * refreshHotelCounts — recomputes hotel_count for all neighborhoods of a city.
 * Called after re-indexing when lat/lng have been backfilled.
 */
async function refreshHotelCounts(city, db) {
  const { data: hoods, error } = await db
    .from("neighborhoods")
    .select("id, name, bbox, polygon")
    .eq("city", city);

  if (error || !hoods?.length) return;

  await Promise.all(hoods.map(async (hood) => {
    const bbox = hood.bbox;
    if (!bbox?.lat_min) return;
    const pr = normalizePolygonRing(hood.polygon);
    const count = await getHotelCountForFence(city, bbox, pr, db);
    await db.from("neighborhoods").update({ hotel_count: count }).eq("id", hood.id);
  }));

  console.log(`[neighborhoods] hotel_count refreshed for ${city} (${hoods.length} neighborhoods)`);
}

/**
 * backfillPhotoQueries — for existing neighborhoods that have empty photo_queries,
 * calls Gemini to generate specific named-place queries per element, then re-runs
 * only the photo fetch (no Overpass, no scoring recompute). Fast and cheap.
 */
async function backfillPhotoQueries(city, db, geminiKey, unsplashKey, googlePlacesKey = null, pexelsKey = null, flickrKey = null) {
  if (!geminiKey) throw new Error("GEMINI_KEY required");

  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, city, name, bbox, polygon, vibe_short, vibe_long, tags, attributes, hotel_count, photo_queries")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  let updated = 0;
  for (const row of rows) {
    // Skip rows that already have photo_queries populated
    const alreadyHas = row.photo_queries && Object.keys(row.photo_queries).length > 0;
    if (alreadyHas) {
      console.log(`[photo-queries] ${row.name}: already has queries, skipping`);
      continue;
    }

    // Targeted Gemini prompt — only asks for photo_queries, uses stored vibe data
    const prompt = `You are a travel photo researcher. For the neighborhood "${row.name}" in ${city}, generate specific Unsplash search queries for 7 visual elements.

Neighborhood context:
- Vibe: ${row.vibe_short || ""}
- Description: ${row.vibe_long || ""}
- Tags: ${(row.tags || []).join(", ")}

Return ONLY a valid JSON object (no markdown, no explanation) with exactly these keys:
parks, restaurants, cafes, street_feel, icon_spots, museums, shops, greenery

Each key maps to an array of exactly 2 search strings. Rules:
- Use NAMED real places, streets, landmarks — NOT generic category words
- Be specific enough that a photographer would use this as a caption
- parks: named park or garden (e.g. "Parque España Mexico City")
- restaurants: a well-known local restaurant or food street
- cafes: a well-known local cafe or cafe-lined street
- street_feel: the most visually distinctive street or feature (e.g. "Roma Norte jacaranda tree lined")
- icon_spots: the defining landmark or tower (e.g. "Torre Mayor Polanco skyline")
- museums: a specific museum name
- shops: a specific shopping street or market
- greenery: the most photogenic tree-lined street, leafy boulevard, or canopied avenue
  (e.g. "Roma Norte jacaranda avenue", "Paseo de la Reforma tree-lined boulevard")

Example output format:
{"parks":["Parque España Mexico City","Parque Luis Cabrera Roma Norte"],"restaurants":["Contramar restaurant Mexico City","Roma Norte terrace dining"],"cafes":["Panaderia Rosetta Mexico City","independent cafe Roma Norte"],"street_feel":["Roma Norte jacaranda tree lined street","Colonia Roma art deco boulevard"],"icon_spots":["Fuente de la Cibeles Mexico City","Roma Norte art nouveau facade"],"museums":["Museo del Objeto del Objeto Mexico City","Casa Lamm Roma Norte"],"shops":["vintage shops Colonia Roma","design boutique Roma Norte"],"greenery":["Roma Norte jacaranda tree lined avenue","Colonia Roma leafy boulevard"]}`;

    let photoQueries = null;
    try {
      const raw = await callGemini(prompt, geminiKey);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        photoQueries = Object.fromEntries(
          Object.entries(parsed)
            .filter(([, v]) => Array.isArray(v) && v.length > 0)
            .map(([k, v]) => [k, v.filter(q => typeof q === "string" && q.trim()).slice(0, 3)])
        );
        console.log(`[photo-queries] ${row.name}: generated queries for ${Object.keys(photoQueries).join(", ")}`);
      }
    } catch (e) {
      console.warn(`[photo-queries] Gemini failed for ${row.name}: ${e.message}`);
      continue;
    }

    if (!photoQueries || Object.keys(photoQueries).length === 0) continue;

    // Persist photo_queries
    await db.from("neighborhoods").update({ photo_queries: photoQueries }).eq("id", row.id);

    // Re-fetch only element photos using new queries (no scoring recompute)
    const { buildNeighborhoodVibeData: bvd } = require("./neighborhood-vibe-data");
    try {
      const polygonRing = normalizePolygonRing(row.polygon);
      const vibeData = await bvd({
        city: row.city,
        neighborhoodName: row.name,
        attributes: row.attributes || {},
        tags: row.tags || [],
        vibeLong: row.vibe_long || "",
        hotelCount: row.hotel_count || 0,
        unsplashKey,
        bbox: row.bbox || null,
        polygon: row.polygon || null,
        googlePlacesKey,
        geminiKey,
        photoQueries,
        pexelsKey,
        flickrKey,
      });
      await db.from("neighborhoods").update({
        vibe_photos: vibeData.vibePhotos,
        vibe_last_computed_at: new Date().toISOString(),
      }).eq("id", row.id);
      updated++;
      console.log(`[photo-queries] ${row.name}: photos refreshed`);
    } catch (e) {
      console.warn(`[photo-queries] photo refresh failed for ${row.name}: ${e.message}`);
    }

    // Brief pause between neighborhoods to stay within Gemini rate limits
    await new Promise(r => setTimeout(r, 1500));
  }

  return updated;
}

/**
 * backfillNeighborhoodPolygons — for each existing neighborhood row in the DB,
 * fetch an authoritative OSM/Nominatim polygon and update polygon + bbox.
 * Skips rows that already have an OSM-quality polygon (≥20 vertices).
 * Nominatim ToS: 1 req/sec max — enforced by 1100 ms sequential gap.
 */
async function backfillNeighborhoodPolygons(city, db, force = false) {
  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, name, bbox, polygon, manual_override")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return { updated: 0, skipped: 0 };

  let updated = 0, skipped = 0;

  for (const row of rows) {
    const existingRing = normalizePolygonRing(row.polygon);

    // Never overwrite manually curated polygons (unless force=true)
    if (!force && row.manual_override) {
      console.log(`[poly-backfill] "${row.name}" has manual_override=true — skipping`);
      skipped++;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    // If already has an OSM-quality ring (≥20 vertices) and not forcing, skip
    if (!force && existingRing?.length >= 20) {
      console.log(`[poly-backfill] "${row.name}" already has ${existingRing.length - 1}-vertex polygon — skipping`);
      skipped++;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }

    // Nominatim 1 req/sec ToS gap
    await new Promise(r => setTimeout(r, 1100));

    let osmRing = null;
    try {
      osmRing = await fetchOsmBoundary(row.name, city, row.bbox?.lat_min != null ? row.bbox : null);
    } catch (e) {
      console.warn(`[poly-backfill] OSM lookup failed for "${row.name}": ${e.message}`);
    }

    if (!osmRing) {
      console.log(`[poly-backfill] No OSM boundary found for "${row.name}" — keeping existing`);
      skipped++;
      continue;
    }

    const newBbox = bboxFromRing(osmRing);
    const updatePayload = {
      polygon: { ring: osmRing },
      ...(newBbox ? { bbox: newBbox } : {}),
    };

    const { error: upErr } = await db
      .from("neighborhoods")
      .update(updatePayload)
      .eq("id", row.id);

    if (upErr) {
      console.error(`[poly-backfill] DB update failed for "${row.name}": ${upErr.message}`);
      skipped++;
    } else {
      const verts = osmRing.length - 1;
      const oldVerts = existingRing ? existingRing.length - 1 : 0;
      console.log(`[poly-backfill] "${row.name}": updated ${oldVerts} → ${verts} vertices`);
      updated++;
    }
  }

  console.log(`[poly-backfill] ${city}: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

module.exports = { generateNeighborhoods, refreshHotelCounts, recomputeNeighborhoodVibes, backfillNeighborhoodPhotos, backfillPhotoQueries, backfillNeighborhoodPolygons };
