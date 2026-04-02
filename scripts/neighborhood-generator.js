/**
 * neighborhood-generator.js — shared module
 * Generates neighborhood cards (with Gemini) and Unsplash photos for any indexed city.
 * Imported by both server.js and index-city.js — no circular deps.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";

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

async function fetchNeighborhoodPhoto(name, city, unsplashKey) {
  if (!unsplashKey) return null;
  const query = `${name} ${city} neighborhood street`;
  const url   = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` } });
    if (!res.ok) return null;
    const data  = await res.json();
    const photo = data.results?.[0];
    if (!photo) return null;
    return {
      url:          photo.urls.regular,
      photographer: photo.user.name,
      profile_url:  photo.user.links.html,
    };
  } catch { return null; }
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

  // Process in parallel: Unsplash + hotel_count
  const rows = await Promise.all(items.map(async (item) => {
    const bbox = item.bbox || {};

    // Fetch Unsplash photo (non-fatal if it fails)
    let photoUrl    = null;
    let photoCredit = null;
    const photo = await fetchNeighborhoodPhoto(item.name, city, unsplashKey).catch(() => null);
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

    // Pack dimension scores into attributes JSONB
    const attributes = {
      walkability_dining:        item.walkability_dining,
      walkability_tourist_spots: item.walkability_tourist_spots,
      green_spaces:              item.green_spaces,
      skyline_character:         item.skyline_character,
      street_energy:             item.street_energy,
      transport_dependency:      item.transport_dependency,
    };

    return {
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
    };
  }));

  // Fallback photo from hotels_cache for rows that got no Unsplash photo
  const noPhotoRows = rows.filter(r => !r.photo_url && r.bbox?.lat_min != null);
  if (noPhotoRows.length > 0) {
    const { data: fallbackPhotos } = await db
      .from("hotels_cache")
      .select("main_photo, lat, lng")
      .eq("city", city)
      .not("main_photo", "is", null)
      .not("lat", "is", null)
      .order("star_rating", { ascending: false })
      .limit(50);

    for (const row of noPhotoRows) {
      if (!fallbackPhotos?.length) break;
      const { lat_min, lat_max, lon_min, lon_max } = row.bbox;
      const match = fallbackPhotos.find(h =>
        h.lat >= lat_min && h.lat <= lat_max && h.lng >= lon_min && h.lng <= lon_max && h.main_photo
      );
      if (match) row.photo_url = match.main_photo;
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

module.exports = { generateNeighborhoods, refreshHotelCounts };
