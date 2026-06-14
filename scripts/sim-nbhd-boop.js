/**
 * Simulate neighbourhood BOOP scoring with the FIXED client-side algorithm.
 * Run: node scripts/sim-nbhd-boop.js
 *
 * Data is embedded here (from DB as of 2026-05-15).
 * Purpose: verify all 5 nbhdScene options produce sensible rankings before pushing.
 */

const HOODS = [
  {
    name: 'Centro Histórico',
    tags: ['first-timers','walkable','culture','iconic','nightlife','foodie'],
    vibe_short: 'Iconic landmarks, colonial grandeur, museums, local bustle',
    attributes: {
      street_energy: 'very lively', green_spaces: 'minimal',
      poi_counts: { cafes:70, parks:66, shops:613, trees:1401, museums:58, icon_spots:104, restaurants:393, trees_street:1281 },
    },
    vibe_elements: {
      cafes:      { score:46 }, parks:    { score:64 },  shops:   { score:81 },
      museums:    { score:100},greenery: { score:62 },  icon_spots:{score:89},
      restaurants:{ score:59 }, street_feel:{ score:89 },
    },
  },
  {
    name: 'Condesa',
    tags: ['returning','local','foodie','nightlife','walkable','green'],
    vibe_short: 'Lush parks, café terraces, vibrant yet liveable',
    attributes: {
      street_energy: 'lively', green_spaces: 'lots',
      poi_counts: { cafes:106, parks:25, shops:226, trees:124, museums:7, icon_spots:19, restaurants:366, trees_street:25 },
    },
    vibe_elements: {
      cafes:      { score:86 }, parks:    { score:66 },  shops:   { score:75 },
      museums:    { score:55 }, greenery: { score:84 },  icon_spots:{score:58},
      restaurants:{ score:87 }, street_feel:{ score:76 },
    },
  },
  {
    name: 'Coyoacán',
    tags: ['returning','local','culture','walkable','artsy','foodie'],
    vibe_short: 'Cobblestone village feel, Frida Kahlo, markets, calm local pace',
    attributes: {
      street_energy: 'moderate', green_spaces: 'some',
      poi_counts: { cafes:55, parks:44, shops:118, trees:490, museums:7, icon_spots:19, restaurants:149, trees_street:490 },
    },
    vibe_elements: {
      cafes:      { score:59 }, parks:    { score:67 },  shops:   { score:52 },
      museums:    { score:53 }, greenery: { score:62 },  icon_spots:{score:56},
      restaurants:{ score:53 }, street_feel:{ score:89 },
    },
  },
  {
    name: 'Juárez',
    tags: ['returning','local','nightlife','walkable','foodie','central'],
    vibe_short: 'Central, walkable, lively nightlife and dining, diverse local energy',
    attributes: {
      street_energy: 'lively', green_spaces: 'minimal',
      poi_counts: { cafes:10, parks:18, shops:29, trees:726, museums:0, icon_spots:6, restaurants:50, trees_street:726 },
    },
    vibe_elements: {
      // Manually corrected 2026-05-15 (Overpass failed during backfill; old stale values were cafes=99/restaurants=98/icon_spots=99)
      cafes:      { score:28 }, parks:    { score:40 },  shops:   { score:27 },
      museums:    { score:8  }, greenery: { score:64 },  icon_spots:{score:20},
      restaurants:{ score:44 }, street_feel:{ score:66 },
    },
  },
  {
    name: 'Paseo de la Reforma',
    tags: ['first-timers','business','walkable','iconic','luxury','culture'],
    vibe_short: 'Grand central boulevard, monuments, business hub, easy transit access',
    attributes: {
      street_energy: 'lively', green_spaces: 'some',
      poi_counts: { cafes:72, parks:53, shops:216, trees:223, museums:21, icon_spots:63, restaurants:241, trees_street:223 },
    },
    vibe_elements: {
      cafes:      { score:74 }, parks:    { score:70 },  shops:   { score:76 },
      museums:    { score:99 }, greenery: { score:62 },  icon_spots:{score:100},
      restaurants:{ score:73 }, street_feel:{ score:76 },
    },
  },
  {
    name: 'Polanco',
    tags: ['luxury','shopping','business','returning','walkable','upscale'],
    vibe_short: 'Designer boutiques, world-class dining, refined and calm',
    attributes: {
      street_energy: 'moderate', green_spaces: 'some',
      poi_counts: { cafes:52, parks:24, shops:196, trees:22, museums:5, icon_spots:10, restaurants:152, trees_street:22 },
    },
    vibe_elements: {
      cafes:      { score:76 }, parks:    { score:66 },  shops:   { score:89 },
      museums:    { score:59 }, greenery: { score:48 },  icon_spots:{score:53},
      restaurants:{ score:71 }, street_feel:{ score:66 },
    },
  },
  {
    name: 'Roma Norte',
    tags: ['returning','local','foodie','nightlife','walkable','artsy'],
    vibe_short: 'Bohemian streets, top cafés, creative local buzz',
    attributes: {
      street_energy: 'lively', green_spaces: 'some',
      poi_counts: { cafes:82, parks:16, shops:213, trees:172, museums:8, icon_spots:8, restaurants:307, trees_street:129 },
    },
    vibe_elements: {
      cafes:      { score:100}, parks:    { score:64 },  shops:   { score:100},
      museums:    { score:80 }, greenery: { score:62 },  icon_spots:{score:52},
      restaurants:{ score:100}, street_feel:{ score:76 },
    },
  },
  {
    name: 'San Rafael',
    tags: ['returning','local','walkable','historic'],
    vibe_short: 'Quiet residential, historic mansions, local life away from tourist trails',
    attributes: {
      street_energy: 'quiet', green_spaces: 'minimal',
      poi_counts: { cafes:17, parks:6, shops:94, trees:6, museums:1, icon_spots:6, restaurants:62, trees_street:6 },
    },
    vibe_elements: {
      cafes:      { score:71 }, parks:    { score:39 },  shops:   { score:99 },
      museums:    { score:43 }, greenery: { score:29 },  icon_spots:{score:67},
      restaurants:{ score:73 }, street_feel:{ score:48 },
    },
  },
  {
    name: 'Aeropuerto',
    tags: ['business','first-timers'],
    vibe_short: 'Airport zone, transit-focused, short-stay convenience',
    attributes: {
      street_energy: 'moderate', green_spaces: 'minimal',
      poi_counts: { cafes:14, parks:12, shops:358, trees:90, museums:3, icon_spots:6, restaurants:121, trees_street:60 },
      // DB-corrected: OSM counted airport grounds as parks (443→12) and airport trees (4218→90); airport terminals as icon_spots (63→6)
    },
    vibe_elements: {
      cafes:      { score:12 }, parks:    { score:12 },  shops:   { score:38 },
      museums:    { score:14 }, greenery: { score:20 },  icon_spots:{score:10},
      restaurants:{ score:20 }, street_feel:{ score:50 },
    },
  },
  {
    name: 'Santa Fe',
    tags: ['business','shopping','modern'],
    vibe_short: 'Modern high-rises, corporate offices, malls, car-oriented business district',
    attributes: {
      street_energy: 'quiet', green_spaces: 'minimal',
      poi_counts: { cafes:0, parks:2, shops:7, trees:0, museums:0, icon_spots:1, restaurants:0 },
    },
    vibe_elements: {
      cafes:      { score:10 }, parks:    { score:37 },  shops:   { score:36 },
      museums:    { score:10 }, greenery: { score:23 },  icon_spots:{score:36},
      restaurants:{ score:10 }, street_feel:{ score:48 },
    },
  },
];

