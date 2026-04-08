/**
 * neighborhood-generator.js — shared module
 * Generates neighborhood cards (with Gemini) and Unsplash photos for any indexed city.
 * Imported by both server.js and index-city.js — no circular deps.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const { buildNeighborhoodVibeData, fetchOverpassPOIs, computeCityMaxCounts, bboxAreaKm2 } = require("./neighborhood-vibe-data");

// Canonical Gemini prompt for neighborhood generation
function buildNeighborhoodPrompt(city) {
  return `Act as a local travel expert with deep knowledge of hotel neighborhoods.

For ${city}, return the top 7 neighborhoods where travelers typically stay.
Include a mix of areas for first-time visitors AND returning travelers who want to go deeper.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences, just the array.

Each item must follow this exact structure:
{
  "name": "Le Marais",
  "bbox": { "lat_min": 48.851, "lat_max": 48.865, "lon_min": 2.348, "lon_max": 2.365 },
  "vibe_short": "Historic, artsy, buzzing café scene",
  "vibe_long": "One of Paris's most atmospheric quarters, Le Marais blends medieval architecture with cutting-edge galleries and some of the city's best falafel. Ideal for first-timers who want to feel immersed in Parisian street life without venturing far from the Louvre.",
  "visitor_type": "first-timer",
  "tags": ["walkable", "historic", "artsy", "nightlife"],
  "walkability_dining": "excellent",
  "walkability_tourist_spots": "excellent",
  "green_spaces": "some",
  "skyline_character": "low-rise historic",
  "street_energy": "lively",
  "transport_dependency": "low"
}

Field rules:
- bbox: approximate decimal degree bounds, accurate to ~500m; format is lat_min/lat_max/lon_min/lon_max
- vibe_short: max 6 words, comma-separated — punchy and vivid (no more than 6 words total)
- vibe_long: exactly 2 sentences — first describes character, second says who it's ideal for
- visitor_type: "first-timer" | "returning" | "both"
- tags: 3-5 values from: walkable, nightlife, historic, artsy, family, luxury, local-feel,
  beachfront, business, quiet, green, romantic, foodie, shopping
- walkability_dining: "excellent" | "good" | "limited"
- walkability_tourist_spots: "excellent" | "good" | "limited"
- green_spaces: "lots" | "some" | "minimal"
- skyline_character: "low-rise historic" | "modern high-rise" | "mixed" | "tree-lined"
- street_energy: "lively" | "moderate" | "quiet"
- transport_dependency: "low" | "medium" | "high"`;
}

async function callGemini(prompt, geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
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
  green:      "park trees leafy",
  foodie:     "restaurant terrace outdoor dining",
  nightlife:  "bar nightlife neon",
  shopping:   "boutique shops street",
  romantic:   "romantic cobblestone evening",
  luxury:     "luxury upscale elegant",
  quiet:      "quiet residential street",
  "local-feel": "local market street life",
  family:     "family park playground",
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
async function fetchGooglePlacesHeroPhoto(name, city, bbox, placesKey) {
  if (!placesKey) return null;
  const simpleName = name.replace(/\s*\([^)]*\)/g, "").trim();

  // ── Strategy 1: nearby landmark search within bbox ─────────────────────────
  if (bbox?.lat_min != null) {
    const centerLat = (bbox.lat_min + bbox.lat_max) / 2;
    const centerLng = (bbox.lon_min + bbox.lon_max) / 2;
    // Use half the diagonal of the bbox as radius, cap at 2 km
    const latSpan = bbox.lat_max - bbox.lat_min;
    const lonSpan = bbox.lon_max - bbox.lon_min;
    const radiusM = Math.min(2000, Math.round(Math.sqrt(latSpan ** 2 + lonSpan ** 2) * 111000 / 2));

    for (const types of HERO_NEARBY_TYPES) {
      try {
        const res = await fetch(PLACES_NEARBY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": placesKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
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
          "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
        },
        body: JSON.stringify({ textQuery, maxResultCount: 5 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      for (const place of (data.places || [])) {
        if (!place.photos?.length) continue;
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
async function fetchNeighborhoodPhoto(name, city, unsplashKey, vibeShort = "", tags = [], bbox = null, googlePlacesKey = null) {
  // 1. Try Google Places first (geo-accurate real neighbourhood photos)
  if (googlePlacesKey) {
    const placesPhoto = await fetchGooglePlacesHeroPhoto(name, city, bbox, googlePlacesKey).catch(() => null);
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

// Categories that make visually distinctive heroes — ranked by preference.
// Tier 1 (landmark/cultural) beats Tier 2 (food/green) beats Tier 3 (retail).
const HERO_CATEGORY_TIER = {
  icon_spots:  1,  // landmarks & monuments — always preferred for hero
  parks:       2,
  museums:     2,
  cafes:       3,
  restaurants: 3,
  shops:       4,
  street_feel: 4,
};

/**
 * pickHeroFromVibePhotos — derive the hero photo from the top-N scoring vibe
 * element categories.  The top-scoring categories represent what the neighbourhood
 * is actually known for (icon_spots for Centro Histórico, cafes for Roma Norte, etc.)
 * and their photos come from the Google Places nearby search so they are geo-accurate.
 *
 * Within the top-N pool, prefer lower-tier (more visually distinctive) categories.
 * Prefers non-fallback (real) photos; falls back to curated statics only as last resort.
 * Returns null if vibePhotos has no usable entries.
 */
