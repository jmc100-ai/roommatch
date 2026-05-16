/**
 * Verify the stayVibe-weights-removal fix by running the SERVER-SIDE
 * lib/nbhd-vibe-rank.js logic against a snapshot of the LIVE Supabase
 * neighbourhoods data (May 2026, Mexico City). This is a true end-to-end
 * sim — no algorithm copy-paste; we import the same module the server uses.
 *
 * Run: node scripts/verify-nbhd-fix.js
 */

const path = require("path");

// Live snapshot of the production `neighborhoods` table for Mexico City
// (pulled via Supabase MCP, May 15 2026 — see HOTEL VIBE / nbhd context).
const HOODS = [
  { name: "Aeropuerto",          tags: ["business","first-timers"], vibe_short: "Airport zone, transit-focused, short-stay convenience", attributes: { green_spaces: "minimal", street_energy: "moderate", poi_counts: { cafes:14, parks:12, shops:358, trees:90, museums:3, icon_spots:6, restaurants:121, trees_street:60 } }, vibe_elements: { cafes:{score:14}, parks:{score:33}, shops:{score:38}, museums:{score:14}, greenery:{score:24}, icon_spots:{score:14}, restaurants:{score:22}, street_feel:{score:48} } },
  { name: "Centro Histórico",    tags: ["first-timers","walkable","culture","iconic","nightlife","foodie"], vibe_short: "Iconic landmarks, colonial grandeur, museums, local bustle", attributes: { green_spaces: "minimal", street_energy: "very lively", poi_counts: { cafes:71, parks:66, shops:617, trees:1430, museums:58, icon_spots:104, restaurants:395, trees_street:1430 } }, vibe_elements: { cafes:{score:51}, parks:{score:40}, shops:{score:82}, museums:{score:100}, greenery:{score:47}, icon_spots:{score:98}, restaurants:{score:64}, street_feel:{score:75} } },
  { name: "Condesa",             tags: ["returning","local","foodie","nightlife","walkable","green"], vibe_short: "Lush parks, café terraces, vibrant yet liveable", attributes: { green_spaces: "lots", street_energy: "lively", poi_counts: { cafes:106, parks:25, shops:226, trees:124, museums:7, icon_spots:19, restaurants:366, trees_street:25 } }, vibe_elements: { cafes:{score:96}, parks:{score:68}, shops:{score:76}, museums:{score:55}, greenery:{score:84}, icon_spots:{score:64}, restaurants:{score:95}, street_feel:{score:76} } },
  { name: "Coyoacán",            tags: ["returning","local","culture","walkable","artsy","foodie"], vibe_short: "Cobblestone village feel, Frida Kahlo, markets, calm local pace", attributes: { green_spaces: "some", street_energy: "moderate", poi_counts: { cafes:55, parks:44, shops:118, trees:490, museums:7, icon_spots:19, restaurants:149, trees_street:490 } }, vibe_elements: { cafes:{score:66}, parks:{score:67}, shops:{score:52}, museums:{score:52}, greenery:{score:62}, icon_spots:{score:61}, restaurants:{score:58}, street_feel:{score:79} } },
  { name: "Juárez",              tags: ["returning","local","nightlife","walkable","foodie","central"], vibe_short: "Central, walkable, lively nightlife and dining, diverse local energy", attributes: { green_spaces: "minimal", street_energy: "lively", poi_counts: { cafes:10, parks:18, shops:29, trees:726, museums:0, icon_spots:6, restaurants:50, trees_street:726 } }, vibe_elements: { cafes:{score:51}, parks:{score:44}, shops:{score:47}, museums:{score:10}, greenery:{score:47}, icon_spots:{score:62}, restaurants:{score:61}, street_feel:{score:76} } },
  { name: "Paseo de la Reforma", tags: ["first-timers","business","walkable","iconic","luxury","culture"], vibe_short: "Grand central boulevard, monuments, business hub, easy transit access", attributes: { green_spaces: "some", street_energy: "lively", poi_counts: { cafes:72, parks:53, shops:216, trees:223, museums:21, icon_spots:63, restaurants:241, trees_street:223 } }, vibe_elements: { cafes:{score:82}, parks:{score:70}, shops:{score:77}, museums:{score:98}, greenery:{score:62}, icon_spots:{score:100}, restaurants:{score:80}, street_feel:{score:89} } },
  { name: "Polanco",             tags: ["luxury","shopping","business","returning","walkable","upscale"], vibe_short: "Designer boutiques, world-class dining, refined and calm", attributes: { green_spaces: "some", street_energy: "moderate", poi_counts: { cafes:52, parks:24, shops:196, trees:22, museums:5, icon_spots:10, restaurants:152, trees_street:22 } }, vibe_elements: { cafes:{score:85}, parks:{score:67}, shops:{score:89}, museums:{score:59}, greenery:{score:48}, icon_spots:{score:58}, restaurants:{score:77}, street_feel:{score:66} } },
  { name: "Roma Norte",          tags: ["returning","local","foodie","nightlife","walkable","artsy"], vibe_short: "Bohemian streets, top cafés, creative local buzz", attributes: { green_spaces: "some", street_energy: "lively", poi_counts: { cafes:82, parks:16, shops:213, trees:172, museums:8, icon_spots:8, restaurants:307, trees_street:129 } }, vibe_elements: { cafes:{score:100}, parks:{score:65}, shops:{score:100}, museums:{score:80}, greenery:{score:62}, icon_spots:{score:56}, restaurants:{score:100}, street_feel:{score:76} } },
  { name: "San Rafael",          tags: ["returning","local","walkable","historic"], vibe_short: "Quiet residential, historic mansions, local life away from tourist trails", attributes: { green_spaces: "minimal", street_energy: "quiet", poi_counts: { cafes:17, parks:6, shops:94, trees:6, museums:1, icon_spots:6, restaurants:62, trees_street:6 } }, vibe_elements: { cafes:{score:78}, parks:{score:39}, shops:{score:100}, museums:{score:42}, greenery:{score:29}, icon_spots:{score:73}, restaurants:{score:80}, street_feel:{score:41} } },
  { name: "Santa Fe",            tags: ["business","shopping","modern"], vibe_short: "Modern high-rises, corporate offices, malls, car-oriented business district", attributes: { green_spaces: "minimal", street_energy: "quiet", poi_counts: { cafes:0, parks:2, shops:7, trees:0, museums:0, icon_spots:1, restaurants:0, trees_street:0 } }, vibe_elements: { cafes:{score:10}, parks:{score:37}, shops:{score:36}, museums:{score:10}, greenery:{score:23}, icon_spots:{score:39}, restaurants:{score:10}, street_feel:{score:41} } },
];