const BOOP_OPTIONS = {
  buzz_central:  { label:'Historic & energetic',  weights:{ iconic:18, culture:14, central:20, nightlife:12, walkability:10, calm:-10, local:-2, luxury:-8 } },
  calm_central:  { label:'Upscale & Refined',    weights:{ luxury:28, shopping:14, calm:14, central:4, walkability:10, nightlife:-14, iconic:2, local:2 } },
  hip_local:     { label:'Trendy & café-filled',  weights:{ local:26, cafes:16, restaurants:12, nightlife:14, walkability:12, central:-12, calm:-2, iconic:-18, touristy:-18, luxury:-10 } },
  leafy_local:   { label:'Quiet & residential',   weights:{ calm:24, green:24, local:20, nightlife:-18, iconic:-18, central:-16, luxury:-14, touristy:-12, shopping:-6, cafes:10, walkability:6 } },
  scenic_open:   { label:'Central & connected',   weights:{ central:20, walkability:16, calm:8, iconic:10, green:4, nightlife:-4 } },
};

const { applyLeafyBusynessPenalty } = require("../lib/nbhd-vibe-rank");

const STREET_ENERGY_SCORE = { 'very lively':90, lively:70, moderate:50, quiet:30, minimal:10 };

function textHasAny(text, arr) {
  const t = (text||'').toLowerCase();
  return arr.some(k => t.includes(k));
}

function effectiveParksScore(h) {
  const raw = Number(h.vibe_elements?.parks?.score || 0);
  const gs = String(h.attributes?.green_spaces||'').toLowerCase();
  const greenAttr = {lots:88, some:62, minimal:35}[gs];
  if (greenAttr == null || gs==='lots') return raw;
  if (gs==='some') return Math.min(raw, Math.round(raw*0.22 + greenAttr*0.78));
  if (gs==='minimal') return Math.min(raw, Math.round(raw*0.14 + greenAttr*0.86));
  return raw;
}

