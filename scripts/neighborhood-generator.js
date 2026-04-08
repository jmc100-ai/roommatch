/**
 * neighborhood-generator.js — shared module
 * Generates neighborhood cards (with Gemini) and Unsplash photos for any indexed city.
 * Imported by both server.js and index-city.js — no circular deps.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const { buildNeighborhoodVibeData, fetchOverpassPOIs, computeCityMaxCounts } = require("./neighborhood-vibe-data");

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

async function fetchNeighborhoodPhoto(name, city, unsplashKey, vibeShort = "", tags = []) {
  if (!unsplashKey) return null;

  const simpleName = name.replace(/\s*\([^)]*\)/g, "").trim();
  const vibeTerms  = vibeVisualTerms(vibeShort);
  const tagTerms   = (tags || []).slice(0, 2)
    .map(t => TAG_VISUAL[t] || t)
    .join(" ")
    .split(/\s+/).slice(0, 4).join(" ");

  // Strategy: start with bare name+city (highest specificity, least noise).
  // Then try name alone — many Unsplash photographers don't tag city.
  // Vibe/tag terms are added later as tiebreakers, not lead queries.
  // City-level fallbacks last.
  const queries = [
    `${simpleName} ${city}`,                                         // name + city, no extra noise
    simpleName,                                                       // name alone (global coverage)
    tagTerms   ? `${simpleName} ${tagTerms}`             : null,    // name + tag visuals (no city)
    vibeTerms  ? `${simpleName} ${city} ${vibeTerms}`   : null,    // name + city + vibe
    tagTerms   ? `${city} ${tagTerms}`                   : null,    // city + vibe (broader)
    `${city} street neighborhood`,                                    // last-resort city generic
  ].filter(Boolean).filter((q, i, arr) => arr.indexOf(q) === i); // dedupe

  for (const query of queries) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
      const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` } });
      if (!res.ok) continue;
      const data  = await res.json();
      // Pick the result with the most downloads (most authoritative photo for the query)
      const photo = (data.results || []).sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
      if (!photo) continue;
      return {
        url:          photo.urls.regular,
        photographer: photo.user.name,
        profile_url:  photo.user.links.html,
        query_used:   query,
      };
    } catch { continue; }
  }
  return null;
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
async function generateNeighborhoods(city, db, geminiKey, unsplashKey) {
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
  // (Unsplash + hotel_count are fine in parallel, only Overpass needs spacing)
  const rows = [];
  for (const item of items) {
    const bbox = item.bbox || {};

    // Fetch Unsplash photo (non-fatal if it fails)
    let photoUrl    = null;
    let photoCredit = null;
    const photo = await fetchNeighborhoodPhoto(item.name, city, unsplashKey, item.vibe_short, item.tags).catch(() => null);
    if (photo) {
      photoUrl    = photo.url;
      photoCredit = { photographer: photo.photographer, profile_url: photo.profile_url };
    }

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
      photo_url:    photoUrl,
      photo_credit: photoCredit,
      hotel_count:  hotelCount,
      _poiCounts:   poiCounts, // transient — used below, not persisted as top-level column
    });
  }

  // Fallback photo from hotels_cache for rows that got no Unsplash photo
  const noPhotoRows = rows.filter(r => !r.photo_url);
  if (noPhotoRows.length > 0) {
    const { data: fallbackPhotos } = await db
      .from("hotels_cache")
      .select("main_photo, lat, lng")
      .eq("city", city)
      .not("main_photo", "is", null)
      .not("lat", "is", null)
      .order("star_rating", { ascending: false })
      .limit(100);

    // Track which fallback photos have been used to avoid duplicates
    const usedPhotos = new Set();

    for (const row of noPhotoRows) {
      if (!fallbackPhotos?.length) break;
      const bbox = row.bbox;
      // Try bbox-matched hotel photo first
      let match = null;
      if (bbox?.lat_min != null) {
        const { lat_min, lat_max, lon_min, lon_max } = bbox;
        match = fallbackPhotos.find(h =>
          !usedPhotos.has(h.main_photo) &&
          h.lat >= lat_min && h.lat <= lat_max && h.lng >= lon_min && h.lng <= lon_max
        );
      }
      // Fallback: any unused top-rated city hotel photo
      if (!match) {
        match = fallbackPhotos.find(h => !usedPhotos.has(h.main_photo));
      }
      if (match) {
        row.photo_url = match.main_photo;
        usedPhotos.add(match.main_photo);
      }
    }
  }

  // Compute city-level POI maximums for per-city score normalisation.
  // Only uses rows that have real Overpass counts.
  const allPoiCounts = rows.map((r) => r._poiCounts).filter(Boolean);
  const cityMaxCounts = allPoiCounts.length > 0 ? computeCityMaxCounts(allPoiCounts) : null;
  if (cityMaxCounts) {
    console.log(`[neighborhoods] city max counts for ${city}: ${JSON.stringify(cityMaxCounts)}`);
  }

  // Compute per-element vibe payloads and photos.
  // Kept sequential per row to avoid exploding external API concurrency.
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
      });
      row.vibe_elements = vibeData.vibeElements;
      row.vibe_photos = vibeData.vibePhotos;
      row.vibe_data_version = "v1";
      row.vibe_last_computed_at = new Date().toISOString();
    } catch (e) {
      console.warn(`[neighborhoods] vibe data generation failed for ${city}/${row.name}: ${e.message}`);
      row.vibe_elements = {};
      row.vibe_photos = {};
      row.vibe_data_version = "v1";
      row.vibe_last_computed_at = new Date().toISOString();
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
async function backfillNeighborhoodPhotos(city, db, unsplashKey) {
  if (!unsplashKey) throw new Error("UNSPLASH_KEY not set");

  const { data: rows, error } = await db
    .from("neighborhoods")
    .select("id, name, vibe_short, tags, bbox")
    .eq("city", city)
    .order("id");

  if (error) throw new Error(`load neighborhoods failed: ${error.message}`);
  if (!rows?.length) return 0;

  let updated = 0;
  for (const row of rows) {
    const photo = await fetchNeighborhoodPhoto(
      row.name, city, unsplashKey, row.vibe_short || "", row.tags || []
    ).catch(() => null);

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
        console.log(`[photos] ${row.name} → ${photo.query_used}`);
        updated++;
      }
    } else {
      console.warn(`[photos] no Unsplash result for ${row.name} (${city})`);
    }
  }
  return updated;
}

/**
 * recomputeNeighborhoodVibes — refresh vibe elements/photos for existing rows.
 * Uses stored poi_counts from attributes when present; re-fetches from Overpass
 * when missing so older rows are automatically enriched on first recompute.
 */
async function recomputeNeighborhoodVibes(city, db, unsplashKey) {
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

  // Compute city-level maximums from all stored counts for per-city normalisation
  const allPoiCounts = rows.map((r) => r.attributes?.poi_counts).filter(Boolean);
  const cityMaxCounts = allPoiCounts.length > 0 ? computeCityMaxCounts(allPoiCounts) : null;
  if (cityMaxCounts) {
    console.log(`[recompute] city max counts for ${city}: ${JSON.stringify(cityMaxCounts)}`);
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
    });
    const { error: upErr } = await db
      .from("neighborhoods")
      .update({
        vibe_elements: vibeData.vibeElements,
        vibe_photos: vibeData.vibePhotos,
        vibe_data_version: "v1",
        vibe_last_computed_at: new Date().toISOString(),
      })
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