function pickHeroFromVibePhotos(vibeElements, vibePhotos, topN = 4) {
  if (!vibeElements || !vibePhotos) return null;

  // Sort elements by score descending, keep only those that have at least one photo
  const ranked = Object.entries(vibeElements)
    .filter(([key]) => Array.isArray(vibePhotos[key]) && vibePhotos[key].length > 0)
    .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0))
    .slice(0, topN);

  if (ranked.length === 0) return null;

  // Within the pool, pick photos from the best-tier category that has real photos.
  // e.g. if top-4 is [restaurants, shops, icon_spots, parks] we pick from icon_spots first.
  const bestTier = Math.min(...ranked.map(([key]) => HERO_CATEGORY_TIER[key] || 99));
  const preferredKeys = ranked
    .filter(([key]) => (HERO_CATEGORY_TIER[key] || 99) === bestTier)
    .map(([key]) => key);

  const realPool = preferredKeys.flatMap(key =>
    (vibePhotos[key] || []).filter(p => p?.url && !p.is_fallback)
  );

  // Widen to all top-N if preferred tier has no real photos
  const fallbackPool = ranked.flatMap(([key]) =>
    (vibePhotos[key] || []).filter(p => p?.url && !p.is_fallback)
  );
  const pool = (realPool.length > 0 ? realPool : fallbackPool.length > 0 ? fallbackPool : null)
    ?? ranked.flatMap(([key]) => (vibePhotos[key] || []).filter(p => p?.url));

  if (pool.length === 0) return null;

  const pick    = pool[Math.floor(Math.random() * pool.length)];
  const topKeys = ranked.map(([key]) => key).join(",");
  console.log(`[photos] hero from top vibes [${topKeys}] tier=${bestTier}: ${pick.source || "?"} — ${pick.query}`);
  return {
    url:          pick.url,
    photographer: pick.attribution?.photographer || "Google Maps contributor",
    profile_url:  pick.attribution?.profile_url  || null,
    query_used:   `vibe_pick:${pick.query || pick.source || "unknown"}`,
    source:       pick.source || "google_places",
  };
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

/**
 * generateNeighborhoods — calls Gemini, fetches Unsplash photos, upserts to DB.
 * Returns array of neighborhood rows.
 */
