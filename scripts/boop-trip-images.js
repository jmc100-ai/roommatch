/**
 * City-specific Boop wizard images for "Have you been to this city before?"
 *
 * Slots:
 *   first  — iconic landmark (clear, recognizable)
 *   repeat — wide city skyline / panorama
 *   expert — trendy neighbourhood street with cafés
 *
 * Selection order per slot: Google Places text search → Unsplash (city-disambiguated)
 * → static fallbacks (Mexico City hand-picks are the quality bar).
 */

const { photoSearchCityPhrase } = require("./neighborhood-vibe-data");

async function fetchUnsplashPhotos(query, unsplashKey, perPage = 8) {
  if (!unsplashKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${unsplashKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_MEDIA_BASE = "https://places.googleapis.com/v1";

const CHAIN_BLOCKLIST = new Set([
  "starbucks", "mcdonald's", "mcdonalds", "dunkin", "costa coffee", "pret a manger",
  "oxxo", "7-eleven", "subway", "burger king", "walmart", "costco",
]);

/** Static fallbacks when APIs miss (relative paths are Mexico City hand-picks). */
const STATIC_FALLBACKS = {
  first: "https://images.unsplash.com/photo-1521216774850-01bc1c5fe0da?auto=format&fit=crop&w=1200&q=80",
  repeat: "images/wizard/trip-been-before.png",
  expert: "images/wizard/trip-know-well.png",
};

/**
 * Curated search plans — tuned against Mexico City litmus assets in client/images/wizard/.
 */
const CITY_CURATED = {
  "mexico city": {
    first: {
      google: [
        "Monumento a la Independencia Mexico City",
        "Angel de la Independencia CDMX",
        "Palacio de Bellas Artes Mexico City",
      ],
      unsplash: [
        "Angel of Independence Mexico City landmark",
        "Palacio de Bellas Artes Mexico City",
      ],
    },
    repeat: {
      google: [
        "Mexico City skyline panoramic aerial view",
        "Ciudad de Mexico vista panoramica skyline",
        "Paseo de la Reforma Mexico City skyline wide",
        "Chapultepec Castle Mexico City city view panorama",
      ],
      unsplash: [
        "Mexico City skyline aerial panorama CDMX",
        "Mexico City cityscape from above wide",
        "Ciudad de Mexico skyline night panoramic",
        "Mexico City downtown skyline drone view",
      ],
    },
    expert: {
      trendyNbhd: "Roma Norte",
      center: { lat: 19.4167, lng: -99.1625 },
      google: [
        "Cafe street Calle Orizaba Roma Norte Mexico City",
        "Roma Norte Mexico City cafe terrace sidewalk",
        "Condesa Mexico City cafe street trees",
      ],
      unsplash: [
        "Roma Norte Mexico City cafe street",
        "Condesa Mexico City sidewalk cafes",
      ],
      nearbyTypes: ["cafe", "coffee_shop"],
    },
  },
  paris: {
    first: {
      google: [
        "Tour Eiffel Paris",
        "Eiffel Tower Paris France",
        "Notre-Dame de Paris cathedral",
      ],
      unsplash: [
        "Eiffel Tower Paris landmark",
        "Notre Dame cathedral Paris France",
      ],
    },
    repeat: {
      google: [
        "Paris skyline panoramic aerial view",
        "Montmartre Sacré-Cœur Paris city panorama",
        "Seine river Paris skyline wide view",
        "Parc de Belleville Paris skyline view",
      ],
      unsplash: [
        "Paris skyline aerial panorama France",
        "Paris cityscape from above wide angle",
        "Paris France skyline sunset panoramic",
      ],
    },
    expert: {
      trendyNbhd: "Le Marais",
      center: { lat: 48.8566, lng: 2.3622 },
      google: [
        "Rue des Rosiers cafe Paris",
        "Le Marais Paris cafe street",
        "Saint-Germain-des-Prés cafe terrace Paris",
      ],
      unsplash: [
        "Le Marais Paris cafe street",
        "Saint-Germain cafe terrace Paris France",
      ],
      nearbyTypes: ["cafe", "coffee_shop"],
    },
  },
  "kuala lumpur": {
    first: {
      google: ["Petronas Towers Kuala Lumpur", "KLCC Kuala Lumpur landmark"],
      unsplash: ["Petronas Towers Kuala Lumpur Malaysia"],
    },
    repeat: {
      google: [
        "Kuala Lumpur skyline panoramic aerial",
        "KLCC park Kuala Lumpur skyline view",
      ],
      unsplash: [
        "Kuala Lumpur skyline aerial panorama Malaysia",
        "Kuala Lumpur cityscape night wide",
      ],
    },
    expert: {
      trendyNbhd: "Bangsar",
      center: { lat: 3.1289, lng: 101.6748 },
      google: ["Bangsar cafe street Kuala Lumpur", "Jalan Telawi cafe Kuala Lumpur"],
      unsplash: ["Bangsar Kuala Lumpur cafe street"],
      nearbyTypes: ["cafe", "coffee_shop"],
    },
  },
};

const CITY_COORDS = {
  "mexico city": [19.4326, -99.1332],
  paris: [48.8566, 2.3522],
  "kuala lumpur": [3.139, 101.6869],
  london: [51.5074, -0.1278],
  "new york": [40.7128, -74.006],
  "new york city": [40.7128, -74.006],
  barcelona: [41.3851, 2.1734],
  rome: [41.9028, 12.4964],
  tokyo: [35.6762, 139.6503],
};

function normalizeCityKey(city) {
  return String(city || "").trim().toLowerCase();
}

function cityCenter(city, lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const ck = normalizeCityKey(city);
  const c = CITY_COORDS[ck];
  if (c) return { lat: c[0], lng: c[1] };
  return null;
}

function cityBbox(center, radiusDeg = 0.14) {
  if (!center) return null;
  return {
    lat_min: center.lat - radiusDeg,
    lat_max: center.lat + radiusDeg,
    lon_min: center.lng - radiusDeg,
    lon_max: center.lng + radiusDeg,
  };
}

function isBlockedPlaceName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return false;
  for (const bad of CHAIN_BLOCKLIST) {
    if (n.includes(bad)) return true;
  }
  if (/\bplayground\b|\bschool\b|\bhospital\b|\bparking\b/i.test(n)) return true;
  return false;
}

/** Score how well a place name reads as a wide city skyline (repeat / "been before"). */
function skylinePlaceNameScore(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return -10;
  let score = 0;
  const positive = [
    "skyline", "panoram", "aerial", "cityscape", "city view", "overview",
    "vista", "lookout", "hill", "castle", "mont", "sacré", "sacred",
    "river", "seine", "bay", "harbor", "harbour", "downtown", "centro",
  ];
  const negative = [
    "viewpoint", "observation", "observatory", "mirador", "deck", "rooftop bar",
    "restaurant", "hotel", "hostel", "museum", "gallery", "mall", "airport",
    "tower viewpoint", "torre latino", "latin american tower", "revolving",
    "cafe", "café", "coffee", "starbucks", "bar ", "club", "gym", "spa",
    "memorial", "monument", "statue", "church", "cathedral", "temple",
    "eiffel", "arc de triomphe", "notre-dame", "angel de la independencia",
  ];
  for (const p of positive) if (n.includes(p)) score += 2;
  for (const bad of negative) if (n.includes(bad)) score -= 5;
  // Single named tower/landmark (not a city-wide vista POI).
  if (/\btower\b|\btorre\b/.test(n) && !n.includes("hill")) score -= 4;
  return score;
}

function isPoorSkylinePlaceName(name) {
  return skylinePlaceNameScore(name) < 0;
}

async function fetchPlacesPhotoUrl(photoName, placesKey, maxWidth = 1200) {
  try {
    const res = await fetch(
      `${PLACES_MEDIA_BASE}/${photoName}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.photoUri || null;
  } catch {
    return null;
  }
}

async function googlePhotoFromTextQuery(textQuery, placesKey, pickOpts = {}) {
  if (!placesKey || !textQuery) return null;
  const skylineMode = pickOpts.slot === "repeat";
  let best = null;
  let bestScore = skylineMode ? -999 : 0;
  try {
    const res = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": placesKey,
        "X-Goog-FieldMask": "places.displayName,places.photos,places.types",
      },
      body: JSON.stringify({ textQuery, maxResultCount: skylineMode ? 12 : 8 }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const place of data.places || []) {
      const name = place.displayName?.text || "";
      if (isBlockedPlaceName(name)) continue;
      if (skylineMode && isPoorSkylinePlaceName(name)) continue;
      if (!place.photos?.length) continue;
      const url = await fetchPlacesPhotoUrl(place.photos[0].name, placesKey);
      if (!url) continue;
      const hit = {
        url,
        source: "google_places",
        query: textQuery,
        placeName: name,
      };
      if (!skylineMode) return hit;
      const sc = skylinePlaceNameScore(name);
      if (sc > bestScore) {
        bestScore = sc;
        best = hit;
      }
    }
    if (skylineMode && best && bestScore >= 0) return best;
    if (skylineMode) return null;
  } catch {
    return null;
  }
  return null;
}

/** Try several text queries; keep the best skyline-scored place across all results. */
async function googleSkylinePhotoFromQueries(queries, placesKey) {
  let best = null;
  let bestScore = -999;
  for (const q of queries) {
    const hit = await googlePhotoFromTextQuery(q, placesKey, { slot: "repeat" });
    if (!hit) continue;
    const sc = skylinePlaceNameScore(hit.placeName);
    if (sc > bestScore) {
      bestScore = sc;
      best = hit;
    }
  }
  return best && bestScore >= 0 ? best : null;
}

async function googlePhotoFromNearby(center, types, placesKey, radiusM = 900) {
  if (!placesKey || !center || !types?.length) return null;
  try {
    const res = await fetch(PLACES_NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": placesKey,
        "X-Goog-FieldMask": "places.displayName,places.photos",
      },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: 12,
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusM,
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const place of data.places || []) {
      const name = place.displayName?.text || "";
      if (isBlockedPlaceName(name)) continue;
      if (!place.photos?.length) continue;
      const url = await fetchPlacesPhotoUrl(place.photos[0].name, placesKey);
      if (!url) continue;
      return {
        url,
        source: "google_places",
        query: `nearby:${types.join(",")}`,
        placeName: name,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function unsplashPhotoFromQueries(queries, unsplashKey) {
  if (!unsplashKey) return null;
  for (const q of queries) {
    const results = await fetchUnsplashPhotos(q, unsplashKey, 5);
    const photo = results.find((p) => p?.urls?.regular);
    if (!photo) continue;
    return {
      url: photo.urls.regular,
      source: "unsplash",
      query: q,
      placeName: null,
    };
  }
  return null;
}

function genericQueries(slotId, cityPhrase) {
  const templates = {
    first: [
      `${cityPhrase} iconic landmark monument`,
      `${cityPhrase} famous landmark tourist attraction`,
      `${cityPhrase} historic monument plaza`,
    ],
    repeat: [
      `${cityPhrase} skyline aerial panorama`,
      `${cityPhrase} cityscape from above wide`,
      `${cityPhrase} downtown skyline bird eye view`,
      `${cityPhrase} panoramic city view skyline`,
    ],
    expert: [
      `${cityPhrase} trendy neighborhood cafe street`,
      `${cityPhrase} cafe terrace sidewalk street`,
      `${cityPhrase} local cafe district street life`,
    ],
  };
  return templates[slotId] || [];
}

async function resolveRepeatSlot(city, opts = {}) {
  const { placesKey, unsplashKey } = opts;
  const ck = normalizeCityKey(city);
  const phrase = photoSearchCityPhrase(city);
  const curated = CITY_CURATED[ck]?.repeat;

  const unsplashList = [
    ...(curated?.unsplash || []),
    ...genericQueries("repeat", phrase),
  ];
  const us = await unsplashPhotoFromQueries(unsplashList, unsplashKey);
  if (us) return { slot: "repeat", ...us };

  if (placesKey) {
    const googleList = [
      ...(curated?.google || []),
      ...genericQueries("repeat", phrase),
    ];
    const g = await googleSkylinePhotoFromQueries(googleList, placesKey);
    if (g) return { slot: "repeat", ...g };
  }

  return {
    slot: "repeat",
    url: STATIC_FALLBACKS.repeat || null,
    source: "static",
    query: null,
    placeName: null,
  };
}

async function resolveSlot(slotId, city, opts = {}) {
  if (slotId === "repeat") return resolveRepeatSlot(city, opts);

  const { placesKey, unsplashKey, lat, lng } = opts;
  const ck = normalizeCityKey(city);
  const phrase = photoSearchCityPhrase(city);
  const curated = CITY_CURATED[ck]?.[slotId];
  const center = curated?.center || cityCenter(city, lat, lng);

  if (placesKey) {
    for (const q of curated?.google || []) {
      const hit = await googlePhotoFromTextQuery(q, placesKey);
      if (hit) return { slot: slotId, ...hit };
    }
    if (slotId === "expert" && curated?.nearbyTypes && center) {
      const hit = await googlePhotoFromNearby(center, curated.nearbyTypes, placesKey, 750);
      if (hit) return { slot: slotId, ...hit };
    }
    for (const q of genericQueries(slotId, phrase)) {
      const hit = await googlePhotoFromTextQuery(q, placesKey);
      if (hit) return { slot: slotId, ...hit };
    }
  }

  const unsplashList = [
    ...(curated?.unsplash || []),
    ...genericQueries(slotId, phrase),
  ];
  const us = await unsplashPhotoFromQueries(unsplashList, unsplashKey);
  if (us) return { slot: slotId, ...us };

  return {
    slot: slotId,
    url: STATIC_FALLBACKS[slotId] || null,
    source: "static",
    query: null,
    placeName: null,
  };
}

/**
 * @returns {Promise<{ first: object, repeat: object, expert: object, city: string }>}
 */
async function fetchTripWizardImages(city, opts = {}) {
  const resolvedCity = String(city || "").trim();
  if (!resolvedCity) {
    throw new Error("city required");
  }
  const [first, repeat, expert] = await Promise.all([
    resolveSlot("first", resolvedCity, opts),
    resolveSlot("repeat", resolvedCity, opts),
    resolveSlot("expert", resolvedCity, opts),
  ]);
  return {
    city: resolvedCity,
    images: {
      first: first.url,
      repeat: repeat.url,
      expert: expert.url,
    },
    meta: { first, repeat, expert },
  };
}

/** Mexico City litmus — URLs we expect to be city-appropriate (not pixel-equal). */
const LITMUS_MEXICO_CITY = {
  first: STATIC_FALLBACKS.first,
  repeat: STATIC_FALLBACKS.repeat,
  expert: STATIC_FALLBACKS.expert,
};

module.exports = {
  fetchTripWizardImages,
  STATIC_FALLBACKS,
  LITMUS_MEXICO_CITY,
  CITY_CURATED,
  photoSearchCityPhrase,
};