function deriveSignals(h, nbhdScene) {
  const e = h.vibe_elements || {};
  const v = k => Number(e[k]?.score || 0);
  const poi = h.attributes?.poi_counts || {};
  const tags = (h.tags||[]).map(t=>t.toLowerCase());
  const txt = `${h.vibe_short||''}`.toLowerCase();
  const leafy = nbhdScene === 'leafy_local';
  const parkW = leafy ? 0.18 : 0.38;
  const greenW = leafy ? 0.76 : 0.52;

  const vp = effectiveParksScore(h);
  const cafeCount = Number(poi.cafes||0);
  const restaurantCount = Number(poi.restaurants||0);
  const cafeDensity = Math.min(100, Math.round(Math.min(cafeCount,120)/120*100));
  const restaurantDensity = Math.min(100, Math.round(Math.min(restaurantCount,400)/400*100));
  const iconCount = Number(poi.icon_spots||0); // RAW COUNT — not vibe_elements score

  const natureBonus = tags.includes('nature') ? 12 : 0;
  const centralTextBonus = (textHasAny(txt,['central','heart','iconic','boulevard']) || tags.includes('central')) ? 14 : 0;
  const streetFeel = v('street_feel') || STREET_ENERGY_SCORE[(h.attributes?.street_energy||'').toLowerCase()] || 50;

  const s = {
    walkability: Math.round(streetFeel*0.55 + v('cafes')*0.20 + vp*0.25),
    green:       Math.round(vp*parkW + v('greenery')*greenW + natureBonus),
    cafes:       Math.round(v('cafes')*0.45 + cafeDensity*0.55 + (tags.includes('foodie')?6:0)),
    restaurants: Math.round(v('restaurants')*0.45 + restaurantDensity*0.55 + (tags.includes('foodie')?6:0)),
    foodie:      Math.round(v('restaurants')*0.65 + v('cafes')*0.35),
    culture:     Math.round(v('museums')*0.55 + iconCount*0.45 + (tags.includes('culture')?16:0)),
    shopping:    Math.round(v('shops')*0.9 + (tags.includes('shopping')?12:0)),
    nightlife:   Math.round(streetFeel*0.40 + v('restaurants')*0.35 + (tags.includes('nightlife')?18:0)),
    calm:        Math.max(0, Math.round(v('greenery')*0.42 + vp*0.18 + (100-streetFeel)*0.32 + v('cafes')*0.08 - iconCount*0.12)),
    central:     Math.round(iconCount*0.55 + streetFeel*0.25 + centralTextBonus),
    local:       Math.round(v('cafes')*0.35 + streetFeel*0.35 + v('restaurants')*0.30 + (tags.includes('returning')?10:0)),
    iconic:      Math.round(iconCount*0.9 + (textHasAny(txt,['iconic','landmark'])?10:0)),
    luxury:      Math.round(v('shops')*0.55 + ((tags.includes('luxury')||tags.includes('upscale'))?30:0)),
    touristy:    Math.round(iconCount*0.55 + (textHasAny(txt,['touristy','tourist'])?18:0)),
  };
  Object.keys(s).forEach(k => { s[k] = Math.max(0, Math.min(150, s[k])); });
  return s;
}

