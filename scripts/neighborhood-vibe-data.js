const ELEMENTS = [
  { key: "parks", label: "Parks", icon: "PARK" },
  { key: "restaurants", label: "Restaurants", icon: "FOOD" },
  { key: "cafes", label: "Cafes", icon: "CAFE" },
  { key: "street_feel", label: "Street Feel", icon: "STREET" },
  { key: "icon_spots", label: "Icon Spots", icon: "ICON" },
  { key: "museums", label: "Museums", icon: "MUSEUM" },
  { key: "shops", label: "Shops", icon: "SHOP" },
];

const PHOTO_RULES = { target: 6, min: 3, max: 8 };

const QUERY_TEMPLATES = {
  parks: [
    "{neighborhood} {city} park",
    "{neighborhood} {city} tree lined streets",
    "{city} neighborhood green space",
  ],
  restaurants: [
    "{neighborhood} {city} restaurants outdoor dining",
    "{neighborhood} {city} food street",
    "{city} neighborhood dining scene",
  ],
  cafes: [
    "{neighborhood} {city} cafe terrace",
    "{neighborhood} {city} coffee shop street",
    "{city} neighborhood cafe culture",
  ],
  street_feel: [
    "{neighborhood} {city} street life",
    "{neighborhood} {city} walkable streets",
    "{city} neighborhood pedestrian street",
  ],
  icon_spots: [
    "{neighborhood} {city} landmark",
    "{neighborhood} {city} square plaza",
    "{city} iconic tourist spot",
  ],
  museums: [
    "{neighborhood} {city} museum",
    "{neighborhood} {city} gallery",
    "{city} museum district",
  ],
  shops: [
    "{neighborhood} {city} boutique shopping",
    "{neighborhood} {city} vintage store",
    "{neighborhood} {city} local market shops",
  ],
};

const FALLBACK_PHOTOS = {
  parks: [
    "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=900&q=80",
    "https://images.unsplash.com/photo-1517167685284-96a27681ad75?w=900&q=80",
    "https://images.unsplash.com/photo-1473445361085-b9a07f55608b?w=900&q=80",
  ],
  restaurants: [
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80",
    "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=80",
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&q=80",
  ],
  cafes: [
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&q=80",
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=900&q=80",
    "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=900&q=80",
  ],
  street_feel: [
    "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=80",
    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=900&q=80",
    "https://images.unsplash.com/photo-1496950866446-3253e1470e8e?w=900&q=80",
  ],
  icon_spots: [
    "https://images.unsplash.com/photo-1520339493071-47e7c16a1fcf?w=900&q=80",
    "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&q=80",
    "https://images.unsplash.com/photo-1543349689-9a4d426bee8e?w=900&q=80",
  ],
  museums: [
    "https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=900&q=80",
    "https://images.unsplash.com/photo-1558449028-b53a39d100fc?w=900&q=80",
    "https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=900&q=80",
  ],
  shops: [
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=900&q=80",
    "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=900&q=80",
    "https://images.unsplash.com/photo-1521334884684-d80222895322?w=900&q=80",
  ],
};

// ── Overpass API ──────────────────────────────────────────────────────────────

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// POI categories that can be scored from real counts.
const POI_CATEGORIES = ["parks", "restaurants", "cafes", "museums", "shops", "icon_spots"];

/**
 * computeCityMaxCounts — given an array of poiCounts objects (one per neighbourhood),
 * returns the per-category maximum across the city.  Used as the normalisation
 * ceiling so scores are relative within the city (best = ~100%, worst = ~20%).
 */
function computeCityMaxCounts(allPoiCounts) {
  const cityMax = {};
  for (const cat of POI_CATEGORIES) {
    cityMax[cat] = Math.max(1, ...allPoiCounts.map((c) => c?.[cat] || 0));
  }
  return cityMax;
}

/**
 * fetchOverpassPOIs — queries OpenStreetMap via Overpass for 6 POI categories
 * inside a bounding box. Returns { parks, restaurants, cafes, museums, shops,
 * icon_spots } counts, or null on failure (caller should fall back to formula).
 *
 * Retries once on 429/504 after a 10s back-off to stay within fair-use limits
 * of the public overpass-api.de instance.
 */
