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
    "{neighborhood} {city} park trees",
    "{neighborhood} {city} public garden",
    "{city} park trees green",
    "{city} urban park",
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
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=80",
    "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=900&q=80",
    "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=900&q=80",
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

/** Drop micro-polygons smaller than this; 250 m² ≈ ~16 m × 16 m square. */
const MIN_GREEN_AREA_SQ_M = 250;

// POI categories that can be scored from real counts.
const POI_CATEGORIES = ["parks", "restaurants", "cafes", "museums", "shops", "icon_spots"];

/**
 * bboxAreaKm2 — approximate area of a lat/lng bounding box in km².
 * Uses the midpoint latitude to correct for longitudinal compression.
 */
function bboxAreaKm2(bbox) {
  if (bbox?.lat_min == null) return null;
  const { lat_min, lat_max, lon_min, lon_max } = bbox;
  const midLat  = (lat_min + lat_max) / 2;
  const latKm   = (lat_max - lat_min) * 111.0;
  const lonKm   = (lon_max - lon_min) * 111.0 * Math.cos(midLat * Math.PI / 180);
  return Math.max(0.01, latKm * lonKm); // floor at 0.01 km² to avoid div-by-zero
}

/** Axis-aligned rectangle (4-sided polygon) in WGS84 — used as a tight fence vs Places circle bleed. */
function pointInBbox(lat, lng, box) {
  if (!box || box.lat_min == null || box.lat_max == null || box.lon_min == null || box.lon_max == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= box.lat_min && lat <= box.lat_max && lng >= box.lon_min && lng <= box.lon_max;
}

/**
 * Inset bbox on all sides so the fence is smaller than Gemini’s loose box and excludes
 * edge POIs pulled in by circular search (e.g. Reforma skyline registered just inside circle).
 * insetRatio 0.12 → shrink each dimension by 12% total (6% per side).
 */
function tightFenceFromBbox(bbox, insetRatio = 0.12) {
  if (bbox?.lat_min == null) return null;
  const latSpan = bbox.lat_max - bbox.lat_min;
  const lonSpan = bbox.lon_max - bbox.lon_min;
  const padLat = (latSpan * insetRatio) / 2;
  const padLon = (lonSpan * insetRatio) / 2;
  const lat_min = bbox.lat_min + padLat;
  const lat_max = bbox.lat_max - padLat;
  const lon_min = bbox.lon_min + padLon;
  const lon_max = bbox.lon_max - padLon;
  if (lat_min >= lat_max || lon_min >= lon_max) return bbox;
  return { lat_min, lat_max, lon_min, lon_max };
}

/** WGS84 ring: [{ lat, lng }, ...] — first point may duplicate last (closed). */
function normalizePolygonRing(input) {
  if (!input) return null;
  const raw = Array.isArray(input) ? input : (input.ring || input.coordinates);
  if (!raw?.length) return null;
  const ring = [];
  for (const p of raw) {
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.lon ?? p.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) ring.push({ lat, lng });
  }
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.abs(a.lat - b.lat) > 1e-7 || Math.abs(a.lng - b.lng) > 1e-7) {
    ring.push({ lat: a.lat, lng: a.lng });
  }
  return ring;
}

/**
 * Ray-casting point-in-polygon. `ring` is closed (last vertex = first).
 */
function pointInPolygon(lat, lng, ring) {
  if (!ring || ring.length < 4) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const inter = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-20) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

function bboxFromRing(ring) {
  if (!ring?.length) return null;
  let lat_min = Infinity, lat_max = -Infinity, lon_min = Infinity, lon_max = -Infinity;
  const n = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    const { lat, lng } = ring[i];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    lat_min = Math.min(lat_min, lat);
    lat_max = Math.max(lat_max, lat);
    lon_min = Math.min(lon_min, lng);
    lon_max = Math.max(lon_max, lng);
  }
  if (!Number.isFinite(lat_min)) return null;
  return { lat_min, lat_max, lon_min, lon_max };
}

function ringCentroid(ring) {
  const open = ring?.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
    ? ring.length - 1
    : ring?.length || 0;
  if (open < 3) return null;
  let slat = 0, slng = 0;
  for (let i = 0; i < open; i++) {
    slat += ring[i].lat;
    slng += ring[i].lng;
  }
  return { lat: slat / open, lng: slng / open };
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Max distance from centroid to any vertex — caps Places circle radius. */
function maxRadiusFromCentroidM(ring) {
  const c = ringCentroid(ring);
  if (!c) return 500;
  const open = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
    ? ring.length - 1
    : ring.length;
  let maxD = 0;
  for (let i = 0; i < open; i++) {
    maxD = Math.max(maxD, haversineM(c.lat, c.lng, ring[i].lat, ring[i].lng));
  }
  return Math.max(120, Math.ceil(maxD * 1.12));
}

/** Shoelace area of a lat/lng ring in km² (equirectangular; same spirit as polygonAreaSqM). */
function ringAreaKm2(ring) {
  const r = normalizePolygonRing(ring);
  if (!r || r.length < 4) return null;
  const coords = r.map((p) => ({ lat: p.lat, lon: p.lng }));
  const m2 = polygonAreaSqM(coords);
  return m2 > 0 ? m2 / 1_000_000 : null;
}

function geometryCentroidLatLng(geom) {
  if (!geom?.length) return null;
  let slat = 0, slng = 0, n = 0;
  for (const p of geom) {
    const la = p.lat ?? p.latitude;
    const lo = p.lon ?? p.lng ?? p.longitude;
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      slat += la;
      slng += lo;
      n++;
    }
  }
  if (!n) return null;
  return { lat: slat / n, lng: slng / n };
}

function overpassElementLatLng(el) {
  if (el.type === "node" && el.lat != null && (el.lon != null || el.lng != null)) {
    return { lat: el.lat, lng: el.lon ?? el.lng };
  }
  if (el.center?.lat != null && (el.center.lon != null || el.center.lng != null)) {
    return { lat: el.center.lat, lng: el.center.lon ?? el.center.lng };
  }
  return null;
}

/**
 * Places / fence: if polygon ring present, require point inside polygon; else inset bbox.
 */
function placeInsideNeighborhoodFence(lat, lng, bbox, polygonRing) {
  if (polygonRing?.length >= 4) {
    if (pointInPolygon(lat, lng, polygonRing)) return true;
    // For simple bbox-derived polygons (≤6 pts = no real OSM boundary, just Gemini rectangle),
    // allow a ~400m buffer. Gemini bbox precision is ~0.001°–0.003° off, and genuine
    // neighbourhood places at the edges get incorrectly rejected without this tolerance.
    // Real OSM polygons (7+ pts) are accurate enough that strict boundary is correct.
    if (polygonRing.length <= 6 && bbox?.lat_min != null) {
      const BUF = 0.004; // ~400 m per side
      const expanded = {
        lat_min: bbox.lat_min - BUF, lat_max: bbox.lat_max + BUF,
        lon_min: bbox.lon_min - BUF, lon_max: bbox.lon_max + BUF,
      };
      return pointInBbox(lat, lng, expanded);
    }
    return false;
  }
  // No polygon stored at all — use raw bbox (no inset, avoids over-excluding edge places)
  return bbox ? pointInBbox(lat, lng, bbox) : true;
}

/**
 * computeCityMaxCounts — given an array of { counts, areaKm2 } objects (one per
 * neighbourhood), returns the per-category maximum **density** (POIs per km²)
 * across the city.  This is the normalisation ceiling used by poiCountToScore.
 *
 * Density-based ceilings mean large neighbourhoods aren't artificially
 * over-scored versus small ones that pack the same category into less space.
 */
function computeCityMaxCounts(allNeighbourhoodData) {
  const cityMax = {};
  for (const cat of POI_CATEGORIES) {
    const densities = allNeighbourhoodData.map(({ counts, areaKm2 }) => {
      const count = counts?.[cat] || 0;
      const area  = areaKm2 && areaKm2 > 0 ? areaKm2 : 1;
      return count / area;
    });
    cityMax[cat] = Math.max(0.001, ...densities);
  }
  return cityMax;
}

