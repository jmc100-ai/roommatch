#!/usr/bin/env node
/**
 * Poll London index + neighborhoods; auto-resume stalled index + rebuild search lag.
 *
 *   node scripts/monitor-london-launch.js              # every 5m, auto-fix ON
 *   node scripts/monitor-london-launch.js --once
 *   node scripts/monitor-london-launch.js --no-auto-fix
 *   node scripts/monitor-london-launch.js --interval=10
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { snapshot, formatReport, checkAndFix } = require("./launch-watchdog");

const CITY = "London";
const INTERVAL_MIN = Number((process.argv.find((a) => a.startsWith("--interval=")) || "").split("=")[1]) || 5;
const ONCE = process.argv.includes("--once");
const AUTO_FIX = !process.argv.includes("--no-auto-fix");
const LOG_PATH = path.join(process.cwd(), "logs", "london-launch-monitor.log");
const STATE_PATH = path.join(process.cwd(), "logs", "london-launch-watchdog.state.json");

async function tick() {
  const s = await snapshot(CITY);
  const actions = await checkAndFix(s, {
    city: CITY,
    logPath: LOG_PATH,
    statePath: STATE_PATH,
    autoFix: AUTO_FIX && !ONCE,
  });
  const report = formatReport(s, actions);
  console.log(report);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, report + "\n");
  return s;
}

async function main() {
  const mode = AUTO_FIX && !ONCE ? "auto-fix ON" : "observe only";
  console.log(`Monitoring ${CITY} every ${INTERVAL_MIN}m (${mode}) → ${LOG_PATH}`);
  await tick();
  if (ONCE) return;
  for (;;) {
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60 * 1000));
    await tick();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
