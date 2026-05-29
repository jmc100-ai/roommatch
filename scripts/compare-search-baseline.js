#!/usr/bin/env node
/**
 * Compare a fresh baseline capture against the golden file.
 *
 *   node scripts/compare-search-baseline.js
 *   node scripts/compare-search-baseline.js --golden=reports/search-baseline-golden.json --current=reports/search-baseline-current.json
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const goldenPath = path.resolve(
  (process.argv.find((a) => a.startsWith("--golden=")) || "--golden=reports/search-baseline-golden.json").split("=")[1]
);
const currentPath = path.resolve(
  (process.argv.find((a) => a.startsWith("--current=")) || "--current=reports/search-baseline-current.json").split("=")[1]
);
const captureFresh = process.argv.includes("--capture");

function load(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

if (captureFresh) {
  const baseUrl = (process.argv.find((a) => a.startsWith("--base-url=")) || "").split("=")[1];
  const args = ["scripts/capture-search-baseline.js", `--out=${currentPath}`];
  if (baseUrl) args.push(`--base-url=${baseUrl}`);
  const r = spawnSync("node", args, { stdio: "inherit", cwd: path.join(__dirname, "..") });
  if (r.status !== 0) process.exit(r.status || 1);
}

const golden = load(goldenPath);
const current = load(currentPath);
if (!golden) {
  console.error(`Golden file missing: ${goldenPath}`);
  process.exit(1);
}
if (!current) {
  console.error(`Current file missing: ${currentPath} (run with --capture)`);
  process.exit(1);
}

const gMap = new Map((golden.cases || []).map((c) => [c.id, c]));
let failures = 0;
let warnings = 0;

console.log(`Compare: ${path.basename(currentPath)} vs golden (${golden.capturedAt})\n`);

for (const cur of current.cases || []) {
  const g = gMap.get(cur.id);
  if (!g) {
    console.log(`? ${cur.id}: new case (no golden)`);
    continue;
  }
  if (cur.error || g.error) {
    console.log(`✗ ${cur.id}: error cur=${cur.error} golden=${g.error}`);
    failures++;
    continue;
  }

  const issues = [];
  const warningsForCase = [];

  const gTop = (g.top10 || []).map((h) => h.id);
  const cTop = (cur.top10 || []).map((h) => h.id);
  const gSrv = (g.serverTop10Ids || g.top10Ids || "").split(",").filter(Boolean);
  const cSrv = (cur.serverTop10Ids || cur.top10Ids || "").split(",").filter(Boolean);
  const serverTop3Changed = gSrv.slice(0, 3).join(",") !== cSrv.slice(0, 3).join(",");
  const top10Changed = gTop.join(",") !== cTop.join(",");

  if (serverTop3Changed) {
    issues.push(`server top3 changed\n    was: ${gSrv.slice(0, 3).join(",")}\n    now: ${cSrv.slice(0, 3).join(",")}`);
  } else if (top10Changed) {
    warningsForCase.push(`client top10 shuffled (rates / Best Match)\n    was: ${g.top10Ids}\n    now: ${cur.top10Ids}`);
  }

  for (let i = 0; i < Math.min(3, (cur.top10 || []).length, (g.top10 || []).length); i++) {
    const a = cur.top10[i];
    const b = g.top10[i];
    if (a.id !== b.id) continue;
    if (Math.abs((a.roomMatch || 0) - (b.roomMatch || 0)) > 2) {
      issues.push(`#${i + 1} ${a.id} roomMatch ${b.roomMatch}→${a.roomMatch}`);
    }
    if (a.nbhd_fit_pct != null && b.nbhd_fit_pct != null && Math.abs(a.nbhd_fit_pct - b.nbhd_fit_pct) > 2) {
      issues.push(`#${i + 1} ${a.id} nbhd ${b.nbhd_fit_pct}→${a.nbhd_fit_pct}`);
    }
  }

  const byteDelta = (cur.payload?.totalBytes || 0) - (g.payload?.totalBytes || 0);
  if (byteDelta < -500000) {
    console.log(`  ${cur.id}: payload ${Math.round((g.payload?.totalBytes || 0) / 1e6 * 10) / 10}MB → ${Math.round((cur.payload?.totalBytes || 0) / 1e6 * 10) / 10}MB (Δ${Math.round(byteDelta / 1e6 * 10) / 10}MB) ✓`);
  }

  const vsearchDelta = (cur.perf?.vsearchWallMs || 0) - (g.perf?.vsearchWallMs || 0);
  if (vsearchDelta < -500) {
    console.log(`  ${cur.id}: vsearch ${g.perf?.vsearchWallMs}ms → ${cur.perf?.vsearchWallMs}ms (Δ${vsearchDelta}ms) ✓`);
  } else if (vsearchDelta > 1500) {
    issues.push(`vsearch slower by ${vsearchDelta}ms`);
  }

  if (cur.stats?.slim_stubs && (cur.payload?.stubs || 0) > 0) {
    const stubWithAttrs = (cur.top10 || []).filter((h) => h.stubHasNbhdAttrs).length;
    if (stubWithAttrs > 0) warnings++;
  }

  if (issues.length) {
    console.log(`✗ ${cur.id}:`);
    for (const iss of issues) console.log(`    ${iss}`);
    failures++;
  } else {
    if (warningsForCase.length) {
      console.log(`~ ${cur.id} (warning):`);
      for (const w of warningsForCase) console.log(`    ${w}`);
      warnings += warningsForCase.length;
    } else {
      console.log(`✓ ${cur.id}`);
    }
  }
}

console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures > 0 ? 1 : 0);