/**
 * Shoelace area of a closed lat/lon ring in m² (equirectangular approx; fine for small polygons).
 */
function polygonAreaSqM(coords) {
  if (!coords || coords.length < 4) return 0;
  const first = coords[0];
  const last  = coords[coords.length - 1];
  const closed =
    Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lon - last.lon) < 1e-7;
  if (!closed) return 0;
  let latSum = 0;
  for (const p of coords) latSum += p.lat;
  const refLat = (latSum / coords.length) * (Math.PI / 180);
  const mPerLat = 111_000;
  const mPerLon = 111_000 * Math.cos(refLat);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i].lon * mPerLon;
    const y1 = coords[i].lat * mPerLat;
    const x2 = coords[i + 1].lon * mPerLon;
    const y2 = coords[i + 1].lat * mPerLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

/**
 * Tags that represent meaningful green / open spaces a visitor would recognise.
 * Excludes landuse=grass (too noisy in dense cities — catches every median strip
 * and ornamental lawn). Includes forest/wood for nature reserves and city woods.
 * leisure=garden is kept but filtered by MIN_GREEN_AREA_SQ_M to drop small planters.
 */
function isGreenElement(t) {
  return (
    t.leisure === "park" ||
    t.leisure === "garden" ||
    t.leisure === "nature_reserve" ||
    t.leisure === "recreation_ground" ||
    t.landuse === "village_green" ||
    t.landuse  === "forest" ||
    t.natural  === "wood"
  );
}

/**
 * Radially expand a polygon ring by bufferDeg degrees outward from its centroid.
 * Used to give park centroids a small tolerance — large parks straddle admin
 * boundaries, so a 200m buffer prevents undercounting neighbourhood parks.
 */
function expandPolygonRing(ring, bufferDeg) {
  if (!ring?.length) return ring;
  const centroid = ringCentroid(ring);
  if (!centroid) return ring;
  return ring.map((pt) => {
    const dlat = pt.lat - centroid.lat;
    const dlng = pt.lng - centroid.lng;
    const dist  = Math.sqrt(dlat * dlat + dlng * dlng);
    if (dist === 0) return pt;
    const scale = (dist + bufferDeg) / dist;
    return { lat: centroid.lat + dlat * scale, lng: centroid.lng + dlng * scale };
  });
}

// ~400 m expressed in degrees latitude (≈0.0036°).  Large parks (e.g. Parque México
// in Condesa) often straddle or sit just outside the strict admin boundary — their
// OSM centroid can be 300-400 m below the polygon edge.  A 400 m buffer covers that
// without pulling in parks from a different neighbourhood a full km away.
const PARK_RING_BUFFER_DEG = 0.0036;

// Expand the Overpass query bbox by this many degrees in every direction so that
// park ways whose centroid is just outside the original bbox are still returned with
// their full geometry (needed for area + centroid calculations below).
const PARK_BBOX_EXPAND_DEG = 0.003;

/**
 * Count green-space features whose mapped polygon area ≥ minSqM.
 * Overpass public servers do not support (if: geom.area()), so we use out geom + this filter.
 * When polygonRing is set, only counts features whose area-weighted centroid lies inside the ring.
 * A small radial buffer (PARK_RING_BUFFER_DEG) is applied to the ring so large boundary
 * parks (e.g. Parque México at the edge of Condesa) are not excluded by centroid precision.
 */
function countGreenAreasMinSqM(elements, minSqM, polygonRing) {
  const bufferedRing = polygonRing ? expandPolygonRing(polygonRing, PARK_RING_BUFFER_DEG) : null;
  const needPoly = bufferedRing?.length >= 4;
  let n = 0;
  for (const el of elements || []) {
    const t = el.tags || {};
    if (!isGreenElement(t)) continue;

    if (el.type === "way" && el.geometry?.length) {
      const area = polygonAreaSqM(el.geometry);
      if (area < minSqM) continue;
      if (needPoly) {
        const c = geometryCentroidLatLng(el.geometry);
        if (!c || !pointInPolygon(c.lat, c.lng, bufferedRing)) continue;
      }
      n++;
    } else if (el.type === "relation" && el.members?.length) {
      let total = 0;
      let sumLat = 0, sumLng = 0, wsum = 0;
      for (const m of el.members) {
        if (m.role === "inner") continue;
        if (m.geometry?.length) {
          const a = polygonAreaSqM(m.geometry);
          total += a;
          const c = geometryCentroidLatLng(m.geometry);
          if (c && a > 0) {
            sumLat += c.lat * a;
            sumLng += c.lng * a;
            wsum += a;
          }
        }
      }
      if (total < minSqM) continue;
      if (needPoly) {
        const clat = wsum > 0 ? sumLat / wsum : null;
        const clng = wsum > 0 ? sumLng / wsum : null;
        if (clat == null || !pointInPolygon(clat, clng, bufferedRing)) continue;
      }
      n++;
    }
  }
  return n;
}

/**
 * Fetch park/garden/green-space polygons with geometry and filter by area in Node.
 * Falls back to a lightweight "out count" query when the geometry query times out
 * (e.g. for large neighbourhoods like Polanco whose bbox spans several km²).
 *
 * The Overpass query bbox is expanded by PARK_BBOX_EXPAND_DEG in all directions so
 * parks whose centroid is just outside the original bbox are still returned with full
 * geometry for area + centroid calculation.
 */
async function fetchOverpassGreenCount(bbox, minSqM, polygonRing = null) {
  const { lat_min, lat_max, lon_min, lon_max } = bbox || {};

  // Slightly expanded bbox for the Overpass fetch so boundary parks are returned.
  const e  = PARK_BBOX_EXPAND_DEG;
  const bb = `${lat_min - e},${lon_min - e},${lat_max + e},${lon_max + e}`;

  // Heavy query: fetch full geometry so we can filter by polygon area.
  // landuse=grass excluded — in dense cities it tags every median strip and lawn.
  const qGeom = `[out:json][timeout:30];
(
  way["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bb});
  way["landuse"~"^(village_green|forest)$"](${bb});
  relation["landuse"~"^(village_green|forest)$"](${bb});
  way["natural"="wood"](${bb});
  relation["natural"="wood"](${bb});
);
out geom;`;

  // Lightweight fallback — no area filter, counts any matched element.  Used when
  // the geometry query times out on large neighbourhoods.
  const qCount = `[out:json][timeout:20];
(
  way["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"](${bb});
  way["landuse"~"^(village_green|forest)$"](${bb});
  relation["landuse"~"^(village_green|forest)$"](${bb});
);
out count;`;

  const doFetch = (query, timeoutMs) => fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(timeoutMs),
  });

  // Try geometry query with a single 15s back-off retry on rate-limit / gateway timeout.
  let res = await doFetch(qGeom, 30000);
  if (res.status === 429 || res.status === 504) {
    await new Promise((r) => setTimeout(r, 15_000));
    res = await doFetch(qGeom, 30000);
  }

  if (res.ok) {
    const data = await res.json();
    return countGreenAreasMinSqM(data.elements, minSqM, polygonRing);
  }

  // Geometry query failed — try the lightweight count-only fallback.
  console.warn(`[overpass] geometry query failed (${res.status}); trying count-only fallback`);
  const resCnt = await doFetch(qCount, 25000).catch(() => null);
  if (resCnt?.ok) {
    const d = await resCnt.json().catch(() => null);
    const total = d?.elements?.[0]?.tags?.total;
    if (total != null) {
      console.warn(`[overpass] count-only fallback returned ${total} (no area filter)`);
      return parseInt(total, 10);
    }
  }

  // Both attempts failed — throw so the caller preserves the old count.
  throw new Error(`Overpass green count ${res.status}`);
}

/**
 * fetchOverpassPOIs — queries OpenStreetMap via Overpass for 6 POI categories
 * inside a bounding box. Returns { parks, restaurants, cafes, museums, shops,
 * icon_spots } counts, or null on failure (caller should fall back to formula).
 *
 * Retries once on 429/504 after a 10s back-off to stay within fair-use limits
 * of the public overpass-api.de instance.
 *
 * Parks: second request with out geom; counts only polygons ≥ MIN_GREEN_AREA_SQ_M
 * (public Overpass has no geom.area() filter).
 */
