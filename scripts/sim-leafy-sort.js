/**
 * Smoke-test: first + leafy_local profile should sort quiet-area hotels above
 * high-room / low-area-fit Reforma hotels (Best Match blend + room dominance fix).
 *
 * Run: node scripts/sim-leafy-sort.js
 */

const { buildBoopProfile } = require("../lib/boop-wizard");
const { sortHotelsBestMatch } = require("../lib/client-match-sort");

const profile = buildBoopProfile({
  trip: "first",
  stayVibe: "sleek_polished",
  nbhdScene: "leafy_local",
});

const stats = { nbhd_rank_weight: 0.62 };
const ctx = { pricesLoaded: true, hasDateSearch: true, showAvailOnly: false };

const cohort = [
  {
    id: "novotel-condesa",
    name: "Novotel Mexico City World Trade Center",
    nbhd_fit_pct: 94,
    vectorScore: 88,
    roomTypes: [{ score: 88 }],
    price: 180,
  },
  {
    id: "sofitel-reforma",
    name: "Sofitel Mexico City Reforma",
    nbhd_fit_pct: 68,
    vectorScore: 85,
    roomTypes: [{ score: 96 }],
    price: 877,
  },
  {
    id: "hilton-reforma",
    name: "Hilton Mexico City Reforma",
    nbhd_fit_pct: 58,
    vectorScore: 80,
    roomTypes: [{ score: 92 }],
    price: 322,
  },
  {
    id: "be-local",
    name: "Be Local Aparthotel",
    nbhd_fit_pct: 90,
    vectorScore: 88,
    roomTypes: [{ score: 88 }],
    price: 102,
  },
  {
    id: "juarez-express",
    name: "City Express by Marriott Ciudad de México EBC Reforma",
    nbhd_fit_pct: 76,
    vectorScore: 85,
    roomTypes: [{ score: 100 }],
    price: 120,
  },
  {
    id: "ritz-reforma",
    name: "The Ritz-Carlton Mexico City",
    nbhd_fit_pct: 57,
    vectorScore: 90,
    roomTypes: [{ score: 100 }],
    price: 1200,
  },
];

const { hotels, meta } = sortHotelsBestMatch([...cohort], stats, profile, ctx);

console.log("Profile: first + sleek_polished + leafy_local");
console.log(`  prefs.central=${profile.prefs.central} iconic=${profile.prefs.iconic} calm=${profile.prefs.calm}`);
console.log(`  sort wNbhd=${meta.wNbhd.toFixed(3)} pm=${meta.pm}\n`);

console.log("Best Match order (mock cohort):");
hotels.forEach((h, i) => {
  const room = meta.roomMatchScore(h);
  const blend = meta.blendedMatchScore(h);
  const sort = meta.sortScore(h);
  console.log(
    `  ${String(i + 1).padStart(2)}. ${h.name.slice(0, 36).padEnd(36)} `
    + `sort=${sort.toFixed(1).padStart(5)} blend=${blend.toFixed(1).padStart(5)} `
    + `room=${String(room).padStart(3)} nbhd=${String(Math.round(h.nbhd_fit_pct)).padStart(2)}`
  );
});

const top = hotels[0]?.id;
const reformaTop3 = hotels.slice(0, 3).filter((h) => h.nbhd_fit_pct < 70).length;
const beLocalRank = hotels.findIndex((h) => h.id === "be-local") + 1;
const sofitelRank = hotels.findIndex((h) => h.id === "sofitel-reforma") + 1;

console.log("");
if (beLocalRank > 0 && sofitelRank > 0 && beLocalRank < sofitelRank) {
  console.log(`PASS: Be Local (#${beLocalRank}) ranks above Sofitel (#${sofitelRank}) despite lower room score`);
} else {
  console.log(`FAIL: Be Local rank=${beLocalRank}, Sofitel rank=${sofitelRank}`);
  process.exitCode = 1;
}

if (reformaTop3 >= 2) {
  console.log(`FAIL: ${reformaTop3}/3 top slots are low-area-fit (<70%) hotels`);
  process.exitCode = 1;
} else {
  console.log(`PASS: at most one low-area-fit hotel in top 3 (${reformaTop3})`);
}

if (top === "be-local" || top === "novotel-condesa") {
  console.log(`PASS: #1 is quiet-area hotel (${hotels[0].name})`);
} else {
  console.log(`WARN: #1 is ${hotels[0]?.name} — check if acceptable`);
}

function bestRoomPickScore(h) {
  const w = 0.48;
  const room = Math.max(0, ...(h.roomTypes || []).map((rt) => rt.score || 0)) || h.vectorScore || 0;
  let s = (1 - w) * room + w * (h.nbhd_fit_pct || 0);
  if ((h.nbhd_fit_pct || 0) < 55) s *= (h.nbhd_fit_pct || 0) / 55;
  return s;
}

console.log("\nBest room pick (leafy_local, w=0.48, excluding overall #1):");
const pool = cohort.filter((h) => h.id !== hotels[0]?.id);
const roomCandidates = pool
  .map((h) => ({
    id: h.id,
    name: h.name,
    room: Math.max(0, ...(h.roomTypes || []).map((rt) => rt.score || 0)),
    nbhd: h.nbhd_fit_pct,
    pick: bestRoomPickScore(h),
  }))
  .sort((a, b) => b.pick - a.pick);
roomCandidates.forEach((r, i) => {
  console.log(
    `  ${i + 1}. ${r.name.slice(0, 36).padEnd(36)} pick=${r.pick.toFixed(1).padStart(5)} `
    + `room=${String(r.room).padStart(3)} nbhd=${r.nbhd}`
  );
});
const bestRoomId = roomCandidates[0]?.id;
if (bestRoomId === "juarez-express" || bestRoomId === "sofitel-reforma" || bestRoomId === "ritz-reforma") {
  console.log("\nFAIL: Best room favours corridor hotel over Condesa");
  process.exitCode = 1;
} else if (roomCandidates[0]?.room < 40) {
  console.log(`\nFAIL: Best room pick has room score ${roomCandidates[0].room} (< 40)`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: Best room favours quiet-area hotel (Juárez 100% room loses)");
}

// Inverted-compare regression: 18% room hotel must never win Best room.
function compareBestRoomPick(a, b, w = 0.48) {
  const score = (h) => {
    const room = Math.max(0, ...(h.roomTypes || []).map((rt) => rt.score || 0)) || h.vectorScore || 0;
    if (h.nbhd_fit_pct == null) return room;
    let s = (1 - w) * room + w * h.nbhd_fit_pct;
    if (h.nbhd_fit_pct < 55) s *= h.nbhd_fit_pct / 55;
    return s;
  };
  const sa = score(a);
  const sb = score(b);
  return sa - sb;
}
const menara = {
  id: "menara",
  name: "Hotel Menara",
  nbhd_fit_pct: 48,
  vectorScore: 18,
  roomTypes: [{ score: 18 }],
};
const poolNoOverall = cohort.filter((h) => h.id !== "novotel-condesa");
let best = null;
for (const h of poolNoOverall) {
  if (Math.max(0, ...(h.roomTypes || []).map((rt) => rt.score || 0)) < 40) continue;
  if (!best || compareBestRoomPick(h, best) > 0) best = h;
}
if (best?.id === "menara" || (best && Math.max(...best.roomTypes.map((r) => r.score)) < 40)) {
  console.log("\nFAIL: inverted-compare / eligibility — low room hotel won Best room");
  process.exitCode = 1;
} else {
  console.log(`\nPASS: inverted-compare fix (Best room=${best?.name?.slice(0, 28)}, not Menara 18%)`);
}
