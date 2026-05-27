#!/usr/bin/env node
/**
 * Random 100-search QA — Mexico City + Paris Boop scenarios.
 *
 *   node scripts/audit-random-100.js
 *   node scripts/audit-random-100.js --base-url=http://localhost:3000 --count=20
 *
 * Writes: reports/random-search-audit-<date>.md
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { buildBoopProfile, buildBoopSeeds } = require("../lib/boop-wizard");
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
const COUNT = Number((process.argv.find((a) => a.startsWith("--count=")) || "").split("=")[1]) || 100;
const SEED_ARG = (process.argv.find((a) => a.startsWith("--seed=")) || "").split("=")[1];
const SEED = SEED_ARG === "random" || !SEED_ARG
  ? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
  : Number(SEED_ARG);
const FULLY_RANDOM = !process.argv.includes("--stratified");
const DELAY_MS = Number((process.argv.find((a) => a.startsWith("--delay=")) || "").split("=")[1]) || 350;
const HVB = 0.2;

const TRIPS = ["first", "repeat", "expert"];
const STAY_VIBES = ["sleek_polished", "cozy_warm", "distinct_unique", "simple_value"];
const NBHD_SCENES = ["buzz_central", "calm_central", "hip_local", "leafy_local", "scenic_open"];
const PRICE_OPTS = [0, 30, 50, 80, 100, -30, -50, -80, -100];
const GROUPS = ["solo", "couple", "family"];
const DEAL_POOL = [[], ["balcony"], ["work_desk"], ["spa_bathroom"], ["free_cancellation"]];
const FREETEXT_POOL = ["", "", "double sinks and rainfall shower", "quiet room away from street", "rooftop bar nearby"];

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

function generateCases(n, seed, fullyRandom = true) {
  const rng = mulberry32(seed);
  const cities = ["Mexico City", "Paris"];
  const cases = [];
  let i = 0;

  if (!fullyRandom) {
    for (const city of cities) {
      for (const trip of TRIPS) {
        for (const stayVibe of STAY_VIBES) {
          for (const nbhdScene of NBHD_SCENES) {
            if (cases.length >= Math.min(40, n)) break;
            cases.push({
              id: `grid_${String(++i).padStart(3, "0")}`,
              city,
              dates: rng() < 0.52,
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
    const nights = 3 + Math.floor(rng() * 5);
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
  try {
    const res = await fetch(url, { headers: apiHeaders(), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
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

function hotelLabel(h) {
  return (h.name && h.name !== "Hotel" ? h.name : h.id).slice(0, 36);
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

  // Monotonic client sort
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

  // Display vs legacy sort room mismatch (production bug signature)
  if (ctx.showAvailOnly && ctx.hasDateSearch && ctx.pricesLoaded) {
    for (let i = 0; i < top10.length; i++) {
      const h = top10[i];
      const display = roomVibeMatchDisplayPct(h);
      const legacySort = hotelEffectiveScore(h, ctx);
      if (Math.abs(display - legacySort) >= 12) {
        findings.push({
          code: "DISPLAY_VS_LEGACY_SORT_ROOM",
          severity: "high",
          detail: `#${i + 1} ${h.id} badge=${display}% legacySortRoom=${legacySort}% (Paris Pullman class bug)`,
        });
      }
    }
  }

  // Legacy vs fixed top-3 divergence
  const fixedTop3 = top10.slice(0, 3).map((h) => h.id).join(",");
  const legacyTop3 = sortedLegacy.slice(0, 3).map((h) => h.id).join(",");
  if (fixedTop3 !== legacyTop3) {
    findings.push({
      code: "FIXED_VS_LEGACY_TOP3",
      severity: "medium",
      detail: `fixed=[${fixedTop3}] legacy=[${legacyTop3}]`,
    });
  }

  // API vs client top-3
  const apiTop3 = apiTop.slice(0, 3).map((h) => h.id).join(",");
  if (apiTop3 !== fixedTop3) {
    findings.push({
      code: "API_VS_CLIENT_TOP3",
      severity: "info",
      detail: `api=[${apiTop3}] client=[${fixedTop3}]`,
    });
  }

  // Room should dominate when gap large (neutral pm)
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
            detail: `#${a + 1} ${hi.id} room=${roomHi} beats #${b + 1} ${lo.id} room=${roomLo} (nbhd ~equal)`,
          });
        }
      }
    }
  }

  // Expensive #1 outlier when similar vibes in top 10
  if (ctx.pricesLoaded && ctx.hasDateSearch && Math.abs(pm) <= 32 && top10[0]?.price != null) {
    const priced = top10.filter((h) => h.price != null).map((h) => h.price);
    if (priced.length >= 5) {
      const med = priced.sort((a, b) => a - b)[Math.floor(priced.length / 2)];
      const p1 = top10[0].price;
      const rooms = top10.map((h) => bestMatchRoomScore(h));
      const maxRoom = Math.max(...rooms);
      const r1 = bestMatchRoomScore(top10[0]);
      if (p1 > med * 2.2 && r1 < maxRoom - 5) {
        findings.push({
          code: "EXPENSIVE_OUTLIER_#1",
          severity: "high",
          detail: `#1 ${top10[0].id} $${p1}/n vs med $${med} room=${r1}% bestIn10=${maxRoom}%`,
        });
      }
    }
  }

  // Nbhd boost when room tied
  if (Math.abs(pm) <= 32 && w > 0) {
    for (let a = 0; a < top10.length - 1; a++) {
      const A = top10[a];
      const B = top10[a + 1];
      const rA = bestMatchRoomScore(A);
      const rB = bestMatchRoomScore(B);
      if (Math.abs(rA - rB) <= 3 && A.nbhd_fit_pct != null && B.nbhd_fit_pct != null) {
        const nbhdGap = B.nbhd_fit_pct - A.nbhd_fit_pct;
        if (nbhdGap >= 18) {
          findings.push({
            code: "NBHD_TIEBREAK_MISS",
            severity: "medium",
            detail: `#${a + 1} ${A.id} nbhd=${A.nbhd_fit_pct} above #${a + 2} ${B.id} nbhd=${B.nbhd_fit_pct} same room ~${rA}%`,
          });
        }
      }
    }
  }

  // Value slider: luxury-heavy top when priceMatters high
  if (pm >= 70 && top10.length >= 5) {
    const stars = top10.slice(0, 5).map((h) => Number(h.starRating)).filter(Number.isFinite);
    const avg = stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : 0;
    const cheapestIdx = top10.findIndex((h) => h.price != null);
    if (avg >= 4.1 && cheapestIdx >= 4) {
      findings.push({
        code: "VALUE_SLIDER_LUXURY_TOP",
        severity: "medium",
        detail: `pm=${pm} top5 avg★=${avg.toFixed(1)} cheapestInTop10 rank=${cheapestIdx + 1}`,
      });
    }
  }

  // Data quality
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

  // Server sort inversions (informational)
  let serverInv = 0;
  for (let i = 1; i < Math.min(20, apiTop.length); i++) {
    if (serverBlend(apiTop[i], w) > serverBlend(apiTop[i - 1], w) + 0.05) serverInv++;
  }
  if (serverInv > 5) {
    findings.push({ code: "SERVER_SORT_INVERSIONS", severity: "info", detail: `${serverInv} inversions in API top 20` });
  }

  // Avail filter shrink
  const rawN = (data.hotels || []).length;
  if (ctx.showAvailOnly && rawN > 0 && sorted.length < rawN * 0.15) {
    findings.push({
      code: "AVAIL_FILTER_SHRINK",
      severity: "info",
      detail: `${rawN} → ${sorted.length} visible (${Math.round((sorted.length / rawN) * 100)}%)`,
    });
  }

  return findings;
}

function summarizeTop(sorted, ctx, n = 5) {
  return sorted.slice(0, n).map((h, i) => {
    const room = bestMatchRoomScore(h);
    const disp = roomVibeMatchDisplayPct(h);
    const nb = h.nbhd_fit_pct != null ? `${h.nbhd_fit_pct}%` : "—";
    const price = h.price != null ? `$${h.price}` : "—";
    return `${i + 1}. ${hotelLabel(h)} (${h.id}) room=${room}% disp=${disp}% nbhd=${nb} ${price}`;
  });
}

async function runCase(caseDef) {
  const profile = buildBoopProfile(caseDef.answers, caseDef.dealbreakers, caseDef.freetext);
  const t0 = Date.now();
  const data = await callVsearch(caseDef, profile);
  const hotels = cloneHotels(data.hotels || []);

  let pricedCount = 0;
  const hasDateSearch = Boolean(caseDef.checkin && caseDef.checkout);
  if (hasDateSearch) {
    try {
      const rates = await callRates(caseDef, hotels.map((h) => h.id));
      pricedCount = mergeRates(hotels, rates);
    } catch (e) {
      return {
        caseDef,
        ok: false,
        error: `rates: ${e.message}`,
        ms: Date.now() - t0,
      };
    }
  }

  const ctx = {
    pricesLoaded: hasDateSearch,
    hasDateSearch,
    showAvailOnly: hasDateSearch && pricedCount > 0,
  };

  const { hotels: sorted } = sortHotelsBestMatch(hotels, data.stats || {}, profile, ctx);
  const { hotels: sortedLegacy } = sortHotelsBestMatchLegacy(hotels, data.stats || {}, profile, ctx);
  const findings = auditCase(caseDef, data, sorted, sortedLegacy, ctx);

  return {
    caseDef,
    ok: true,
    ms: Date.now() - t0,
    hotelCount: hotels.length,
    visibleCount: sorted.length,
    pricedCount,
    nbhdWeight: data.stats?.nbhd_rank_weight,
    findings,
    topSummary: summarizeTop(sorted, ctx),
    perfMs: data.stats?.perf_ms,
  };
}

function buildReport(results, meta) {
  const lines = [];
  const byCode = new Map();
  const errors = results.filter((r) => !r.ok);

  for (const r of results.filter((x) => x.ok)) {
    for (const f of r.findings) {
      if (!byCode.has(f.code)) byCode.set(f.code, []);
      byCode.get(f.code).push({ caseId: r.caseDef.id, city: r.caseDef.city, ...f });
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
  const codes = [...byCode.keys()].sort((a, b) => {
    const sa = severityOrder[byCode.get(a)[0].severity] ?? 9;
    const sb = severityOrder[byCode.get(b)[0].severity] ?? 9;
    return sa - sb || byCode.get(b).length - byCode.get(a).length;
  });

  lines.push(`# Random Search QA Report (${meta.count} searches)`);
  lines.push("");
  lines.push(`- **Date:** ${meta.date}`);
  lines.push(`- **Base URL:** ${meta.baseUrl}`);
  lines.push(`- **Seed:** ${meta.seed}`);
  lines.push(`- **Completed:** ${results.filter((r) => r.ok).length}/${meta.count} (${errors.length} errors)`);
  lines.push(`- **Cities:** Mexico City + Paris`);
  lines.push(`- **Dated searches:** ${results.filter((r) => r.ok && r.caseDef.dates).length}`);
  lines.push(`- **Sort model:** Client Best Match (lib/client-match-sort.js)`);
  lines.push(`- **Case generation:** ${meta.fullyRandom ? "100% random (no stratified grid)" : "stratified grid + random"}`);
  lines.push("");

  lines.push("## Executive summary");
  lines.push("");
  const high = codes.filter((c) => byCode.get(c)[0].severity === "high");
  const med = codes.filter((c) => byCode.get(c)[0].severity === "medium");
  lines.push(
    `Ran **${meta.count}** Boop-style searches with varied trip type, stay vibe, neighbourhood scene, price slider, and optional dates. Found **${high.length}** high-severity issue categories (${high.reduce((s, c) => s + byCode.get(c).length, 0)} instances), **${med.length}** medium-severity categories. No fixes applied in this pass — see *Possible fixes* below.`
  );
  lines.push("");

  lines.push("## Test plan");
  lines.push("");
  lines.push("Each case:");
  lines.push("1. Builds a Boop profile (trip, stayVibe, nbhdScene, group_size, priceMatters ±100, optional must-haves / freetext).");
  lines.push("2. Calls `GET /api/vsearch` (V2) with `boop_profile`.");
  lines.push("3. When dates set (~52%): `GET /api/rates`, merges prices, enables *Available only* when `pricedCount > 0`.");
  lines.push("4. Re-sorts with **Best Match** client logic (room vibe % + nbhd blend + Boop price guards + live-rate nudge).");
  lines.push("5. Checks invariants vs design: room dominance, nbhd tiebreaks, expensive #1 outliers, display/sort alignment, data completeness.");
  lines.push("");

  lines.push("## Results by issue category");
  lines.push("");
  if (!codes.length && !errors.length) {
    lines.push("_No issues detected._");
  }
  for (const code of codes) {
    const items = byCode.get(code);
    const sev = items[0].severity;
    lines.push(`### \`${code}\` (${sev}) — ${items.length} hit(s)`);
    lines.push("");
    const sample = items.slice(0, 8);
    for (const it of sample) {
      lines.push(`- **${it.caseId}** (${it.city}): ${it.detail}`);
    }
    if (items.length > 8) lines.push(`- _…and ${items.length - 8} more_`);
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

  lines.push("## Sample top-5 rankings (first 12 cases)");
  lines.push("");
  for (const r of results.filter((x) => x.ok).slice(0, 12)) {
    const c = r.caseDef;
    lines.push(`### ${c.id} — ${c.city}, trip=${c.answers.trip}, stay=${c.answers.stayVibe}, nbhd=${c.answers.nbhdScene}, pm=${c.answers.priceMatters}${c.dates ? `, ${c.checkin}→${c.checkout}` : ", no dates"}`);
    for (const line of r.topSummary) lines.push(`- ${line}`);
    if (r.findings.length) {
      lines.push(`- _Findings:_ ${r.findings.map((f) => f.code).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Possible fixes (not implemented)");
  lines.push("");
  const fixes = [
    {
      id: "F1",
      issue: "DISPLAY_VS_LEGACY_SORT_ROOM / Paris Pullman vs Lux Picpus",
      fix: "Ensure production deploys `bestMatchRoomScore()` using `roomVibeMatchDisplayPct()` only; never `hotelEffectiveScore()` for Best Match sort when avail filter is on.",
    },
    {
      id: "F2",
      issue: "EXPENSIVE_OUTLIER_#1 with neutral price slider + dates",
      fix: "Increase `MATCH_LIVE_RATE_NUDGE_MAX` (currently 10) or tighten `MATCH_LIVE_RATE_ROOM_GAP`; optionally tier nudge by price ratio (e.g. 3× median).",
    },
    {
      id: "F3",
      issue: "ROOM_GAP_IGNORED / nbhd guard overrides room",
      fix: "When `priceMatters` neutral, skip or soften `shouldNbhdGuardYieldToPrice` unless room gap < 8; raise `BOOP_PRICE_NBHD_GAP_GUARD` for neutral pm.",
    },
    {
      id: "F4",
      issue: "API_VS_CLIENT_TOP3 divergence",
      fix: "Document that API order is server primarySignal; client re-sorts on render. Optionally align server export order with client Best Match for debug snapshots.",
    },
    {
      id: "F5",
      issue: "Vibe tour ≠ list #1",
      fix: "Open auto vibe tour only after rates + `getSortedHotelsForDisplay()[0]` (local fix in app.js — verify deployed).",
    },
    {
      id: "F6",
      issue: "STUB_HEAVY_TOP10 in large cities with dates",
      fix: "Expand Phase-B gallery for priced stubs; lazy-fetch room photos before first paint for top priced hotels.",
    },
    {
      id: "F7",
      issue: "VALUE_SLIDER_LUXURY_TOP when pm≥70",
      fix: "Strengthen value penalty for 4★+ when `priceMatters` high; verify `valueSeekingLuxuryLean` uses live price not star proxy when rates exist.",
    },
    {
      id: "F8",
      issue: "WEAK_NAME_TOP5 / deferred meta",
      fix: "Raise `META_SYNC_LIMIT` for Boop searches or prefetch meta for client-sorted top 30 after sort.",
    },
    {
      id: "F9",
      issue: "AVAIL_FILTER_SHRINK hides most results",
      fix: "UX: warn when >85% filtered; consider showing unpriced with badge instead of hiding when pricedCount low.",
    },
    {
      id: "F10",
      issue: "Debug snapshot shows API order not UI order",
      fix: "`copyDebugSnapshot()` should serialize `getSortedHotelsForDisplay()` not `_lastVsearchHotels`.",
    },
  ];

  const hitCodes = new Set(codes);
  for (const f of fixes) {
    const relevant = [...hitCodes].filter((c) => f.issue.includes(c.split("_")[0]) || f.issue.toLowerCase().includes(c.toLowerCase().replace(/_/g, " ")));
    lines.push(`### ${f.id}. ${f.issue.split("/")[0].trim()}`);
    lines.push(`${f.fix}`);
    if (relevant.length) lines.push(`_Triggered by:_ ${relevant.join(", ")}`);
    lines.push("");
  }

  lines.push("## Performance notes");
  lines.push("");
  const perf = results.filter((r) => r.ok && r.perfMs).map((r) => r.perfMs.total || r.perfMs.wall);
  if (perf.length) {
    perf.sort((a, b) => a - b);
    lines.push(`- vsearch wall ms (p50/p90): ${perf[Math.floor(perf.length * 0.5)]} / ${perf[Math.floor(perf.length * 0.9)]}`);
  }
  const totalMs = results.filter((r) => r.ok).map((r) => r.ms);
  if (totalMs.length) {
    totalMs.sort((a, b) => a - b);
    lines.push(`- End-to-end per case ms (p50/p90): ${totalMs[Math.floor(totalMs.length * 0.5)]} / ${totalMs[Math.floor(totalMs.length * 0.9)]}`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const cases = generateCases(COUNT, SEED, FULLY_RANDOM);
  const results = [];
  console.log(`\nRandom search QA — ${COUNT} cases @ ${BASE_URL} (seed=${SEED}, ${FULLY_RANDOM ? "fully random" : "stratified"})\n`);

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
        console.log(`${r.visibleCount}/${r.hotelCount} hotels ${r.ms}ms${hi ? ` ⚠ ${hi} high` : " ok"}`);
      }
    } catch (e) {
      results.push({ caseDef: c, ok: false, error: e.message, ms: 0 });
      console.log(`ERROR ${e.message}`);
    }
    if (idx < cases.length - 1) await new Promise((res) => setTimeout(res, DELAY_MS));
  }

  const reportDir = path.join(__dirname, "..", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportDir, `random-search-audit-${date}-seed${SEED}.md`);
  const report = buildReport(results, { count: COUNT, seed: SEED, baseUrl: BASE_URL, date, fullyRandom: FULLY_RANDOM });
  fs.writeFileSync(reportPath, report, "utf8");

  const okN = results.filter((r) => r.ok).length;
  const highN = results.filter((r) => r.ok).reduce((s, r) => s + r.findings.filter((f) => f.severity === "high").length, 0);
  console.log(`\nDone: ${okN}/${COUNT} ok, ${highN} high-severity findings`);
  console.log(`Report: ${reportPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