async function fetchOverpassPOIs(bbox, polygonRing = null) {
  const { lat_min, lat_max, lon_min, lon_max } = bbox || {};
  if (lat_min == null) return null;

  let parksFiltered = null;   // null = fetch failed → fall back to old park+garden count
  try {
    parksFiltered = await fetchOverpassGreenCount(bbox, MIN_GREEN_AREA_SQ_M, polygonRing);
    console.log(`[overpass] green spaces (≥${MIN_GREEN_AREA_SQ_M} m²): ${parksFiltered}`);
  } catch (e) {
    console.warn(`[overpass] green count failed (${e.message}); falling back to unfiltered park+garden`);
  }

  // Pause between green query and main union — gives Overpass time to recover.
  await new Promise((r) => setTimeout(r, 10000));

  // Main union (no park/garden — those are in fetchOverpassGreenCount).
  //
  // Icon spots: must capture both nodes (small statues, plaques) AND polygon
  // features (cathedrals, palaces, archaeological sites like Templo Mayor).
  // tourism=artwork included for public sculptures and murals.
  // historic=palace/archaeological_site added for civic landmarks that are
  // mapped as way/relation footprints in OSM (not as tourism=attraction nodes).
  const q = `[out:json][timeout:30];
(
  node["amenity"~"^(restaurant|fast_food|bar|pub|food_court)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["amenity"="cafe"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["tourism"~"^(museum|gallery)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["tourism"~"^(museum|gallery)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  relation["tourism"~"^(museum|gallery)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["shop"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["tourism"~"^(attraction|viewpoint|artwork)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["tourism"~"^(attraction|viewpoint)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  relation["tourism"~"^(attraction|viewpoint)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["historic"~"^(monument|memorial|castle|ruins|archaeological_site|palace|building)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["historic"~"^(monument|memorial|castle|ruins|archaeological_site|palace|building|fortification)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  relation["historic"~"^(monument|memorial|castle|ruins|archaeological_site|palace|building|fortification)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  way["building"~"^(cathedral|basilica|chapel|monastery|church|temple|shrine)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  relation["building"~"^(cathedral|basilica|chapel|monastery|church|temple|shrine)$"](${lat_min},${lon_min},${lat_max},${lon_max});
);
out tags center;`;

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

  const counts = {
    parks: parksFiltered,  // null when green query failed — caller must preserve old DB value
    restaurants: 0,
    cafes: 0,
    museums: 0,
    shops: 0,
    icon_spots: 0,
  };

  const polyActive = polygonRing?.length >= 4;

  for (const el of (data.elements || [])) {
    if (polyActive) {
      const pt = overpassElementLatLng(el);
      if (!pt || !pointInPolygon(pt.lat, pt.lng, polygonRing)) continue;
    }
    const t = el.tags || {};
    if (t.amenity === "cafe") {
      counts.cafes++;
    } else if (["restaurant", "fast_food", "bar", "pub", "food_court"].includes(t.amenity)) {
      counts.restaurants++;
    } else if (["museum", "gallery"].includes(t.tourism)) {
      counts.museums++;
    } else if (t.shop) {
      counts.shops++;
    } else if (
      ["attraction", "viewpoint", "artwork"].includes(t.tourism) ||
      ["monument", "memorial", "castle", "ruins", "archaeological_site",
       "palace", "building", "fortification"].includes(t.historic) ||
      ["cathedral", "basilica", "chapel", "monastery",
       "church", "temple", "shrine"].includes(t.building)
    ) {
      counts.icon_spots++;
    }
  }

  console.log(`[overpass] final counts: parks=${counts.parks ?? "null(failed)"} restaurants=${counts.restaurants} cafes=${counts.cafes} museums=${counts.museums} shops=${counts.shops} icon_spots=${counts.icon_spots}`);

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
 * computeWalkabilityScore — per-element walkability score derived from
 * Gemini-generated neighbourhood attributes.
 *
 * Each element type maps to the most relevant attribute(s):
 *   parks       → green_spaces
 *   restaurants → walkability_dining
 *   cafes       → walkability_dining + street_energy blend
 *   museums     → walkability_tourist_spots
 *   icon_spots  → walkability_tourist_spots
 *   shops       → walkability_dining + street_energy blend
 *   street_feel → street_energy
 */
function computeWalkabilityScore(elementKey, attributes = {}) {
  const wDining = catScore(attributes.walkability_dining,        { excellent: 90, good: 68, limited: 40 });
  const wTour   = catScore(attributes.walkability_tourist_spots, { excellent: 90, good: 68, limited: 40 });
  const energy  = catScore(attributes.street_energy,            { lively: 88, moderate: 62, quiet: 42 });
  const green   = catScore(attributes.green_spaces,             { lots: 88, some: 62, minimal: 35 });

  switch (elementKey) {
    case "parks":       return clamp(Math.round(green));
    case "restaurants": return clamp(Math.round(wDining));
    case "cafes":       return clamp(Math.round(wDining * 0.7 + energy * 0.3));
    case "museums":     return clamp(Math.round(wTour));
    case "icon_spots":  return clamp(Math.round(wTour));
    case "shops":       return clamp(Math.round(wDining * 0.45 + energy * 0.55));
    case "street_feel": return clamp(Math.round(energy));
    default:            return 60;
  }
}

/**
 * computeBoopVibe — neighbourhood-level aggregate score shown in every element panel.
 *
 * Formula: mean of all element scores × POI-richness scaling.
 * The scaling factor √(totalPOIs / 600) rewards data-rich neighbourhoods (more POIs =
 * more to actually do) and gently discounts sparse areas.  Caps at 1.0 beyond 600
 * total POIs so dense cities don't all cluster at 99–100.
 */
function computeBoopVibe(elementScores, poiCounts = null) {
  const scoreValues = Object.values(elementScores).filter((v) => typeof v === "number");
  if (!scoreValues.length) return 50;

  const meanScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;

  let poiScaling = 0.75; // conservative default when Overpass data absent
  if (poiCounts) {
    const totalPOIs = Object.values(poiCounts).reduce((a, b) => a + (b || 0), 0);
    if (totalPOIs > 0) poiScaling = Math.min(1, Math.sqrt(totalPOIs / 600));
  }

  return clamp(Math.round(meanScore * poiScaling));
}

/**
 * poiCountToScore — density-aware √-scale normalisation.
 *
 * Converts a raw POI count + neighbourhood area into a 0–100 score by:
 *  1. Computing density = count / areaKm2 (POIs per km²)
 *  2. Normalising against the city's peak density for that category
 *  3. Applying √ scaling so a neighbourhood at half the peak scores ~70%, not 50%
 *
 * This prevents large neighbourhoods from being over-scored just because they
 * contain more absolute POIs — a compact dense neighbourhood scores higher than
 * a sprawling one with the same raw count.
 *
 * Falls back to raw-count global ceilings when area or cityMaxCounts is absent.
 * Floor of 10 so even the quietest neighbourhood registers visibly.
 */
// Global fallback ceilings in **density units** (POIs per km²) for a typical
// walkable urban neighbourhood (~4 km²).  Used only when Overpass data is absent.
const GLOBAL_FALLBACK_MAX = {
  parks: 5, restaurants: 75, cafes: 25, museums: 8, shops: 120, icon_spots: 8,
};

function poiCountToScore(count, category, areaKm2 = null, cityMaxDensities = null) {
  if (!count || count <= 0) return 10;
  if (areaKm2 && areaKm2 > 0) {
    // Density path (preferred): normalise against city's peak density
    const density    = count / areaKm2;
    const maxDensity = cityMaxDensities?.[category] || GLOBAL_FALLBACK_MAX[category] || 5;
    return clamp(Math.round(Math.sqrt(density / maxDensity) * 100), 10, 100);
  }
  // Fallback: raw count against global ceiling (no area data available)
  const max = GLOBAL_FALLBACK_MAX[category] || 50;
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
function computeElementScores(attributes = {}, tags = [], vibeLong = "", poiCounts = null, cityMaxCounts = null, areaKm2 = null) {
  const wDining = catScore(attributes.walkability_dining, { excellent: 90, good: 68, limited: 40 });
  const wTour   = catScore(attributes.walkability_tourist_spots, { excellent: 90, good: 68, limited: 40 });
  const energy  = catScore(attributes.street_energy, { lively: 88, moderate: 62, quiet: 42 });
  const text    = (vibeLong || "").toLowerCase();

  const hasRealCounts = poiCounts && Object.values(poiCounts).some((v) => v > 0);

  let scores;
  if (hasRealCounts) {
    scores = {
      parks:       poiCountToScore(poiCounts.parks,       "parks",       areaKm2, cityMaxCounts),
      restaurants: poiCountToScore(poiCounts.restaurants, "restaurants", areaKm2, cityMaxCounts),
      cafes:       poiCountToScore(poiCounts.cafes,       "cafes",       areaKm2, cityMaxCounts),
      museums:     poiCountToScore(poiCounts.museums,     "museums",     areaKm2, cityMaxCounts),
      shops:       poiCountToScore(poiCounts.shops,       "shops",       areaKm2, cityMaxCounts),
      icon_spots:  poiCountToScore(poiCounts.icon_spots,  "icon_spots",  areaKm2, cityMaxCounts),
    };
  } else {
    const green   = catScore(attributes.green_spaces, { lots: 90, some: 65, minimal: 32 });
    const skyline = catScore(attributes.skyline_character, {
      "low-rise historic": 82, "modern high-rise": 58, mixed: 70, "tree-lined": 76,
    });
    scores = {
      parks:       clamp(green * 0.756 + wTour * 0.244 + (hasTag(tags, "green") ? 8 : 0)),
      restaurants: clamp(wDining * 0.64 + energy * 0.26 + (hasTag(tags, "foodie") ? 10 : 0)),
      cafes:       clamp(wDining * 0.45 + wTour * 0.25 + (hasTag(tags, "local-feel") ? 8 : 0) + (hasTag(tags, "shopping") ? 5 : 0)),
      museums:     clamp(skyline * 0.26 + wTour * 0.34 + (hasTag(tags, "artsy") ? 8 : 0) + (text.includes("museum") || text.includes("gallery") ? 16 : 0)),
      shops:       clamp(energy * 0.24 + wTour * 0.2 + wDining * 0.18 + (hasTag(tags, "shopping") ? 18 : 0) + (hasTag(tags, "luxury") ? 8 : 0)),
      icon_spots:  clamp(skyline * 0.4 + wTour * 0.3 + (hasTag(tags, "historic") ? 14 : 0) + (text.includes("square") || text.includes("landmark") ? 8 : 0)),
    };
  }

  // street_feel: tourist-walkability + street energy (transport_dependency removed)
  scores.street_feel = clamp(Math.round((wTour * 42 + energy * 26) / 68));

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

function buildElementPayload(elementKey, score, neighborhoodName, hotelCount, shopsSubscores = null, poiCounts = null, walkability = 60, boopVibe = 50) {
  const label = ELEMENTS.find((e) => e.key === elementKey)?.label || elementKey;
  return {
    score,
    summary: `${neighborhoodName}: ${label.toLowerCase()} feel is ${score >= 80 ? "very strong" : score >= 65 ? "strong" : score >= 50 ? "good" : "moderate"}.`,
    facts: elementFacts(elementKey, score, hotelCount, shopsSubscores, poiCounts),
    metrics: {
      density:     score,
      walkability: walkability,
      boop_vibe:   boopVibe,
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
  // urban_park covers small neighbourhood parks (e.g. Parque España in Roma Norte)
  // that Places often tags separately from the generic "park" type.
  // garden covers formal gardens that show up as parks in many cities.
  parks:       ["park", "urban_park", "national_park", "botanical_garden", "garden"],
  restaurants: ["restaurant"],
  cafes:       ["cafe", "coffee_shop"],
  museums:     ["museum", "art_gallery"],
  // Big-box chains (Home Depot, Elektra, Sodimac) are now blocked by CHAIN_BLOCKLIST
  // so home_goods_store is safe to include for boutique home & lifestyle stores.
  // gift_shop also removed: tends to pull souvenir stalls or airport shops.
  shops:       ["clothing_store", "book_store", "florist", "jewelry_store", "home_goods_store"],
  // historical_landmark + worship buildings — these return outdoor architectural photos.
  // tourist_attraction is intentionally excluded: it matches museums/restaurants/bars
  // which return interior shots. church/mosque/hindu_temple cover major religious
  // landmarks (Parroquia de la Sagrada Familia, mosques in KL, etc.) that Google
  // Places doesn't always tag as historical_landmark.
  icon_spots:  ["historical_landmark", "church", "mosque", "hindu_temple", "synagogue"],
  street_feel: null,
};

// Global chain names to exclude from element photo results.
// These are mega-chains whose Google Maps photos are typically generic interiors
// rather than neighbourhood-specific imagery.
const CHAIN_BLOCKLIST = new Set([
  "starbucks", "mcdonald's", "mcdonalds", "burger king", "kfc", "subway",
  "domino's", "dominos", "pizza hut", "taco bell", "wendy's", "wendys",
  "dunkin'", "dunkin", "tim hortons", "costa coffee", "pret a manger",
  "pret", "five guys", "popeyes", "chick-fil-a", "chipotle", "applebee's",
  "olive garden", "ihop", "denny's", "dennys", "sushi express", "sushi king",
  "nando's", "nandos", "wagamama", "panda express", "wingstop",
  "krispy kreme", "jamba juice", "smoothie king", "seven eleven", "7-eleven",
  "circle k", "oxxo", "vips", "sanborns", "walmart", "costco", "carrefour",
  "liverpool", "palacio de hierro",   // Mexican department store chains
  "sears", "h&m", "zara", "forever 21", "gap", "old navy",
  // Gas stations — their cafe/convenience sub-sections can appear as "cafe" results
  "pemex", "bp", "shell", "total energies", "totalenergies", "esso", "chevron",
  "mobil", "petro seven", "petro 7", "exxon", "texaco", "repsol",
  // Big-box home improvement / electronics chains — wrong for neighbourhood shopping
  "home depot", "the home depot", "elektra", "sodimac", "liverpool",
  "soriana", "sam's club", "sams club", "chedraui", "mega", "superama",
  "office depot", "officemax", "best buy", "radioshack",
]);

function isChain(displayName) {
  if (!displayName) return false;
  return CHAIN_BLOCKLIST.has(displayName.toLowerCase().trim());
}

// Well-known mega-landmarks that Google Places POPULARITY surfaces for any
// nearby neighbourhood but that clearly belong to a specific iconic location
// (e.g. Chapultepec Park, Angel de Independencia strip). Blocklisting them
// stops them from appearing in adjacent neighbourhood photo carousels.
const LANDMARK_BLOCKLIST = new Set([
  // Chapultepec Park landmarks (appear in Condesa, Juárez, Polanco results)
  "chapultepec castle", "castillo de chapultepec",
  "bosque de chapultepec", "chapultepec forest",
  "museo nacional de antropología", "national museum of anthropology",
  "museo de arte moderno", "museo rufino tamayo",
  "papalote museo del niño",
  "monumento a los niños héroes", "niños héroes",
  "puerta de los leones de chapultepec",
  // Reforma corridor (bleeds into Juárez / Condesa)
  "diana the huntress fountain", "fuente de diana la cazadora",
  "fuente de diana cazadora",
  "ángel de la independencia", "angel de la independencia",
  "monumento a la independencia",
  "torre mayor", "torre reforma",
]);

// Landmarks that are blocklisted globally EXCEPT in their home neighbourhood,
// where they are the defining visual identity.
// key = normalized landmark name, value = canonical neighbourhood name (case-insensitive match).
const LANDMARK_HOME_NEIGHBORHOOD = {
  "torre mayor":                    "polanco",
  "torre reforma":                  "polanco",
  "ángel de la independencia":      "juárez",
  "angel de la independencia":      "juárez",
  "monumento a la independencia":   "juárez",
  "diana the huntress fountain":    "juárez",
  "fuente de diana la cazadora":    "juárez",
  "fuente de diana cazadora":       "juárez",
};

function isBlocklistedLandmark(displayName, currentNeighborhood = null) {
  if (!displayName) return false;
  const norm = displayName.toLowerCase().trim();
  if (!LANDMARK_BLOCKLIST.has(norm)) return false;
  // If the landmark belongs to this specific neighbourhood, allow it through.
  const home = LANDMARK_HOME_NEIGHBORHOOD[norm];
  if (home && currentNeighborhood && home === currentNeighborhood.toLowerCase().trim()) return false;
  return true;
}

/**
 * Positive check: does a Google Places display name look like an actual green space?
 * Used for the `parks` element to reject businesses/roundabouts/stores that
 * Google Maps happens to type as "park" (meeting points, print shops, tour operators, etc.)
 */
function isParkLikePlaceName(displayName) {
  if (!displayName) return false;
  const n = displayName.toLowerCase();
  return (
    // English
    /\b(park|garden|gardens|green|grove|common|meadow|woods|forest|botanic|nature|reserve|trail)\b/.test(n) ||
    // Spanish (glorieta/camellón excluded — roundabouts and road medians, not parks)
    /\b(parque|parques|jardín|jardin|jardines|bosque|reserva|verde|alameda|vivero)\b/.test(n) ||
    // French (promenade excluded — often a commercial pedestrian street; plantée covers Promenade Plantée)
    /\b(parc|jardin|bois|forêt|foret|champ|plantée|plantee)\b/.test(n) ||
    // Malay / Indonesian
    /\b(taman|hutan|kebun)\b/.test(n)
  );
}

/**
 * isMuseumLikePlaceName — negative filter for museums/galleries.
 * Rejects names that clearly indicate a non-museum venue (bazaars, cafés,
 * bakeries, bookstore-cafes) that Google mistags as museum or art_gallery.
 * Intentionally permissive: many legitimate cultural institutions have names
 * that don't contain "museum" (e.g. "Monnaie de Paris", "Centre Pompidou",
 * "Fondation Cartier"), so we reject only obvious negatives.
 */
function isMuseumLikePlaceName(displayName) {
  if (!displayName) return true; // no name — don't reject
  const n = displayName.toLowerCase();
  // Reject clearly non-museum venues
  if (/\b(bazar|bazaar|mercado|tianguis|market|flea\s+market|pulgas)\b/.test(n)) return false;
  if (/\blibros\s+y\s+caf[eé]\b/.test(n)) return false; // bookstore-cafe
  if (/\b(boulangerie|panadería|pastelería|bakery)\b/.test(n)) return false;
  if (/\b(restaurant|restaurante)\b/.test(n)) return false;
  return true;
}

/**
 * Reject patterns for icon_spots — non-architecturally-significant venues that
 * Google Places sometimes returns under church/historical_landmark types.
 * A Kingdom Hall hallway or generic community church is not a traveler icon spot.
 */
const ICON_SPOT_REJECT_PATTERNS = [
  /kingdom\s+hall/i,
  /salón\s+del\s+reino/i,
  /sala\s+del\s+reino/i,
  /iglesia\s+cristiana\s+(ciudad|refugio|nuevo|vida)\b/i,
  /asamblea\s+de\s+dios/i,
  /iglesia\s+(bautista|evangélica|evangelica|adventista|pentecostal)\b/i,
  /seventh.?day\s+adventist/i,
  /church\s+of\s+(christ|god|jesus\s+christ\s+of\s+latter)/i,
  /comunidad\s+de\s+jesús/i,
  /\bword\s+of\s+(faith|life)\b/i,
];

function isValidIconSpotName(displayName) {
  if (!displayName) return true; // no name → don't reject
  const n = displayName.toLowerCase();
  return !ICON_SPOT_REJECT_PATTERNS.some((p) => p.test(n));
}

/** Small urban "parks" in Google are often playgrounds; skip for park carousel imagery. */
function isPlaygroundLikePlaceName(displayName) {
  if (!displayName) return false;
  const n = displayName.toLowerCase();
  return (
    // English
    /\b(playground|play area|tot lot|splash pad|jungle gym|swing park|skatepark|skate park)\b/.test(n) ||
    // Spanish — "juegos infantiles" = children's play area, "parque infantil" = children's park
    /\b(juegos\s+infantiles|parque\s+infantil|área\s+de\s+juegos|zona\s+de\s+juegos|tobogán|columpio)\b/.test(n) ||
    // French
    /\b(aire\s+de\s+jeux|jeux\s+pour\s+enfants|terrain\s+de\s+jeux)\b/.test(n) ||
    // Malay / Indonesian (KL)
    /\b(taman\s+permainan|gelanggang\s+permainan)\b/.test(n)
  );
}

/**
 * geminiVisionIsGreenParkPhoto — calls Gemini Flash Lite to verify a Google Places
 * photo actually shows a green park/garden rather than playground equipment or urban
 * infrastructure. Returns true (accept) on any error so we fail open, not closed.
 */
async function geminiVisionIsGreenParkPhoto(photoUrl, geminiKey) {
  if (!geminiKey || !photoUrl) return true;
  try {
    // Fetch the image at a small size to keep token cost low
    const smallUrl = photoUrl.replace(/maxWidthPx=\d+/, "maxWidthPx=400");
    const imgRes = await fetch(smallUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) return true;
    const imgBuf  = await imgRes.arrayBuffer();
    const imgB64  = Buffer.from(imgBuf).toString("base64");
    const mime    = imgRes.headers.get("content-type") || "image/jpeg";

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: "Does this photo primarily show a green park, garden, or natural green landscape (grass, trees, plants, flowers)? Answer YES if it does. Answer NO if the photo mainly shows: playground equipment (slides, swings, climbing frames), rubber/asphalt play surfaces, or children's play structures. Reply with a single word: YES or NO." },
          { inlineData: { mimeType: mime, data: imgB64 } },
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 5 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return true;
    const data   = await res.json();
    const answer = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toUpperCase();
    const isGreen = answer.startsWith("YES");
    if (!isGreen) console.log(`[vision] rejected non-green park photo (answer: ${answer}): ${photoUrl.slice(0, 80)}…`);
    return isGreen;
  } catch (e) {
    console.warn(`[vision] park photo check failed (allowing): ${e.message}`);
    return true; // fail open
  }
}

/**
 * geminiVisionCheck — generic YES/NO vision gate using Gemini Flash Lite.
 * Accepts a plain-English YES question; returns true for YES, false for NO.
 * Always fails open (returns true on any error) so a vision API hiccup never
 * blocks the whole pipeline.
 */
async function geminiVisionCheck(photoUrl, geminiKey, yesQuestion) {
  if (!geminiKey || !photoUrl) return true;
  try {
    const smallUrl = photoUrl.replace(/maxWidthPx=\d+/, "maxWidthPx=400");
    const imgRes = await fetch(smallUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) return true;
    const imgBuf = await imgRes.arrayBuffer();
    const imgB64 = Buffer.from(imgBuf).toString("base64");
    const mime   = imgRes.headers.get("content-type") || "image/jpeg";

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: `${yesQuestion} Reply with a single word: YES or NO.` },
          { inlineData: { mimeType: mime, data: imgB64 } },
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 5 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return true;
    const data   = await res.json();
    const answer = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toUpperCase();
    return answer.startsWith("YES");
  } catch (e) {
    console.warn(`[vision] check failed (allowing): ${e.message}`);
    return true;
  }
}

/**
 * geminiVisionIsOutdoorFoodPhoto — checks whether a restaurant or cafe photo
 * shows outdoor/street-level content.
 *
 * Calibrated generously: accept any photo where the EXTERIOR of a venue is
 * visible — facade, canopy, outdoor chairs, terrace, or street context.
 * Only hard-reject photos that are EXCLUSIVELY indoor (closed room interior)
 * with zero outdoor or exterior visual context.
 */
async function geminiVisionIsOutdoorFoodPhoto(photoUrl, geminiKey) {
  return geminiVisionCheck(
    photoUrl, geminiKey,
    "Does this photo show ANY outdoor or street-level element related to a cafe or restaurant? This includes: outdoor seating or terrace, sidewalk tables, the building facade or canopy, a street view with the venue visible, or people eating outside. Answer YES if any outdoor or exterior element is visible. Answer NO only if the photo EXCLUSIVELY shows a fully enclosed interior room (walls, ceiling, floor) with no outdoor context at all, OR shows only a food dish close-up with no venue visible."
  );
}

/**
 * geminiVisionIsArchitecturalPhoto — used for Pexels photos tagged as
 * museums or icon_spots. Accepts only photos showing the building/monument
 * exterior; rejects interiors, fashion shoots, and generic cityscapes.
 */
async function geminiVisionIsArchitecturalPhoto(photoUrl, geminiKey, elementKey) {
  const q = elementKey === "museums"
    ? "Does this photo show the exterior architecture of a museum, art gallery, or cultural institution building? Answer YES for building exteriors, facades, or plazas in front of a cultural building. Answer NO for interior rooms, artworks without building context, fashion shoots, or generic street scenes."
    : "Does this photo show a recognisable historic landmark, monument, statue, famous building, or architectural icon? Answer YES for clear landmark/monument photos. Answer NO for generic city views without an obvious landmark, interior shots, or people posing as the main subject.";
  return geminiVisionCheck(photoUrl, geminiKey, q);
}

/**
 * fetchGooglePlacesElementPhotos — nearby search inside the neighbourhood bbox,
 * filtered by category type. Returns up to `maxPhotos` photo objects.
 * Falls back gracefully — returns [] on any error.
 */
async function fetchGooglePlacesElementPhotos(bbox, elementKey, placesKey, maxPhotos = PHOTO_RULES.target, polygonRing = null, geminiKey = null, neighborhoodName = null) {
  if (!placesKey || bbox?.lat_min == null) return [];
  const types = PLACES_ELEMENT_TYPES[elementKey];
  if (!types) return []; // street_feel — caller uses Unsplash fallback

  const poly = polygonRing?.length >= 4 ? polygonRing : null;
  const center = poly ? ringCentroid(poly) : null;
  const centerLat = center ? center.lat : (bbox.lat_min + bbox.lat_max) / 2;
  const centerLng = center ? center.lng : (bbox.lon_min + bbox.lon_max) / 2;
  // Base radius from bbox or polygon span, capped at 3 km
  const baseRadiusM = poly
    ? Math.min(3000, maxRadiusFromCentroidM(poly))
    : Math.min(
        3000,
        Math.round(Math.max(bbox.lat_max - bbox.lat_min, bbox.lon_max - bbox.lon_min) * 111000 / 2)
      );

  // icon_spots: use POPULARITY (returns well-known places) but shrink radius to
  // 50% so landmarks at the edges of the bbox (e.g. Chapultepec/Diana Cazadora
  // appearing in Condesa results) are excluded. The tighter circle stays centred
  // on the neighbourhood and picks the most-popular spots actually *within* it.
  // parks: use POPULARITY so well-known parks (Parque España, Vondelpark, etc.)
  // surface first regardless of exact centroid distance. Many smaller neighbourhood
  // parks that are physically central have no photos in Places so DISTANCE fails
  // to find anything useful. POPULARITY surfaces parks people actually photograph.
  // All other categories: full radius + POPULARITY.
  const rankPref = "POPULARITY";
  const radiusM  = elementKey === "icon_spots"
    ? Math.round(baseRadiusM * 0.50)
    : baseRadiusM;

  // Cast a wider net for categories where filters reject a high proportion:
  // - parks: name + vision filters reject plazas, skate parks, etc. → 3×
  // - restaurants/cafes: outdoor vision filter rejects ~70% (interior shots) → 2.5×
  // - shops: vision check + chain filter rejects a lot → 2×
  // Without this multiplier Google Places returns only ~2 outdoor food photos per hood.
  const CANDIDATE_MULT = { parks: 3, restaurants: 3, cafes: 3, shops: 2 };
  const mult = CANDIDATE_MULT[elementKey] ?? 1;
  const maxResultCount = Math.min(20, maxPhotos * mult);

  const body = {
    includedTypes: types,
    maxResultCount,
    rankPreference: rankPref,
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
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
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
    const plat = place.location?.latitude;
    const plng = place.location?.longitude;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
      console.log(`[photos] skipping (no coordinates): ${place.displayName?.text || elementKey}`);
      continue;
    }
    if (!placeInsideNeighborhoodFence(plat, plng, bbox, poly)) {
      console.log(`[photos] skipping outside neighbourhood fence: ${place.displayName?.text || "?"} @ ${plat},${plng}`);
      continue;
    }
    // Skip global chain venues — their photos are generic interiors, not neighbourhood-specific.
    if (isChain(place.displayName?.text)) {
      console.log(`[photos] skipping chain: ${place.displayName?.text}`);
      continue;
    }
    // Skip well-known mega-landmarks that belong to a specific iconic location
    // (e.g. Chapultepec Park) and bleed into adjacent neighbourhoods via POPULARITY.
    if (isBlocklistedLandmark(place.displayName?.text, neighborhoodName)) {
      console.log(`[photos] skipping blocklisted landmark: ${place.displayName?.text}`);
      continue;
    }
    if (elementKey === "parks") {
      const pname = place.displayName?.text;
      if (isPlaygroundLikePlaceName(pname)) {
        console.log(`[photos] skipping playground-like park POI: ${pname}`);
        continue;
      }
      if (!isParkLikePlaceName(pname)) {
        console.log(`[photos] skipping non-green park POI: ${pname}`);
        continue;
      }
    }
    // Museums: positive-check name — reject bazaars, bookstore-cafes, etc. that
    // Google mistags as art_gallery or whose name gives no museum signal.
    if (elementKey === "museums") {
      const pname = place.displayName?.text;
      if (pname && !isMuseumLikePlaceName(pname)) {
        console.log(`[photos] skipping non-museum POI in museums category: ${pname}`);
        continue;
      }
    }
    // Icon spots: reject generic community halls / non-architectural religious venues.
    if (elementKey === "icon_spots") {
      const pname = place.displayName?.text;
      if (!isValidIconSpotName(pname)) {
        console.log(`[photos] skipping non-iconic place in icon_spots: ${pname}`);
        continue;
      }
    }
    // For food/shop categories fetch up to 2 photos per venue to maximise the
    // number of outdoor candidates available for the vision filter.
    const PHOTOS_PER_VENUE = (elementKey === "restaurants" || elementKey === "cafes" || elementKey === "shops") ? 2 : 1;
    const candidatePhotos = place.photos.slice(0, PHOTOS_PER_VENUE);
    for (const photoMeta of candidatePhotos) {
      if (photos.length >= maxPhotos) break;
      const photoName = photoMeta.name;
      const attr = photoMeta.authorAttributions?.[0];
      try {
        const mediaRes = await fetch(
          `${PLACES_MEDIA_BASE}/${photoName}/media?maxWidthPx=900&skipHttpRedirect=true`,
          { headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(10000) }
        );
        if (!mediaRes.ok) continue;
        const mediaData = await mediaRes.json();
        if (!mediaData.photoUri) continue;
        // For parks: vision-check the actual photo content so playground images
        // uploaded to a "park" Place are caught even when the name looks legitimate.
        if (elementKey === "parks" && geminiKey) {
          const isGreen = await geminiVisionIsGreenParkPhoto(mediaData.photoUri, geminiKey);
          if (!isGreen) continue;
        }
        photos.push({
          url:        mediaData.photoUri,
          source:     "google_places",
          query:      place.displayName?.text || elementKey,
          is_fallback: false,
          attribution: attr ? { photographer: attr.displayName, profile_url: attr.uri } : null,
        });
      } catch { continue; }
    }
    if (photos.length >= maxPhotos) break;
  }
  return photos;
}

// ── Wikimedia Commons photo helpers ──────────────────────────────────────────

/**
 * fetchWikimediaPhotos — searches Wikimedia Commons for images matching a query.
 * Free, no API key, no meaningful rate limit. Excellent for named museums,
 * galleries, and historic landmarks — every notable cultural institution in the
 * world has CC-licensed photos on Commons.
 *
 * Uses the MediaWiki generator search so one call returns both search results
 * and image URLs (thumburl at 900px width).
 */
async function fetchWikimediaPhotos(query, maxPhotos = PHOTO_RULES.target) {
  try {
    const params = new URLSearchParams({
      action:       "query",
      generator:    "search",
      gsrsearch:    `${query} filetype:bitmap`,
      gsrnamespace: "6",      // File namespace only
      gsrlimit:     String(Math.min(20, maxPhotos * 4)),
      prop:         "imageinfo",
      iiprop:       "url|extmetadata",
      iiurlwidth:   "900",
      format:       "json",
      origin:       "*",
    });
    const url = `https://commons.wikimedia.org/w/api.php?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});

    const photos = [];
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) continue;

      // Skip non-photo formats
      const title = (page.title || "").toLowerCase();
      if (/\.(svg|pdf|tiff?|xcf|ogg|ogv|webm|flac|mp3|wav)$/.test(title)) continue;

      // Skip strongly portrait images (e.g. portrait paintings) — cards are landscape
      const w = Number(info.extmetadata?.ImageWidth?.value  || 0);
      const h = Number(info.extmetadata?.ImageHeight?.value || 0);
      if (w > 0 && h > 0 && h > w * 1.4) continue;

      // Skip tiny thumbnails
      if (w > 0 && w < 400) continue;

      const artist  = (info.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim() || null;
      const license = info.extmetadata?.LicenseShortName?.value || null;

      photos.push({
        url:        info.thumburl,
        source:     "wikimedia",
        query,
        is_fallback: false,
        attribution: {
          photographer: artist ? `${artist}${license ? ` (${license})` : ""}` : `Wikimedia Commons${license ? ` (${license})` : ""}`,
          profile_url:  `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`,
        },
      });
      if (photos.length >= maxPhotos) break;
    }
    console.log(`[wikimedia] "${query}" → ${photos.length} photos`);
    return photos;
  } catch (e) {
    console.warn(`[wikimedia] fetch failed for "${query}": ${e.message}`);
    return [];
  }
}

// ── Pexels photo helpers ──────────────────────────────────────────────────────

/**
 * fetchPexelsPhotos — searches Pexels for landscape photos matching a query.
 * Free tier: 200 req/hr, 20 000 req/month. Attribution required.
 * Used as a second Unsplash-tier fallback for all categories.
 */
async function fetchPexelsPhotos(query, pexelsKey, perPage = 8) {
  if (!pexelsKey) return [];
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: pexelsKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos || []).map((p) => ({
      url:        p.src.large2x || p.src.large || p.src.original,
      source:     "pexels",
      query,
      is_fallback: false,
      attribution: {
        photographer: p.photographer,
        profile_url:  p.photographer_url,
      },
    }));
  } catch (e) {
    console.warn(`[pexels] fetch failed for "${query}": ${e.message}`);
    return [];
  }
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
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    if (res.status === 429) console.warn(`[unsplash] rate-limited on "${query}" — skipping`);
    return [];
  }
  const data = await res.json();
  return data.results || [];
}

/**
 * fetchFlickrPhotos — geo-bounded search using the Flickr API.
 *
 * Unlike Unsplash (keyword search), Flickr returns photos that were *physically
 * geotagged* inside the supplied bounding box, so photos are guaranteed to show
 * the actual neighbourhood being queried.  Sorted by interestingness (Flickr's
 * quality/engagement signal) and filtered to Creative-Commons-licensed images.
 *
 * Returns an array of normalised photo objects ready for addPick().
 * Rate limit: 3600 req/hr on the free API tier (72× more than Unsplash).
 */
async function fetchFlickrPhotos(bbox, tags, flickrKey, perPage = 8) {
  if (!flickrKey || !bbox) return [];
  const { lat_min, lat_max, lon_min, lon_max } = bbox;
  if (lat_min == null) return [];

  // CC licenses: 1=BY-NC-SA 2=BY-NC 3=BY-NC-ND 4=BY 5=BY-SA 6=BY-ND 9=CC0 10=PDM
  const params = new URLSearchParams({
    method:        "flickr.photos.search",
    api_key:       flickrKey,
    bbox:          `${lon_min},${lat_min},${lon_max},${lat_max}`,
    tags,
    tag_mode:      "any",
    license:       "1,2,4,5,6,9,10",
    safe_search:   "1",
    content_type:  "1",
    sort:          "interestingness-desc",
    extras:        "url_m,url_l,url_c,url_z,owner_name,description",
    per_page:      String(Math.min(perPage, 50)),
    format:        "json",
    nojsoncallback:"1",
  });

  try {
    const res = await fetch(`https://api.flickr.com/services/rest/?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`[flickr] API error ${res.status} for tags="${tags}"`);
      return [];
    }
    const data = await res.json();
    if (data.stat !== "ok") {
      console.warn(`[flickr] API returned stat=${data.stat} for tags="${tags}"`);
      return [];
    }
    const photos = data.photos?.photo || [];
    const result = photos
      .map((p) => {
        const url = p.url_l || p.url_c || p.url_z || p.url_m;
        if (!url) return null;
        return {
          url,
          query: tags,
          source: "flickr",
          attribution: {
            photographer: p.ownername || "Flickr user",
            profile_url:  `https://www.flickr.com/photos/${p.owner}`,
          },
        };
      })
      .filter(Boolean);
    console.log(`[flickr] "${tags}" bbox → ${result.length} photos`);
    return result;
  } catch (e) {
    console.warn(`[flickr] fetch failed (${e.message})`);
    return [];
  }
}

// Flickr tag sets per element category — tuned for travel photography.
// Keep tags broad so the geo-bbox does the heavy filtering.
const FLICKR_TAGS = {
  cafes:       "cafe,coffee,coffeehouse,terrace",
  restaurants: "restaurant,food,dining,terrace,outdoor",
  shops:       "shopping,boutique,market,street,shop",
  street_feel: "street,urban,architecture,neighborhood,alley",
  parks:       "park,garden,green,nature",
  museums:     "museum,art,gallery,architecture",
  icon_spots:  "landmark,monument,architecture,historic",
};

const UNSPLASH_PLAYGROUND_ALT = /\b(playground|swings?|jungle\s*gym|seesaw|see-saw|merry-go-round|playground equipment|kids on slides?|skatepark|skate park)\b/i;
const UNSPLASH_GREEN_CUE = /\b(park|garden|trees?|lawn|meadow|forest|trail|botanic|greenery|greenway|path|landscape|canopy|grass)\b/i;

/**
 * Prefer Unsplash results whose alt text looks like a landscape park, not play equipment.
 */
function rankParkUnsplashResults(results) {
  if (!Array.isArray(results) || results.length === 0) return results;
  const scored = results.map((photo, i) => {
    const text = `${photo.alt_description || ""} ${photo.description || ""}`;
    let score = 0;
    if (UNSPLASH_PLAYGROUND_ALT.test(text)) score -= 3;
    if (UNSPLASH_GREEN_CUE.test(text)) score += 2;
    score += Math.max(0, 1 - i * 0.05);
    return { photo, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((x) => x.score > -2).map((x) => x.photo);
  return filtered.length ? filtered : results;
}

/**
 * fetchElementPhotos — simplified 3-source pipeline:
 *
 *   Step 1 — Flickr geo-bbox  (primary; all 7 categories; CC-licensed permanent URLs)
 *   Step 2 — Wikimedia named  (secondary; museums / icon_spots / parks / street_feel)
 *   Step 3 — Unsplash fallback (graceful degradation when no flickrKey)
 *   Step 4 — Static curated   (absolute last resort, zero-photos guard only)
 *
 * flickrKey: Flickr Pro API key. When present, Google Places, Pexels, and generic
 *   Unsplash templates are all bypassed. Flickr geo-bbox returns photos physically
 *   taken inside the neighbourhood — permanently URL-stable and legally cacheable.
 * sharedDedupeSet: Set shared across all category calls for one neighbourhood so
 *   the same photo cannot appear in two categories (e.g. cafes AND shops).
 */
async function fetchElementPhotos(city, neighborhoodName, elementKey, unsplashKey, bbox = null, googlePlacesKey = null, polygonRing = null, geminiKey = null, photoQueries = null, pexelsKey = null, flickrKey = null, sharedDedupeSet = null) {
  // Local dedupe tracks URLs within this call; sharedDedupeSet tracks URLs
  // across all category calls for the same neighbourhood.
  const localDedupe = new Set();
  const picks = [];

  const addPick = (obj, isOutdoor = true) => {
    if (!obj?.url) return;
    const key = obj.url.split("?")[0];
    if (localDedupe.has(key)) return;
    if (sharedDedupeSet?.has(key)) return;
    localDedupe.add(key);
    sharedDedupeSet?.add(key);
    picks.push(obj);
  };

  const specificQueries = Array.isArray(photoQueries) && photoQueries.length > 0
    ? photoQueries
    : [];

  // Outdoor vision-gate for food categories: prefer outdoor/street shots; accept
  // indoor only when we can't reach the minimum count without them.
  const isFoodCategory = elementKey === "restaurants" || elementKey === "cafes";
  const addWithFoodCheck = async (obj) => {
    if (!obj?.url) return;
    if (isFoodCategory && geminiKey) {
      const isOutdoor = await geminiVisionIsOutdoorFoodPhoto(obj.url, geminiKey);
      if (isOutdoor) {
        addPick(obj, true);
      } else if (picks.length < PHOTO_RULES.min) {
        console.log(`[vision] ${elementKey} indoor accepted (below min): ${obj.query || ""}`);
        addPick(obj, false);
      } else {
        console.log(`[vision] ${elementKey} indoor rejected: ${obj.query || ""}`);
      }
    } else {
      addPick(obj);
    }
  };

  // ── Step 1: Flickr geo-bbox (primary for ALL categories) ─────────────────────
  // Photos are physically geotagged inside the neighbourhood bbox — geo-accurate,
  // CC-licensed, and URL-permanent.  Sorted by interestingness (Flickr quality
  // signal).  Replaces Google Places, Pexels, and generic Unsplash templates.
  if (flickrKey && bbox) {
    const fTags = FLICKR_TAGS[elementKey] || "street,neighborhood";
    // Fetch extra candidates so the food outdoor-filter has headroom to reject some.
    const wantExtra = isFoodCategory ? PHOTO_RULES.target + 6 : PHOTO_RULES.target + 2;
    const fPhotos = await fetchFlickrPhotos(bbox, fTags, flickrKey, wantExtra);
    for (const fp of fPhotos) {
      if (picks.length >= PHOTO_RULES.target) break;
      await addWithFoodCheck(fp);
    }
  }

  // ── Step 2: Wikimedia named search (supplements Flickr for landmark categories)
  // Wikimedia named-place queries ("Museo Soumaya Mexico City") reliably surface
  // the specific canonical exterior/editorial photo of a landmark.  Used for
  // museums, icon_spots, parks, and street_feel — NOT cafes/restaurants/shops
  // (Wikimedia returns interior shots for named commercial venues).
  const WIKI_CATEGORIES = new Set(["museums", "icon_spots", "parks", "street_feel"]);
  if (picks.length < PHOTO_RULES.target && WIKI_CATEGORIES.has(elementKey)) {
    const wikiQueryList = specificQueries.length > 0
      ? [...specificQueries, `${neighborhoodName} ${city}`]
      : (elementKey === "museums" || elementKey === "icon_spots")
        ? [`${neighborhoodName} ${city} ${elementKey === "museums" ? "museum gallery" : "landmark monument"}`, `${neighborhoodName} ${city}`]
        : [`${neighborhoodName} ${city}`];
    for (const q of wikiQueryList) {
      if (picks.length >= PHOTO_RULES.target) break;
      const wikiPhotos = await fetchWikimediaPhotos(q, PHOTO_RULES.target - picks.length);
      wikiPhotos.forEach((p) => addPick(p));
    }
  }

  // ── Step 3: Unsplash fallback (only when Flickr key is absent) ───────────────
  // Graceful degradation so the pipeline produces something during the transition
  // period before a Flickr key is added.  When flickrKey is present this entire
  // block is skipped — Flickr is strictly better (geo-accurate, permanent URLs).
  if (!flickrKey && picks.length < PHOTO_RULES.min) {
    // 3a: named-place specific queries
    const unsplashTarget = elementKey === "street_feel" ? PHOTO_RULES.target : PHOTO_RULES.min;
    for (const q of specificQueries) {
      if (picks.length >= unsplashTarget) break;
      let res = await fetchUnsplashPhotos(q, unsplashKey, PHOTO_RULES.max);
      if (elementKey === "parks") res = rankParkUnsplashResults(res);
      for (const photo of res) {
        if (picks.length >= unsplashTarget) break;
        await addWithFoodCheck(normalizePhotoObject(photo, q, "unsplash_specific"));
      }
    }
    // 3b: generic templates — last resort when specific queries also came up short
    if (picks.length < PHOTO_RULES.min) {
      const genericQueries = buildQueries(elementKey, neighborhoodName, city).filter(Boolean);
      for (const q of genericQueries) {
        if (picks.length >= PHOTO_RULES.min) break;
        let res = await fetchUnsplashPhotos(q, unsplashKey, PHOTO_RULES.max);
        if (elementKey === "parks") res = rankParkUnsplashResults(res);
        for (const photo of res) {
          if (picks.length >= PHOTO_RULES.min) break;
          await addWithFoodCheck(normalizePhotoObject(photo, q, "unsplash"));
        }
      }
    }
  }

  // ── Step 4: Static curated fallbacks — zero-photos guard only ────────────────
  if (picks.length === 0) {
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
async function buildNeighborhoodVibeData({ city, neighborhoodName, attributes, tags, vibeLong, hotelCount, unsplashKey, poiCounts = null, cityMaxCounts = null, bbox = null, polygon = null, googlePlacesKey = null, geminiKey = null, photoQueries = null, pexelsKey = null, flickrKey = null }) {
  const ring = normalizePolygonRing(polygon);
  const areaKm2 = ring?.length >= 4 ? (ringAreaKm2(ring) ?? bboxAreaKm2(bbox)) : bboxAreaKm2(bbox);
  const { scores, shopsSubscores } = computeElementScores(attributes, tags, vibeLong, poiCounts, cityMaxCounts, areaKm2);
  const boopVibe = computeBoopVibe(scores, poiCounts);
  const vibeElements = {};
  const vibePhotos = {};

  // Shared URL dedupe set prevents the same photo from appearing in multiple
  // categories (e.g. a coffee-shop photo ending up in both cafes AND shops).
  const sharedDedupeSet = new Set();

  for (const element of ELEMENTS) {
    const key = element.key;
    const walkability = computeWalkabilityScore(key, attributes);
    vibeElements[key] = buildElementPayload(
      key,
      scores[key] || 0,
      neighborhoodName,
      hotelCount || 0,
      key === "shops" ? shopsSubscores : null,
      poiCounts,
      walkability,
      boopVibe,
    );
    // Per-element photo queries from Gemini (specific named places)
    const elementPhotoQueries = (photoQueries && photoQueries[key]) ? photoQueries[key] : null;
    vibePhotos[key] = await fetchElementPhotos(city, neighborhoodName, key, unsplashKey, bbox, googlePlacesKey, ring, geminiKey, elementPhotoQueries, pexelsKey, flickrKey, sharedDedupeSet);
  }

  return { vibeElements, vibePhotos };
}

module.exports = {
  ELEMENTS,
  PHOTO_RULES,
  POI_CATEGORIES,
  bboxAreaKm2,
  pointInBbox,
  tightFenceFromBbox,
  normalizePolygonRing,
  pointInPolygon,
  bboxFromRing,
  ringAreaKm2,
  ringCentroid,
  maxRadiusFromCentroidM,
  placeInsideNeighborhoodFence,
  fetchOverpassPOIs,
  computeCityMaxCounts,
  buildNeighborhoodVibeData,
  fetchFlickrPhotos,
  isPlaygroundLikePlaceName,
  isParkLikePlaceName,
  isMuseumLikePlaceName,
  isValidIconSpotName,
  geminiVisionCheck,
  geminiVisionIsOutdoorFoodPhoto,
  geminiVisionIsArchitecturalPhoto,
};