async function generateNeighborhoods(city, db, geminiKey, unsplashKey, googlePlacesKey = null) {
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

  // Process sequentially to stay within Overpass fair-use rate limits
  const rows = [];
  for (const item of items) {
    const bbox = item.bbox || {};

    // Hotel count (skip if no lat/lng backfill done yet)
    let hotelCount = 0;
    if (bbox.lat_min != null) {
      hotelCount = await getHotelCountForBbox(city, bbox, db);
      // Widen bbox by 0.01° if no hotels found (covers sparse backfill)
      if (hotelCount === 0) {
        const widened = {
          lat_min: bbox.lat_min - 0.01, lat_max: bbox.lat_max + 0.01,
          lon_min: bbox.lon_min - 0.01, lon_max: bbox.lon_max + 0.01,
        };
        hotelCount = await getHotelCountForBbox(city, widened, db);
      }
    }

    // Fetch real POI counts from Overpass — 3s gap before each call
    let poiCounts = null;
    if (bbox.lat_min != null) {
      await new Promise((r) => setTimeout(r, 3000));
      poiCounts = await fetchOverpassPOIs(bbox).catch((e) => {
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
      transport_dependency:      item.transport_dependency,
      ...(poiCounts ? { poi_counts: poiCounts } : {}),
    };

    rows.push({
      city,
      name:         item.name,
      bbox:         bbox,
      vibe_short:   item.vibe_short,
      vibe_long:    item.vibe_long,
      tags:         item.tags || [],
      visitor_type: item.visitor_type,
      attributes,
      photo_url:    null, // set after vibe photos are computed below
      photo_credit: null,
      hotel_count:  hotelCount,
      _poiCounts:   poiCounts, // transient — used below, not persisted as top-level column
    });
  }

  // Compute city-level peak densities for per-city score normalisation.
  // Uses {counts, areaKm2} pairs so scores reflect POI density not raw counts.
  const allNeighbourhoodData = rows
    .filter(r => r._poiCounts && r.bbox?.lat_min != null)
    .map(r => ({ counts: r._poiCounts, areaKm2: bboxAreaKm2(r.bbox) }));
  const cityMaxCounts = allNeighbourhoodData.length > 0 ? computeCityMaxCounts(allNeighbourhoodData) : null;
  if (cityMaxCounts) {
    console.log(`[neighborhoods] city peak densities for ${city}: ${JSON.stringify(Object.fromEntries(Object.entries(cityMaxCounts).map(([k,v]) => [k, Math.round(v * 10) / 10])))} per km²`);
  }

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
        googlePlacesKey,
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
    const heroPick = pickHeroFromVibePhotos(row.vibe_elements, row.vibe_photos);
    if (heroPick) {
      row.photo_url    = heroPick.url;
      row.photo_credit = { photographer: heroPick.photographer, profile_url: heroPick.profile_url, query_used: heroPick.query_used };
    } else {
      // Last resort: fetch directly (Places nearby → Unsplash)
      const photo = await fetchNeighborhoodPhoto(row.name, city, unsplashKey, row.vibe_short, row.tags, row.bbox, googlePlacesKey).catch(() => null);
      if (photo) {
        row.photo_url    = photo.url;
        row.photo_credit = { photographer: photo.photographer, profile_url: photo.profile_url, query_used: photo.query_used };
      }
    }

    // Remove transient field — not a DB column
    delete row._poiCounts;
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
async function backfillNeighborhoodPhotos(city, db, unsplashKey, googlePlacesKey = null) {
  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, name, vibe_short, tags, bbox, vibe_elements, vibe_photos")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  let updated = 0;
  for (const row of rows) {
    // Primary: pick hero from top-scoring vibe elements (no extra API call)
    let photo = pickHeroFromVibePhotos(row.vibe_elements, row.vibe_photos);

    // Fallback: fetch directly via Places / Unsplash
    if (!photo) {
      if (!unsplashKey && !googlePlacesKey) {
        console.warn(`[photos] no vibe photos and no API keys for ${row.name} — skipping`);
        continue;
      }
      photo = await fetchNeighborhoodPhoto(
        row.name, city, unsplashKey, row.vibe_short || "", row.tags || [], row.bbox || null, googlePlacesKey
      ).catch(() => null);
    }

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
async function recomputeNeighborhoodVibes(city, db, unsplashKey, googlePlacesKey = null) {
  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, city, name, bbox, vibe_long, tags, attributes, hotel_count")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  // Always re-fetch Overpass counts (sequential, 3s gap) so any query changes
  // (e.g. parks node→way fix) propagate without a separate migration step.
  for (const row of rows) {
    if (row.bbox?.lat_min != null) {
      await new Promise((r) => setTimeout(r, 3000));
      const fetched = await fetchOverpassPOIs(row.bbox).catch((e) => {
        console.warn(`[recompute] Overpass failed for ${row.name}: ${e.message}`);
        return null;
      });
      if (fetched) {
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
    .map(r => ({ counts: r.attributes.poi_counts, areaKm2: bboxAreaKm2(r.bbox) }));
  const cityMaxCounts = allNeighbourhoodData.length > 0 ? computeCityMaxCounts(allNeighbourhoodData) : null;
  if (cityMaxCounts) {
    console.log(`[recompute] city peak densities for ${city}: ${JSON.stringify(Object.fromEntries(Object.entries(cityMaxCounts).map(([k,v]) => [k, Math.round(v * 10) / 10])))} per km²`);
  }

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
      googlePlacesKey,
    });
    // Derive hero photo from top-scoring vibe elements
    const heroPick = pickHeroFromVibePhotos(vibeData.vibeElements, vibeData.vibePhotos);

    const updatePayload = {
      vibe_elements: vibeData.vibeElements,
      vibe_photos:   vibeData.vibePhotos,
      vibe_data_version:    "v1",
      vibe_last_computed_at: new Date().toISOString(),
    };
    if (heroPick) {
      updatePayload.photo_url    = heroPick.url;
      updatePayload.photo_credit = { photographer: heroPick.photographer, profile_url: heroPick.profile_url, query_used: heroPick.query_used };
    }

    const { error: upErr } = await db
      .from("neighborhoods")
      .update(updatePayload)
      .eq("id", row.id);
    if (upErr) throw new Error(`update ${row.name} failed: ${upErr.message}`);
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
    .select("id, name, bbox")
    .eq("city", city);

  if (error || !hoods?.length) return;

  await Promise.all(hoods.map(async (hood) => {
    const bbox = hood.bbox;
    if (!bbox?.lat_min) return;
    const count = await getHotelCountForBbox(city, bbox, db);
    await db.from("neighborhoods").update({ hotel_count: count }).eq("id", hood.id);
  }));

  console.log(`[neighborhoods] hotel_count refreshed for ${city} (${hoods.length} neighborhoods)`);
}

module.exports = { generateNeighborhoods, refreshHotelCounts, recomputeNeighborhoodVibes, backfillNeighborhoodPhotos };
