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

function testSelectMoreHotelsMatchesMainListRanks() {
  const hotels = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i}`,
    vectorScore: 100 - i,
    nbhd_fit_pct: 50,
    hotelScore: 50,
  }));
  const picks = V2.selectTopPicks(hotels);
  const more = V2.selectMoreHotels(hotels, picks, V2.MORE_HOTELS_COUNT);
  assert(more.length === 8, `expected 8 more hotels, got ${more.length}`);
  for (let i = 0; i < 8; i++) {
    assert(more[i].id === hotels[i + 1].id, `more[${i}] should be main-list rank #${i + 2}`);
  }
  console.log('  ok selectMoreHotels — ranks #2–#9 match sorted list');
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
  testSelectTopPicksUnique();
  testSelectMoreHotelsMatchesMainListRanks();
  testCuratedHighlightIds();
  testLensReorders();
  console.log('\nAll passed.');
}

main();
