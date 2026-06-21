/**
 * Canonical city config for V2 indexing, rollout, and launch CLI.
 * Single source for LiteAPI names, country codes, and triaged quality policy.
 */

/** @typedef {object} CityConfig
 * @property {string} displayName — DB / UI city key
 * @property {string} liteapiCityName — LiteAPI catalog `cityName`
 * @property {string} countryCode — ISO 3166-1 alpha-2
 * @property {'mega'|'large'|'medium'|'small'|'live'} [tier]
 * @property {number} indexCap — stop after N indexed hotels; 0 = no cap
 * @property {number} minStars — catalog pre-filter (inclusive)
 * @property {number} minGuestRating — allow stars=0 when rating >= this
 * @property {number} minRoomPhotos — per-room-type photo floor
 * @property {string[]} [liteapiSatelliteCities] — extra LiteAPI cityName lists merged into catalog (e.g. Hounslow for London)
 * @property {number} [verifyMinHotels]
 * @property {number} [verifyMinInventory]
 * @property {number} [verifyMinRoomTypes]
 * @property {number} [verifyMinFacts]
 * @property {number} [minNeighborhoodCoveragePct] — min share of geocoded hotels inside any nbhd fence (0–1)
 */

const DEFAULTS = {
  indexCap: 0,
  minStars: 2,
  minGuestRating: 0,
  minRoomPhotos: 2,
};

/** @type {CityConfig[]} */
const CITY_LIST = [
  // Live / reference cities (no index cap — already complete)
  { displayName: "Mexico City", liteapiCityName: "Mexico City", countryCode: "MX", tier: "live", indexCap: 0, minStars: 2, minGuestRating: 0 },
  { displayName: "Paris", liteapiCityName: "Paris", countryCode: "FR", tier: "live", indexCap: 0, minStars: 2, minGuestRating: 0 },
  { displayName: "Kuala Lumpur", liteapiCityName: "Kuala Lumpur", countryCode: "MY", tier: "live", indexCap: 0, minStars: 2, minGuestRating: 0 },

  // Next 10 launch queue
  {
    displayName: "London",
    liteapiCityName: "London",
    countryCode: "GB",
    tier: "mega",
    indexCap: 4000,
    minStars: 3,
    minGuestRating: 7.0,
    liteapiSatelliteCities: ["Hounslow", "Hayes", "Feltham"],
    minNeighborhoodCoveragePct: 0.99,
  },
  { displayName: "Tokyo", liteapiCityName: "Tokyo", countryCode: "JP", tier: "large", indexCap: 4000, minStars: 3, minGuestRating: 7.0, minNeighborhoodCoveragePct: 0.70 },
  { displayName: "Rome", liteapiCityName: "Rome", countryCode: "IT", tier: "mega", indexCap: 4000, minStars: 3, minGuestRating: 7.0, minNeighborhoodCoveragePct: 0.70 },
  { displayName: "Barcelona", liteapiCityName: "Barcelona", countryCode: "ES", tier: "medium", indexCap: 3500, minStars: 3, minGuestRating: 7.0 },
  { displayName: "Lisbon", liteapiCityName: "Lisbon", countryCode: "PT", tier: "large", indexCap: 4000, minStars: 3, minGuestRating: 7.0 },
  { displayName: "Bangkok", liteapiCityName: "Bangkok", countryCode: "TH", tier: "medium", indexCap: 3500, minStars: 3, minGuestRating: 7.0 },
  { displayName: "Istanbul", liteapiCityName: "Istanbul", countryCode: "TR", tier: "large", indexCap: 4000, minStars: 3, minGuestRating: 7.0 },
  { displayName: "Amsterdam", liteapiCityName: "Amsterdam", countryCode: "NL", tier: "small", indexCap: 0, minStars: 2, minGuestRating: 0 },
  { displayName: "Athens", liteapiCityName: "Athens", countryCode: "GR", tier: "mega", indexCap: 4000, minStars: 3, minGuestRating: 7.0, minNeighborhoodCoveragePct: 0.70 },
  { displayName: "New York City", liteapiCityName: "New York", countryCode: "US", tier: "small", indexCap: 0, minStars: 2, minGuestRating: 0 },
];