const { buildNeighborhoodMatchById } = require(path.resolve(__dirname, "..", "lib", "nbhd-vibe-rank.js"));

// Two boop profiles: BEFORE (broken — stayVibe weights bled in) vs
// AFTER (fixed — stayVibe contributes nothing to BOOP.prefs).
//
// Both profiles use the same answer set:
//   trip=first, stayVibe=sleek_polished, nbhdScene=buzz_central
//
// BEFORE: BOOP.prefs sums weights from all three answers' weight tables.
//   trip(first):           central:+20, iconic:+18, calm:+8, local:-6
//   stayVibe(sleek):       luxury:+14, central:+4, calm:+8
//   nbhdScene(buzz):       iconic:+18, culture:+14, central:+20, nightlife:+12,
//                          walkability:+10, calm:-10, local:-2, luxury:-8
//   sum:                   central:44, iconic:36, calm:+6, local:-8, luxury:+6, ...
//   reconcile × 0.65:      central:29, local:-5  (rest unchanged)
//
// AFTER: stayVibe option has no `weights` field → contributes nothing.
//   sum:                   central:40, iconic:36, calm:-2, local:-8, luxury:-8, ...
//   reconcile × 0.65:      central:26, local:-5  (rest unchanged)

const PROFILE_BEFORE = {
  prefs: { central:29, iconic:36, calm:6, local:-5, luxury:6, culture:14, nightlife:12, walkability:10 },
  freetext: "",
  dealbreakers: [],
  answers: { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central" },
};
const PROFILE_AFTER = {
  prefs: { central:26, iconic:36, calm:-2, local:-5, luxury:-8, culture:14, nightlife:12, walkability:10 },
  freetext: "",
  dealbreakers: [],
  answers: { trip: "first", stayVibe: "sleek_polished", nbhdScene: "buzz_central" },
};

function rank(label, profile) {
  const hoodsWithId = HOODS.map((h, i) => ({ ...h, id: i + 1 }));
  const matchById = buildNeighborhoodMatchById(hoodsWithId, profile);
  const ranked = hoodsWithId
    .map((h) => ({ name: h.name, pct: matchById.get(h.id) ?? 0 }))
    .sort((a, b) => b.pct - a.pct);
  console.log(`\n── ${label} ──`);
  console.log("  prefs:", JSON.stringify(profile.prefs));
  ranked.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(26)} ${String(r.pct).padStart(3)}%`);
  });
  return ranked;
}

const before = rank("BEFORE (broken — stayVibe bled into prefs)", PROFILE_BEFORE);
const after  = rank("AFTER (fixed — stayVibe weights removed)",   PROFILE_AFTER);

console.log("\n── Δ summary ──");
const beforeMap = new Map(before.map((r) => [r.name, r.pct]));
const afterMap = new Map(after.map((r) => [r.name, r.pct]));
for (const r of after) {
  const d = r.pct - (beforeMap.get(r.name) || 0);
  const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "·";
  console.log(`  ${r.name.padEnd(26)} ${String(beforeMap.get(r.name)).padStart(3)}% → ${String(r.pct).padStart(3)}%  ${arrow}${Math.abs(d)}`);
}

console.log("\n  Reforma vs Centro: BEFORE Δ=", beforeMap.get("Paseo de la Reforma") - beforeMap.get("Centro Histórico"));
console.log("                       AFTER  Δ=", afterMap.get("Paseo de la Reforma") - afterMap.get("Centro Histórico"));
