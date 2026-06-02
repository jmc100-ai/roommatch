#!/usr/bin/env node
/**
 * Unit tests for SearchResultsV2 pick/more-hotel logic (no browser).
 * Run: node scripts/test-search-results-v2-logic.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../client/search-results-v2.js'), 'utf8');
const sandbox = {
  window: { addEventListener() {}, scrollTo() {} },
  globalThis: {},

  document: {
    readyState: 'complete',
    addEventListener() {},
    getElementById: () => null,
    createElement: () => ({ innerHTML: '', appendChild() {} }),
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
  },
};
sandbox.window.RoomMatchResultsBridge = {
  roomVibeMatchDisplayPct(h) {
    const rooms = h?.roomTypes || [];
    if (rooms.length) return Math.round(Math.max(0, ...rooms.map((r) => r.score || 0)));
    return Math.round(Number(h.vectorScore) || 0);
  },
  hotelStyleMatchDisplayPct(h) {
    const raw = Number(h.hotelScore);
    if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
    const room = sandbox.window.RoomMatchResultsBridge.roomVibeMatchDisplayPct(h);
    const nbhdRaw = h.nbhd_fit_pct != null ? Math.round(Number(h.nbhd_fit_pct)) : 0;
    const nbhdForBlend = nbhdRaw > 0 ? nbhdRaw : room;
    return Math.max(0, Math.round(room * 0.65 + nbhdForBlend * 0.35));
  },
  overallMatchDisplayPct(h) {
    return Math.round(Number(h.vectorScore) || 0);
  },
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox.window;
vm.runInContext(src, vm.createContext(sandbox));
const V2 = sandbox.window.SearchResultsV2;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testSelectTopPicksUnique() {
  const hotels = [
    { id: 'a', vectorScore: 90, nbhd_fit_pct: 70, hotelScore: 60 },
    { id: 'b', vectorScore: 95, nbhd_fit_pct: 50, hotelScore: 80 },
    { id: 'c', vectorScore: 80, nbhd_fit_pct: 92, hotelScore: 55 },
    { id: 'd', vectorScore: 75, nbhd_fit_pct: 40, hotelScore: 88 },
    { id: 'e', vectorScore: 70, nbhd_fit_pct: 30, hotelScore: 50 },
  ];
  const sorted = [...hotels].sort((a, b) => b.vectorScore - a.vectorScore);
  const picks = V2.selectTopPicks(sorted);
  const ids = ['overall', 'room_match', 'area_fit', 'stylish'].map((k) => picks[k]?.id).filter(Boolean);
  assert(ids.length === 4, `expected 4 picks, got ${ids.length}`);
  assert(new Set(ids).size === 4, `picks must be unique hotels: ${ids.join(',')}`);
  assert(picks.overall.id === sorted[0].id, 'overall should be first in sorted list');
  console.log('  ok selectTopPicks — four unique hotels');
}

function testSelectMoreHotelsExcludesTopPicks() {
  const hotels = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i}`,
    name: `Hotel ${i}`,
    vectorScore: 100 - i,
    nbhd_fit_pct: 40 + i,
    hotelScore: 30 + i,
  }));
  hotels[8].name = 'The Ritz-Carlton Residences Mexico City';
  hotels[8].vectorScore = 100;
  hotels[8].hotelScore = 95;
  hotels[3].name = 'The Ritz-Carlton, Mexico City';
  hotels[3].hotelScore = 99;
  const sorted = [...hotels].sort((a, b) => {
    const bScore = bridgeOverall(b);
    const aScore = bridgeOverall(a);
    return bScore - aScore;
  });
  function bridgeOverall(h) {
    return (Number(h.vectorScore) || 0);
  }
  const picks = V2.selectTopPicks(sorted);
  const pickIds = new Set(
    ['overall', 'room_match', 'area_fit', 'stylish'].map((k) => picks[k]?.id).filter(Boolean),
  );
  const more = V2.selectMoreHotels(sorted, picks, V2.MORE_HOTELS_COUNT);
  assert(more.length === 8, `expected 8 more hotels, got ${more.length}`);
  for (const h of more) {
    assert(!pickIds.has(h.id), `more hotels must not repeat top pick ${h.id}`);
  }
  const brands = ['overall', 'room_match', 'area_fit', 'stylish']
    .map((k) => picks[k] && V2.hotelBrandKey(picks[k]))
    .filter(Boolean);
  assert(new Set(brands).size === brands.length, `top picks should not share brand keys: ${brands.join(', ')}`);
  console.log('  ok selectMoreHotels — excludes all top picks');
}

function testSelectMoreHotelsMatchesMainListRanks() {
  const hotels = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i}`,
    name: `Distinct Brand ${i}`,
    vectorScore: 100 - i,
    nbhd_fit_pct: 50,
    hotelScore: 50,
  }));
  const picks = V2.selectTopPicks(hotels);
  const more = V2.selectMoreHotels(hotels, picks, V2.MORE_HOTELS_COUNT);
  assert(more.length === 8, `expected 8 more hotels, got ${more.length}`);
  const pickIds = new Set(
    ['overall', 'room_match', 'area_fit', 'stylish'].map((k) => picks[k]?.id).filter(Boolean),
  );
  let rank = 0;
  for (const h of hotels) {
    if (pickIds.has(h.id)) continue;
    assert(more[rank]?.id === h.id, `more[${rank}] should be next sorted hotel after picks`);
    rank += 1;
    if (rank >= 8) break;
  }
  console.log('  ok selectMoreHotels — next sorted rows after picks');
}

function testBrandKeyCollapsesRitzVariants() {
  const a = { id: 'a', name: 'The Ritz-Carlton Residences Mexico City', city: 'Mexico City' };
  const b = { id: 'b', name: 'The Ritz-Carlton, Mexico City', city: 'Mexico City' };
  assert(V2.hotelBrandKey(a) === V2.hotelBrandKey(b), 'Ritz variants should share brand key');
  console.log('  ok hotelBrandKey — Ritz variants');
}

function testLensReorders() {
  const hotels = [
    { id: 'a', vectorScore: 50, primary_nbhd: { attributes: { calm: 9, green: 8 } } },
    { id: 'b', vectorScore: 90, primary_nbhd: { attributes: { calm: 2, green: 1 } } },
  ];
  const quiet = V2.sortHotelsForLens(hotels, 'quiet');
  assert(quiet[0].id === 'a', 'quiet lens should prefer calm/green neighbourhood attrs');
  console.log('  ok lensSort — quiet promotes calm hotel');
}

function testCuratedHighlightIds() {
  const hotels = Array.from({ length: 12 }, (_, i) => ({
    id: `h${i}`,
    vectorScore: 100 - i,
    nbhd_fit_pct: 40 + i,
    hotelScore: 30 + i,
    roomTypes: [{ score: 50 + i * 5 }],
  }));
  hotels[8].roomTypes[0].score = 100;
  const ids = V2.getCuratedHighlightHotelIds(hotels);
  assert(ids.includes('h0'), 'overall h0');
  assert(ids.includes('h8'), 'best room match h8');
  assert(ids.length >= 10 && new Set(ids).size === ids.length, `unique highlight ids: ${ids.length}`);
  console.log('  ok getCuratedHighlightHotelIds — picks + more');
}

function testStylishPickMetricFallback() {
  const h = {
    id: 'fs',
    vectorScore: 88,
    nbhd_fit_pct: 72,
    hotelScore: null,
    roomTypes: [{ score: 91 }],
  };
  const pct = V2.pickMetricPct(h, 'stylish');
  assert(pct > 0, `stylish pick should not show 0% when hotelScore is null, got ${pct}`);
  assert(pct >= 80, `expected blended style pct ~80+, got ${pct}`);
  console.log('  ok pickMetricPct stylish — fallback when hotelScore null');
}

function testModeConstants() {
  assert(V2.MODE_CLASSIC === 'classic', 'MODE_CLASSIC');
  assert(V2.MODE_V2 === 'v2', 'MODE_V2');
  assert(V2.PICK_SLOTS.length === 4, 'four pick slots');
  assert(V2.MORE_HOTELS_COUNT === 8, 'eight more hotels');
  console.log('  ok constants');
}

function main() {
  console.log('SearchResultsV2 logic tests\n');
  if (!V2) throw new Error('SearchResultsV2 failed to load');
  testModeConstants();
  testStylishPickMetricFallback();
  testSelectTopPicksUnique();
  testBrandKeyCollapsesRitzVariants();
  testSelectMoreHotelsExcludesTopPicks();
  testSelectMoreHotelsMatchesMainListRanks();
  testCuratedHighlightIds();
  testLensReorders();
  console.log('\nAll passed.');
}

main();