const ALIASES = {
  nyc: "New York City",
  "new york": "New York City",
  nycity: "New York City",
  cdmx: "Mexico City",
  kl: "Kuala Lumpur",
};

const BY_DISPLAY = new Map(CITY_LIST.map((c) => [c.displayName.toLowerCase(), c]));

/** @deprecated use resolveCityConfig — map displayName → countryCode */
const COUNTRY_CODES = Object.fromEntries(
  CITY_LIST.map((c) => [c.displayName.toLowerCase(), c.countryCode]),
);

/**
 * @param {string} input
 * @returns {CityConfig & typeof DEFAULTS}
 */
function resolveCityConfig(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("city name required");
  const aliasTarget = ALIASES[raw.toLowerCase()];
  const canonical = aliasTarget || raw;
  const hit = BY_DISPLAY.get(canonical.toLowerCase());
  if (hit) return { ...DEFAULTS, ...hit };
  // Unknown city — pass through with no cap (legacy behaviour)
  return {
    ...DEFAULTS,
    displayName: canonical,
    liteapiCityName: canonical,
    countryCode: "",
    tier: "medium",
  };
}

/**
 * @param {import('./city-registry').CityConfig} cfg
 */
function passesCatalogFilter(hotel, cfg) {
  const stars = Number(hotel.stars ?? hotel.starRating ?? 0);
  const rating = Number(hotel.rating ?? hotel.guestRating ?? 0);
  if (stars >= cfg.minStars) return true;
  if (stars === 0 && cfg.minGuestRating > 0 && rating >= cfg.minGuestRating) return true;
  return false;
}

/**
 * @param {import('./city-registry').CityConfig} cfg
 */
function getCoverageThreshold(cfg) {
  if (cfg.minNeighborhoodCoveragePct != null) return cfg.minNeighborhoodCoveragePct;
  if (cfg.tier === "mega" || cfg.tier === "large") return 0.70;
  if ((cfg.indexCap || 0) > 0) return 0.65;
  return 0.55;
}

function getVerifyThresholds(cfg) {
  const cap = cfg.indexCap || 0;
  if (cfg.verifyMinHotels != null) {
    return {
      minHotels: cfg.verifyMinHotels,
      minInventory: cfg.verifyMinInventory ?? 1000,
      minRoomTypes: cfg.verifyMinRoomTypes ?? 100,
      minFacts: cfg.verifyMinFacts ?? 1000,
    };
  }
  if (cap > 0) {
    return {
      minHotels: Math.max(100, Math.floor(cap * 0.12)),
      minInventory: Math.max(1000, Math.floor(cap * 12)),
      minRoomTypes: Math.max(100, Math.floor(cap * 0.12)),
      minFacts: Math.max(1000, Math.floor(cap * 12)),
    };
  }
  return { minHotels: 100, minInventory: 1000, minRoomTypes: 100, minFacts: 1000 };
}

function countryCode(city) {
  return resolveCityConfig(city).countryCode;
}

function listLaunchCities() {
  return CITY_LIST.filter((c) => c.tier !== "live").map((c) => c.displayName);
}

/** @param {CityConfig & typeof DEFAULTS} cfg */
function listLiteapiCatalogCities(cfg) {
  const primary = cfg.liteapiCityName || cfg.displayName;
  const satellites = cfg.liteapiSatelliteCities || [];
  return [primary, ...satellites.filter((c) => c && c !== primary)];
}

module.exports = {
  CITY_LIST,
  COUNTRY_CODES,
  DEFAULTS,
  ALIASES,
  resolveCityConfig,
  passesCatalogFilter,
  getVerifyThresholds,
  getCoverageThreshold,
  countryCode,
  listLaunchCities,
  listLiteapiCatalogCities,
};
