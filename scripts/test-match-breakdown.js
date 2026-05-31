#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildMatchBreakdown, humanizeFactKey } = require('../lib/match-breakdown');

const hotelFactHits = new Map([
  ['h1', new Set(['double_sinks', 'walk_in_shower'])],
]);

const hotelVibeCovMap = new Map([
  ['h1', {
    room: { visual_style_sleek_polished: 0.82 },
    public: { area_pool: 1, area_bar: 0.5 },
  }],
]);

const nbhdHoodRows = [
  {
    id: 1,
    name: 'Centro',
    vibe_short: 'Historic core',
    vibe_elements: {
      street_feel: { score: 70 },
      cafes: { score: 55 },
      restaurants: { score: 60 },
      museums: { score: 80 },
      icon_spots: { score: 40 },
      greenery: { score: 30 },
      parks: { score: 25 },
      shops: { score: 50 },
    },
    attributes: { poi_counts: { icon_spots: 40, cafes: 30, restaurants: 50 } },
    tags: ['culture', 'central'],
  },
  {
    id: 2,
    name: 'Roma',
    vibe_short: 'Trendy',
    vibe_elements: {
      street_feel: { score: 65 },
      cafes: { score: 90 },
      restaurants: { score: 85 },
      museums: { score: 30 },
      icon_spots: { score: 20 },
      greenery: { score: 50 },
      parks: { score: 40 },
      shops: { score: 70 },
    },
    attributes: { poi_counts: { icon_spots: 15, cafes: 80, restaurants: 90 } },
    tags: ['local'],
  },
];

const mb = buildMatchBreakdown({
  hotelId: 'h1',
  topScore: 88,
  hotelScore: 76,
  nbhdFitPct: 84,
  nbhdRankWeight: 0.55,
  mustHaveKeys: ['double_sinks', 'private_balcony'],
  hardFilterKeys: [],
  detectedFactKeys: ['double_sinks', 'walk_in_shower', 'rainfall_shower'],
  hotelFactHits,
  hotelVibeCovMap,
  primaryNbhd: { id: 1, name: 'Centro' },
  nbhdHoodRows,
  stayVibe: 'sleek_polished',
  factWeightsRaw: { visual_style_sleek_polished: 0.9, area_pool: 0.5 },
});

assert.strictEqual(mb.overall_pct, Math.round(0.45 * 88 + 0.55 * 84));
assert.strictEqual(mb.room_pct, 88);
assert.strictEqual(mb.must_haves_summary.met, 1);
assert.strictEqual(mb.must_haves_summary.total, 2);
assert.strictEqual(mb.must_haves.find((m) => m.fact_key === 'double_sinks').status, 'met');
assert.ok(mb.nbhd_signals.walkability >= 0);
assert.ok(humanizeFactKey('double_sinks').includes('sink'));

console.log('test-match-breakdown: ok');