async function fetchOverpassPOIs(bbox) {
  const { lat_min, lat_max, lon_min, lon_max } = bbox || {};
  if (lat_min == null) return null;

  // Single union query — one HTTP call per neighbourhood.
  // Parks: ways/relations only (polygons = actual park areas).
  // Node-tagged parks in OSM are usually micro-markers (tree planters, 2m² patches)
  // that inflate counts by 10-30x — only polygon areas represent real parks.
  const q = `[out:json][timeout:25];
(
  way["leisure"~"^(park|garden)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  relation["leisure"~"^(park|garden)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["amenity"~"^(restaurant|fast_food|bar|pub|food_court)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["amenity"="cafe"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["tourism"~"^(museum|gallery|attraction|viewpoint)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["tourism"~"^(museum|gallery)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["shop"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["historic"~"^(monument|memorial|castle|ruins|archaeological_site)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["historic"~"^(monument|castle|ruins)$"](${lat_min},${lon_min},${lat_max},${lon_max});
);
out tags;`;

  const doFetch = () => fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(30000),
  });

  let res = await doFetch();

  // Single retry after back-off on rate-limit or gateway timeout
  if (res.status === 429 || res.status === 504) {
    await new Promise((r) => setTimeout(r, 10000));
    res = await doFetch();
  }

  if (!res.ok) throw new Error(`Overpass API ${res.status}`);
  const data = await res.json();

  const counts = { parks: 0, restaurants: 0, cafes: 0, museums: 0, shops: 0, icon_spots: 0 };

  for (const el of (data.elements || [])) {
    const t = el.tags || {};
    if (t.leisure === "park" || t.leisure === "garden") {
      counts.parks++;
    } else if (t.amenity === "cafe") {
      counts.cafes++;
    } else if (["restaurant", "fast_food", "bar", "pub", "food_court"].includes(t.amenity)) {
      counts.restaurants++;
    } else if (["museum", "gallery"].includes(t.tourism)) {
      counts.museums++;
    } else if (t.shop) {
      counts.shops++;
    } else if (
      ["attraction", "viewpoint"].includes(t.tourism) ||
      ["monument", "memorial", "castle", "ruins", "archaeological_site"].includes(t.historic)
    ) {
      counts.icon_spots++;
    }
  }

  return counts;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function hasTag(tags, key) {
  return (tags || []).some((t) => (t || "").toLowerCase() === key);
}

function catScore(value, map) {
  return map[value] ?? 50;
}

/**
 * poiCountToScore — √-scale normalisation relative to the city's own maximum.
 *
 * Scoring is per-city: the neighbourhood with the most of a category scores
 * ~95–100%; others scale proportionally.  √ gives natural spread — a
 * neighbourhood with half the city max scores ~70%, not 50%.
 *
 * Floor of 10 so even the quietest neighbourhood registers visibly.
 *
 * Falls back to a global ceiling when cityMaxCounts is not available.
 */
const GLOBAL_FALLBACK_MAX = {
  parks: 20, restaurants: 300, cafes: 100, museums: 30, shops: 500, icon_spots: 30,
};

function poiCountToScore(count, category, cityMaxCounts = null) {
  if (!count || count <= 0) return 10;
  const max = cityMaxCounts?.[category] || GLOBAL_FALLBACK_MAX[category] || 50;
  // √(count/max)*100, floor 10, ceil 100
  return clamp(Math.round(Math.sqrt(count / max) * 100), 10, 100);
}

/**
 * computeElementScores — returns per-element 0–100 scores.
 *
 * When poiCounts + cityMaxCounts are provided (real Overpass data), scores for
 * all POI-countable elements are derived from real counts normalised within the
 * city.  street_feel always uses the Gemini-attribute formula (walkability
 * infrastructure, not a POI count).  Falls back to the full formula when
 * poiCounts is null.
 */
