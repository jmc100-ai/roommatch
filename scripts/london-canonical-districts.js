/**
 * London hotel-search districts — canonical tourist list (12 areas).
 * Product framing: where a visitor would search for a hotel, not full geographic coverage.
 */

const { getCuratedNeighborhoodFence, HEATHROW_T5, HEATHROW_RADIUS_MI } = require("./neighborhood-fence-overrides");
const { normalizePolygonRing } = require("./neighborhood-vibe-data");
const { isInGeoZone } = require("./geo-index-helpers");

/** @type {Array<{ name: string, bbox?: object, vibe_short: string, vibe_long: string, tags: string[], visitor_type?: string, attributes?: object }>} */
const LONDON_CANONICAL_DISTRICTS = [
  {
    name: "Heathrow",
    vibe_short: "Airport hub, early flights",
    vibe_long: "Hotels near London Heathrow for early departures, long layovers, or flight-first trips. Bath Road and terminal corridors — convenience over sightseeing.",
    tags: ["business"],
    visitor_type: "both",
    attributes: { walkability_dining: "limited", walkability_tourist_spots: "limited", green_spaces: "minimal", skyline_character: "mixed", street_energy: "moderate" },
  },
  {
    name: "Covent Garden",
    bbox: { lat_min: 51.506, lat_max: 51.518, lon_min: -0.129, lon_max: -0.117 },
    vibe_short: "Theatre district, street performers",
    vibe_long: "The West End's liveliest square — theatres, restaurants, and buzzy pedestrian streets. Ideal first-timers who want to be in the action.",
    tags: ["first-timers", "culture", "walkable"],
    visitor_type: "first-timers",
    attributes: { walkability_dining: "excellent", walkability_tourist_spots: "excellent", green_spaces: "some", skyline_character: "historic", street_energy: "lively" },
  },
  {
    name: "Soho",
    bbox: { lat_min: 51.508, lat_max: 51.518, lon_min: -0.140, lon_max: -0.127 },
    vibe_short: "Nightlife, dining, creative edge",
    vibe_long: "London's entertainment core — Chinatown, gay village, indie bars, and late-night energy. For travellers who want the city loud and late.",
    tags: ["nightlife", "foodie", "artsy"],
    visitor_type: "both",
    attributes: { walkability_dining: "excellent", walkability_tourist_spots: "good", green_spaces: "minimal", skyline_character: "mixed", street_energy: "lively" },
  },
  {
    name: "Westminster",
    bbox: { lat_min: 51.493, lat_max: 51.515, lon_min: -0.145, lon_max: -0.115 },
    vibe_short: "Icons, parks, royal London",
    vibe_long: "Big Ben, Westminster Abbey, and St James's Park — the postcard London most first-time visitors expect. Government grandeur and river walks.",
    tags: ["first-timers", "historic", "central"],
    visitor_type: "first-timers",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "excellent", green_spaces: "lots", skyline_character: "historic", street_energy: "moderate" },
  },
  {
    name: "South Bank",
    bbox: { lat_min: 51.498, lat_max: 51.512, lon_min: -0.125, lon_max: -0.105 },
    vibe_short: "Thames views, culture mile",
    vibe_long: "The Tate Modern, London Eye, and riverside promenade — open skies and culture along the Thames. Great for families and gallery lovers.",
    tags: ["culture", "walkable", "first-timers"],
    visitor_type: "first-timers",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "excellent", green_spaces: "some", skyline_character: "modern", street_energy: "moderate" },
  },
  {
    name: "South Kensington",
    bbox: { lat_min: 51.485, lat_max: 51.505, lon_min: -0.195, lon_max: -0.165 },
    vibe_short: "Museums, elegance, Chelsea fringe",
    vibe_long: "Victoria & Albert, Natural History Museum, and refined Victorian streets. Quiet luxury near Hyde Park — includes Chelsea hotel belt.",
    tags: ["culture", "luxury", "family"],
    visitor_type: "first-timers",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "excellent", green_spaces: "lots", skyline_character: "historic", street_energy: "calm" },
  },
  {
    name: "Marylebone",
    bbox: { lat_min: 51.514, lat_max: 51.526, lon_min: -0.160, lon_max: -0.140 },
    vibe_short: "Village calm, boutique charm",
    vibe_long: "Marylebone High Street's independent shops and leafy squares — upscale but relaxed, minutes from Oxford Street without the chaos.",
    tags: ["luxury", "quiet", "returning"],
    visitor_type: "both",
    attributes: { walkability_dining: "excellent", walkability_tourist_spots: "good", green_spaces: "some", skyline_character: "historic", street_energy: "calm" },
  },
  {
    name: "Notting Hill",
    bbox: { lat_min: 51.507, lat_max: 51.524, lon_min: -0.215, lon_max: -0.187 },
    vibe_short: "Colourful streets, market flair",
    vibe_long: "Portobello Road antiques, pastel townhouses, and a village feel in west London. Popular with repeat visitors and style-conscious stays.",
    tags: ["artsy", "returning", "walkable"],
    visitor_type: "returning",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "good", green_spaces: "some", skyline_character: "historic", street_energy: "moderate" },
  },
  {
    name: "Shoreditch",
    bbox: { lat_min: 51.518, lat_max: 51.532, lon_min: -0.085, lon_max: -0.070 },
    vibe_short: "Street art, creative east",
    vibe_long: "East London's trendsetting core — street art, rooftop bars, and warehouse conversions. For travellers who want edgy over iconic.",
    tags: ["artsy", "nightlife", "returning"],
    visitor_type: "returning",
    attributes: { walkability_dining: "excellent", walkability_tourist_spots: "good", green_spaces: "minimal", skyline_character: "mixed", street_energy: "lively" },
  },
  {
    name: "King's Cross",
    bbox: { lat_min: 51.528, lat_max: 51.545, lon_min: -0.130, lon_max: -0.112 },
    vibe_short: "St Pancras, canals, regenerated",
    vibe_long: "King's Cross and St Pancras station hub — Eurostar access, Coal Drops Yard, and canal-side dining. Transit-smart with a design-forward edge.",
    tags: ["central", "business", "walkable"],
    visitor_type: "both",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "good", green_spaces: "some", skyline_character: "modern", street_energy: "moderate" },
  },
  {
    name: "Canary Wharf",
    bbox: { lat_min: 51.498, lat_max: 51.515, lon_min: -0.045, lon_max: -0.005 },
    vibe_short: "Docklands towers, business hub",
    vibe_long: "Modern skyscrapers on the Isle of Dogs — finance district hotels with river views and fast DLR links. Different London, same city.",
    tags: ["business", "luxury"],
    visitor_type: "both",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "limited", green_spaces: "some", skyline_character: "modern", street_energy: "calm" },
  },
  {
    name: "Paddington",
    bbox: { lat_min: 51.512, lat_max: 51.528, lon_min: -0.195, lon_max: -0.168 },
    vibe_short: "Station hub, Hyde Park edge",
    vibe_long: "Paddington Station and the Bayswater hotel belt — practical Heathrow Express access and Hyde Park nearby. Reliable, well-connected base.",
    tags: ["central", "business", "walkable"],
    visitor_type: "both",
    attributes: { walkability_dining: "good", walkability_tourist_spots: "good", green_spaces: "lots", skyline_character: "mixed", street_energy: "moderate" },
  },
];

