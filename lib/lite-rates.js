/**
 * Shared LiteAPI /hotels/rates helpers — used by /api/rates and vsearch phase-B embed.
 */
const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";

const LITEAPI_MAX_RATES_PER_HOTEL = Math.max(10, Math.min(300,
  Number(process.env.LITEAPI_MAX_RATES_PER_HOTEL) || 60));

const RATES_DETAIL_TOPN = Math.max(0, Math.min(200,
  Number(process.env.RATES_DETAIL_TOPN ?? 50)));
const RATES_DETAIL_CHUNK = Math.max(5, Math.min(48,
  Number(process.env.RATES_DETAIL_CHUNK ?? 15)));

/** Main-pass batching — one 3500-hotel POST can take ~25s; parallel chunks overlap wall time. */
const RATES_MAIN_CHUNK = Math.max(80, Math.min(600,
  Number(process.env.RATES_MAIN_CHUNK) || 300));
const RATES_MAIN_CONCURRENCY = Math.max(1, Math.min(16,
  Number(process.env.RATES_MAIN_CONCURRENCY) || 10));
const RATES_CACHE_TTL_MS = Math.max(30_000, Math.min(900_000,
  Number(process.env.RATES_CACHE_TTL_MS) || 180_000));

const RATES_CURRENCY_ALLOW = new Set(["EUR", "USD", "GBP", "CAD", "AUD", "MXN"]);

/** In-memory full-city rates cache — keyed by city|checkin|checkout|currency. */
const _ratesResultCache = new Map();

function getCachedRates(cacheKey) {
  if (!cacheKey) return null;
  const entry = _ratesResultCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.ts > RATES_CACHE_TTL_MS) {
    _ratesResultCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function setCachedRates(cacheKey, result) {
  if (!cacheKey || !result) return;
  _ratesResultCache.set(cacheKey, { ts: Date.now(), result });
  if (_ratesResultCache.size > 24) {
    const oldest = [..._ratesResultCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < oldest.length - 20; i++) _ratesResultCache.delete(oldest[i][0]);
  }
}

/** Dedupe concurrent full-city fetches (vsearch prefetch + client /api/rates). */
const _ratesInflight = new Map();

function prefetchCityRatesBackground(cacheKey, hotelIds, checkin, checkout, currency) {
  if (!cacheKey || !hotelIds?.length || getCachedRates(cacheKey) || _ratesInflight.has(cacheKey)) return;
  fetchRatesForHotelIds(hotelIds, checkin, checkout, currency, { skipDetail: true, cacheKey })
    .then((r) => {
      if (r?.pricedCount > 0) {
        const city = String(cacheKey).split("|")[0];
        console.log(
          `[rates-prefetch] ${city}: ${r.pricedCount}/${hotelIds.length} priced in ${r.wall_ms}ms` +
          (r.main_chunks ? ` chunks=${r.main_chunks}` : "")
        );
      }
    })
    .catch((e) => console.warn("[rates-prefetch]", e.message));
}

function buildRatesResult(acc, cur, dateCtx, ids, t0, extra = {}) {
  return {
    prices: acc.prices,
    roomPrices: acc.roomPrices,
    roomNames: acc.roomNames,
    offerIds: acc.offerIds,
    roomFreeCancel: acc.roomFreeCancel,
    hotelFreeCancel: acc.hotelFreeCancel,
    currency: cur,
    nights: dateCtx.nights,
    pricedCount: Object.keys(acc.prices).length,
    wall_ms: Date.now() - t0,
    hotel_ids_fetched: ids.length,
    ...extra,
  };
}

function sanitizeRatesCurrency(q) {
  const c = String(q || "").trim().toUpperCase();
  return RATES_CURRENCY_ALLOW.has(c) ? c : "USD";
}

function liteRateHasFreeCancellation(rate) {
  const pol = rate?.cancellationPolicies;
  if (!pol || typeof pol !== "object") return false;
  if (pol.refundableTag === "NRFN") return false;
  const infos = pol.cancelPolicyInfos;
  if (Array.isArray(infos) && infos.length) {
    if (infos.some((i) => Number(i?.amount) === 0)) return true;
  }
  return pol.refundableTag === "RFN";
}

async function liteRatesCall(hotelIds, checkin, checkout, currency = "USD") {
  const cur = sanitizeRatesCurrency(currency);
  const liteRes = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
    method: "POST",
    headers: { "X-API-Key": LITEAPI_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      hotelIds,
      checkin,
      checkout,
      currency: cur,
      guestNationality: "US",
      occupancies: [{ adults: 2 }],
      maxRatesPerHotel: LITEAPI_MAX_RATES_PER_HOTEL,
      roomMapping: true,
      timeout: 22,
    }),
  });
  if (liteRes.status === 429) {
    const err = new Error("rate_limited");
    err.status = 429;
    throw err;
  }
  if (!liteRes.ok) {
    const err = new Error("liteapi_error_" + liteRes.status);
    err.status = liteRes.status;
    throw err;
  }
  const json = await liteRes.json();
  return json?.data?.rates ?? json?.data ?? json?.rates ?? [];
}

