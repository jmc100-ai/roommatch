/**
 * Curated neighborhood fences when Nominatim/OSM returns the wrong entity
 * (a building, piazza, or whole borough) instead of a walkable guest area.
 *
 * Add entries here during city QA when verifyNeighborhoodFences fails.
 * bbox only — polygon is derived as an octagon at apply time.
 *
 * @typedef {object} FenceOverride
 * @property {object} [bbox] — { lat_min, lat_max, lon_min, lon_max } (auto from geoAnchor if omitted)
 * @property {{ lat: number, lng: number }} [geoAnchor] — center for radius-based zones
 * @property {number} [geoRadiusMi] — radius miles from geoAnchor
 * @property {number} [geoQuota] — target hotels to index in geo-backfill pass
 * @property {number} [minIndexedHotels] — verify gate minimum hotel_count
 * @property {boolean} [airportQuality] — allow hotel-level photo exception in geo zone
 * @property {number} [minHotelImages] — min hotelImages for airport quality (default 6)
 * @property {boolean} [sparse] — if true, hotel_count=0..2 is OK (legacy; prefer geoQuota)
 * @property {string} [note] — why this override exists (for docs / logs)
 */

const { bboxEnclosingRadius } = require("./geo-index-helpers");

const MIN_FENCE_SPAN = 0.012; // ~1.3 km — below this, hotel_count is unreliable

/** Heathrow T5 — anchor for 3-mile airport corridor zone */
const HEATHROW_T5 = { lat: 51.4700, lng: -0.4543 };
const HEATHROW_RADIUS_MI = 3;

/** London: 12 canonical tourist hotel-search districts only (see london-canonical-districts.js). */
/** @type {Record<string, Record<string, FenceOverride>>} */
const FENCE_OVERRIDES = {
  London: {
    Heathrow: {
      geoAnchor: HEATHROW_T5,
      geoRadiusMi: HEATHROW_RADIUS_MI,
      geoQuota: 50,
      minIndexedHotels: 40,
      airportQuality: true,
      minHotelImages: 6,
      note: "3 mi from T5 — Bath Road / terminal hotels; geo-backfill from London+Hounslow+Hayes+Feltham",
    },
    "Covent Garden": {
      bbox: { lat_min: 51.506, lat_max: 51.518, lon_min: -0.129, lon_max: -0.117 },
      note: "OSM returns the piazza (~100 m), not the theatre district",
    },
    Soho: {
      bbox: { lat_min: 51.508, lat_max: 51.518, lon_min: -0.140, lon_max: -0.127 },
      note: "West End nightlife / Chinatown — distinct from Covent Garden piazza",
    },
    Westminster: {
      bbox: { lat_min: 51.493, lat_max: 51.515, lon_min: -0.145, lon_max: -0.115 },
      note: "OSM returns whole borough (~40 km²); use West End core for counts",
    },
    "South Bank": {
      bbox: { lat_min: 51.498, lat_max: 51.512, lon_min: -0.125, lon_max: -0.105 },
      note: "Thames south bank culture mile",
    },
    "South Kensington": {
      bbox: { lat_min: 51.485, lat_max: 51.505, lon_min: -0.195, lon_max: -0.165 },
      note: "Museum belt + Chelsea hotel strip",
    },
    Marylebone: {
      bbox: { lat_min: 51.514, lat_max: 51.526, lon_min: -0.160, lon_max: -0.140 },
      note: "Gemini/OSM bbox lat span too small for reliable hotel_count",
    },
    "Notting Hill": {
      bbox: { lat_min: 51.507, lat_max: 51.524, lon_min: -0.215, lon_max: -0.187 },
      note: "Portobello / Ladbroke Grove hotel belt",
    },
    Shoreditch: {
      bbox: { lat_min: 51.518, lat_max: 51.532, lon_min: -0.085, lon_max: -0.070 },
      note: "OSM returns a single building on Shoreditch High Street",
    },
    "King's Cross": {
      bbox: { lat_min: 51.528, lat_max: 51.545, lon_min: -0.130, lon_max: -0.112 },
      note: "St Pancras / King's Cross station hub",
    },
    "Canary Wharf": {
      bbox: { lat_min: 51.498, lat_max: 51.515, lon_min: -0.045, lon_max: -0.005 },
      note: "Isle of Dogs / Docklands financial district",
    },
    Paddington: {
      bbox: { lat_min: 51.512, lat_max: 51.528, lon_min: -0.195, lon_max: -0.168 },
      note: "Paddington Station + Bayswater hotel belt",
    },
  },
  // Tokyo, Rome, etc. — add overrides during each city's nbhd QA pass
};

function resolveFenceBbox(entry) {
  if (entry?.bbox?.lat_min != null) return { ...entry.bbox };
  if (entry?.geoAnchor && entry.geoRadiusMi) {
    return bboxEnclosingRadius(entry.geoAnchor.lat, entry.geoAnchor.lng, entry.geoRadiusMi);
  }
  return null;
}

function isDegenerateBbox(bbox) {
  if (bbox?.lat_min == null) return true;
  const latSpan = bbox.lat_max - bbox.lat_min;
  const lonSpan = bbox.lon_max - bbox.lon_min;
  return latSpan < MIN_FENCE_SPAN || lonSpan < MIN_FENCE_SPAN;
}

function bboxSpanLabel(bbox) {
  if (bbox?.lat_min == null) return "missing";
  const latSpan = bbox.lat_max - bbox.lat_min;
  const lonSpan = bbox.lon_max - bbox.lon_min;
  return `${latSpan.toFixed(4)}×${lonSpan.toFixed(4)}°`;
}

/** @returns {(FenceOverride & { bbox: object }) | null} */
function getCuratedNeighborhoodFence(city, name) {
  if (!city || !name) return null;
  const cityKey = String(city).trim();
  const table = FENCE_OVERRIDES[cityKey];
  if (!table) return null;
  const hit = table[name] || (name === "Heathrow Area" ? table.Heathrow : null);
  if (!hit) return null;
  const bbox = resolveFenceBbox(hit);
  if (!bbox) return null;
  return { ...hit, bbox };
}

function listCuratedFenceCities() {
  return Object.keys(FENCE_OVERRIDES);
}

/** Zones that need a post-cap geographic backfill pass. */
function listGeoQuotaFences(city) {
  const table = FENCE_OVERRIDES[String(city || "").trim()];
  if (!table) return [];
  return Object.entries(table)
    .filter(([, entry]) => entry.geoQuota > 0 && entry.geoAnchor && entry.geoRadiusMi)
    .map(([hoodName, entry]) => {
      const bbox = resolveFenceBbox(entry);
      return {
        hoodName,
        ...entry,
        bbox,
      };
    });
}

module.exports = {
  FENCE_OVERRIDES,
  MIN_FENCE_SPAN,
  HEATHROW_T5,
  HEATHROW_RADIUS_MI,
  isDegenerateBbox,
  bboxSpanLabel,
  resolveFenceBbox,
  getCuratedNeighborhoodFence,
  listCuratedFenceCities,
  listGeoQuotaFences,
};