const LONDON_DISTRICT_NAMES = LONDON_CANONICAL_DISTRICTS.map((d) => d.name);

function bboxAreaSqDeg(bbox) {
  if (bbox?.lat_min == null) return Infinity;
  return (bbox.lat_max - bbox.lat_min) * (bbox.lon_max - bbox.lon_min);
}

function fenceCentroid(bbox) {
  if (bbox?.lat_min == null) return null;
  return { lat: (bbox.lat_min + bbox.lat_max) / 2, lng: (bbox.lon_min + bbox.lon_max) / 2 };
}

function hotelInDistrict(lat, lng, city, district, ng) {
  const curated = getCuratedNeighborhoodFence(city, district.name);
  if (curated?.geoAnchor && curated.geoRadiusMi) {
    return isInGeoZone(lat, lng, curated);
  }
  const bbox = curated?.bbox || district.bbox;
  if (!bbox?.lat_min) return false;
  const ring = ng.bboxToOctagonRing(bbox);
  return ng.hotelInsideResolvedFence(lat, lng, city, district.name, bbox, ring);
}

/**
 * Assign every indexed hotel to exactly one canonical tourist district.
 * In-fence match first (smallest area on overlap); else nearest district centroid.
 */
async function refreshLondonCanonicalHotelCounts(city, db) {
  const ng = require("./neighborhood-generator");
  const hotelRows = await ng.loadCityHotelCoords(city, db);
  const { data: hoods, error } = await db
    .from("neighborhoods")
    .select("id, name, bbox, polygon")
    .eq("city", city);
  if (error) throw new Error(error.message);

  const districtByName = new Map(LONDON_CANONICAL_DISTRICTS.map((d) => [d.name, d]));
  const hoodMeta = (hoods || [])
    .filter((h) => districtByName.has(h.name))
    .map((h) => {
      const district = districtByName.get(h.name);
      const curated = getCuratedNeighborhoodFence(city, h.name);
      const bbox = curated?.bbox || district.bbox || h.bbox;
      return { ...h, district, bbox, area: bboxAreaSqDeg(bbox), centroid: fenceCentroid(bbox) };
    });

  const counts = new Map(hoodMeta.map((h) => [h.id, 0]));
  const byName = {};

  for (const hotel of hotelRows) {
    const { lat, lng } = hotel;
    const matches = hoodMeta.filter((h) => hotelInDistrict(lat, lng, city, h.district, ng));
    let pick = null;
    if (matches.length === 1) {
      pick = matches[0];
    } else if (matches.length > 1) {
      pick = matches.reduce((best, h) => (h.area < best.area ? h : best));
    } else {
      let bestD = Infinity;
      for (const h of hoodMeta) {
        if (!h.centroid) continue;
        const d = (lat - h.centroid.lat) ** 2 + (lng - h.centroid.lng) ** 2;
        if (d < bestD) {
          bestD = d;
          pick = h;
        }
      }
    }
    if (pick) {
      counts.set(pick.id, (counts.get(pick.id) || 0) + 1);
      byName[pick.name] = (byName[pick.name] || 0) + 1;
    }
  }

  for (const h of hoodMeta) {
    const count = counts.get(h.id) || 0;
    const { error: upErr } = await db.from("neighborhoods").update({ hotel_count: count }).eq("id", h.id);
    if (upErr) throw new Error(`hotel_count ${h.name}: ${upErr.message}`);
  }

  const assigned = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(
    `[london-districts] partitioned ${assigned}/${hotelRows.length} hotels across ${hoodMeta.length} tourist districts`,
  );
  return {
    updated: hoodMeta.length,
    hotels: hotelRows.length,
    assigned,
    byName,
    catalog_total: hotelRows.length,
    hotels_in_areas: assigned,
    coverage_pct: hotelRows.length ? assigned / hotelRows.length : 0,
    hood_count: hoodMeta.length,
  };
}