function mergeLiteRatesIntoMaps(ratesList, nights, acc) {
  let totalRoomTypes = 0, withMappedId = 0, newMappedIds = 0;
  for (const hotel of ratesList) {
    const hotelId = hotel.hotelId;
    for (const rt of (hotel.roomTypes || [])) {
      totalRoomTypes++;
      const total = rt.rates?.[0]?.retailRate?.total?.[0]?.amount;
      if (!total || total <= 0) continue;
      const perNight = Math.round(total / nights);

      const firstRate = rt.rates?.[0];
      const fcThis = liteRateHasFreeCancellation(firstRate);
      if (fcThis) acc.hotelFreeCancel[hotelId] = true;

      if (!acc.prices[hotelId] || perNight < acc.prices[hotelId]) {
        acc.prices[hotelId] = perNight;
      }

      const mappedRoomId = firstRate?.mappedRoomId;
      if (mappedRoomId) {
        withMappedId++;
        const key = String(mappedRoomId);
        if (!acc.roomPrices[hotelId]) acc.roomPrices[hotelId] = {};
        const existing = acc.roomPrices[hotelId][key];
        if (existing == null) newMappedIds++;
        if (existing == null || perNight < existing) {
          acc.roomPrices[hotelId][key] = perNight;
          if (firstRate?.name) {
            if (!acc.roomNames[hotelId]) acc.roomNames[hotelId] = {};
            acc.roomNames[hotelId][key] = String(firstRate.name).slice(0, 120);
          }
          const offerId = firstRate?.offerId || firstRate?.offer_id;
          if (offerId) {
            if (!acc.offerIds[hotelId]) acc.offerIds[hotelId] = {};
            acc.offerIds[hotelId][key] = offerId;
          }
          if (!acc.roomFreeCancel[hotelId]) acc.roomFreeCancel[hotelId] = {};
          acc.roomFreeCancel[hotelId][key] = fcThis;
        }
      }
    }
  }
  return { totalRoomTypes, withMappedId, newMappedIds };
}

function emptyRatesAcc() {
  return {
    prices: {},
    roomPrices: {},
    roomNames: {},
    offerIds: {},
    roomFreeCancel: {},
    hotelFreeCancel: {},
  };
}

function parseRatesNights(checkin, checkout) {
  if (!checkin || !checkout) return null;
  let nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  if (nights < 1) return null;
  let co = checkout;
  if (nights > 30) {
    const capped = new Date(checkin);
    capped.setDate(capped.getDate() + 30);
    co = capped.toISOString().slice(0, 10);
    nights = 30;
  }
  return { checkin, checkout: co, nights };
}

async function runDetailPass(hotelIds, checkin, checkout, currency, nights, acc) {
  const detailIds = hotelIds.slice(0, RATES_DETAIL_TOPN);
  if (!detailIds.length) return { newRoomRates: 0, callsOk: 0, callsFail: 0 };

  const numChunks = Math.ceil(detailIds.length / RATES_DETAIL_CHUNK);
  const chunks = Array.from({ length: numChunks }, () => []);
  for (let i = 0; i < detailIds.length; i++) {
    chunks[i % numChunks].push(detailIds[i]);
  }

  const results = await Promise.allSettled(
    chunks.map((ids) => liteRatesCall(ids, checkin, checkout, currency))
  );
  let newRoomRates = 0, callsOk = 0, callsFail = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      callsOk++;
      const s = mergeLiteRatesIntoMaps(r.value, nights, acc);
      newRoomRates += s.newMappedIds;
    } else {
      callsFail++;
    }
  }
  return { newRoomRates, callsOk, callsFail, detailIds: detailIds.length };
}