function normalize(rawArr) {
  const dims = ['walkability','green','cafes','restaurants','foodie','culture','shopping','nightlife','calm','central','local','iconic','luxury','touristy'];
  const minMax = {};
  for (const d of dims) {
    const vals = rawArr.map(r => r.s[d]);
    minMax[d] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  return rawArr.map(r => {
    const out = {};
    for (const d of dims) {
      const { min, max } = minMax[d];
      out[d] = max-min < 0.001 ? 50 : Math.round((r.s[d]-min)/(max-min)*100);
    }
    return { name: r.name, norm: out };
  });
}

function boopScore(norm, weights) {
  let sum = 0, denom = 0;
  for (const [k, wRaw] of Object.entries(weights)) {
    if (typeof norm[k] !== 'number') continue;
    const w = Number(wRaw);
    if (!w) continue;
    const importance = Math.abs(w);
    const x = Math.max(0, Math.min(1, norm[k]/100));
    const fit = w >= 0 ? x : 1-x;
    sum += importance * fit;
    denom += importance;
  }
  return denom > 0 ? sum/denom : 0.5;
}

for (const [sceneId, scene] of Object.entries(BOOP_OPTIONS)) {
  const raw = HOODS.map(h => ({ name: h.name, s: deriveSignals(h, sceneId) }));
  const normed = normalize(raw);
  const scored = normed.map(n => {
    const hood = HOODS.find(h => h.name === n.name);
    let score = boopScore(n.norm, scene.weights);
    if (sceneId === "leafy_local" && hood) {
      score = applyLeafyBusynessPenalty(score, n.norm, sceneId, hood);
    }
    return {
      name: n.name,
      score,
      norm: n.norm,
    };
  });
  scored.sort((a,b) => b.score - a.score);

  // Spread to 45-95 range
  const vals = scored.map(s => s.score);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const spread = (s) => hi-lo < 0.001 ? 75 : Math.round(45 + (s-lo)/(hi-lo)*50);

  console.log(`\n── ${scene.label} (${sceneId}) ─────────────────`);
  scored.forEach((s, i) => {
    const pct = spread(s.score);
    // show key signal values (raw before normalization)
    const rr = raw.find(r => r.name === s.name).s;
    console.log(`  ${String(i+1).padStart(2)}. ${s.name.padEnd(26)} ${String(pct).padStart(3)}%  (calm=${rr.calm} green=${rr.green} iconic=${rr.iconic} central=${rr.central} local=${rr.local} luxury=${rr.luxury})`);
  });
}

console.log('\nData uses actual DB values as of 2026-05-15. Juárez and Aeropuerto vibe_elements were manually corrected (Overpass backfill failed with 403 for both).');
console.log('After backfill, Juárez local/cafes/restaurants will be lower, improving rankings further.');

// ── DEBUG: user's MERGED prefs comparison BEFORE vs AFTER stayVibe-weights fix ──
//
// Profile: trip=first, stayVibe=sleek_polished, nbhdScene=buzz_central
// (Q3 nbhdScene = "Historic & energetic" — user expects Centro Histórico #1.)
//
// BEFORE (May 2026, broken): stayVibe weights (luxury:+14, central:+4, calm:+8)
// merge into BOOP.prefs and CANCEL buzz_central's luxury:-8 and calm:-10. After
// reconcileTripEnvWeights × 0.65 on agreeing dims, the user shipped prefs with
// luxury:+6 and calm:+6 — net positive — silently flipping the algorithm's
// preference toward luxury+calm areas (Reforma) over energetic (Centro Histórico).
// BEFORE prefs (the bug): { central:29, iconic:36, calm:+6, local:-5, luxury:+6, culture:14, nightlife:12, walkability:10 }
//
// AFTER (this commit): stayVibe options no longer have `weights:{...}`.
// Only trip + nbhdScene contribute to BOOP.prefs.
//   trip=first          → central:+20, iconic:+18, calm:+8, local:-6
//   nbhdScene=buzz_central → iconic:+18, culture:+14, central:+20, nightlife:+12,
//                            walkability:+10, calm:-10, local:-2, luxury:-8
//   sum                 → central:40, iconic:36, calm:-2, local:-8, luxury:-8, ...
//   reconcile × 0.65 on (central, local) where trip+loc agree
//   final               → central:26, iconic:36, calm:-2, local:-5, luxury:-8,
//                         culture:14, nightlife:12, walkability:10
// luxury:-8 and calm:-2 are now properly NEGATIVE → Centro Histórico (low luxury,
// low calm, high culture) outranks Paseo de la Reforma (high luxury, somewhat calm).

const beforePrefs = { central:29, iconic:36, calm:6, local:-5, luxury:6, culture:14, nightlife:12, walkability:10 };
const afterPrefs  = { central:26, iconic:36, calm:-2, local:-5, luxury:-8, culture:14, nightlife:12, walkability:10 };

for (const [label, userPrefs] of [['BEFORE (broken)', beforePrefs], ['AFTER (fixed)', afterPrefs]]) {
  const raw = HOODS.map(h => ({ name: h.name, s: deriveSignals(h, 'buzz_central') }));
  const normed = normalize(raw);
  const scored = normed.map(n => ({ name: n.name, score: boopScore(n.norm, userPrefs) }));
  scored.sort((a,b) => b.score - a.score);
  const vals = scored.map(s => s.score);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const spread = (s) => hi-lo < 0.001 ? 75 : Math.round(45 + (s-lo)/(hi-lo)*50);
  console.log(`\n── MERGED prefs ${label} (trip=first + stayVibe=sleek_polished + nbhdScene=buzz_central) ──`);
  console.log('   prefs:', JSON.stringify(userPrefs));
  scored.forEach((s,i) => {
    const rr = raw.find(r => r.name===s.name).s;
    console.log('  ' + String(i+1).padStart(2) + '. ' + s.name.padEnd(26) + ' ' + String(spread(s.score)).padStart(3) + '%  (calm=' + rr.calm + ' iconic=' + rr.iconic + ' central=' + rr.central + ' luxury=' + rr.luxury + ')');
  });
}