/** Replace all London neighborhood rows with the 12 canonical tourist districts. */
async function rebuildLondonCanonicalDistricts(db, { log = console.log, enrichVibes = false, keys = {} } = {}) {
  const ng = require("./neighborhood-generator");
  const city = "London";

  const { error: delErr } = await db.from("neighborhoods").delete().eq("city", city).eq("manual_override", false);
  if (delErr) throw new Error(`delete neighborhoods: ${delErr.message}`);

  const rows = [];
  for (const district of LONDON_CANONICAL_DISTRICTS) {
    const curated = getCuratedNeighborhoodFence(city, district.name);
    let bbox = curated?.bbox || district.bbox;
    if (!bbox?.lat_min && district.name === "Heathrow") {
      const { bboxEnclosingRadius } = require("./geo-index-helpers");
      bbox = bboxEnclosingRadius(HEATHROW_T5.lat, HEATHROW_T5.lng, HEATHROW_RADIUS_MI);
    }
    if (!bbox?.lat_min) throw new Error(`missing bbox for ${district.name}`);
    const ring = ng.bboxToOctagonRing(bbox);
    rows.push({
      city,
      name: district.name,
      bbox,
      polygon: { ring },
      vibe_short: district.vibe_short,
      vibe_long: district.vibe_long,
      tags: district.tags,
      visitor_type: district.visitor_type || "both",
      attributes: district.attributes || {},
      hotel_count: 0,
    });
  }

  const { error: upErr } = await db.from("neighborhoods").upsert(rows, { onConflict: "city,name" });
  if (upErr) throw new Error(`upsert districts: ${upErr.message}`);
  log(`  rebuilt ${rows.length} canonical London tourist districts`);

  await ng.applyCuratedNeighborhoodFences(city, db);
  const result = await refreshLondonCanonicalHotelCounts(city, db);
  if (enrichVibes) {
    await enrichLondonDistrictVibes(db, keys, { log });
  }
  return result;
}