function computeElementScores(attributes = {}, tags = [], vibeLong = "", poiCounts = null, cityMaxCounts = null) {
  const wDining = catScore(attributes.walkability_dining, { excellent: 90, good: 68, limited: 40 });
  const wTour   = catScore(attributes.walkability_tourist_spots, { excellent: 90, good: 68, limited: 40 });
  const energy  = catScore(attributes.street_energy, { lively: 88, moderate: 62, quiet: 42 });
  const transit = catScore(attributes.transport_dependency, { low: 86, medium: 62, high: 36 });
  const text    = (vibeLong || "").toLowerCase();

  const hasRealCounts = poiCounts && Object.values(poiCounts).some((v) => v > 0);

  let scores;
  if (hasRealCounts) {
    scores = {
      parks:       poiCountToScore(poiCounts.parks,       "parks",       cityMaxCounts),
      restaurants: poiCountToScore(poiCounts.restaurants, "restaurants", cityMaxCounts),
      cafes:       poiCountToScore(poiCounts.cafes,       "cafes",       cityMaxCounts),
      museums:     poiCountToScore(poiCounts.museums,     "museums",     cityMaxCounts),
      shops:       poiCountToScore(poiCounts.shops,       "shops",       cityMaxCounts),
      icon_spots:  poiCountToScore(poiCounts.icon_spots,  "icon_spots",  cityMaxCounts),
    };
  } else {
    const green   = catScore(attributes.green_spaces, { lots: 90, some: 65, minimal: 32 });
    const skyline = catScore(attributes.skyline_character, {
      "low-rise historic": 82, "modern high-rise": 58, mixed: 70, "tree-lined": 76,
    });
    scores = {
      parks:       clamp(green * 0.68 + wTour * 0.22 + transit * 0.1 + (hasTag(tags, "green") ? 8 : 0)),
      restaurants: clamp(wDining * 0.64 + energy * 0.26 + (hasTag(tags, "foodie") ? 10 : 0)),
      cafes:       clamp(wDining * 0.45 + wTour * 0.25 + (hasTag(tags, "local-feel") ? 8 : 0) + (hasTag(tags, "shopping") ? 5 : 0)),
      museums:     clamp(skyline * 0.26 + wTour * 0.34 + (hasTag(tags, "artsy") ? 8 : 0) + (text.includes("museum") || text.includes("gallery") ? 16 : 0)),
      shops:       clamp(energy * 0.24 + wTour * 0.2 + wDining * 0.18 + (hasTag(tags, "shopping") ? 18 : 0) + (hasTag(tags, "luxury") ? 8 : 0)),
      icon_spots:  clamp(skyline * 0.4 + wTour * 0.3 + (hasTag(tags, "historic") ? 14 : 0) + (text.includes("square") || text.includes("landmark") ? 8 : 0)),
    };
  }

  // street_feel is always formula-derived (walkability infrastructure signal)
  scores.street_feel = clamp(wTour * 0.42 + transit * 0.32 + energy * 0.26);

  const shopsSubscores = {
    high_end_boutique: clamp(scores.shops * 0.55 + (hasTag(tags, "luxury") ? 28 : 0) + (text.includes("designer") ? 12 : 0)),
    vintage_thrift:    clamp(scores.shops * 0.58 + (hasTag(tags, "artsy") ? 20 : 0) + (text.includes("vintage") ? 14 : 0)),
    local_artisan:     clamp(scores.shops * 0.62 + (hasTag(tags, "local-feel") ? 20 : 0) + (hasTag(tags, "market") ? 16 : 0)),
  };

  return { scores, shopsSubscores };
}

// ── Facts lines ───────────────────────────────────────────────────────────────

function elementFacts(elementKey, score, hotelCount, shopsSubscores = null, poiCounts = null) {
  const real = poiCounts?.[elementKey];

  if (elementKey === "parks") return [
    real != null ? `${real} parks & gardens mapped in the area` : `${Math.max(2, Math.round(score / 12))} notable green areas in easy reach`,
    `${Math.max(4, Math.round((100 - score) / 14))}-${Math.max(8, Math.round((100 - score) / 10))} min walk to larger green spaces`,
    `Morning calm profile: ${Math.max(38, Math.round(score * 0.84))}%`,
  ];
  if (elementKey === "restaurants") return [
    real != null ? `${real} restaurants, bars & eateries` : `${Math.round(score / 8 + hotelCount / 6)} dining venues per km² (estimated)`,
    `${Math.max(3, Math.round(score / 18))}-${Math.max(7, Math.round(score / 11))} min walk to dense food streets`,
    `Evening dining energy: ${Math.max(35, Math.round(score * 0.9))}%`,
  ];
  if (elementKey === "cafes") return [
    real != null ? `${real} cafes mapped in the area` : `${Math.max(8, Math.round(score / 8 + 4))} cafe options in walk radius`,
    `Sidewalk seating visibility: ${score}%`,
    `Linger-friendly profile: ${Math.max(32, Math.round(score * 0.82))}%`,
  ];
  if (elementKey === "street_feel") return [
    `${Math.max(5, Math.round(score / 10 + 4))} high-comfort pedestrian segments`,
    `Pedestrian comfort index: ${score}%`,
    `Wayfinding simplicity: ${Math.max(34, Math.round(score * 0.8))}%`,
  ];
  if (elementKey === "icon_spots") return [
    real != null ? `${real} landmarks, monuments & viewpoints` : `${Math.max(3, Math.round(score / 11 + 2))} icon spots in practical reach`,
    `Landmark/square access profile: ${score}%`,
    `Photo-worthy icon moments: ${Math.max(30, Math.round(score * 0.86))}%`,
  ];
  if (elementKey === "museums") return [
    real != null ? `${real} museums & galleries` : `${Math.max(2, Math.round(score / 11 + 2))} museums/galleries in easy reach`,
    `Culture-day friendliness: ${score}%`,
    `Rainy-day resilience: ${Math.max(30, Math.round(score * 0.76))}%`,
  ];
  if (elementKey === "shops" && shopsSubscores) return [
    real != null ? `${real} shops mapped in the area` : `${Math.max(5, Math.round(score / 8 + 3))} shopping stops in easy stroll`,
    `Boutique: ${shopsSubscores.high_end_boutique}%  Vintage: ${shopsSubscores.vintage_thrift}%`,
    `Local artisan/market: ${shopsSubscores.local_artisan}%`,
  ];
  return [`Signal profile: ${score}%`];
}

