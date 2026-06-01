#!/usr/bin/env node
/**
 * V2 comprehensive QA — Boop searches, performance, sort invariants, vibe signals,
 * hotel detail pages. Mexico City + Paris.
 *
 *   node scripts/audit-v2-comprehensive-suite.js
 *   node scripts/audit-v2-comprehensive-suite.js --count=150 --delay=280
 *   node scripts/audit-v2-comprehensive-suite.js --base-url=http://localhost:3000
 *
 * Writes: reports/v2-comprehensive-audit-<date>-seed<N>.md
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
const { STAY_VIBE_TO_VISUAL_STYLE } = require("../scripts/fact-catalog");
const {
  roomVibeMatchDisplayPct,
  bestMatchRoomScore,
  hotelEffectiveScore,
  sortHotelsBestMatch,
  sortHotelsBestMatchLegacy,
  boopPriceMattersForSort,
} = require("../lib/client-match-sort");
const { getBaseUrl } = require("./search-test-lib");

const BASE_URL = getBaseUrl(process.argv);
const COUNT = Number((process.argv.find((a) => a.startsWith("--count=")) || "").split("=")[1]) || 150;
const SEED_ARG = (process.argv.find((a) => a.startsWith("--seed=")) || "").split("=")[1];
const SEED = SEED_ARG === "random" || !SEED_ARG
  ? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
  : Number(SEED_ARG);
const DELAY_MS = Number((process.argv.find((a) => a.startsWith("--delay=")) || "").split("=")[1]) || 280;
const DETAIL_SAMPLE_PER_CITY = Number((process.argv.find((a) => a.startsWith("--detail=")) || "").split("=")[1]) || 15;
const HVB = 0.2;

const TRIPS = ["first", "repeat", "expert"];
const STAY_VIBES = ["sleek_polished", "cozy_warm", "distinct_unique", "simple_value"];
const NBHD_SCENES = ["buzz_central", "calm_central", "hip_local", "leafy_local", "scenic_open"];
const PRICE_OPTS = [0, 30, 50, 80, 100, -30, -50, -80, -100];
const GROUPS = ["solo", "couple", "family"];
const DEAL_POOL = [[], ["balcony"], ["work_desk"], ["spa_bathroom"], ["free_cancellation"]];
const FREETEXT_POOL = ["", "", "double sinks and rainfall shower", "quiet room away from street", "rooftop bar nearby", "king bed city view"];

function mulberry32(a) {
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function addDays(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateCases(n, seed) {
  const rng = mulberry32(seed);
  const cities = ["Mexico City", "Paris"];
  const cases = [];
  let i = 0;

  // Stratified grid: cover trip × stayVibe × nbhdScene for both cities (up to ~80)
  for (const city of cities) {
    for (const trip of TRIPS) {
      for (const stayVibe of STAY_VIBES) {
        for (const nbhdScene of NBHD_SCENES) {
          if (cases.length >= Math.min(80, Math.floor(n * 0.55))) break;
          cases.push({
            id: `grid_${String(++i).padStart(3, "0")}`,
            city,
            dates: rng() < 0.55,
            answers: {
              trip,
              stayVibe,
              nbhdScene,
              group_size: pick(rng, GROUPS),
              priceMatters: pick(rng, [0, 0, 50, 80, -50]),
            },
            dealbreakers: pick(rng, DEAL_POOL),
            freetext: pick(rng, FREETEXT_POOL),
          });
        }
      }
    }
  }

  while (cases.length < n) {
    cases.push({
      id: `rnd_${String(++i).padStart(3, "0")}`,
      city: pick(rng, cities),
      dates: rng() < 0.52,
      answers: {
        trip: pick(rng, TRIPS),
        stayVibe: pick(rng, STAY_VIBES),
        nbhdScene: pick(rng, NBHD_SCENES),
        group_size: pick(rng, GROUPS),
        priceMatters: pick(rng, PRICE_OPTS),
      },
      dealbreakers: pick(rng, DEAL_POOL),
      freetext: pick(rng, FREETEXT_POOL),
    });
  }

  const base = "2026-06-18";
  for (const c of cases) {
    if (!c.dates) {
      c.checkin = null;
      c.checkout = null;
      continue;
    }
    const offset = 5 + Math.floor(rng() * 25);
    const nights = 2 + Math.floor(rng() * 6);
    c.checkin = addDays(base, offset);
    c.checkout = addDays(c.checkin, nights);
  }

  return cases.slice(0, n);
}

function apiHeaders() {
  const h = { Accept: "application/json" };
  if (process.env.INDEX_SECRET) h["x-index-secret"] = process.env.INDEX_SECRET;
  return h;
}

async function fetchJson(url, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: apiHeaders(), signal: ctrl.signal });
    const text = await res.text();
    const clientMs = Date.now() - t0;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return { data: JSON.parse(text), clientMs };
  } finally {
    clearTimeout(t);
  }
}

async function callVsearch(caseDef, profile) {
  const { roomSeed, hotelSeed, mustHaves } = buildBoopSeeds(profile);
  const params = new URLSearchParams({
    query: roomSeed,
    city: caseDef.city,
    search_version: "v2",
    hotel_query: hotelSeed,
    boop_profile: JSON.stringify(profile),
  });
  if (mustHaves.length) params.set("must_haves", mustHaves.join(","));
  if (caseDef.checkin && caseDef.checkout) {
    params.set("checkin", caseDef.checkin);
    params.set("checkout", caseDef.checkout);
    params.set("currency", "USD");
  }
  return fetchJson(`${BASE_URL}/api/vsearch?${params}`);
}

async function callRates(caseDef, hotelIds) {
  const params = new URLSearchParams({
    city: caseDef.city,
    checkin: caseDef.checkin,
    checkout: caseDef.checkout,
    currency: "USD",
    hotelIds: hotelIds.slice(0, 200).join(","),
  });
  return fetchJson(`${BASE_URL}/api/rates?${params}`, 90000);
}

async function callHotelDetail(hotelId) {
  return fetchJson(`${BASE_URL}/api/hotel/${encodeURIComponent(hotelId)}`, 45000);
}

function cloneHotels(hotels) {
  return hotels.map((h) => ({
    ...h,
    roomTypes: (h.roomTypes || []).map((rt) => ({ ...rt, photos: rt.photos ? [...rt.photos] : [] })),
    roomPrices: h.roomPrices ? { ...h.roomPrices } : undefined,
  }));
}

function mergeRates(hotels, ratesData) {
  const prices = ratesData.prices || {};
  const roomPrices = ratesData.roomPrices || {};
  for (const h of hotels) {
    const id = String(h.id);
    h.price = prices[id] != null ? Number(prices[id]) : null;
    h.roomPrices = roomPrices[id] ? { ...roomPrices[id] } : null;
  }
  return Number(ratesData.pricedCount) || 0;
}

function primaryApprox(h) {
  const v = Number(h.vectorScore) || 0;
  const hv = Number(h.hotelScore);
  let ps = v;
  if (Number.isFinite(hv) && hv > 0) ps = (1 - HVB) * v + HVB * hv;
  return ps;
}

function serverBlend(h, w) {
  const ps = primaryApprox(h);
  if (w > 0 && h.nbhd_fit_pct != null) return (1 - w) * ps + w * h.nbhd_fit_pct;
  return ps;
}

function extractPerf(stats, clientMs, ratesClientMs) {
  const perf = stats?.perf_ms || {};
  return {
    client_ms: clientMs,
    handler_wall_ms: stats?.handler_wall_ms ?? null,
    meta_sync_ms: stats?.meta_sync_ms ?? null,
    meta_sync_count: stats?.meta_sync_count ?? null,
    deferred_meta: (stats?.deferred_meta_ids || []).length,
    phase_a_ms: perf.phase_a_ms ?? null,
    phase_b_ms: perf.phase_b_ms ?? null,
    nlp_intent_ms: perf.nlp_intent_ms ?? null,
    scoring_ms: perf.scoring_ms ?? null,
    post_boop_ms: perf.post_boop_ms ?? null,
    wall_ms: perf.wall_ms ?? null,
    rates_embed_ms: perf.rates_embed_ms ?? null,
    rates_embed_wait_ms: perf.rates_embed_wait_ms ?? null,
    rates_embed_count: perf.rates_embed_count ?? null,
    rates_tail_pending: perf.rates_tail_pending ?? false,
    rates_client_ms: ratesClientMs ?? null,
  };
}

function sortByPrice(hotels, asc = true) {
  const copy = [...hotels];
  copy.sort((a, b) => {
    const pa = a.price != null ? a.price : asc ? Infinity : -Infinity;
    const pb = b.price != null ? b.price : asc ? Infinity : -Infinity;
    return asc ? pa - pb : pb - pa;
  });
  return copy;
}

function sortByGuestRating(hotels, reverse = false) {
  const copy = [...hotels];
  copy.sort((a, b) => {
    const ra = Number(a.rating) || Number(a.guestRating) || 0;
    const rb = Number(b.rating) || Number(b.guestRating) || 0;
    return reverse ? ra - rb : rb - ra;
  });
  return copy;
}

function auditSortModes(sorted, hotels, ctx) {
  const findings = [];
  if (!ctx.pricesLoaded) return findings;

  const priced = hotels.filter((h) => h.price != null);
  if (priced.length < 8) return findings;

  const priceAsc = sortByPrice(priced, true).slice(0, 10);
  for (let i = 1; i < priceAsc.length; i++) {
    if (priceAsc[i].price < priceAsc[i - 1].price - 0.01) {
      findings.push({
        code: "PRICE_SORT_BROKEN",
        severity: "high",
        detail: `asc #${i} $${priceAsc[i].price} < #${i - 1} $${priceAsc[i - 1].price}`,
      });
      break;
    }
  }

  const ratingDesc = sortByGuestRating(hotels.filter((h) => h.rating || h.guestRating)).slice(0, 8);
  for (let i = 1; i < ratingDesc.length; i++) {
    const ra = Number(ratingDesc[i - 1].rating) || Number(ratingDesc[i - 1].guestRating);
    const rb = Number(ratingDesc[i].rating) || Number(ratingDesc[i].guestRating);
    if (rb > ra + 0.05) {
      findings.push({
        code: "RATING_SORT_BROKEN",
        severity: "medium",
        detail: `#${i + 1} rating ${rb} > #${i} ${ra}`,
      });
      break;
    }
  }

  return findings;
}

function auditVibeSignals(caseDef, data, sorted) {
  const findings = [];
  const stayVibe = caseDef.answers.stayVibe;
  const expectedStyle = STAY_VIBE_TO_VISUAL_STYLE[stayVibe];
  const stats = data.stats || {};
  const top10 = sorted.slice(0, 10);

  if (stats.hotel_vibe_model && stats.hotel_vibe_model !== "v2_facts") {
    findings.push({
      code: "VIBE_MODEL_FALLBACK",
      severity: "medium",
      detail: `expected v2_facts, got ${stats.hotel_vibe_model}`,
    });
  }

  const weights = stats.hotel_vibe_fact_weights || {};
  if (expectedStyle && Object.keys(weights).length && !weights[expectedStyle]) {
    findings.push({
      code: "VIBE_WEIGHT_MISSING",
      severity: "medium",
      detail: `stayVibe=${stayVibe} missing ${expectedStyle} in fact_weights`,
    });
  }

  const scored = top10.filter((h) => Number(h.hotelScore) > 0);
  if (stats.hotel_vibe_model === "v2_facts" && scored.length < 4) {
    findings.push({
      code: "VIBE_SCORE_SPARSE_TOP10",
      severity: "low",
      detail: `only ${scored.length}/10 top hotels have hotelScore>0`,
    });
  }

  // Top hotel should not be a hostel when sleek_polished (property type penalty)
  if (stayVibe === "sleek_polished") {
    const h0 = top10[0];
    if (h0?.propertyType === "hostel" || h0?.property_type === "hostel") {
      findings.push({
        code: "HOSTEL_TOP_SLEEK",
        severity: "high",
        detail: `#1 ${h0.id} is hostel for sleek_polished query`,
      });
    }
  }

  if (stats.nbhd_blend_applied) {
    const withNbhd = top10.filter((h) => h.nbhd_fit_pct != null).length;
    if (withNbhd < 6) {
      findings.push({
        code: "NBHD_BLEND_SPARSE",
        severity: "medium",
        detail: `only ${withNbhd}/10 have nbhd_fit_pct with blend on`,
      });
    }
  }

  return findings;
}

function auditCase(caseDef, data, sorted, sortedLegacy, ctx) {
  const findings = [];
  const top = sorted.slice(0, 15);
  const top10 = sorted.slice(0, 10);
  const apiTop = (data.hotels || []).slice(0, 10);
  const { meta } = sortHotelsBestMatch(cloneHotels(data.hotels || []), data.stats || {}, buildBoopProfile(caseDef.answers, caseDef.dealbreakers, caseDef.freetext), ctx);
  const sortScore = meta.sortScore;
  const w = typeof data.stats?.nbhd_rank_weight === "number" ? data.stats.nbhd_rank_weight : 0;
  const pm = boopPriceMattersForSort(buildBoopProfile(caseDef.answers, caseDef.dealbreakers, caseDef.freetext));

  for (let i = 1; i < top.length; i++) {
    const prev = sortScore(top[i - 1]);
    const cur = sortScore(top[i]);
    if (cur > prev + 0.05) {
      findings.push({
        code: "SORT_NON_MONOTONIC",
        severity: "high",
        detail: `#${i} ${top[i].id} sort=${cur.toFixed(1)} > #${i + 1} ${top[i - 1].id} sort=${prev.toFixed(1)}`,
      });
      break;
    }
  }

  if (ctx.showAvailOnly && ctx.hasDateSearch && ctx.pricesLoaded) {
    for (let i = 0; i < top10.length; i++) {
      const h = top10[i];
      const display = roomVibeMatchDisplayPct(h);
      const sortRoom = bestMatchRoomScore(h);
      if (Math.abs(display - sortRoom) >= 3) {
        findings.push({
          code: "DISPLAY_VS_SORT_ROOM",
          severity: "high",
          detail: `#${i + 1} ${h.id} badge=${display}% sortRoom=${sortRoom}%`,
        });
      }
    }
  }

  const fixedTop3 = top10.slice(0, 3).map((h) => h.id).join(",");
  const legacyTop3 = sortedLegacy.slice(0, 3).map((h) => h.id).join(",");
  if (fixedTop3 !== legacyTop3) {
    findings.push({ code: "FIXED_VS_LEGACY_TOP3", severity: "medium", detail: `fixed=[${fixedTop3}] legacy=[${legacyTop3}]` });
  }

  const apiTop3 = apiTop.slice(0, 3).map((h) => h.id).join(",");
  if (apiTop3 !== fixedTop3) {
    findings.push({ code: "API_VS_CLIENT_TOP3", severity: "info", detail: `api=[${apiTop3}] client=[${fixedTop3}]` });
  }

  if (Math.abs(pm) <= 32) {
    for (let a = 0; a < top10.length; a++) {
      for (let b = a + 1; b < top10.length; b++) {
        const hi = top10[a];
        const lo = top10[b];
        const roomHi = bestMatchRoomScore(hi);
        const roomLo = bestMatchRoomScore(lo);
        const nbhdHi = hi.nbhd_fit_pct ?? 0;
        const nbhdLo = lo.nbhd_fit_pct ?? 0;
        if (roomLo - roomHi >= 15 && Math.abs(nbhdLo - nbhdHi) <= 8 && a < b) {
          findings.push({
            code: "ROOM_GAP_IGNORED",
            severity: "high",
            detail: `#${a + 1} ${hi.id} room=${roomHi} beats #${b + 1} ${lo.id} room=${roomLo}`,
          });
        }
      }
    }
  }

  const stubs = top10.filter((h) => !(h.roomTypes || []).length).length;
  if (stubs > 3) {
    findings.push({ code: "STUB_HEAVY_TOP10", severity: "medium", detail: `${stubs}/10 cards lack room photos` });
  }

  for (let i = 0; i < Math.min(10, top10.length); i++) {
    const h = top10[i];
    if (data.stats?.nbhd_blend_applied && h.nbhd_fit_pct == null) {
      findings.push({ code: "MISSING_NBHD", severity: "medium", detail: `#${i + 1} ${h.id}` });
    }
    if (!h.name || h.name === "Hotel" || h.name === h.id) {
      if (i < 5) findings.push({ code: "WEAK_NAME_TOP5", severity: "low", detail: `#${i + 1} ${h.id}` });
    }
  }

  findings.push(...auditVibeSignals(caseDef, data, sorted));
  findings.push(...auditSortModes(sorted, cloneHotels(data.hotels || []), ctx));

  return findings;
}

function auditHotelDetailPayload(hotelId, payload) {
  const issues = [];
  if (!payload.name || payload.name === hotelId || payload.name === "Hotel") {
    issues.push("weak_or_missing_name");
  }
  if (!payload.city) issues.push("missing_city");
  const roomTypes = payload.room_types || [];
  if (!roomTypes.length) issues.push("no_room_types");
  const photoCount =
    (payload.hotel_photos || []).length +
    roomTypes.reduce((s, rt) => s + (rt.photos || []).length, 0);
  if (photoCount === 0) issues.push("no_photos");
  if (!payload.description && !(payload.amenities || []).length) {
    issues.push("sparse_liteapi_meta");
  }
  if (payload.star_rating == null && payload.guest_rating == null) {
    issues.push("no_ratings");
  }
  return issues;
}

async function runCase(caseDef) {
  const profile = buildBoopProfile(caseDef.answers, caseDef.dealbreakers, caseDef.freetext);
  const t0 = Date.now();
  let ratesClientMs = null;

  const { data, clientMs: vsearchClientMs } = await callVsearch(caseDef, profile);
  const hotels = cloneHotels(data.hotels || []);

  let pricedCount = 0;
  const hasDateSearch = Boolean(caseDef.checkin && caseDef.checkout);
  const embeddedRates = data.stats?.perf_ms?.rates_embed_count != null;

  if (hasDateSearch && data.prices) {
    pricedCount = mergeRates(hotels, {
      prices: data.prices,
      roomPrices: data.roomPrices,
      pricedCount: data.stats?.priced_count ?? data.pricedCount,
    });
  } else if (hasDateSearch && !embeddedRates) {
    try {
      const { data: rates, clientMs } = await callRates(caseDef, hotels.map((h) => h.id));
      ratesClientMs = clientMs;
      pricedCount = mergeRates(hotels, rates);
    } catch (e) {
      return { caseDef, ok: false, error: `rates: ${e.message}`, ms: Date.now() - t0 };
    }
  } else if (hasDateSearch && embeddedRates) {
    pricedCount = data.stats?.perf_ms?.rates_embed_count ?? 0;
    if (data.prices) mergeRates(hotels, { prices: data.prices, roomPrices: data.roomPrices, pricedCount });
  }

  const ctx = {
    pricesLoaded: hasDateSearch && (pricedCount > 0 || embeddedRates),
    hasDateSearch,
    showAvailOnly: hasDateSearch && pricedCount > 0,
  };

  const { hotels: sorted } = sortHotelsBestMatch(hotels, data.stats || {}, profile, ctx);
  const { hotels: sortedLegacy } = sortHotelsBestMatchLegacy(hotels, data.stats || {}, profile, ctx);
  const findings = auditCase(caseDef, data, sorted, sortedLegacy, ctx);
  const perf = extractPerf(data.stats, vsearchClientMs, ratesClientMs);

  return {
    caseDef,
    ok: true,
    ms: Date.now() - t0,
    hotelCount: hotels.length,
    visibleCount: sorted.length,
    pricedCount,
    findings,
    perf,
    topHotelIds: sorted.slice(0, 5).map((h) => h.id),
  };
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function buildFixCatalog(hitCodes) {
  const fixes = [
    { id: "F1", codes: ["DISPLAY_VS_LEGACY_SORT_ROOM"], risk: "Low", title: "Align Best Match sort with room badge display", fix: "Use bestMatchRoomScore()/roomVibeMatchDisplayPct() for sort when avail filter is on; never hotelEffectiveScore().", area: "client/app.js + lib/client-match-sort.js" },
    { id: "F2", codes: ["EXPENSIVE_OUTLIER_#1", "ROOM_GAP_IGNORED"], risk: "Medium", title: "Tune live-rate nudge / nbhd guard", fix: "Adjust MATCH_LIVE_RATE_NUDGE_MAX and BOOP_PRICE_NBHD_GAP_GUARD when priceMatters neutral.", area: "lib/client-match-sort.js" },
    { id: "F3", codes: ["HOSTEL_TOP_SLEEK"], risk: "Low", title: "Property-type penalty for hostel × sleek", fix: "Verify stayVibe property_type multiplier in search-v2.js is deployed.", area: "scripts/search-v2.js" },
    { id: "F4", codes: ["STUB_HEAVY_TOP10"], risk: "Medium", title: "Stub hotels in top 10", fix: "Expand Phase-B gallery or lazy-fetch room photos for priced top hotels before first paint.", area: "scripts/search-v2.js + client" },
    { id: "F5", codes: ["WEAK_NAME_TOP5"], risk: "Low", title: "Deferred hotel metadata", fix: "Raise META_SYNC_LIMIT for Boop or prefetch meta for client-sorted top 30.", area: "server.js search-v2 meta fetch" },
    { id: "F6", codes: ["VIBE_WEIGHT_MISSING", "VIBE_MODEL_FALLBACK"], risk: "Medium", title: "Hotel vibe model not applying stayVibe", fix: "Ensure mergeStayVibeIntoIntent runs and score_hotels_facts_v2 receives visual_style weights.", area: "scripts/search-v2.js + fact-catalog" },
    { id: "F7", codes: ["NBHD_BLEND_SPARSE", "MISSING_NBHD", "NBHD_TIEBREAK_MISS"], risk: "Medium", title: "Neighbourhood fit gaps", fix: "Verify get_primary_nbhds_for_hotels RPC coverage; regen neighbourhoods if Paris incomplete.", area: "Supabase + neighborhood-generator" },
    { id: "F8", codes: ["API_VS_CLIENT_TOP3"], risk: "Info", title: "API order ≠ UI Best Match", fix: "Document server primarySignal vs client re-sort; optional debug export of getSortedHotelsForDisplay().", area: "docs / debug snapshot" },
    { id: "F9", codes: ["PRICE_SORT_BROKEN", "RATING_SORT_BROKEN"], risk: "High", title: "Alternate sort modes broken", fix: "Audit getSortedHotelsForDisplay() branches for price/rating/stars.", area: "client/app.js" },
    { id: "F10", codes: ["DETAIL_PAGE_ISSUES"], risk: "Medium", title: "Hotel detail page missing data", fix: "Check LiteAPI live-fetch + v2_room_inventory coverage for sampled hotels.", area: "/api/hotel/:id" },
    { id: "F11", codes: ["SORT_NON_MONOTONIC"], risk: "High", title: "Best Match sort inversions", fix: "Review sortScore tiebreaker stack in client-match-sort.js.", area: "lib/client-match-sort.js" },
    { id: "F12", codes: ["FIXED_VS_LEGACY_TOP3"], risk: "Low", title: "Legacy sort still diverges", fix: "Remove legacy path or gate behind debug flag once fixed sort verified.", area: "lib/client-match-sort.js" },
  ];
  return fixes.map((f) => ({
    ...f,
    triggered: f.codes.some((c) => hitCodes.has(c)),
  }));
}

function buildReport(results, detailResults, meta) {
  const lines = [];
  const byCode = new Map();
  const errors = results.filter((r) => !r.ok);

  for (const r of results.filter((x) => x.ok)) {
    for (const f of r.findings) {
      if (!byCode.has(f.code)) byCode.set(f.code, []);
      byCode.get(f.code).push({ caseId: r.caseDef.id, city: r.caseDef.city, ...f });
    }
  }

  for (const d of detailResults) {
    if (d.issues.length) {
      const code = "DETAIL_PAGE_ISSUES";
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({
        caseId: d.sampledFrom || "detail",
        city: d.city,
        severity: d.issues.includes("no_room_types") ? "high" : "medium",
        detail: `${d.hotelId}: ${d.issues.join(", ")} (${d.ms}ms)`,
      });
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
  const codes = [...byCode.keys()].sort((a, b) => {
    const sa = severityOrder[byCode.get(a)[0].severity] ?? 9;
    const sb = severityOrder[byCode.get(b)[0].severity] ?? 9;
    return sa - sb || byCode.get(b).length - byCode.get(a).length;
  });

  const okResults = results.filter((r) => r.ok);
  const perfRows = okResults.map((r) => r.perf).filter(Boolean);

  lines.push(`# V2 Comprehensive QA Report (${meta.count} searches)`);
  lines.push("");
  lines.push(`- **Date:** ${meta.date}`);
  lines.push(`- **Base URL:** ${meta.baseUrl}`);
  lines.push(`- **Seed:** ${meta.seed}`);
  lines.push(`- **Search cases:** ${okResults.length}/${meta.count} ok (${errors.length} errors)`);
  lines.push(`- **Detail pages sampled:** ${detailResults.length} (${detailResults.filter((d) => d.issues.length).length} with issues)`);
  lines.push(`- **Cities:** Mexico City + Paris`);
  lines.push(`- **Dated searches:** ${okResults.filter((r) => r.caseDef.dates).length}`);
  lines.push("");

  lines.push("## Executive summary");
  lines.push("");
  const highCodes = codes.filter((c) => byCode.get(c)[0].severity === "high");
  const highInstances = highCodes.reduce((s, c) => s + byCode.get(c).length, 0);
  lines.push(
    `Ran **${meta.count}** Boop-style V2 searches (stratified grid + random) across Mexico City and Paris with varied trip type, stay vibe, neighbourhood scene, price slider, optional dates, must-haves, and freetext. Audited **${detailResults.length}** hotel detail pages from random top-result samples. Found **${highCodes.length}** high-severity issue categories (**${highInstances}** instances). **No fixes applied** — see labeled fix catalog at end.`
  );
  lines.push("");

  lines.push("## Performance (instrumented)");
  lines.push("");
  lines.push("| Metric | p50 | p90 | max |");
  lines.push("|--------|-----|-----|-----|");
  const perfKeys = [
    ["vsearch client (full response)", "client_ms"],
    ["server handler_wall_ms", "handler_wall_ms"],
    ["server wall_ms (v2 perf)", "wall_ms"],
    ["phase-A DB", "phase_a_ms"],
    ["phase-B parallel", "phase_b_ms"],
    ["NLP intent", "nlp_intent_ms"],
    ["meta sync (top names)", "meta_sync_ms"],
    ["rates embed (in vsearch)", "rates_embed_ms"],
    ["end-to-end case (vsearch+rates)", "case_ms"],
  ];
  const caseMs = okResults.map((r) => r.ms);
  for (const [label, key] of perfKeys) {
    const vals =
      key === "case_ms"
        ? caseMs
        : perfRows.map((p) => p[key]).filter((v) => typeof v === "number" && v > 0);
    if (!vals.length) continue;
    lines.push(`| ${label} | ${percentile(vals, 0.5)} | ${percentile(vals, 0.9)} | ${Math.max(...vals)} |`);
  }
  lines.push("");
  const deferred = perfRows.map((p) => p.deferred_meta).filter((v) => typeof v === "number");
  if (deferred.length) {
    lines.push(`- Deferred meta IDs (lazy client fetch): median **${percentile(deferred, 0.5)}**, p90 **${percentile(deferred, 0.9)}**`);
  }
  const metaSync = perfRows.map((p) => p.meta_sync_count).filter((v) => typeof v === "number");
  if (metaSync.length) {
    lines.push(`- Sync meta count (names on first paint): median **${percentile(metaSync, 0.5)}**`);
  }
  lines.push("");
  lines.push("_Interpretation:_ `meta_sync_ms` ≈ time until top ~30 cards have names; full `client_ms` includes Phase-B photos for ~250 hotels + optional embedded rates.");
  lines.push("");

  lines.push("## Results by issue category");
  lines.push("");
  if (!codes.length && !errors.length) lines.push("_No issues detected._");
  for (const code of codes) {
    const items = byCode.get(code);
    lines.push(`### \`${code}\` (${items[0].severity}) — ${items.length} hit(s)`);
    lines.push("");
    for (const it of items.slice(0, 6)) {
      lines.push(`- **${it.caseId}** (${it.city}): ${it.detail}`);
    }
    if (items.length > 6) lines.push(`- _…and ${items.length - 6} more_`);
    lines.push("");
  }

  if (errors.length) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors) {
      lines.push(`- **${e.caseDef.id}** (${e.caseDef.city}): ${e.error}`);
    }
    lines.push("");
  }

  lines.push("## City breakdown");
  lines.push("");
  for (const city of ["Mexico City", "Paris"]) {
    const subset = okResults.filter((r) => r.caseDef.city === city);
    const cityHigh = subset.reduce((s, r) => s + r.findings.filter((f) => f.severity === "high").length, 0);
    const avgMs = subset.length ? Math.round(subset.reduce((a, r) => a + r.ms, 0) / subset.length) : 0;
    lines.push(`- **${city}:** ${subset.length} cases, avg ${avgMs}ms, ${cityHigh} high-severity findings`);
  }
  lines.push("");

  lines.push("## Sample cases (first 8 with findings)");
  lines.push("");
  let shown = 0;
  for (const r of okResults) {
    if (!r.findings.length) continue;
    if (shown >= 8) break;
    const c = r.caseDef;
    lines.push(`### ${c.id} — ${c.city}, stay=${c.answers.stayVibe}, nbhd=${c.answers.nbhdScene}${c.dates ? `, ${c.checkin}→${c.checkout}` : ""}`);
    lines.push(`- Perf: client=${r.perf.client_ms}ms wall=${r.perf.wall_ms ?? "—"}ms meta_sync=${r.perf.meta_sync_ms ?? "—"}ms`);
    lines.push(`- Findings: ${r.findings.map((f) => f.code).join(", ")}`);
    lines.push("");
    shown++;
  }

  lines.push("## Fix catalog (NOT implemented — for later triage)");
  lines.push("");
  const hitCodes = new Set(codes);
  const fixes = buildFixCatalog(hitCodes);
  for (const f of fixes) {
    const tag = f.triggered ? "**TRIGGERED**" : "not observed";
    lines.push(`### ${f.id}. ${f.title} — ${tag}`);
    lines.push(`- **Risk:** ${f.risk}`);
    lines.push(`- **Area:** ${f.area}`);
    lines.push(`- **Proposed fix:** ${f.fix}`);
    if (f.triggered) lines.push(`- **Related codes:** ${f.codes.filter((c) => hitCodes.has(c)).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function sampleDetailPages(results, perCity) {
  const rng = mulberry32(SEED + 999);
  const byCity = { "Mexico City": [], Paris: [] };
  for (const r of results.filter((x) => x.ok && x.topHotelIds?.length)) {
    byCity[r.caseDef.city]?.push(...r.topHotelIds);
  }
  const detailResults = [];

  for (const [city, ids] of Object.entries(byCity)) {
    const unique = [...new Set(ids)];
    for (let n = 0; n < perCity && unique.length; n++) {
      const idx = Math.floor(rng() * unique.length);
      const hotelId = unique.splice(idx, 1)[0];
      try {
        const { data, clientMs } = await callHotelDetail(hotelId);
        const issues = auditHotelDetailPayload(hotelId, data);
        detailResults.push({ hotelId, city, issues, ms: clientMs, sampledFrom: "top_results" });
      } catch (e) {
        detailResults.push({ hotelId, city, issues: [`fetch_error: ${e.message}`], ms: 0, sampledFrom: "top_results" });
      }
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  return detailResults;
}

async function main() {
  const cases = generateCases(COUNT, SEED);
  const results = [];
  console.log(`\nV2 Comprehensive QA — ${COUNT} cases @ ${BASE_URL} (seed=${SEED})\n`);

  for (let idx = 0; idx < cases.length; idx++) {
    const c = cases[idx];
    process.stdout.write(`  [${idx + 1}/${cases.length}] ${c.id} ${c.city}… `);
    try {
      const r = await runCase(c);
      results.push(r);
      if (!r.ok) {
        console.log(`ERROR ${r.error}`);
      } else {
        const hi = r.findings.filter((f) => f.severity === "high").length;
        console.log(`${r.perf.client_ms}ms ${r.visibleCount}hotels${hi ? ` ⚠${hi}high` : " ok"}`);
      }
    } catch (e) {
      results.push({ caseDef: c, ok: false, error: e.message, ms: 0 });
      console.log(`ERROR ${e.message}`);
    }
    if (idx < cases.length - 1) await new Promise((res) => setTimeout(res, DELAY_MS));
  }

  console.log(`\nSampling ${DETAIL_SAMPLE_PER_CITY} detail pages per city…`);
  const detailResults = await sampleDetailPages(results, DETAIL_SAMPLE_PER_CITY);

  const reportDir = path.join(__dirname, "..", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportDir, `v2-comprehensive-audit-${date}-seed${SEED}.md`);
  const report = buildReport(results, detailResults, { count: COUNT, seed: SEED, baseUrl: BASE_URL, date });
  fs.writeFileSync(reportPath, report, "utf8");

  const okN = results.filter((r) => r.ok).length;
  const highN = results.filter((r) => r.ok).reduce((s, r) => s + r.findings.filter((f) => f.severity === "high").length, 0);
  console.log(`\nDone: ${okN}/${COUNT} searches ok, ${highN} high-severity findings`);
  console.log(`Detail pages: ${detailResults.filter((d) => d.issues.length).length}/${detailResults.length} with issues`);
  console.log(`Report: ${reportPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