/** Run main rates pass — parallel chunks when cohort exceeds RATES_MAIN_CHUNK. */
async function runMainPass(hotelIds, checkin, checkout, currency, nights) {
  if (hotelIds.length <= RATES_MAIN_CHUNK) {
    const ratesList = await liteRatesCall(hotelIds, checkin, checkout, currency);
    const acc = emptyRatesAcc();
    mergeLiteRatesIntoMaps(ratesList, nights, acc);
    return { acc, rateLimited: false, mainChunks: 1, mainCallsOk: 1, mainCallsFail: 0 };
  }

  const chunks = [];
  for (let i = 0; i < hotelIds.length; i += RATES_MAIN_CHUNK) {
    chunks.push(hotelIds.slice(i, i + RATES_MAIN_CHUNK));
  }

  const acc = emptyRatesAcc();
  let rateLimited = false;
  let mainCallsOk = 0;
  let mainCallsFail = 0;
  let nextChunk = 0;
  const workers = Math.min(RATES_MAIN_CONCURRENCY, chunks.length);

  async function worker() {
    while (nextChunk < chunks.length) {
      const idx = nextChunk++;
      try {
        const ratesList = await liteRatesCall(chunks[idx], checkin, checkout, currency);
        mergeLiteRatesIntoMaps(ratesList, nights, acc);
        mainCallsOk++;
      } catch (e) {
        mainCallsFail++;
        if (e.status === 429) rateLimited = true;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { acc, rateLimited, mainChunks: chunks.length, mainCallsOk, mainCallsFail };
}

/**
 * Fetch LiteAPI rates for a hotel-id cohort.
 * @param {string[]} hotelIds
 * @param {{ skipDetail?: boolean, cacheKey?: string }} opts — skipDetail=true for fast vsearch embed (main pass only).
 */
async function fetchRatesForHotelIds(hotelIds, checkin, checkout, currency = "USD", opts = {}) {
  const ids = (hotelIds || []).map(String).filter(Boolean);
  const dateCtx = parseRatesNights(checkin, checkout);
  if (!ids.length || !dateCtx) return null;

  const cur = sanitizeRatesCurrency(currency);
  const cacheKey = opts.cacheKey || null;

  if (cacheKey) {
    const cached = getCachedRates(cacheKey);
    if (cached) {
      return { ...cached, wall_ms: 0, cache_hit: true, hotel_ids_fetched: ids.length };
    }
    if (_ratesInflight.has(cacheKey)) {
      return _ratesInflight.get(cacheKey);
    }
  }

  const runFetch = async () => {
  const t0 = Date.now();
  let acc;
  let rateLimited = false;
  let mainStats = null;

  try {
    const main = await runMainPass(ids, dateCtx.checkin, dateCtx.checkout, cur, dateCtx.nights);
    acc = main.acc;
    rateLimited = main.rateLimited;
    mainStats = {
      main_chunks: main.mainChunks,
      main_calls_ok: main.mainCallsOk,
      main_calls_fail: main.mainCallsFail,
    };
  } catch (e) {
    const accEmpty = emptyRatesAcc();
    return buildRatesResult(accEmpty, cur, dateCtx, ids, t0, {
      pricedCount: 0,
      rateLimited: e.status === 429,
      error: e.message,
      skip_detail: !!opts.skipDetail,
    });
  }

  let detailStats = null;
  if (!opts.skipDetail && RATES_DETAIL_TOPN > 0 && ids.length >= 50) {
    detailStats = await runDetailPass(ids, dateCtx.checkin, dateCtx.checkout, cur, dateCtx.nights, acc);
  }

  const result = buildRatesResult(acc, cur, dateCtx, ids, t0, {
    skip_detail: !!opts.skipDetail,
    detail_stats: detailStats,
    rateLimited,
    ...mainStats,
  });

  if (cacheKey && result.pricedCount > 0) {
    setCachedRates(cacheKey, {
      prices: result.prices,
      roomPrices: result.roomPrices,
      roomNames: result.roomNames,
      offerIds: result.offerIds,
      roomFreeCancel: result.roomFreeCancel,
      hotelFreeCancel: result.hotelFreeCancel,
      currency: result.currency,
      nights: result.nights,
      pricedCount: result.pricedCount,
      skip_detail: result.skip_detail,
    });
  }

  return result;
  };

  if (cacheKey) {
    const inflight = runFetch();
    _ratesInflight.set(cacheKey, inflight);
    try {
      return await inflight;
    } finally {
      _ratesInflight.delete(cacheKey);
    }
  }

  return runFetch();
}

module.exports = {
  sanitizeRatesCurrency,
  liteRateHasFreeCancellation,
  mergeLiteRatesIntoMaps,
  liteRatesCall,
  fetchRatesForHotelIds,
  parseRatesNights,
  getCachedRates,
  prefetchCityRatesBackground,
  RATES_DETAIL_TOPN,
  RATES_DETAIL_CHUNK,
  RATES_MAIN_CHUNK,
  RATES_MAIN_CONCURRENCY,
  LITEAPI_MAX_RATES_PER_HOTEL,
};