// ── Payload builder ───────────────────────────────────────────────────────────

function buildElementPayload(elementKey, score, neighborhoodName, hotelCount, shopsSubscores = null, poiCounts = null) {
  const label = ELEMENTS.find((e) => e.key === elementKey)?.label || elementKey;
  return {
    score,
    summary: `${neighborhoodName}: ${label.toLowerCase()} feel is ${score >= 80 ? "very strong" : score >= 65 ? "strong" : score >= 50 ? "good" : "moderate"}.`,
    facts: elementFacts(elementKey, score, hotelCount, shopsSubscores, poiCounts),
    metrics: {
      signal_strength: score,
      confidence: clamp(score * 0.82),
      user_fit: clamp(score * 0.78 + 12),
    },
    ...(elementKey === "shops" ? { subscores: shopsSubscores } : {}),
  };
}

// ── Google Places photo helpers ───────────────────────────────────────────────

const PLACES_NEARBY_URL  = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_MEDIA_BASE  = "https://places.googleapis.com/v1";

// Places API (New) type values per element category.
// street_feel has no clean Places type — falls back to Unsplash.
const PLACES_ELEMENT_TYPES = {
  parks:       ["park", "national_park", "botanical_garden"],
  restaurants: ["restaurant"],
  cafes:       ["cafe"],
  museums:     ["museum", "art_gallery"],
  shops:       ["clothing_store", "book_store", "gift_shop", "shopping_mall"],
  icon_spots:  ["tourist_attraction", "historical_landmark"],
  street_feel: null,
};

/**
 * fetchGooglePlacesElementPhotos — nearby search inside the neighbourhood bbox,
 * filtered by category type. Returns up to `maxPhotos` photo objects.
 * Falls back gracefully — returns [] on any error.
 */