/** Overpass + photo pipeline for London district cards (run after any rebuild). */
async function enrichLondonDistrictVibes(db, keys = {}, { log = console.log } = {}) {
  const ng = require("./neighborhood-generator");
  const city = "London";

  // Ensure walkability attributes exist (rebuild upsert may have left {} on older rows).
  for (const district of LONDON_CANONICAL_DISTRICTS) {
    if (!district.attributes) continue;
    await db
      .from("neighborhoods")
      .update({ attributes: district.attributes })
      .eq("city", city)
      .eq("name", district.name);
  }

  const gemini = keys.geminiKey || process.env.GEMINI_KEY;
  const unsplash = keys.unsplashKey || process.env.UNSPLASH_KEY;
  if (!gemini || !unsplash) {
    log("  skip vibe enrich — GEMINI_KEY and UNSPLASH_KEY required");
    return 0;
  }
  log("  vibe recompute (Overpass + photos)…");
  const n = await ng.recomputeNeighborhoodVibes(
    city,
    db,
    unsplash,
    keys.googlePlacesKey || process.env.GOOGLE_PLACES_KEY || null,
    gemini,
    keys.pexelsKey || process.env.PEXELS_KEY || null,
    keys.flickrKey || process.env.FLICKR_KEY || null,
  );
  log(`  vibe rows updated: ${n}`);
  return n;
}

function buildLondonTouristDistrictPrompt() {
  const names = LONDON_DISTRICT_NAMES.join(", ");
  return `You are a London travel expert helping a hotel-search product.

Task: return the hotel-search districts a tourist would pick when booking London — NOT administrative boroughs, NOT exhaustive geographic coverage. Include airport stay areas.

Return ONLY a JSON array with EXACTLY these 12 district names (same spelling, one entry each):
${names}

Framing rules:
- "Heathrow" = airport hotels near LHR (early flights, layovers) — NOT central sightseeing.
- "Soho" covers Fitzrovia / West End nightlife west of Covent Garden.
- "Paddington" includes the Bayswater hotel belt near Hyde Park.
- "South Kensington" includes Chelsea museum belt hotels.
- "Canary Wharf" covers the Docklands / Isle of Dogs business hotel zone.
- Do NOT add extra districts (no Stratford, Greenwich, Croydon, etc.) — only the 12 above.

Each item must include: name, bbox, polygon.ring (6+ vertices + closing point), vibe_short, vibe_long, tags, visitor_type, walkability_dining, walkability_tourist_spots, green_spaces, skyline_character, street_energy, photo_queries.

Return ONLY valid JSON — no markdown, no explanation.`;
}

module.exports = {
  LONDON_CANONICAL_DISTRICTS,
  LONDON_DISTRICT_NAMES,
  buildLondonTouristDistrictPrompt,
  rebuildLondonCanonicalDistricts,
  refreshLondonCanonicalHotelCounts,
  enrichLondonDistrictVibes,
};
