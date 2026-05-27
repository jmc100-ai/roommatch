#!/usr/bin/env node
/**
 * Quick /api/vsearch latency audit (Mexico City by default).
 *
 *   node scripts/audit-vsearch-perf.js
 *   node scripts/audit-vsearch-perf.js --base-url=http://localhost:3000
 *   node scripts/audit-vsearch-perf.js --runs=3
 *
 * Prints client wall time + server stats.perf_ms / handler_wall_ms when present.
 */

require("dotenv").config();

const BASE = (process.argv.find((a) => a.startsWith("--base-url=")) || "--base-url=http://localhost:3000")
  .split("=")[1]
  .replace(/\/$/, "");
const RUNS = Math.max(1, parseInt(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || "2", 10));

const QUERY = "sleek modern minimalist room, clean lines, natural light";
const CITY = "Mexico City";

async function oneRun(i) {
  const params = new URLSearchParams({
    query: QUERY,
    city: CITY,
    search_version: "v2",
    boop_profile: JSON.stringify({
      answers: { group_size: "couple", priceMatters: 100, stayVibe: "sleek_polished", nbhdScene: "buzz_central" },
      prefs: { central: 11, iconic: 36, walkability: 10, nightlife: 12 },
      dealbreakers: [],
    }),
  });
  const url = `${BASE}/api/vsearch?${params}`;
  const headers = {};
  if (process.env.INDEX_SECRET) headers["x-index-secret"] = process.env.INDEX_SECRET;
  const t0 = Date.now();
  const r = await fetch(url, { headers });
  const wall = Date.now() - t0;
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Run ${i + 1}: HTTP ${r.status} — not JSON (${text.slice(0, 120)}…)`);
    return { wall, ok: false };
  }
  const st = data.stats || {};
  const perf = st.perf_ms || {};
  console.log(
    `Run ${i + 1}: HTTP ${r.status} wall=${wall}ms hotels=${(data.hotels || []).length}` +
    ` | handler=${st.handler_wall_ms ?? "—"}ms meta_sync=${st.meta_sync_ms ?? "—"}ms (n=${st.meta_sync_count ?? "—"})` +
    ` | v2 wall=${perf.wall_ms ?? "—"} phase_a=${perf.phase_a_ms ?? "—"} nlp=${perf.nlp_intent_ms ?? "—"} phase_b=${perf.phase_b_ms ?? "—"}`
  );
  return { wall, ok: r.ok };
}

(async () => {
  console.log(`Audit ${RUNS}× GET /api/vsearch\n  ${BASE}\n  city=${CITY}\n`);
  const walls = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await oneRun(i);
    if (r.ok) walls.push(r.wall);
    if (i < RUNS - 1) await new Promise((res) => setTimeout(res, 400));
  }
  if (walls.length) {
    walls.sort((a, b) => a - b);
    const med = walls[Math.floor(walls.length / 2)];
    console.log(`\nClient wall: min=${walls[0]}ms med=${med}ms max=${walls[walls.length - 1]}ms`);
    if (med > 5000) {
      console.log("⚠ Over 5s — check Render logs for [v2 perf] and [v2-meta] lines; meta_sync often dominates Boop searches.");
    }
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