async function fetchGooglePlacesElementPhotos(bbox, elementKey, placesKey, maxPhotos = PHOTO_RULES.target) {
  if (!placesKey || !bbox?.lat_min) return [];
  const types = PLACES_ELEMENT_TYPES[elementKey];
  if (!types) return []; // street_feel — caller uses Unsplash fallback

  const centerLat = (bbox.lat_min + bbox.lat_max) / 2;
  const centerLng = (bbox.lon_min + bbox.lon_max) / 2;
  // Convert bbox size to radius in metres, cap at 3 km
  const radiusM = Math.min(
    3000,
    Math.round(Math.max(bbox.lat_max - bbox.lat_min, bbox.lon_max - bbox.lon_min) * 111000 / 2)
  );

  const body = {
    includedTypes: types,
    maxResultCount: maxPhotos,
    rankPreference: "POPULARITY",
    locationRestriction: {
      circle: { center: { latitude: centerLat, longitude: centerLng }, radius: radiusM },
    },
  };

  let places = [];
  try {
    const res = await fetch(PLACES_NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": placesKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    places = data.places || [];
  } catch { return []; }

  const photos = [];
  for (const place of places) {
    if (!place.photos?.length) continue;
    const photoName = place.photos[0].name;
    const attr = place.photos[0].authorAttributions?.[0];
    try {
      const mediaRes = await fetch(
        `${PLACES_MEDIA_BASE}/${photoName}/media?maxWidthPx=900&skipHttpRedirect=true`,
        { headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(10000) }
      );
      if (!mediaRes.ok) continue;
      const mediaData = await mediaRes.json();
      if (!mediaData.photoUri) continue;
      photos.push({
        url:        mediaData.photoUri,
        source:     "google_places",
        query:      place.displayName?.text || elementKey,
        is_fallback: false,
        attribution: attr ? { photographer: attr.displayName, profile_url: attr.uri } : null,
      });
    } catch { continue; }
    if (photos.length >= maxPhotos) break;
  }
  return photos;
}

// ── Unsplash photo helpers ────────────────────────────────────────────────────

function buildQueries(elementKey, neighborhoodName, city) {
  const templates = QUERY_TEMPLATES[elementKey] || [];
  return templates.map((t) =>
    t.replace("{neighborhood}", neighborhoodName).replace("{city}", city)
  );
}

function normalizePhotoObject(photo, query, source, isFallback = false) {
  if (typeof photo === "string") {
    return { url: photo, source, query, is_fallback: isFallback, attribution: null };
  }
  return {
    url: photo.urls?.regular || photo.url || null,
    source,
    query,
    is_fallback: isFallback,
    attribution: photo.user ? {
      photographer: photo.user.name,
      profile_url: photo.user.links?.html || null,
    } : (photo.attribution || null),
  };
}

async function fetchUnsplashPhotos(query, unsplashKey, perPage = 8) {
  if (!unsplashKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

/**
 * fetchElementPhotos — Google Places primary, Unsplash fallback, curated last resort.
 * street_feel has no Places type so it always uses Unsplash.
 */
async function fetchElementPhotos(city, neighborhoodName, elementKey, unsplashKey, bbox = null, googlePlacesKey = null) {
  const dedupe = new Set();
  const picks = [];

  const addPick = (obj) => {
    if (!obj?.url) return;
    const key = obj.url.split("?")[0];
    if (dedupe.has(key)) return;
    dedupe.add(key);
    picks.push(obj);
  };

  // Primary: Google Places geo-search (real photos from actual venues in the neighbourhood)
  if (googlePlacesKey && bbox) {
    const placesPhotos = await fetchGooglePlacesElementPhotos(bbox, elementKey, googlePlacesKey);
    placesPhotos.forEach((p) => addPick(p));
  }

  // Fallback: Unsplash text search
  if (picks.length < PHOTO_RULES.min) {
    const queries = buildQueries(elementKey, neighborhoodName, city);
    if (queries[0]) {
      const res = await fetchUnsplashPhotos(queries[0], unsplashKey, PHOTO_RULES.max);
      res.forEach((photo) => addPick(normalizePhotoObject(photo, queries[0], "unsplash")));
    }
    if (picks.length < PHOTO_RULES.min && queries[2]) {
      const res = await fetchUnsplashPhotos(queries[2], unsplashKey, PHOTO_RULES.max);
      res.forEach((photo) => addPick(normalizePhotoObject(photo, queries[2], "unsplash_city")));
    }
  }

  // Last resort: curated static fallbacks
  if (picks.length < PHOTO_RULES.min) {
    (FALLBACK_PHOTOS[elementKey] || []).forEach((url) =>
      addPick(normalizePhotoObject(url, "fallback", "fallback_curated", true))
    );
  }

  return picks.slice(0, PHOTO_RULES.target);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildNeighborhoodVibeData — computes per-element scores + fetches photos.
 *
 * poiCounts (optional): real counts from fetchOverpassPOIs. When provided,
 * scores for all elements except street_feel are derived from real OSM data.
 * Falls back to Gemini-attribute formula when null.
 */
async function buildNeighborhoodVibeData({ city, neighborhoodName, attributes, tags, vibeLong, hotelCount, unsplashKey, poiCounts = null, cityMaxCounts = null, bbox = null, googlePlacesKey = null }) {
  const { scores, shopsSubscores } = computeElementScores(attributes, tags, vibeLong, poiCounts, cityMaxCounts);
  const vibeElements = {};
  const vibePhotos = {};

  for (const element of ELEMENTS) {
    const key = element.key;
    vibeElements[key] = buildElementPayload(
      key,
      scores[key] || 0,
      neighborhoodName,
      hotelCount || 0,
      key === "shops" ? shopsSubscores : null,
      poiCounts,
    );
    vibePhotos[key] = await fetchElementPhotos(city, neighborhoodName, key, unsplashKey, bbox, googlePlacesKey);
  }

  return { vibeElements, vibePhotos };
}

module.exports = {
  ELEMENTS,
  PHOTO_RULES,
  POI_CATEGORIES,
  fetchOverpassPOIs,
  computeCityMaxCounts,
  buildNeighborhoodVibeData,
};
