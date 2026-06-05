/**
 * Supabase L2 cache for full-city LiteAPI rates (key ends with |full).
 */
const RATES_CURRENCY_ALLOW = new Set(["EUR", "USD", "GBP", "CAD", "AUD", "MXN"]);

function sanitizeRatesCurrency(q) {
  const c = String(q || "").trim().toUpperCase();
  return RATES_CURRENCY_ALLOW.has(c) ? c : "USD";
}

const RATES_SNAPSHOT_TTL_MS = Math.max(
  60_000,
  Math.min(3_600_000, Number(process.env.RATES_SNAPSHOT_TTL_MS) || 30 * 60 * 1000)
);

function snapshotEnabled() {
  const v = process.env.RATES_SNAPSHOT;
  if (v === "0" || v === "false") return false;
  return v === "1" || v === "true" || v == null || v === "";
}

function buildFullRatesCacheKey(city, checkin, checkout, currency) {
  return `${city}|${checkin}|${checkout}|${sanitizeRatesCurrency(currency)}|full`;
}

function parseCacheKeyDates(cacheKey) {
  if (!cacheKey || typeof cacheKey !== "string") return null;
  const parts = cacheKey.split("|");
  if (parts.length < 5 || parts[parts.length - 1] !== "full") return null;
  return {
    city: parts[0],
    checkin: parts[1],
    checkout: parts[2],
    currency: parts[3],
  };
}

async function readRatesSnapshot(supabase, cacheKey) {
  if (!snapshotEnabled() || !supabase || !cacheKey) return null;
  const { data, error } = await supabase
    .from("rates_snapshots")
    .select("payload, priced_count, fetched_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data?.payload) return null;
  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age > RATES_SNAPSHOT_TTL_MS) return null;
  const payload = data.payload;
  return {
    prices: payload.prices || {},
    roomPrices: payload.roomPrices || {},
    roomNames: payload.roomNames || {},
    offerIds: payload.offerIds || {},
    roomFreeCancel: payload.roomFreeCancel || {},
    hotelFreeCancel: payload.hotelFreeCancel || {},
    currency: payload.currency,
    nights: payload.nights,
    pricedCount: data.priced_count ?? payload.pricedCount ?? 0,
    skip_detail: payload.skip_detail,
    snapshot_hit: true,
    snapshot_age_ms: age,
  };
}

async function writeRatesSnapshot(supabase, cacheKey, result) {
  if (!snapshotEnabled() || !supabase || !cacheKey || !result?.pricedCount) return;
  const meta = parseCacheKeyDates(cacheKey);
  if (!meta) return;
  const payload = {
    prices: result.prices || {},
    roomPrices: result.roomPrices || {},
    roomNames: result.roomNames || {},
    offerIds: result.offerIds || {},
    roomFreeCancel: result.roomFreeCancel || {},
    hotelFreeCancel: result.hotelFreeCancel || {},
    currency: result.currency,
    nights: result.nights,
    pricedCount: result.pricedCount,
    skip_detail: !!result.skip_detail,
  };
  await supabase.from("rates_snapshots").upsert(
    {
      cache_key: cacheKey,
      city: meta.city,
      checkin: meta.checkin,
      checkout: meta.checkout,
      currency: meta.currency,
      payload,
      priced_count: result.pricedCount,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  );
}

module.exports = {
  RATES_SNAPSHOT_TTL_MS,
  snapshotEnabled,
  buildFullRatesCacheKey,
  parseCacheKeyDates,
  readRatesSnapshot,
  writeRatesSnapshot,
  sanitizeRatesCurrency,
};
